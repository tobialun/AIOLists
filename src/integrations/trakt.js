// src/integrations/trakt.js
const axios = require('axios');
const { ITEMS_PER_PAGE, TRAKT_CLIENT_ID } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');
const { getTraktTokens, saveTraktTokens } = require('../utils/remoteStorage');

const TRAKT_API_URL = 'https://api.trakt.tv';

async function getTraktUserUuid(accessToken) {
  const response = await axios.get(`${TRAKT_API_URL}/users/settings`, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data.user.ids.uuid;
}

async function refreshTraktToken(userConfig) {
  const refreshToken = userConfig.traktRefreshToken;
  if (!refreshToken) return false;

  try {
    const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
      refresh_token: refreshToken,
      client_id: TRAKT_CLIENT_ID,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
      grant_type: 'refresh_token'
    });

    if (response.status === 200 && response.data) {
      const newTokens = {
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token,
          expiresAt: Date.now() + (response.data.expires_in * 1000)
      };

      userConfig.traktAccessToken = newTokens.accessToken;
      userConfig.traktRefreshToken = newTokens.refreshToken;
      userConfig.traktExpiresAt = newTokens.expiresAt;

      // Only save if Upstash credentials are provided
      if (userConfig.upstashUrl && userConfig.traktUuid) {
        await saveTraktTokens(userConfig, newTokens);
      }
      return true;
    }
    return false;
  } catch (error) {
    if (error.response?.status === 401) {
      userConfig.traktAccessToken = null;
      userConfig.traktRefreshToken = null;
      userConfig.traktExpiresAt = null;
      if (userConfig.upstashUrl && userConfig.traktUuid) {
        await saveTraktTokens(userConfig, { accessToken: null, refreshToken: null, expiresAt: null });
      }
    }
    return false;
  }
}

async function initTraktApi(userConfig) {
  // If Upstash credentials are provided, use them as the source of truth
  if (userConfig.upstashUrl && userConfig.upstashToken && userConfig.traktUuid) {
    const tokens = await getTraktTokens(userConfig);
    if (tokens) {
      userConfig.traktAccessToken = tokens.accessToken;
      userConfig.traktRefreshToken = tokens.refreshToken;
      userConfig.traktExpiresAt = tokens.expiresAt;

      if (Date.now() >= new Date(userConfig.traktExpiresAt).getTime()) {
        return await refreshTraktToken(userConfig);
      }
      return true;
    }
  }

  // Fallback for non-persistent flow (token is in the config hash)
  if (userConfig.traktAccessToken && userConfig.traktExpiresAt) {
    if (Date.now() >= new Date(userConfig.traktExpiresAt).getTime()) {
      return await refreshTraktToken(userConfig);
    }
    return true;
  }

  return false;
}

