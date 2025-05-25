const axios = require('axios');
const { ITEMS_PER_PAGE, TRAKT_CLIENT_ID } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');

const TRAKT_API_URL = 'https://api.trakt.tv';

async function initTraktApi(userConfig) {
  if (userConfig.traktAccessToken && userConfig.traktExpiresAt) {
    const now = new Date();
    const expiresAt = new Date(userConfig.traktExpiresAt);
    if (now < expiresAt) return true; // Token is valid
    // Token expired, try to refresh
    if (userConfig.traktRefreshToken) return refreshTraktToken(userConfig);
  }
  return false; // No token, expired and no refresh token, or refresh failed
}

async function refreshTraktToken(userConfig) {
  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      refresh_token: userConfig.traktRefreshToken,
      client_id: TRAKT_CLIENT_ID,
      // client_secret: TRAKT_CLIENT_SECRET, // Not typically used for PIN auth flow with public clients
      grant_type: 'refresh_token',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' // Must match what was used for initial auth
    }, { headers: { 'Content-Type': 'application/json' } });

    if (response.status === 200 && response.data) {
      userConfig.traktAccessToken = response.data.access_token;
      userConfig.traktRefreshToken = response.data.refresh_token; // Store the new refresh token
      userConfig.traktExpiresAt = new Date(Date.now() + (response.data.expires_in * 1000)).toISOString();
      // Persist these changes (e.g., by re-compressing config or specific update endpoint)
      // For now, assume userConfig is mutated and will be saved by the caller
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error refreshing Trakt token:", error.message);
    if (error.response?.status === 401) { // Unauthorized, likely bad refresh token
      // Invalidate tokens
      userConfig.traktAccessToken = null;
      userConfig.traktRefreshToken = null;
      userConfig.traktExpiresAt = null;
    }
    return false;
  }
}

function getTraktAuthUrl() {
  return `${TRAKT_API_URL}/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;
}

async function authenticateTrakt(code) {
  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      code,
      client_id: TRAKT_CLIENT_ID,
      // client_secret: TRAKT_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });

    if (response.status === 200 && response.data) {
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000)).toISOString()
      };
    }
    throw new Error('Failed to authenticate with Trakt');
  } catch (error) {
    console.error("Error authenticating with Trakt:", error.response?.data || error.message);
    throw error; // Re-throw to be handled by the caller
  }
}

async function fetchTraktLists(userConfig) {
  if (!await initTraktApi(userConfig)) return []; // Ensure token is valid/refreshed

  try {
    const response = await axios.get(`${TRAKT_API_URL}/users/me/lists`, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${userConfig.traktAccessToken}`
      }
    });
    const lists = response.data.map(list => ({
      id: `trakt_${list.ids.slug}`, // Use slug for ID
      name: list.name,
      updated: list.updated_at,
      listType: 'T', // Custom type for Trakt user lists
      isTraktList: true
    }));
    // Add special Trakt lists
    const specialLists = [
      { id: 'trakt_watchlist', name: 'Trakt Watchlist', isTraktWatchlist: true, listType: 'T'},
      { id: 'trakt_recommendations_movies', name: 'Recommended Movies', isTraktRecommendations: true, isMovieList: true, listType: 'T'},
      { id: 'trakt_recommendations_shows', name: 'Recommended Shows', isTraktRecommendations: true, isShowList: true, listType: 'T'},
      { id: 'trakt_trending_movies', name: 'Trending Movies', isTraktTrending: true, isMovieList: true, listType: 'T'},
      { id: 'trakt_trending_shows', name: 'Trending Shows', isTraktTrending: true, isShowList: true, listType: 'T'},
      { id: 'trakt_popular_movies', name: 'Popular Movies', isTraktPopular: true, isMovieList: true, listType: 'T'},
      { id: 'trakt_popular_shows', name: 'Popular Shows', isTraktPopular: true, isShowList: true, listType: 'T'}
    ];
    return [...lists, ...specialLists.map(sl => ({ ...sl, updated: new Date().toISOString() }))];
  } catch (error) {
    console.error("Error fetching Trakt lists:", error.message);
    return [];
  }
}

