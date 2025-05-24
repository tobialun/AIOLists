// src/integrations/trakt.js
const axios = require('axios');
const { ITEMS_PER_PAGE, TRAKT_CLIENT_ID } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');

const TRAKT_API_URL = 'https://api.trakt.tv';

async function initTraktApi(userConfig) {
  if (userConfig.traktAccessToken && userConfig.traktExpiresAt) {
    const now = new Date();
    const expiresAt = new Date(userConfig.traktExpiresAt);
    if (now < expiresAt) return true;
    if (userConfig.traktRefreshToken) return refreshTraktToken(userConfig);
  }
  return false;
}

async function refreshTraktToken(userConfig) {
  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      refresh_token: userConfig.traktRefreshToken, client_id: TRAKT_CLIENT_ID,
      grant_type: 'refresh_token', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });
    if (response.status === 200 && response.data) {
      userConfig.traktAccessToken = response.data.access_token;
      userConfig.traktRefreshToken = response.data.refresh_token;
      userConfig.traktExpiresAt = new Date(Date.now() + (response.data.expires_in * 1000)).toISOString();
      return true;
    } return false;
  } catch (error) {
    console.error("Error refreshing Trakt token:", error.message);
    if (error.response?.status === 401) {
      userConfig.traktAccessToken = null; userConfig.traktRefreshToken = null; userConfig.traktExpiresAt = null;
    } return false;
  }
}

function getTraktAuthUrl() {
  return `${TRAKT_API_URL}/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;
}

function getTraktAuthUrl() {
  return `${TRAKT_API_URL}/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;
}

async function authenticateTrakt(code) {
  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      code, client_id: TRAKT_CLIENT_ID, grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });
    if (response.status === 200 && response.data) {
      return {
        accessToken: response.data.access_token, refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000)).toISOString()
      };
    } throw new Error('Failed to authenticate with Trakt');
  } catch (error) {
    console.error("Error authenticating with Trakt:", error.response?.data || error.message);
    throw error;
  }
}

async function fetchTraktLists(userConfig) {
  if (!await initTraktApi(userConfig)) return [];
  try {
    const response = await axios.get(`${TRAKT_API_URL}/users/me/lists`, {
      headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2',
                 'trakt-api-key': TRAKT_CLIENT_ID, 'Authorization': `Bearer ${userConfig.traktAccessToken}` }
    });
    const lists = response.data.map(list => ({
      id: `trakt_${list.ids.slug}`, name: list.name, updated: list.updated_at, listType: 'T', isTraktList: true
    }));
    const specialLists = [
      { id: 'trakt_watchlist', name: 'Trakt Watchlist', isTraktWatchlist: true, listType: 'T' },
      { id: 'trakt_recommendations_movies', name: 'Recommended Movies', isTraktRecommendations: true, isMovieList: true, listType: 'T' },
      { id: 'trakt_recommendations_shows', name: 'Recommended Shows', isTraktRecommendations: true, isShowList: true, listType: 'T' },
      { id: 'trakt_trending_movies', name: 'Trending Movies', isTraktTrending: true, isMovieList: true, listType: 'T' },
      { id: 'trakt_trending_shows', name: 'Trending Shows', isTraktTrending: true, isShowList: true, listType: 'T' },
      { id: 'trakt_popular_movies', name: 'Popular Movies', isTraktPopular: true, isMovieList: true, listType: 'T' },
      { id: 'trakt_popular_shows', name: 'Popular Shows', isTraktPopular: true, isShowList: true, listType: 'T' }
    ];
    return [...lists, ...specialLists.map(sl => ({ ...sl, updated: new Date().toISOString() }))];
  } catch (error) {
    console.error("Error fetching Trakt lists:", error.message); return [];
  }
}

