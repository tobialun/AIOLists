// src/integrations/trakt.js
const axios = require('axios');
const { ITEMS_PER_PAGE, TRAKT_CLIENT_ID } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');

const TRAKT_API_URL = 'https://api.trakt.tv';

const logger = {
  log: (message) => console.log(`[TraktIntegration] ${message}`),
  error: (message, error) => console.error(`[TraktIntegration] ERROR: ${message}`, error),
  time: (label) => console.time(`[TraktIntegration] TIMER: ${label}`),
  timeEnd: (label) => console.timeEnd(`[TraktIntegration] TIMER: ${label}`),
};

async function initTraktApi(userConfig) {
  logger.log('Initializing Trakt API...');
  if (userConfig.traktAccessToken && userConfig.traktExpiresAt) {
    const now = new Date();
    const expiresAt = new Date(userConfig.traktExpiresAt);
    if (now < expiresAt) {
      logger.log('Trakt access token is valid.');
      return true;
    }
    logger.log('Trakt access token expired. Attempting refresh...');
    if (userConfig.traktRefreshToken) {
      const refreshed = await refreshTraktToken(userConfig);
      if (refreshed) {
        logger.log('Trakt token refreshed successfully.');
      } else {
        logger.error('Trakt token refresh failed.');
      }
      return refreshed;
    }
    logger.log('No Trakt refresh token available.');
  }
  logger.log('No valid Trakt access token or expiration info.');
  return false;
}

async function refreshTraktToken(userConfig) {
  const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_9 = "refreshTraktToken";
  logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_9);
  logger.log('Attempting to refresh Trakt token...');
  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      refresh_token: userConfig.traktRefreshToken,
      client_id: TRAKT_CLIENT_ID,
      grant_type: 'refresh_token',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });

    if (response.status === 200 && response.data) {
      userConfig.traktAccessToken = response.data.access_token;
      userConfig.traktRefreshToken = response.data.refresh_token;
      userConfig.traktExpiresAt = new Date(Date.now() + (response.data.expires_in * 1000)).toISOString();
      logger.log(`Token refreshed. New expiry: ${userConfig.traktExpiresAt}`);
      logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_9);
      return true;
    }
    logger.error(`Failed to refresh token, status: ${response.status}`, response.data);
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_9);
    return false;
  } catch (error) {
    logger.error("Exception during Trakt token refresh:", error.message);
    if (error.response?.status === 401) {
      logger.log('Trakt API returned 401 during refresh. Invalidating local token info.');
      userConfig.traktAccessToken = null;
      userConfig.traktRefreshToken = null;
      userConfig.traktExpiresAt = null;
    }
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_9);
    return false;
  }
}