function getTraktAuthUrl() {
  const url = `${TRAKT_API_URL}/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;
  return url;
}

async function authenticateTrakt(code, userConfig) {
  const response = await axios.post(`${TRAKT_API_URL}/oauth/token`, {
    code,
    client_id: TRAKT_CLIENT_ID,
    grant_type: 'authorization_code',
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
  });

  if (response.status === 200 && response.data) {
    const tokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
    };

    const uuid = await getTraktUserUuid(tokens.accessToken);
    
    return {
      uuid,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
  }
  throw new Error('Failed to authenticate with Trakt');
}

// ... the rest of the file (fetchTraktLists, etc.) remains unchanged ...
async function fetchTraktLists(userConfig) {
    if (!await initTraktApi(userConfig)) {
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
        id: `trakt_${list.ids.slug}`, name: list.name, updated: list.updated_at, listType: 'T', isTraktList: true, hasMovies: true, hasShows: true
      }));
      const specialLists = [
        { id: 'trakt_watchlist', name: 'Trakt Watchlist', isTraktWatchlist: true, listType: 'T', hasMovies: true, hasShows: true },
        { id: 'trakt_recommendations_movies', name: 'Recommended Movies', isTraktRecommendations: true, listType: 'T', hasMovies: true, hasShows: false },
        { id: 'trakt_recommendations_shows', name: 'Recommended Shows', isTraktRecommendations: true, listType: 'T', hasMovies: false, hasShows: true },
        { id: 'trakt_trending_movies', name: 'Trending Movies', isTraktTrending: true, listType: 'T', hasMovies: true, hasShows: false },
        { id: 'trakt_trending_shows', name: 'Trending Shows', isTraktTrending: true, listType: 'T', hasMovies: false, hasShows: true },
        { id: 'trakt_popular_movies', name: 'Popular Movies', isTraktPopular: true, listType: 'T', hasMovies: true, hasShows: false },
        { id: 'trakt_popular_shows', name: 'Popular Shows', isTraktPopular: true, listType: 'T', hasMovies: false, hasShows: true }
      ];
      return [...lists, ...specialLists.map(sl => ({ ...sl, updated: new Date().toISOString() }))];
    } catch (error) {
      console.error("[TraktIntegration] Exception fetching Trakt lists:", error.message);
      return [];
    }
  }
  
  async function fetchPublicTraktListDetails(traktListUrl) {
    try {
      const cleanedUrl = traktListUrl.split('?')[0];
      const urlMatch = cleanedUrl.match(/^https?:\/\/trakt\.tv\/users\/([\w-]+)\/lists\/([\w-]+)\/?$/);
      if (!urlMatch) {
          throw new Error('Invalid Trakt list URL format.');
      }
      const [, username, listSlugOrId] = urlMatch;
      const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };
      
      const listDetailsResponse = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}`, { headers });
      
      if (!listDetailsResponse.data) {
          throw new Error('Could not fetch Trakt list details.');
      }
      const listData = listDetailsResponse.data;
  
      let hasMovies = false, hasShows = false;
      if (listData.item_count > 0) {
        const sampleLimit = Math.min(listData.item_count, 10);
        const itemsResp = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listData.ids.slug}/items?limit=${sampleLimit}&extended=full`, { headers });
        if (itemsResp.data && Array.isArray(itemsResp.data)) {
          for (const item of itemsResp.data) {
            if (item.type === 'movie' && item.movie) hasMovies = true;
            if (item.type === 'show' && item.show) hasShows = true;
            if (hasMovies && hasShows) break;
          }
        }
      }
      const result = {
        listId: `traktpublic_${username}_${listData.ids.slug}`, originalTraktId: String(listData.ids.trakt),
        originalTraktSlug: listData.ids.slug, traktUser: username, listName: listData.name,
        isTraktPublicList: true, hasMovies: hasMovies, hasShows: hasShows, itemCount: listData.item_count
      };
      return result;
    } catch (error) {
      console.error("[TraktIntegration] Exception fetching public Trakt list details:", error.response?.data || error.message);
      throw new Error(`Failed to fetch Trakt list: ${error.response?.data?.error_description || error.message}`);
    }
  }
  
  async function fetchTraktListItems(
    listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc',
    isPublicImport = false, publicUsername = null, itemTypeHint = null, genre = null,
    isMetadataCheck = false
  ) {
  
  if (!listId) {
    console.error(`[TraktIntegration] Critical error - listId is undefined.`);
    return null;
  }
  
  const limit = isMetadataCheck ? 1 : ITEMS_PER_PAGE;
  const page = isMetadataCheck ? 1 : Math.floor(skip / limit) + 1;
  const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };
  
  if (!isPublicImport) {
    const isReady = await initTraktApi(userConfig);
    if (!isReady) {
      console.error(`[TraktIntegration] Trakt API not initialized or token refresh failed for listId: ${listId}`);
      return null;
    }
    headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
  }
  
  let requestUrl;
  let params = { limit, page, extended: 'full' };
  let rawTraktEntries = [];
  let effectiveItemTypeForEndpoint = itemTypeHint;
  
  try {
    if (isPublicImport && publicUsername) {
        const actualSlug = listId.replace(/^traktpublic_[^_]+_/, '');
        let basePath = `${TRAKT_API_URL}/users/${publicUsername}/lists/${actualSlug}/items`;
        if (itemTypeHint === 'movie') requestUrl = `${basePath}/movies`;
        else if (itemTypeHint === 'series') requestUrl = `${basePath}/shows`;
        else requestUrl = basePath; 
        effectiveItemTypeForEndpoint = itemTypeHint;
        if (['rank', 'added', 'title', 'released', 'runtime', 'popularity', 'votes', 'random'].includes(sortBy) && !isMetadataCheck) {
            params.sort_by = sortBy; if (sortOrder) params.sort_how = sortOrder;
        }
    } else if (listId === 'trakt_watchlist') {
        let typeForEndpoint = itemTypeHint || 'all'; 
        if (itemTypeHint === 'series') typeForEndpoint = 'shows';
        if (itemTypeHint === 'movie') typeForEndpoint = 'movies';
        let sortForEndpoint = sortBy;
        requestUrl = `${TRAKT_API_URL}/sync/watchlist/${typeForEndpoint}/${sortForEndpoint}/${sortOrder}`;
        params = { limit, page, extended: 'full' };
        effectiveItemTypeForEndpoint = null; 
    } else if (listId.startsWith('trakt_recommendations_')) {
        effectiveItemTypeForEndpoint = listId.endsWith('_movies') ? 'movie' : (listId.endsWith('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) { 
            console.error(`[TraktIntegration] Invalid recommendations list ID: ${listId}`);
            return null; 
        }
        requestUrl = `${TRAKT_API_URL}/recommendations/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}`;
        if (genre && !isMetadataCheck) params.genres = genre.toLowerCase().replace(/\s+/g, '-');
    } else if (listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
        effectiveItemTypeForEndpoint = listId.includes('_movies') ? 'movie' : (listId.includes('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) { 
            console.error(`[TraktIntegration] Invalid trending/popular list ID: ${listId}`);
            return null; 
        }
        const endpointType = listId.startsWith('trakt_trending_') ? 'trending' : 'popular';
        if (headers.Authorization) { 
          delete headers.Authorization;
        }
        requestUrl = `${TRAKT_API_URL}/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}/${endpointType}`;
        if (genre && !isMetadataCheck) params.genres = genre.toLowerCase().replace(/\s+/g, '-');
  
    } else if (listId.startsWith('trakt_')) { 
        const listSlug = listId.replace('trakt_', '');
        let basePath = `${TRAKT_API_URL}/users/me/lists/${listSlug}/items`;
        if (itemTypeHint === 'movie') { requestUrl = `${basePath}/movies`; effectiveItemTypeForEndpoint = 'movie'; }
        else if (itemTypeHint === 'series') { requestUrl = `${basePath}/shows`; effectiveItemTypeForEndpoint = 'series'; }
        else { requestUrl = basePath; effectiveItemTypeForEndpoint = null; } 
        if (sortBy && !isMetadataCheck) params.sort_by = sortBy; 
        if (sortOrder && !isMetadataCheck) params.sort_how = sortOrder;
    } else {
      console.warn(`[TraktIntegration] Unknown Trakt list ID format or type: ${listId}`);
      return null;
    }
  
    if (requestUrl) { 
        const response = await axios.get(requestUrl, { headers, params });
        if (Array.isArray(response.data)) {
            rawTraktEntries = response.data;
        }
    }
  
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
        } else { 
           if (listId.startsWith('trakt_trending_')) {
              if (effectiveItemTypeForEndpoint === 'movie' && entry.movie && entry.movie.ids && entry.movie.title && typeof entry.movie.year === 'number') {
                  resolvedStremioType = 'movie';
                  itemDataForDetails = entry.movie;
              } else if (effectiveItemTypeForEndpoint === 'series' && entry.show && entry.show.ids && entry.show.title && typeof entry.show.year === 'number') {
                  resolvedStremioType = 'series';
                  itemDataForDetails = entry.show;
              } else {
                  return null;
              }
           } else if (listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_popular_')) {
              if (effectiveItemTypeForEndpoint === 'movie' && entry.ids && entry.title && typeof entry.year === 'number') {
                  resolvedStremioType = 'movie';
                  itemDataForDetails = entry;
              } else if (effectiveItemTypeForEndpoint === 'series' && entry.ids && entry.title && typeof entry.year === 'number') {
                  resolvedStremioType = 'series';
                  itemDataForDetails = entry;
              } else {
                  return null;
              }
           } else {
               return null;
           }
        }
        
        if (!itemDataForDetails) return null;
        if (itemTypeHint && itemTypeHint !== 'all' && resolvedStremioType !== itemTypeHint) return null; 
        
        const imdbId = itemDataForDetails.ids?.imdb;
        if (!imdbId) return null; 
  
        return {
          imdb_id: imdbId, tmdb_id: itemDataForDetails.ids?.tmdb, title: itemDataForDetails.title,
          year: itemDataForDetails.year, overview: itemDataForDetails.overview, genres: itemDataForDetails.genres,
          runtime: itemDataForDetails.runtime, type: resolvedStremioType,
          listed_at: listedAt 
        };
      }).filter(item => item !== null);
      
      if (listId === 'trakt_watchlist' && sortBy === 'added' && initialItems.length > 0) {
          initialItems.sort((a, b) => {
              const dateA = a.listed_at ? new Date(a.listed_at) : 0;
              const dateB = b.listed_at ? new Date(b.listed_at) : 0;
              return (sortOrder === 'asc' ? dateA - dateB : dateB - dateA);
          });
      }
  
      let enrichedAllItems = await enrichItemsWithCinemeta(initialItems); 
  
      if (genre && enrichedAllItems.length > 0 && !isMetadataCheck) {
          const lowerGenre = String(genre).toLowerCase();
          const needsServerSideGenreFiltering = !(
              listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_trending_') ||
              listId.startsWith('trakt_popular_') || (isPublicImport && itemTypeHint) 
          );
          if (needsServerSideGenreFiltering) {
              enrichedAllItems = enrichedAllItems.filter(item => item.genres && item.genres.map(g => String(g).toLowerCase()).includes(lowerGenre));
          }
      }
  
      const finalResult = { allItems: enrichedAllItems, hasMovies: false, hasShows: false };
      enrichedAllItems.forEach(item => {
        if (item.type === 'movie') finalResult.hasMovies = true;
        else if (item.type === 'series') finalResult.hasShows = true;
      });
          
      return finalResult;
  
    } catch (error) {
      console.error(`[TraktIntegration] Critical exception in fetchTraktListItems for list ${listId}: ${error.message}`, error.stack); 
      if (error.response) {
          console.error(`[TraktIntegration] Trakt API Error Response: Status ${error.response.status}`, JSON.stringify(error.response.data, null, 2)); 
      }
      return null;
    }
  }
  
  module.exports = {
    initTraktApi,
    getTraktAuthUrl,
    authenticateTrakt,
    fetchTraktLists,
    fetchTraktListItems,
    fetchPublicTraktListDetails
  };