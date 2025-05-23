// src/integrations/trakt.js
const axios = require('axios');
const { ITEMS_PER_PAGE, TRAKT_CLIENT_ID } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher'); // Import the new utility

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
    }
    return false;
  } catch (error) {
    console.error("Error refreshing Trakt token:", error.message);
    if (error.response?.status === 401) { /* Reset tokens if refresh fails due to invalid token */
      userConfig.traktAccessToken = null; userConfig.traktRefreshToken = null; userConfig.traktExpiresAt = null;
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
      code: code, client_id: TRAKT_CLIENT_ID,
      grant_type: 'authorization_code', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });
    if (response.status === 200 && response.data) {
      return {
        accessToken: response.data.access_token, refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000)).toISOString()
      };
    }
    throw new Error('Failed to authenticate with Trakt (Status not 200 or no data)');
  } catch (error) {
    console.error("Error authenticating with Trakt:", error.response ? error.response.data : error.message);
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
      id: `trakt_${list.ids.slug}`, name: list.name, updated: list.updated_at,
      listType: 'T', isTraktList: true
    }));
    const specialLists = [
      { id: 'trakt_watchlist', name: 'Trakt Watchlist', isTraktWatchlist: true, listType: 'T' },
      { id: 'trakt_recommendations_movies', name: 'Trakt Recommended Movies', isTraktRecommendations: true, isMovieList: true, listType: 'T' },
      { id: 'trakt_recommendations_shows', name: 'Trakt Recommended Shows', isTraktRecommendations: true, isShowList: true, listType: 'T' },
      { id: 'trakt_trending_movies', name: 'Trending Movies', isTraktTrending: true, isMovieList: true, listType: 'T' },
      { id: 'trakt_trending_shows', name: 'Trending Shows', isTraktTrending: true, isShowList: true, listType: 'T' },
      { id: 'trakt_popular_movies', name: 'Popular Movies', isTraktPopular: true, isMovieList: true, listType: 'T' },
      { id: 'trakt_popular_shows', name: 'Popular Shows', isTraktPopular: true, isShowList: true, listType: 'T' }
    ];
    return [...lists, ...specialLists.map(sl => ({ ...sl, updated: new Date().toISOString() }))];
  } catch (error) {
    console.error("Error fetching Trakt lists:", error.message);
    return [];
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

  if (!isPublicImport) {
    if (!await initTraktApi(userConfig)) return null;
    headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
  }

  let requestUrl;
  let params = { limit, page, extended: 'full' };
  let specificItemType = publicItemType;
  let rawTraktEntries = []; // Store raw entries from Trakt API

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
        if (Array.isArray(moviesResp.data)) rawTraktEntries.push(...moviesResp.data.map(entry => ({ ...entry, typeFromParams: 'movie' })));
        if (Array.isArray(showsResp.data)) rawTraktEntries.push(...showsResp.data.map(entry => ({ ...entry, typeFromParams: 'show' })));
      } else {
        requestUrl = `${TRAKT_API_URL}/users/me/watchlist/${specificItemType === 'series' ? 'shows' : 'movies'}`;
        const response = await axios.get(requestUrl, { headers, params });
        if (Array.isArray(response.data)) rawTraktEntries = response.data.map(entry => ({ ...entry, typeFromParams: specificItemType }));
      }
    } else if (listId.startsWith('trakt_recommendations_')) {
      specificItemType = listId.endsWith('_movies') ? 'movie' : 'series';
      requestUrl = `${TRAKT_API_URL}/recommendations/${specificItemType === 'series' ? 'shows' : 'movies'}`;
      const response = await axios.get(requestUrl, { headers, params: { limit, page, extended: 'full' } }); // No sorting for recommendations
      if (Array.isArray(response.data)) rawTraktEntries = response.data.map(item => ({ [specificItemType]: item, typeFromParams: specificItemType }));
    } else if (listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
      specificItemType = listId.includes('_movies') ? 'movie' : 'series';
      const endpointType = listId.startsWith('trakt_trending_') ? 'trending' : 'popular';
      delete headers.Authorization;
      requestUrl = `${TRAKT_API_URL}/${specificItemType === 'series' ? 'shows' : 'movies'}/${endpointType}`;
      const response = await axios.get(requestUrl, { headers, params: { limit, page, extended: 'full' } }); // No sorting here
      if (Array.isArray(response.data)) rawTraktEntries = response.data.map(entry => ({ ...entry, typeFromParams: specificItemType }));
    } else if (listId.startsWith('trakt_')) { // User's custom Trakt lists
      const listSlug = listId.replace('trakt_', '');
      requestUrl = `${TRAKT_API_URL}/users/me/lists/${listSlug}/items`;
      params.sort_by = sortBy; params.sort_how = sortOrder; // Apply sorting if applicable
      const response = await axios.get(requestUrl, { headers, params });
      if (Array.isArray(response.data)) rawTraktEntries = response.data; // These entries already have 'type'
    } else {
      console.error(`Unknown Trakt listId format for item fetching: ${listId}`); return null;
    }

    // Map Trakt entries to a common structure for enrichment
    const initialItems = rawTraktEntries.map(entry => {
      const itemData = entry.movie || entry.show || entry; // 'entry' itself for recommendations/trending
      const type = entry.typeFromParams || entry.type; // Use typeFromParams if set, else entry.type
      const resolvedType = type === 'show' || itemData?.type === 'show' ? 'series' : 'movie';

      return {
        imdb_id: itemData?.ids?.imdb,
        tmdb_id: itemData?.ids?.tmdb,
        title: itemData?.title,
        year: itemData?.year,
        overview: itemData?.overview,
        genres: itemData?.genres, // Array from Trakt
        runtime: itemData?.runtime, // Minutes
        // traktRating: itemData?.rating, // Could be used if needed
        // certification: itemData?.certification,
        type: resolvedType,
        // Preserve original Trakt entry if needed for deeper merging later
        // _traktData: itemData 
      };
    }).filter(item => item.imdb_id); // Must have imdb_id for Cinemeta

    const enrichedAllItems = await enrichItemsWithCinemeta(initialItems);
    
    const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
    enrichedAllItems.forEach(item => {
      if (item.type === 'movie') finalResult.movies.push(item);
      else if (item.type === 'series') finalResult.shows.push(item);
    });
    finalResult.hasMovies = finalResult.movies.length > 0;
    finalResult.hasShows = finalResult.shows.length > 0;
    return finalResult;

  } catch (error) {
    console.error(`Error in fetchTraktListItems for ${listId}: ${error.message}`);
    if (error.response) console.error("Trakt API Error:", JSON.stringify(error.response.data), error.response.status);
    return null;
  }
}

module.exports = {
  initTraktApi, refreshTraktToken, getTraktAuthUrl, authenticateTrakt,
  fetchTraktLists, fetchTraktListItems, fetchPublicTraktListDetails
};