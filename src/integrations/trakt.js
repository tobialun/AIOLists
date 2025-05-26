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
      refresh_token: userConfig.traktRefreshToken,
      client_id: TRAKT_CLIENT_ID,
      grant_type: 'refresh_token',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
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
    if (error.response?.status === 401) {
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
    throw error;
  }
}

async function fetchTraktLists(userConfig) {
  if (!await initTraktApi(userConfig)) return [];
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
      const sampleLimit = Math.min(listData.item_count, 100);
      const itemsResp = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listData.ids.slug}/items?limit=${sampleLimit}&extended=full`, { headers });
      if (itemsResp.data && Array.isArray(itemsResp.data)) {
        for (const item of itemsResp.data) {
          if (item.type === 'movie' && item.movie) hasMovies = true;
          if (item.type === 'show' && item.show) hasShows = true;
          if (hasMovies && hasShows) break;
        }
      }
    }
    return {
      listId: `traktpublic_${username}_${listData.ids.slug}`, originalTraktId: String(listData.ids.trakt),
      originalTraktSlug: listData.ids.slug, traktUser: username, listName: listData.name,
      isTraktPublicList: true, hasMovies: hasMovies, hasShows: hasShows, itemCount: listData.item_count
    };
  } catch (error) {
    console.error('Error fetching public Trakt list details:', error.response?.data || error.message);
    throw new Error(`Failed to fetch Trakt list: ${error.response?.data?.error_description || error.message}`);
  }
}

async function fetchTraktListItems(
    listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc',
    isPublicImport = false, publicUsername = null, itemTypeHint = null, genre = null,
    isMetadataCheck = false
) {
  if (!listId) {
    console.error(`TraktListItems: Critical error - listId is undefined.`);
    return null;
  }
  
  const limit = isMetadataCheck ? 1 : ITEMS_PER_PAGE;
  const page = isMetadataCheck ? 1 : Math.floor(skip / limit) + 1;

  const headers = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_CLIENT_ID };

  if (!isPublicImport) {
    if (!await initTraktApi(userConfig)) {
      console.error(`TraktListItems (ID: ${listId}): Trakt API not initialized or token refresh failed.`);
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
        let basePath = `${TRAKT_API_URL}/users/me/watchlist`;
        if (itemTypeHint === 'movie') { requestUrl = `${basePath}/movies`; effectiveItemTypeForEndpoint = 'movie'; }
        else if (itemTypeHint === 'series') { requestUrl = `${basePath}/shows`; effectiveItemTypeForEndpoint = 'series'; }
        else {
            const typesToFetch = isMetadataCheck && itemTypeHint ? [itemTypeHint] : ['movie', 'show'];
            const promises = typesToFetch.map(type => {
                const typePath = type === 'movie' ? 'movies' : 'shows';
                return axios.get(`${basePath}/${typePath}`, { headers, params }).catch(e => ({ data: [] }));
            });
            const responses = await Promise.all(promises);
            responses.forEach((resp, index) => {
                const currentType = typesToFetch[index]; // 'movie' or 'show'
                if (Array.isArray(resp.data)) rawTraktEntries.push(...resp.data.map(entry => ({ ...entry, typeFromParams: currentType })));
            });
            effectiveItemTypeForEndpoint = null;
        }
        if (['rank', 'added', 'released', 'title'].includes(sortBy) && !isMetadataCheck) params.sort = sortBy;
    } else if (listId.startsWith('trakt_recommendations_')) {
        effectiveItemTypeForEndpoint = listId.endsWith('_movies') ? 'movie' : (listId.endsWith('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) { console.error(`TraktListItems (ID: ${listId}): Invalid recommendations list ID.`); return null; }
        requestUrl = `${TRAKT_API_URL}/recommendations/${effectiveItemTypeForEndpoint === 'series' ? 'shows' : 'movies'}`;
        if (genre && !isMetadataCheck) params.genres = genre.toLowerCase().replace(/\s+/g, '-');
    } else if (listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
        effectiveItemTypeForEndpoint = listId.includes('_movies') ? 'movie' : (listId.includes('_shows') ? 'series' : null);
        if (!effectiveItemTypeForEndpoint) { console.error(`TraktListItems (ID: ${listId}): Invalid trending/popular list ID.`); return null; }
        const endpointType = listId.startsWith('trakt_trending_') ? 'trending' : 'popular';
        if (headers.Authorization) delete headers.Authorization;
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
      console.warn(`TraktListItems (ID: ${listId}): Unknown Trakt list ID format or type.`); return null;
    }

    if (requestUrl && rawTraktEntries.length === 0) {
        const response = await axios.get(requestUrl, { headers, params });
        if (listId.startsWith('trakt_recommendations_') || listId.startsWith('trakt_trending_') || listId.startsWith('trakt_popular_')) {
             if (Array.isArray(response.data)) {
                rawTraktEntries = response.data.map(item => ({ [effectiveItemTypeForEndpoint]: item, typeFromParams: effectiveItemTypeForEndpoint }));
             }
        } else if (Array.isArray(response.data)) {
            rawTraktEntries = response.data.map(entry => ({ ...entry, typeFromParams: entry.type || effectiveItemTypeForEndpoint || null }));
        }
    }

    const initialItems = rawTraktEntries.map(entry => {
      let itemDataForDetails;
      let resolvedStremioType;
      let entryType = entry.typeFromParams || entry.type || effectiveItemTypeForEndpoint;

      if (entryType === 'movie' && entry.movie) {
        resolvedStremioType = 'movie';
        if (entry.movie.movie && entry.movie.movie.ids) { // Handles { movie: { movie: ACTUAL_DATA } }
            itemDataForDetails = entry.movie.movie;
        } else if (entry.movie.ids) { // Handles { movie: ACTUAL_DATA }
            itemDataForDetails = entry.movie;
        } else {
            return null;
        }
      } else if (entryType === 'series' && entry.series) {
        resolvedStremioType = 'series';
        if (entry.series.show && entry.series.show.ids) { // Handles { series: { show: ACTUAL_DATA } }
            itemDataForDetails = entry.series.show;
        } else if (entry.series.ids) { // Handles { series: ACTUAL_DATA }
            itemDataForDetails = entry.series;
        } else {
            return null;
        }
      } else if (entryType === 'show' && entry.show) { // Handles items from watchlist/user lists with type: 'show'
        resolvedStremioType = 'series'; 
        itemDataForDetails = entry.show;
      } else {
        return null;
      }
      
      if (!itemDataForDetails) {
          return null;
      }

      if (itemTypeHint && resolvedStremioType !== itemTypeHint && !(listId === 'trakt_watchlist' && !itemTypeHint)) {
         return null;
      }

      const imdbId = itemDataForDetails.ids?.imdb;
      if (!imdbId) { 
        return null; 
      }

      return {
        imdb_id: imdbId, tmdb_id: itemDataForDetails.ids?.tmdb, title: itemDataForDetails.title,
        year: itemDataForDetails.year, overview: itemDataForDetails.overview, genres: itemDataForDetails.genres,
        runtime: itemDataForDetails.runtime, type: resolvedStremioType,
      };
    }).filter(item => item !== null);

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

    const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
    enrichedAllItems.forEach(item => {
      if (item.type === 'movie') { finalResult.movies.push(item); finalResult.hasMovies = true; }
      else if (item.type === 'series') { finalResult.shows.push(item); finalResult.hasShows = true; }
    });
    
    return finalResult;

  } catch (error) {
    console.error(`TraktListItems (ID: ${listId}): Critical error: ${error.message}`, error.stack);
    if (error.response) {
        console.error(`TraktListItems (ID: ${listId}): Trakt API Error Response: Status ${error.response.status}`, JSON.stringify(error.response.data, null, 2));
    }
    return null;
  }
}

module.exports = {
  initTraktApi, refreshTraktToken, getTraktAuthUrl, authenticateTrakt,
  fetchTraktLists, fetchTraktListItems, fetchPublicTraktListDetails
};