async function fetchPublicTraktListDetails(traktListUrl) {
  try {
    const cleanedUrl = traktListUrl.split('?')[0];
    const urlMatch = cleanedUrl.match(/^https?:\/\/trakt\.tv\/users\/([\w-]+)\/lists\/([\w-]+)\/?$/);
    if (!urlMatch) throw new Error('Invalid Trakt list URL format.');
    const [, username, listSlugOrId] = urlMatch;
    const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };
    const listDetailsResponse = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}`, { headers });
    if (!listDetailsResponse.data) throw new Error('Could not fetch Trakt list details.');
    const listData = listDetailsResponse.data;
    let hasMovies = false, hasShows = false;
    if (listData.item_count > 0) {
      const itemsResp = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}/items?limit=5&extended=full`, { headers });
      if (itemsResp.data && Array.isArray(itemsResp.data)) {
        for (const item of itemsResp.data) {
          if (item.type === 'movie') hasMovies = true;
          if (item.type === 'show') hasShows = true;
          if (hasMovies && hasShows) break;
        }
      }
    }
    return {
      listId: `traktpublic_${username}_${listData.ids.slug}`, originalTraktId: String(listData.ids.trakt),
      originalTraktSlug: listData.ids.slug, traktUser: username, listName: listData.name,
      isTraktPublicList: true, hasMovies, hasShows, itemCount: listData.item_count
    };
  } catch (error) {
    console.error('Error fetching public Trakt list details:', error.response?.data || error.message);
    throw new Error(`Failed to fetch Trakt list: ${error.response?.data?.error_description || error.message}`);
  }
}


