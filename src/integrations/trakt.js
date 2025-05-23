// src/integrations/trakt.js
const axios = require('axios');
const { ITEMS_PER_PAGE, TRAKT_CLIENT_ID } = require('../config');

const TRAKT_API_URL = 'https://api.trakt.tv';

async function initTraktApi(userConfig) {
  if (userConfig.traktAccessToken && userConfig.traktExpiresAt) {
    const now = new Date();
    const expiresAt = new Date(userConfig.traktExpiresAt);
    if (now < expiresAt) {
      return true;
    }
    if (userConfig.traktRefreshToken) {
      return refreshTraktToken(userConfig);
    }
  }
  return false;
}

async function refreshTraktToken(userConfig) {
  try {
    const response = await axios.post(
      `${TRAKT_API_URL}/oauth/token`,
      {
        refresh_token: userConfig.traktRefreshToken,
        client_id: TRAKT_CLIENT_ID,
        grant_type: 'refresh_token',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (response.status === 200 && response.data) {
      userConfig.traktAccessToken = response.data.access_token;
      userConfig.traktRefreshToken = response.data.refresh_token;
      const expiresInMs = response.data.expires_in * 1000;
      userConfig.traktExpiresAt = new Date(Date.now() + expiresInMs).toISOString();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error refreshing Trakt token:", error.message);
    if (error.response && error.response.status === 401) {
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
      code: code,
      client_id: TRAKT_CLIENT_ID,
      grant_type: 'authorization_code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
    }, { headers: { 'Content-Type': 'application/json' } });

    if (response.status === 200 && response.data) {
      const expiresInMs = response.data.expires_in * 1000;
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + expiresInMs).toISOString()
      };
    }
    throw new Error('Failed to authenticate with Trakt (Status not 200 or no data)');
  } catch (error) {
    console.error("Error authenticating with Trakt:", error.response ? error.response.data : error.message);
    throw error;
  }
}

async function fetchTraktLists(userConfig) {
  if (!userConfig.traktAccessToken) return [];
  const isValid = await initTraktApi(userConfig);
  if (!isValid) return [];

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
      id: `trakt_${list.ids.slug}`,
      name: list.name,
      updated: list.updated_at,
      listType: 'T', 
      isTraktList: true 
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

    specialLists.forEach(sl => {
        lists.push({ ...sl, updated: new Date().toISOString() });
    });
    return lists;
  } catch (error) {
    console.error("Error fetching Trakt lists:", error.message);
    return [];
  }
}