async function fetchPublicTraktListDetails(traktListUrl) {
  try {
    const cleanedUrl = traktListUrl.split('?')[0]; // Remove query params if any
    const urlMatch = cleanedUrl.match(/^https?:\/\/trakt\.tv\/users\/([\w-]+)\/lists\/([\w-]+)\/?$/);
    if (!urlMatch) throw new Error('Invalid Trakt list URL format. Expected: https://trakt.tv/users/username/lists/list-slug-or-id');
    
    const [, username, listSlugOrId] = urlMatch;
    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID
    };

    // Fetch main list details to get name, actual slug, etc.
    const listDetailsResponse = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}`, { headers });
    if (!listDetailsResponse.data) throw new Error('Could not fetch Trakt list details.');
    const listData = listDetailsResponse.data;

    // Determine if list has movies/shows by fetching a few items
    let hasMovies = false, hasShows = false;
    if (listData.item_count > 0) {
      const itemsResp = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listData.ids.slug}/items?limit=5&extended=full`, { headers });
      if (itemsResp.data && Array.isArray(itemsResp.data)) {
        for (const item of itemsResp.data) {
          if (item.type === 'movie' && item.movie) hasMovies = true;
          if (item.type === 'show' && item.show) hasShows = true;
          if (hasMovies && hasShows) break; // Stop if both found
        }
      }
    }

    return {
      listId: `traktpublic_${username}_${listData.ids.slug}`, // Unique ID for AIOLists
      originalTraktId: String(listData.ids.trakt), // Store original Trakt numeric ID
      originalTraktSlug: listData.ids.slug, // Store original Trakt slug
      traktUser: username, // Store the Trakt username
      listName: listData.name,
      isTraktPublicList: true,
      hasMovies: hasMovies,
      hasShows: hasShows,
      itemCount: listData.item_count
    };
  } catch (error) {
    console.error('Error fetching public Trakt list details:', error.response?.data || error.message);
    throw new Error(`Failed to fetch Trakt list: ${error.response?.data?.error_description || error.message}`);
  }
}