async function fetchTraktListItems(listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc', isPublicImport = false, publicUsername = null, publicItemType = null) {
  const limit = ITEMS_PER_PAGE;
  const page = Math.floor(skip / limit) + 1;
  const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };
  
  // Small helper for logging context
  const logContext = `TraktListItems (ID: ${listId}, TypeHint: ${publicItemType || 'any'}, Page: ${page})`;

  if (!isPublicImport && !await initTraktApi(userConfig)) {
    console.log(`[${logContext}] Trakt API not initialized or auth failed.`);
    return null;
  }
  if (!isPublicImport) headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;

  let requestUrl;
  let params = { limit, page, extended: 'full' };
  let specificItemType = publicItemType; // Used to determine if we are fetching specifically movies or shows
  let rawTraktEntries = [];

  try {
    if (isPublicImport && publicUsername && publicItemType) {
        const actualSlugOrId = listId.replace(/^trakt_/, '');
        const traktApiItemType = publicItemType === 'series' ? 'shows' : 'movies';
        requestUrl = `${TRAKT_API_URL}/users/${publicUsername}/lists/${actualSlugOrId}/items/${traktApiItemType}`;
        if (['rank', 'added', 'title', 'released', 'runtime', 'popularity', 'votes', 'random'].includes(sortBy)) {
            params.sort_by = sortBy; if (sortOrder) params.sort_how = sortOrder;
        }
        const response = await axios.get(requestUrl, { headers, params });
        rawTraktEntries = Array.isArray(response.data) ? response.data.map(entry => ({ ...entry, typeFromParams: publicItemType })) : [];
    } else if (listId === 'trakt_watchlist') {
        if (['rank', 'added', 'released', 'title'].includes(sortBy)) params.sort = sortBy;
        if (sortOrder) params.order = sortOrder;
        if (!specificItemType) {
            const [moviesResp, showsResp] = await Promise.all([
                axios.get(`${TRAKT_API_URL}/users/me/watchlist/movies`, { headers, params }).catch(e => ({ data: [] })),
                axios.get(`${TRAKT_API_URL}/users/me/watchlist/shows`, { headers, params }).catch(e => ({ data: [] }))
            ]);
            if (Array.isArray(moviesResp.data)) rawTraktEntries.push(...moviesResp.data.map(entry => ({ ...entry, typeFromParams: 'movie'})));
            if (Array.isArray(showsResp.data)) rawTraktEntries.push(...showsResp.data.map(entry => ({ ...entry, typeFromParams: 'show'})));
        } else { 
            requestUrl = `${TRAKT_API_URL}/users/me/watchlist/${specificItemType === 'series' ? 'shows' : 'movies'}`;
            const response = await axios.get(requestUrl, { headers, params });
            if (Array.isArray(response.data)) rawTraktEntries = response.data.map(entry => ({ ...entry, typeFromParams: specificItemType }));
        }
    } else if (listId.startsWith('trakt_recommendations_')) {
        specificItemType = listId.endsWith('_movies') ? 'movie' : (listId.endsWith('_shows') ? 'series' : null); // Ensure 'series'
        if (!specificItemType) { console.error(`[${logContext}] Could not determine specific item type for recommendations list ${listId}`); return null; }
        requestUrl = `${TRAKT_API_URL}/recommendations/${specificItemType === 'series' ? 'shows' : 'movies'}`;
        const response = await axios.get(requestUrl, { headers, params: { limit, page, extended: 'full' } }); 
        if (Array.isArray(response.data)) rawTraktEntries = response.data.map(item => ({ [specificItemType]: item, typeFromParams: specificItemType }));
    } else if (listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
        specificItemType = listId.includes('_movies') ? 'movie' : (listId.includes('_shows') ? 'series' : null); // Ensure 'series'
        if (!specificItemType) { console.error(`[${logContext}] Could not determine specific item type for trending/popular list ${listId}`); return null; }
        const endpointType = listId.startsWith('trakt_trending_') ? 'trending' : 'popular';
        if (headers.Authorization) delete headers.Authorization; 
        requestUrl = `${TRAKT_API_URL}/${specificItemType === 'series' ? 'shows' : 'movies'}/${endpointType}`;
        const response = await axios.get(requestUrl, { headers, params: { limit, page, extended: 'full' } });
        if (Array.isArray(response.data)) rawTraktEntries = response.data.map(entry => ({ ...entry, typeFromParams: specificItemType }));
    } else if (listId.startsWith('trakt_')) { // User's custom Trakt lists
        const listSlug = listId.replace('trakt_', '');
        requestUrl = `${TRAKT_API_URL}/users/me/lists/${listSlug}/items`;
        if (sortBy) params.sort_by = sortBy; 
        if (sortOrder) params.sort_how = sortOrder;
        const response = await axios.get(requestUrl, { headers, params });
        if (Array.isArray(response.data)) rawTraktEntries = response.data; // These entries usually have 'type'
    } else {
      console.error(`[${logContext}] Unknown Trakt listId format.`); return null;
    }

    // --- End of Trakt API fetching logic ---

    const initialItems = rawTraktEntries.map(entry => {
      const itemData = entry.movie || entry.show || entry; // For recommendations/trending, entry itself is the item
      const typeFromTrakt = entry.typeFromParams || entry.type; // typeFromParams if specifically fetched, else Trakt's 'type'
      
      // Defensive type resolution
      let resolvedType = 'movie'; // Default
      if (typeFromTrakt === 'show' || itemData?.type === 'show' || typeFromTrakt === 'series') {
        resolvedType = 'series';
      } else if (typeFromTrakt === 'movie' || itemData?.type === 'movie') {
        resolvedType = 'movie';
      }
      // If specificItemType was set (e.g. for _movies or _shows lists), it should take precedence
      if (specificItemType === 'movie' || specificItemType === 'series') {
        resolvedType = specificItemType;
      }


      const imdbId = itemData?.ids?.imdb;
      if (!imdbId) {
        return null;
      }

      return {
        imdb_id: imdbId,
        tmdb_id: itemData?.ids?.tmdb,
        title: itemData?.title,
        year: itemData?.year,
        overview: itemData?.overview,
        genres: itemData?.genres,
        runtime: itemData?.runtime,
        type: resolvedType,
      };
    }).filter(item => item !== null);

    const enrichedAllItems = await enrichItemsWithCinemeta(initialItems);

    const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
    enrichedAllItems.forEach(item => {
      if (item.type === 'movie') {
        finalResult.movies.push(item);
      } else if (item.type === 'series') {
        finalResult.shows.push(item);
      } else {
      }
    });
    finalResult.hasMovies = finalResult.movies.length > 0;
    finalResult.hasShows = finalResult.shows.length > 0;
    
    return finalResult;

  } catch (error) {
    console.error(`[${logContext}] Critical error in fetchTraktListItems: ${error.message}`, error.stack);
    if (error.response) {
        console.error(`[${logContext}] Trakt API Error Response:`, JSON.stringify(error.response.data), error.response.status);
    }
    return null;
  }
}

module.exports = {
  initTraktApi, refreshTraktToken, getTraktAuthUrl, authenticateTrakt,
  fetchTraktLists, fetchTraktListItems, fetchPublicTraktListDetails
};