async function fetchPublicTraktListDetails(traktListUrl) {
  try {
    const cleanedUrl = traktListUrl.split('?')[0];

    const urlPattern = /^https?:\/\/trakt\.tv\/users\/([\w-]+)\/lists\/([\w-]+)\/?$/;
    const urlMatch = cleanedUrl.match(urlPattern);
    if (!urlMatch) {
      throw new Error('Invalid Trakt list URL format. Expected: https://trakt.tv/users/username/list-slug-or-id');
    }

    const [, username, listSlugOrId] = urlMatch;

    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID 
    };

    const listDetailsResponse = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}`, { headers });
    if (!listDetailsResponse.data) {
      throw new Error('Could not fetch Trakt list details.');
    }
    const listData = listDetailsResponse.data;

    let hasMovies = false;
    let hasShows = false;
    
    if (listData.item_count > 0) {
        const listItemsResponse = await axios.get(`${TRAKT_API_URL}/users/${username}/lists/${listSlugOrId}/items?limit=5&extended=full`, { headers });
        if (listItemsResponse.data && Array.isArray(listItemsResponse.data)) {
            for (const item of listItemsResponse.data) {
                if (item.type === 'movie') hasMovies = true;
                if (item.type === 'show') hasShows = true;
                if (hasMovies && hasShows) break;
            }
        }
    }

    return {
      listId: `traktpublic_${username}_${listData.ids.slug}`, 
      originalTraktId: String(listData.ids.trakt),
      originalTraktSlug: listData.ids.slug,
      traktUser: username,
      listName: listData.name,
      isTraktPublicList: true,
      hasMovies: hasMovies,
      hasShows: hasShows,
      itemCount: listData.item_count
    };

  } catch (error) {
    console.error('Error fetching public Trakt list details:', error.response ? error.response.data : error.message);
    throw new Error(`Failed to fetch Trakt list: ${error.response?.data?.error_description || error.message}`);
  }
}

async function fetchTraktListItems(listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc', isPublicImport = false, publicUsername = null, publicItemType = null) {
  const limit = ITEMS_PER_PAGE;
  const page = Math.floor(skip / limit) + 1;
  
  const headers = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID,
  };

  if (!isPublicImport) {
    if (!userConfig.traktAccessToken) return null;
    const isValid = await initTraktApi(userConfig);
    if (!isValid) return null;
    headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
  }

  let requestUrl;
  let params = { limit, page, extended: 'full' };
  let specificItemType = publicItemType; // 'movie' or 'series'

  try {
    if (isPublicImport && publicUsername && publicItemType) {
        const actualSlugOrId = listId.replace(/^trakt_/, ''); // listId is like trakt_SLUG for public imports
        const traktApiItemType = publicItemType === 'series' ? 'shows' : 'movies'; // API uses 'shows'/'movies'
        requestUrl = `${TRAKT_API_URL}/users/${publicUsername}/lists/${actualSlugOrId}/items/${traktApiItemType}`;
        const validPublicSorts = ['rank', 'added', 'title', 'released', 'runtime', 'popularity', 'votes', 'random'];
        if (validPublicSorts.includes(sortBy)) {
            params.sort_by = sortBy;
        }

    } else if (listId === 'trakt_watchlist') {
      const typePath = sortBy === 'my_rating' ? (specificItemType === 'series' ? 'shows' : 'movies') : (specificItemType === 'series' ? 'shows' : 'movies'); // fallback
      const validWatchlistSorts = ['rank', 'added', 'released', 'title']; // my_rating not directly for watchlist items sort path
      const effectiveSortBy = validWatchlistSorts.includes(sortBy) ? sortBy : 'rank';
      requestUrl = `${TRAKT_API_URL}/users/me/watchlist/${typePath || 'movies'}/${effectiveSortBy}`; // Default to movies if type not clear
    } else if (listId.startsWith('trakt_recommendations_')) {
      specificItemType = listId.endsWith('_movies') ? 'movie' : 'series';
      requestUrl = `${TRAKT_API_URL}/recommendations/${specificItemType === 'series' ? 'shows' : 'movies'}`;
    } else if (listId.startsWith('trakt_trending_')) {
      specificItemType = listId.endsWith('_movies') ? 'movie' : 'series';
      delete headers.Authorization;
      requestUrl = `${TRAKT_API_URL}/${specificItemType === 'series' ? 'shows' : 'movies'}/trending`;
    } else if (listId.startsWith('trakt_popular_')) {
      specificItemType = listId.endsWith('_movies') ? 'movie' : 'series';
      delete headers.Authorization;
      requestUrl = `${TRAKT_API_URL}/${specificItemType === 'series' ? 'shows' : 'movies'}/popular`;
    } else if (listId.startsWith('trakt_')) {
      const listSlug = listId.replace('trakt_', '');
      requestUrl = `${TRAKT_API_URL}/users/me/lists/${listSlug}/items`;
      params.sort_by = sortBy;
      params.sort_how = sortOrder;
    } else {
      console.error(`Unknown Trakt listId format for item fetching: ${listId}`);
      return null;
    }

    const response = await axios.get(requestUrl, { headers, params });
    
    let items = [];
    if (Array.isArray(response.data)) {
        items = response.data;
    } else if (response.data && Array.isArray(response.data.items)) {
        items = response.data.items;
    }

    const processedItems = items.map(entry => {
      const itemData = entry.movie || entry.show || entry;
      const type = specificItemType || (entry.type === 'show' || itemData.type === 'show' ? 'series' : 'movie');
      return {
        imdb_id: itemData.ids?.imdb,
        tmdb_id: itemData.ids?.tmdb,
        title: itemData.title,
        year: itemData.year,
        type: type,
      };
    }).filter(item => item.imdb_id || item.tmdb_id);

    const result = { movies: [], shows: [], hasMovies: false, hasShows: false };
    processedItems.forEach(item => {
      if (item.type === 'movie') result.movies.push(item);
      else if (item.type === 'series') result.shows.push(item);
    });
    result.hasMovies = result.movies.length > 0;
    result.hasShows = result.shows.length > 0;
    
    return result;

  } catch (error) {
    const errorMessage = `Error fetching Trakt list items for ${listId}${isPublicImport ? ` (public: ${publicUsername}/${listId.replace('trakt_','')})` : ''}: ${error.message}`;
    console.error(errorMessage);
    if (error.response) {
        console.error("Trakt API Error Response:", error.response.data, error.response.status);
        if (error.response.status === 404) {
        }
    }
    return null;
  }
}

module.exports = {
  initTraktApi,
  refreshTraktToken,
  getTraktAuthUrl,
  authenticateTrakt,
  fetchTraktLists,
  fetchTraktListItems,
  fetchPublicTraktListDetails
};