async function fetchTraktListItems(listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc', isPublicImport = false, publicUsername = null, itemTypeHint = null, genre = null) { // Added genre
  const limit = ITEMS_PER_PAGE;
  const page = Math.floor(skip / limit) + 1; // Trakt API is 1-indexed for pages
  const headers = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID
  };
  
  const logContext = `TraktListItems (ID: ${listId}, TypeHint: ${itemTypeHint || 'any'}, Genre: ${genre || 'any'}, Page: ${page})`;

  if (!isPublicImport) { // For private lists, ensure token is valid
    if (!await initTraktApi(userConfig)) {
      console.error(`[${logContext}] Trakt API not initialized or token refresh failed.`);
      return null;
    }
    headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
  }

  let requestUrl;
  let params = { limit, page, extended: 'full' };
  let rawTraktEntries = [];
  let effectiveItemTypeForEndpoint = itemTypeHint; // movie, series, or null for mixed


  try {
    if (isPublicImport && publicUsername) {
        // For public lists, listId is like 'traktpublic_username_actualslug'
        const actualSlugOrId = listId.replace(/^traktpublic_[^_]+_/, '');
        const traktApiItemTypePath = itemTypeHint === 'series' ? 'shows' : (itemTypeHint === 'movie' ? 'movies' : null);
        
        if (!traktApiItemTypePath) { // If no specific type hint, fetch all types from the list
             requestUrl = `${TRAKT_API_URL}/users/${publicUsername}/lists/${actualSlugOrId}/items`;
        } else { // Fetch only a specific type if hinted
            requestUrl = `${TRAKT_API_URL}/users/${publicUsername}/lists/${actualSlugOrId}/items/${traktApiItemTypePath}`;
        }
        // Sorting for public user lists (can be by rank, added, title etc.)
        if (['rank', 'added', 'title', 'released', 'runtime', 'popularity', 'votes', 'random'].includes(sortBy)) {
            params.sort_by = sortBy;
            if (sortOrder) params.sort_how = sortOrder; // asc or desc
        }
    } else if (listId === 'trakt_watchlist') {
        if (['rank', 'added', 'released', 'title'].includes(sortBy)) params.sort = sortBy; // Watchlist uses 'sort'
        if (sortOrder) params.order = sortOrder; // asc or desc

        if (!itemTypeHint) { // Fetch both movies and shows for watchlist if no type hint
            const [moviesResp, showsResp] = await Promise.all([
                axios.get(`${TRAKT_API_URL}/users/me/watchlist/movies`, { headers, params }).catch(e => ({ data: [] })),
                axios.get(`${TRAKT_API_URL}/users/me/watchlist/shows`, { headers, params }).catch(e => ({ data: [] }))
            ]);
            if (Array.isArray(moviesResp.data)) rawTraktEntries.push(...moviesResp.data.map(entry => ({ ...entry, typeFromParams: 'movie'}))); // Add type hint
            if (Array.isArray(showsResp.data)) rawTraktEntries.push(...showsResp.data.map(entry => ({ ...entry, typeFromParams: 'show'})));
        } else { // Fetch specific type for watchlist
            requestUrl = `${TRAKT_API_URL}/users/me/watchlist/${itemTypeHint === 'series' ? 'shows' : 'movies'}`;
            effectiveItemTypeForEndpoint = itemTypeHint;
        }
    } else if (listId.startsWith('trakt_recommendations_')) {
        effectiveItemTypeForEndpoint = listId.endsWith('_movies') ? 'movie' : (listId.endsWith('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) return null; // Invalid recommendations list ID
        requestUrl = `${TRAKT_API_URL}/recommendations/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}`;
        // Recommendations can be filtered by genre on Trakt's side
        if (genre) params.genres = genre.toLowerCase().replace(/\s+/g, '-'); // Trakt uses slugified genres
        params = { ...params, limit, page, extended: 'full' }; // Ensure params are correctly set
    } else if (listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
        effectiveItemTypeForEndpoint = listId.includes('_movies') ? 'movie' : (listId.includes('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) return null;
        const endpointType = listId.startsWith('trakt_trending_') ? 'trending' : 'popular';
        if (headers.Authorization) delete headers.Authorization; // Trending/Popular don't need auth and can fail if sent with bad token
        requestUrl = `${TRAKT_API_URL}/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}/${endpointType}`;
        // Trending/Popular can also be filtered by genre on Trakt's side
        if (genre) params.genres = genre.toLowerCase().replace(/\s+/g, '-');
        params = { ...params, limit, page, extended: 'full' };
    } else if (listId.startsWith('trakt_')) { // Regular user list
        const listSlug = listId.replace('trakt_', '');
        requestUrl = `${TRAKT_API_URL}/users/me/lists/${listSlug}/items`;
        if (itemTypeHint) { // If a specific type is requested for a user list
             const typePath = itemTypeHint === 'series' ? 'shows' : (itemTypeHint === 'movie' ? 'movies' : null);
             if (typePath) requestUrl += `/${typePath}`; // Append /movies or /shows
             effectiveItemTypeForEndpoint = itemTypeHint;
        }
        // Sorting for user lists
        if (sortBy) params.sort_by = sortBy; 
        if (sortOrder) params.sort_how = sortOrder;
    } else {
      console.warn(`[${logContext}] Unknown Trakt list ID format.`);
      return null; // Unknown list ID format
    }

    // Make the API call if requestUrl is set and not already populated (e.g. combined watchlist)
    if (requestUrl && rawTraktEntries.length === 0) {
        const response = await axios.get(requestUrl, { headers, params });
        // Recommendations, Trending, Popular return array of items directly, not item objects with 'movie'/'show' keys
        if (listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
             // The response here is an array of movie/show objects directly
             if (Array.isArray(response.data)) rawTraktEntries = response.data.map(item => ({ [effectiveItemTypeForEndpoint]: item, typeFromParams: effectiveItemTypeForEndpoint }));
        } else if (Array.isArray(response.data)) { // For user lists and watchlist
            // Data is an array of list items, each has a 'type' ('movie', 'show') and a corresponding object key
            rawTraktEntries = response.data.map(entry => ({ ...entry, typeFromParams: entry.type || effectiveItemTypeForEndpoint || null }));
        }
    }


    // Process raw Trakt entries to a common format for enrichment
    const initialItems = rawTraktEntries.map(entry => {
      let itemDataForDetails;
      let resolvedStremioType;
      let entryType = entry.typeFromParams || entry.type; // Use our added type hint or Trakt's type

      // Unpack based on Trakt's structure (item.movie, item.show, or direct item for trending/popular)
      if (entryType === 'movie' && entry.movie) {
        resolvedStremioType = 'movie';
        itemDataForDetails = entry.movie;
      } else if (entryType === 'show' && entry.show) {
        resolvedStremioType = 'series';
        itemDataForDetails = entry.show;
      } else if (entry.movie) { // Handles cases where entry is { movie: {...} } and type might be missing/general
        resolvedStremioType = 'movie';
        itemDataForDetails = entry.movie;
      } else if (entry.show) { // Handles cases where entry is { show: {...} }
        resolvedStremioType = 'series';
        itemDataForDetails = entry.show;
      } else if (entry.ids && entry.title) { // Fallback for flatter structures, often from trending/popular if not pre-processed
          itemDataForDetails = entry; // The entry itself is the movie/show object
          if (entryType === 'movie') resolvedStremioType = 'movie';
          else if (entryType === 'show' || entryType === 'series') resolvedStremioType = 'series';
          else if (effectiveItemTypeForEndpoint) resolvedStremioType = effectiveItemTypeForEndpoint; // Use type from endpoint if available
          else return null; // Cannot determine type
      } else {
        // console.warn(`[${logContext}] Skipping entry with unknown structure:`, entry);
        return null; // Skip if structure is not recognized
      }
      
      // If a specific item type was requested (e.g., for split views) and this item doesn't match, skip it.
      // This is mainly for when itemTypeHint was null initially and we fetched mixed content.
      if (itemTypeHint && resolvedStremioType !== itemTypeHint) {
         // console.log(`[${logContext}] Filtering out item due to type mismatch. Expected: ${itemTypeHint}, Got: ${resolvedStremioType}`, itemDataForDetails.title);
         return null;
      }

      const imdbId = itemDataForDetails?.ids?.imdb;
      if (!imdbId) {
        // console.warn(`[${logContext}] Skipping item without IMDb ID:`, itemDataForDetails.title);
        return null; // Essential for Stremio
      }

      // Basic mapping, enrichment will add more details
      return {
        imdb_id: imdbId, // For enrichment key
        tmdb_id: itemDataForDetails?.ids?.tmdb, // For enrichment if needed
        title: itemDataForDetails?.title,
        year: itemDataForDetails?.year,
        overview: itemDataForDetails?.overview,
        genres: itemDataForDetails?.genres, // Trakt provides genres as an array of slugs
        runtime: itemDataForDetails?.runtime, // In minutes
        type: resolvedStremioType, // 'movie' or 'series'
        // Add any other fields needed before enrichment or that enrichment might miss
      };
    }).filter(item => item !== null); // Remove nulls from mapping

    // Enrich with Cinemeta (which also converts Trakt genre slugs to display names)
    let enrichedAllItems = await enrichItemsWithCinemeta(initialItems);

    // Post-enrichment genre filtering IF Trakt API didn't filter it and genre is specified
    // This is a fallback, especially for user lists and watchlists where Trakt API doesn't filter by genre
    if (genre && enrichedAllItems.length > 0 &&
        !(listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_'))) {
        enrichedAllItems = enrichedAllItems.filter(item => item.genres && item.genres.includes(genre));
    }

    const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
    enrichedAllItems.forEach(item => {
      if (item.type === 'movie') {
        finalResult.movies.push(item);
        finalResult.hasMovies = true;
      } else if (item.type === 'series') {
        finalResult.shows.push(item);
        finalResult.hasShows = true;
      }
    });
    
    // console.log(`[${logContext}] Processed ${rawTraktEntries.length} raw entries, resulted in ${finalResult.movies.length} movies, ${finalResult.shows.length} shows.`);
    return finalResult;

  } catch (error) {
    console.error(`[${logContext}] Critical error in fetchTraktListItems: ${error.message}`, error.stack);
    if (error.response) {
        console.error(`[${logContext}] Trakt API Error Response:`, JSON.stringify(error.response.data), error.response.status);
    }
    return null; // Return null on error
  }
}

module.exports = {
  initTraktApi, refreshTraktToken, getTraktAuthUrl, authenticateTrakt,
  fetchTraktLists, fetchTraktListItems, fetchPublicTraktListDetails
};