function getTraktAuthUrl() {
  const url = `${TRAKT_API_URL}/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;
  logger.log(`Generated Trakt Auth URL: ${url}`);
  return url;
}

async function authenticateTrakt(code) {
  const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_10 = "authenticateTrakt";
  logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_10);
  logger.log(`Attempting to authenticate Trakt with code: ${code ? '******' : 'null'}`);
  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      code,
      client_id: TRAKT_CLIENT_ID,
      grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });

    if (response.status === 200 && response.data) {
      logger.log('Trakt authentication successful.');
      const tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + (response.data.expires_in * 1000)).toISOString()
      };
      logger.log(`Received tokens. Expiry: ${tokens.expiresAt}`);
      logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_10);
      return tokens;
    }
    logger.error(`Failed to authenticate with Trakt, status: ${response.status}`, response.data);
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_10);
    throw new Error('Failed to authenticate with Trakt');
  } catch (error) {
    logger.error("Exception during Trakt authentication:", error.response?.data || error.message);
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_10);
    throw error;
  }
}

async function fetchTraktLists(userConfig) {
  const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_11 = "fetchTraktLists";
  logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_11);
  logger.log('Fetching Trakt lists for user...');
  if (!await initTraktApi(userConfig)) {
    logger.error('Trakt API not initialized or token refresh failed during fetchTraktLists.');
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_11);
    return [];
  }
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
      id: `trakt_${list.ids.slug}`, name: list.name, updated: list.updated_at, listType: 'T', isTraktList: true
    }));
    logger.log(`Workspaceed ${lists.length} custom Trakt lists.`);
    const specialLists = [
      { id: 'trakt_watchlist', name: 'Trakt Watchlist', isTraktWatchlist: true, listType: 'T'},
      { id: 'trakt_recommendations_movies', name: 'Recommended Movies', isTraktRecommendations: true, isMovieList: true, listType: 'T'},
      { id: 'trakt_recommendations_shows', name: 'Recommended Shows', isTraktRecommendations: true, isShowList: true, listType: 'T'},
      { id: 'trakt_trending_movies', name: 'Trending Movies', isTraktTrending: true, isMovieList: true, listType: 'T'},
      { id: 'trakt_trending_shows', name: 'Trending Shows', isTraktTrending: true, isShowList: true, listType: 'T'},
      { id: 'trakt_popular_movies', name: 'Popular Movies', isTraktPopular: true, isMovieList: true, listType: 'T'},
      { id: 'trakt_popular_shows', name: 'Popular Shows', isTraktPopular: true, isShowList: true, listType: 'T'}
    ];
    logger.log('Added special Trakt lists (Watchlist, Recommendations, etc.).');
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_11);
    return [...lists, ...specialLists.map(sl => ({ ...sl, updated: new Date().toISOString() }))];
  } catch (error) {
    logger.error("Exception fetching Trakt lists:", error.message);
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_11);
    return [];
  }
}

async function fetchPublicTraktListDetails(traktListUrl) {
  const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_12 = "fetchPublicTraktListDetails";
  logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_12);
  logger.log(`Workspaceing public Trakt list details for URL: ${traktListUrl}`);
  try {
    const cleanedUrl = traktListUrl.split('?')[0];
    const urlMatch = cleanedUrl.match(/^https?:\/\/trakt\.tv\/users\/([\w-]+)\/lists\/([\w-]+)\/?$/);
    if (!urlMatch) {
        logger.error('Invalid Trakt list URL format.');
        throw new Error('Invalid Trakt list URL format.');
    }
    const [, username, listSlugOrId] = urlMatch;
    logger.log(`Parsed username: ${username}, slug/ID: ${listSlugOrId}`);
    const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };
    
    logger.log(`Workspaceing list details from: ${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}`);
    const listDetailsResponse = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}`, { headers });
    
    if (!listDetailsResponse.data) {
        logger.error('Could not fetch Trakt list details (no data).');
        throw new Error('Could not fetch Trakt list details.');
    }
    const listData = listDetailsResponse.data;
    logger.log(`Workspaceed list details: ${listData.name} (Items: ${listData.item_count})`);

    let hasMovies = false, hasShows = false;
    if (listData.item_count > 0) {
      const sampleLimit = Math.min(listData.item_count, 10);
      logger.log(`Workspaceing ${sampleLimit} sample items to determine content types...`);
      const itemsResp = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listData.ids.slug}/items?limit=${sampleLimit}&extended=full`, { headers });
      if (itemsResp.data && Array.isArray(itemsResp.data)) {
        for (const item of itemsResp.data) {
          if (item.type === 'movie' && item.movie) hasMovies = true;
          if (item.type === 'show' && item.show) hasShows = true;
          if (hasMovies && hasShows) break;
        }
      }
      logger.log(`Content types determined: Movies=${hasMovies}, Shows=${hasShows}`);
    }
    const result = {
      listId: `traktpublic_${username}_${listData.ids.slug}`, originalTraktId: String(listData.ids.trakt),
      originalTraktSlug: listData.ids.slug, traktUser: username, listName: listData.name,
      isTraktPublicList: true, hasMovies: hasMovies, hasShows: hasShows, itemCount: listData.item_count
    };
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_12);
    return result;
  } catch (error) {
    logger.error("Exception fetching public Trakt list details:", error.response?.data || error.message);
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_12);
    throw new Error(`Failed to fetch Trakt list: ${error.response?.data?.error_description || error.message}`);
  }
}

async function fetchTraktListItems(
    listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc',
    isPublicImport = false, publicUsername = null, itemTypeHint = null, genre = null,
    isMetadataCheck = false
) {
  const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13 = `WorkspaceTraktListItems for ${listId} (skip: ${skip}, typeHint: ${itemTypeHint}, genre: ${genre}, metaCheck: ${isMetadataCheck})`;
  logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);

  if (!listId) {
    logger.error(`Critical error - listId is undefined.`);
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
    return null;
  }
  
  logger.log(`Workspaceing items for list: ${listId}, Skip: ${skip}, SortBy: ${sortBy}, Order: ${sortOrder}, Public: ${isPublicImport}, TypeHint: ${itemTypeHint}, Genre: ${genre}, MetaCheck: ${isMetadataCheck}`);

  const limit = isMetadataCheck ? 1 : ITEMS_PER_PAGE;
  const page = isMetadataCheck ? 1 : Math.floor(skip / limit) + 1;
  logger.log(`Calculated - Limit: ${limit}, Page: ${page}`);

  const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };

  if (!isPublicImport) {
    logger.log('Private list, checking/refreshing token...');
    if (!await initTraktApi(userConfig)) {
      logger.error(`Trakt API not initialized or token refresh failed.`);
      logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
      return null;
    }
    headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
    logger.log('Token OK, authorization header added.');
  } else {
    logger.log('Public list, no authorization needed.');
  }

  let requestUrl;
  let params = { limit, page, extended: 'full' };
  let rawTraktEntries = [];
  let effectiveItemTypeForEndpoint = itemTypeHint; // For most cases
  let allItems = []; // For watchlist unified view


  try {
    if (isPublicImport && publicUsername) {
        const actualSlug = listId.replace(/^traktpublic_[^_]+_/, '');
        let basePath = `${TRAKT_API_URL}/users/${publicUsername}/lists/${actualSlug}/items`;
        if (itemTypeHint === 'movie') requestUrl = `${basePath}/movies`;
        else if (itemTypeHint === 'series') requestUrl = `${basePath}/shows`;
        else requestUrl = basePath; // Fetches mixed if typeHint is null or 'all'
        effectiveItemTypeForEndpoint = itemTypeHint;
        if (['rank', 'added', 'title', 'released', 'runtime', 'popularity', 'votes', 'random'].includes(sortBy) && !isMetadataCheck) {
            params.sort_by = sortBy; if (sortOrder) params.sort_how = sortOrder;
        }
        logger.log(`Public import URL: ${requestUrl}, Params: ${JSON.stringify(params)}`);
    } else if (listId === 'trakt_watchlist') {
        logger.log('Fetching Trakt Watchlist...');
        let typeForEndpoint = itemTypeHint || 'all'; 
        if (itemTypeHint === 'series') typeForEndpoint = 'shows'; // API uses 'shows' for series type
        if (itemTypeHint === 'movie') typeForEndpoint = 'movies';

        let sortForEndpoint = sortBy;
        if (sortBy === 'added' && (typeForEndpoint === 'all' || typeForEndpoint === 'movies' || typeForEndpoint === 'shows')) {
             // The /sync/watchlist endpoint uses 'added' directly.
             // Other list item endpoints use 'added' in sort_by but it might mean list_added_at.
             // For watchlist, 'added' generally means when the item was added to Trakt globally or user's perception of 'added' date.
        }


        requestUrl = `${TRAKT_API_URL}/sync/watchlist/${typeForEndpoint}/${sortForEndpoint}/${sortOrder}`;
        params = { limit, page, extended: 'full' }; // No sort in params for this endpoint
        effectiveItemTypeForEndpoint = null; // Will be determined from response
        logger.log(`Watchlist Sync URL: ${requestUrl}, Params: ${JSON.stringify(params)}`);

    } else if (listId.startsWith('trakt_recommendations_')) {
        effectiveItemTypeForEndpoint = listId.endsWith('_movies') ? 'movie' : (listId.endsWith('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) { 
            logger.error(`Invalid recommendations list ID: ${listId}`);
            logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
            return null; 
        }
        requestUrl = `${TRAKT_API_URL}/recommendations/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}`;
        if (genre && !isMetadataCheck) params.genres = genre.toLowerCase().replace(/\s+/g, '-');
        logger.log(`Recommendations URL: ${requestUrl}, Params: ${JSON.stringify(params)}`);
    } else if (listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
        effectiveItemTypeForEndpoint = listId.includes('_movies') ? 'movie' : (listId.includes('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) { 
            logger.error(`Invalid trending/popular list ID: ${listId}`);
            logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
            return null; 
        }
        const endpointType = listId.startsWith('trakt_trending_') ? 'trending' : 'popular';
        if (headers.Authorization) {
          delete headers.Authorization;
        }
        requestUrl = `${TRAKT_API_URL}/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}/${endpointType}`;
        if (genre && !isMetadataCheck) params.genres = genre.toLowerCase().replace(/\s+/g, '-');
        logger.log(`${endpointType.charAt(0).toUpperCase() + endpointType.slice(1)} URL: ${requestUrl}, Params: ${JSON.stringify(params)}`);
    } else if (listId.startsWith('trakt_')) { 
        const listSlug = listId.replace('trakt_', '');
        let basePath = `${TRAKT_API_URL}/users/me/lists/${listSlug}/items`;
        if (itemTypeHint === 'movie') { requestUrl = `${basePath}/movies`; effectiveItemTypeForEndpoint = 'movie'; }
        else if (itemTypeHint === 'series') { requestUrl = `${basePath}/shows`; effectiveItemTypeForEndpoint = 'series'; }
        else { requestUrl = basePath; effectiveItemTypeForEndpoint = null; } 
        if (sortBy && !isMetadataCheck) params.sort_by = sortBy; 
        if (sortOrder && !isMetadataCheck) params.sort_how = sortOrder;
        logger.log(`Custom list URL: ${requestUrl}, Params: ${JSON.stringify(params)}`);
    } else {
      logger.warn(`Unknown Trakt list ID format or type: ${listId}`);
      logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
      return null;
    }

    if (requestUrl) { 
        logger.log(`Making Trakt API call to: ${requestUrl} with params: ${JSON.stringify(params)}`);
        const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_14 = `axios.get ${requestUrl}`;
        logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_14);
        const response = await axios.get(requestUrl, { headers, params });
        logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_14);
        logger.log(`Trakt API response status: ${response.status}`);

        if (Array.isArray(response.data)) {
            rawTraktEntries = response.data;
        }
        logger.log(`Received ${rawTraktEntries.length} raw entries from Trakt API.`);
    }


    const GITHUB_CLIENT_ID_SECRET_TRAKT_JS_15 = `processAndEnrichTraktItems for ${listId}`;
    logger.time(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_15);

    const initialItems = rawTraktEntries.map(entry => {
      let itemDataForDetails;
      let resolvedStremioType;
      let listedAt = entry.listed_at; 

      const itemTypeFromEntry = entry.type; 

      if (itemTypeFromEntry === 'movie' && entry.movie) {
        resolvedStremioType = 'movie';
        itemDataForDetails = entry.movie;
      } else if (itemTypeFromEntry === 'show' && entry.show) {
        resolvedStremioType = 'series';
        itemDataForDetails = entry.show;
      } else if (itemTypeFromEntry === 'episode' && entry.episode && entry.show) {
         resolvedStremioType = 'series'; 
         itemDataForDetails = entry.show; 
      } else if (itemTypeFromEntry === 'season' && entry.season && entry.show) {
         resolvedStremioType = 'series';
         itemDataForDetails = entry.show;
      }
      else {
         if (listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
            if (effectiveItemTypeForEndpoint === 'movie' && entry.ids) { // Assuming direct item if no 'movie' property
                resolvedStremioType = 'movie'; itemDataForDetails = entry;
            } else if (effectiveItemTypeForEndpoint === 'series' && entry.ids) { // Assuming direct item
                resolvedStremioType = 'series'; itemDataForDetails = entry;
            } else {
                return null;
            }
         } else {
            return null;
         }
      }
      
      if (!itemDataForDetails) return null;

      if (itemTypeHint && itemTypeHint !== 'all' && resolvedStremioType !== itemTypeHint) {
         return null; 
      }
      const imdbId = itemDataForDetails.ids?.imdb;
      if (!imdbId) return null; 

      return {
        imdb_id: imdbId, tmdb_id: itemDataForDetails.ids?.tmdb, title: itemDataForDetails.title,
        year: itemDataForDetails.year, overview: itemDataForDetails.overview, genres: itemDataForDetails.genres,
        runtime: itemDataForDetails.runtime, type: resolvedStremioType,
        listed_at: listedAt 
      };
    }).filter(item => item !== null);
    logger.log(`Processed ${initialItems.length} initial items from raw Trakt entries.`);

    
    if (listId === 'trakt_watchlist' && sortBy === 'added' && initialItems.length > 0) {
        initialItems.sort((a, b) => {
            const dateA = a.listed_at ? new Date(a.listed_at) : 0;
            const dateB = b.listed_at ? new Date(b.listed_at) : 0;
            return (sortOrder === 'asc' ? dateA - dateB : dateB - dateA);
        });
        logger.log(`Watchlist items sorted by 'listed_at' in ${sortOrder} order.`);
    }


    let enrichedAllItems = await enrichItemsWithCinemeta(initialItems);
    logger.log(`Enriched ${enrichedAllItems.length} items with Cinemeta.`);

    if (genre && enrichedAllItems.length > 0 && !isMetadataCheck) {
        logger.log(`Filtering enriched items by genre: ${genre}`);
        const lowerGenre = String(genre).toLowerCase();
        const needsServerSideGenreFiltering = !(
            listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_trending_') ||
            listId.startsWith('trakt_popular_') || (isPublicImport && itemTypeHint) 
        );
        if (needsServerSideGenreFiltering) {
            enrichedAllItems = enrichedAllItems.filter(item => item.genres && item.genres.map(g => String(g).toLowerCase()).includes(lowerGenre));
            logger.log(`After genre filtering: ${enrichedAllItems.length} items remain.`);
        } else {
            logger.log(`Genre filtering not applied or done by Trakt for this list type.`);
        }
    }
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_15);

    const finalResult = { allItems: enrichedAllItems, hasMovies: false, hasShows: false };
    enrichedAllItems.forEach(item => {
      if (item.type === 'movie') finalResult.hasMovies = true;
      else if (item.type === 'series') finalResult.hasShows = true;
    });
    logger.log(`Final result for ${listId}: Total Items: ${finalResult.allItems.length}, HasMovies: ${finalResult.hasMovies}, HasShows: ${finalResult.hasShows}`);
    
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
    return finalResult;

  } catch (error) {
    logger.error(`Critical exception in fetchTraktListItems for list ${listId}: ${error.message}`, error.stack);
    if (error.response) {
        logger.error(`Trakt API Error Response: Status ${error.response.status}`, JSON.stringify(error.response.data, null, 2));
    }
    logger.timeEnd(GITHUB_CLIENT_ID_SECRET_TRAKT_JS_13);
    return null;
  }
}

module.exports = {
  initTraktApi, refreshTraktToken, getTraktAuthUrl, authenticateTrakt,
  fetchTraktLists, fetchTraktListItems, fetchPublicTraktListDetails
};