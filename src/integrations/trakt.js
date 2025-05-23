const axios = require('axios');
const { ITEMS_PER_PAGE } = require('../config');

const TRAKT_API_URL = 'https://api.trakt.tv';
const TRAKT_CLIENT_ID = '490414ec03fe9a33b2d0c16d58261ebbbd9cf0eee23f213fa0e3eb1d6126d05c';

/**
 * Initialize Trakt API client and handle authentication
 * @param {Object} userConfig - User configuration
 * @returns {Promise<boolean>} Whether Trakt is authenticated
 */
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

/**
 * Refresh a Trakt access token using the refresh token
 * @param {Object} userConfig - User configuration
 * @returns {Promise<boolean>} Whether token refresh was successful
 */
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
        // Token is invalid (e.g., revoked), clear it
        userConfig.traktAccessToken = null;
        userConfig.traktRefreshToken = null;
        userConfig.traktExpiresAt = null;
        console.error("Trakt refresh token is invalid or revoked. User needs to re-authenticate.");
    }
    return false;
  }
}

/**
 * Get authentication URL for Trakt
 * @returns {string} Authentication URL
 */
function getTraktAuthUrl() {
  return `${TRAKT_API_URL}/oauth/authorize?response_type=code&client_id=${TRAKT_CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;
}

/**
 * Handle Trakt authentication with authorization code
 * @param {string} code - Authorization code
 * @returns {Promise<Object>} Trakt tokens
 */
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
    console.error("Error authenticating with Trakt:", error.message);
    if (error.response) console.error("Trakt API Error Response:", error.response.data);
    throw error;
  }
}

/**
 * Fetch Trakt user lists
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Array>} Array of lists
 */
async function fetchTraktLists(userConfig) {
  if (!userConfig.traktAccessToken) return [];
  const isValid = await initTraktApi(userConfig);
  if (!isValid) {
    console.warn("Trakt token invalid or expired, cannot fetch lists.");
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
      id: `trakt_${list.ids.slug}`, // Used for personal lists
      user_id: 'trakt_user', // Placeholder
      name: list.name,
      updated: list.updated_at,
      listType: 'T', // Denotes a Trakt list
      isTraktList: true // Specific flag for personal custom lists
    }));

    // Add "special" Trakt lists that are not user-created custom lists
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
        lists.push({
            ...sl,
            user_id: 'trakt_user',
            updated: new Date().toISOString(),
        });
    });

    return lists;
  } catch (error) {
    console.error("Error fetching Trakt lists:", error.message);
    return [];
  }
}

/**
 * Fetch items from a Trakt list
 * @param {string} listId - Trakt list ID (e.g., trakt_watchlist, trakt_slug)
 * @param {Object} userConfig - User configuration
 * @param {number} skip - Number of items to skip
 * @param {string} [sortBy='rank'] - Field to sort by
 * @param {string} [sortOrder='asc'] - Sort order ('asc' or 'desc')
 * @returns {Promise<Object|null>} Object with movies and shows, or null on error
 */
async function fetchTraktListItems(listId, userConfig, skip = 0, sortBy = 'rank', sortOrder = 'asc') {
  if (!userConfig.traktAccessToken) return null;
  const isValid = await initTraktApi(userConfig);
  if (!isValid) {
    console.warn("Trakt token invalid or expired, cannot fetch list items.");
    return null;
  }

  const limit = ITEMS_PER_PAGE;
  const page = Math.floor(skip / limit) + 1;
  
  const headers = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID,
    'Authorization': `Bearer ${userConfig.traktAccessToken}`
  };
  
  let requestPromises = [];
  let processFunction = (items, typeOverride = null) => items.map(item => {
    const media = item.movie || item.show || item; // Handles different response structures
    return {
      imdb_id: media.ids?.imdb,
      title: media.title,
      year: media.year,
      type: typeOverride || (item.type === 'show' || media.type === 'show' ? 'series' : 'movie') // Ensure 'series' for Stremio
    };
  });

  try {
    if (listId === 'trakt_watchlist') {
      const validWatchlistSorts = ['rank', 'added', 'released', 'title'];
      const watchlistSortBy = validWatchlistSorts.includes(sortBy) ? sortBy : 'rank';

      requestPromises.push(
        axios.get(`${TRAKT_API_URL}/users/me/watchlist/movies/${watchlistSortBy}`, { headers, params: { limit, page, extended: 'full' } })
             .then(res => ({ type: 'movies', data: res.data }))
      );
      requestPromises.push(
        axios.get(`${TRAKT_API_URL}/users/me/watchlist/shows/${watchlistSortBy}`, { headers, params: { limit, page, extended: 'full' } })
             .then(res => ({ type: 'shows', data: res.data }))
      );
    } else if (listId.startsWith('trakt_recommendations_')) {
      const type = listId.endsWith('_movies') ? 'movies' : 'shows';
      // Recommendations don't typically support user sorting via API in the same way.
      requestPromises.push(
        axios.get(`${TRAKT_API_URL}/recommendations/${type}`, { headers, params: { limit, page, extended: 'full' } })
             .then(res => ({ type, data: res.data }))
      );
    } else if (listId.startsWith('trakt_trending_')) {
      const type = listId.endsWith('_movies') ? 'movies' : 'shows';
      requestPromises.push(
        axios.get(`${TRAKT_API_URL}/${type}/trending`, { headers: { ...headers, Authorization: undefined }, params: { limit, page, extended: 'full' } }) // No auth needed for public trending
             .then(res => ({ type, data: res.data }))
      );
    } else if (listId.startsWith('trakt_popular_')) {
      const type = listId.endsWith('_movies') ? 'movies' : 'shows';
      requestPromises.push(
        axios.get(`${TRAKT_API_URL}/${type}/popular`, { headers: { ...headers, Authorization: undefined }, params: { limit, page, extended: 'full' } }) // No auth needed for public popular
             .then(res => ({ type, data: res.data }))
      );
    } else if (listId.startsWith('trakt_')) { // User's custom list
      const listSlug = listId.replace('trakt_', '');
      // Custom lists use sort_by and sort_how
      const params = { limit, page, extended: 'full', sort_by: sortBy, sort_how: sortOrder };
      requestPromises.push(
        axios.get(`${TRAKT_API_URL}/users/me/lists/${listSlug}/items`, { headers, params })
             .then(res => ({ type: 'mixed', data: res.data })) // Type is mixed, need to check each item
      );
    } else {
      console.error(`Unknown Trakt listId format: ${listId}`);
      return null;
    }

    const results = await Promise.all(requestPromises);
    let movies = [];
    let shows = [];

    results.forEach(result => {
      if (result.type === 'movies') {
        movies.push(...processFunction(result.data, 'movie'));
      } else if (result.type === 'shows') {
        shows.push(...processFunction(result.data, 'series'));
      } else if (result.type === 'mixed') {
        result.data.forEach(item => {
          if (item.type === 'movie') {
            movies.push(processFunction([item.movie], 'movie')[0]);
          } else if (item.type === 'show') {
            shows.push(processFunction([item.show], 'series')[0]);
          }
        });
      }
    });
    
    return {
      movies,
      shows,
      hasMovies: movies.length > 0,
      hasShows: shows.length > 0,
    };

  } catch (error) {
    console.error(`Error fetching Trakt list items for ${listId}:`, error.message);
    if (error.response) console.error("Trakt API Error Response:", error.response.data, error.response.status);
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
};