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
  // Check if we have a valid token that's not expired
  if (userConfig.traktAccessToken && userConfig.traktExpiresAt) {
    const now = new Date();
    const expiresAt = new Date(userConfig.traktExpiresAt);
    
    if (now < expiresAt) {
      return true;
    }
    
    // Token expired, try to refresh
    if (userConfig.traktRefreshToken) {
      return refreshTraktToken(userConfig);
    }
  }
  // No tokens or failed to refresh
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
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.status === 200 && response.data) {
      // Return updated config (caller must save it)
      userConfig.traktAccessToken = response.data.access_token;
      userConfig.traktRefreshToken = response.data.refresh_token;
      
      // Calculate expiration date
      const expiresInMs = response.data.expires_in * 1000;
      const expiresAt = new Date(Date.now() + expiresInMs);
      userConfig.traktExpiresAt = expiresAt.toISOString();
      
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error refreshing Trakt token:", error.message);
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
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data) {
      // Calculate expiration date
      const expiresInMs = response.data.expires_in * 1000;
      const expiresAt = new Date(Date.now() + expiresInMs);
      
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: expiresAt.toISOString()
      };
    }
    
    throw new Error('Failed to authenticate with Trakt');
  } catch (error) {
    console.error("Error authenticating with Trakt:", error.message);
    if (error.response) {
      console.error("Trakt API Error Response:", error.response.data);
    }
    throw error;
  }
}

/**
 * Fetch Trakt user lists
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Array>} Array of lists
 */
async function fetchTraktLists(userConfig) {
  try {
    if (!userConfig.traktAccessToken) {
      return [];
    }
    
    // Ensure token is valid
    const isValid = await initTraktApi(userConfig);
    if (!isValid) {
      return [];
    }
    
    // Fetch user's lists from Trakt
    const response = await axios.get(`${TRAKT_API_URL}/users/me/lists`, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${userConfig.traktAccessToken}`
      }
    });
    
    if (response.status !== 200) {
      return [];
    }
    
    // Transform the lists into our format
    const lists = response.data.map(list => ({
      id: `trakt_${list.ids.slug}`,
      user_id: 'trakt_user',
      name: list.name,
      updated: list.updated_at,
      listType: 'T', // T for Trakt
      isTraktList: true
    }));
    
    // Also add special lists
    lists.push(
      {
        id: 'trakt_watchlist',
        user_id: 'trakt_user',
        name: 'Trakt Watchlist',
        updated: new Date().toISOString(),
        isTraktWatchlist: true,
        listType: 'T'
      },
      {
        id: 'trakt_recommendations_movies',
        user_id: 'trakt_user',
        name: 'Trakt Recommended Movies',
        updated: new Date().toISOString(),
        isTraktRecommendations: true,
        isMovieList: true,
        listType: 'T'
      },
      {
        id: 'trakt_recommendations_shows',
        user_id: 'trakt_user',
        name: 'Trakt Recommended Shows',
        updated: new Date().toISOString(),
        isTraktRecommendations: true,
        isShowList: true,
        listType: 'T'
      },
      {
        id: 'trakt_trending_movies',
        user_id: 'trakt_user',
        name: 'Trending Movies',
        updated: new Date().toISOString(),
        isTraktTrending: true,
        isMovieList: true,
        listType: 'T'
      },
      {
        id: 'trakt_trending_shows',
        user_id: 'trakt_user',
        name: 'Trending Shows',
        updated: new Date().toISOString(),
        isTraktTrending: true,
        isShowList: true,
        listType: 'T'
      },
      {
        id: 'trakt_popular_movies',
        user_id: 'trakt_user',
        name: 'Popular Movies',
        updated: new Date().toISOString(),
        isTraktPopular: true,
        isMovieList: true,
        listType: 'T'
      },
      {
        id: 'trakt_popular_shows',
        user_id: 'trakt_user',
        name: 'Popular Shows',
        updated: new Date().toISOString(),
        isTraktPopular: true,
        isShowList: true,
        listType: 'T'
      }
    );
    
    return lists;
  } catch (error) {
    console.error("Error fetching Trakt lists:", error.message);
    return [];
  }
}

/**
 * Fetch items from a Trakt list
 * @param {string} listId - Trakt list ID
 * @param {Object} userConfig - User configuration
 * @param {number} skip - Number of items to skip
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchTraktListItems(listId, userConfig, skip = 0) {
  try {
    if (!userConfig.traktAccessToken) {
      return null;
    }
    
    // Ensure token is valid
    const isValid = await initTraktApi(userConfig);
    if (!isValid) {
      return null;
    }
    
    // Replace hardcoded limit
    const limit = ITEMS_PER_PAGE;
    
    // Calculate the page number based on skip value
    // Trakt API uses pagination with page numbers rather than skip/offset
    const page = Math.floor(skip / limit) + 1;
    
    // Handle special Trakt lists
    if (listId === 'trakt_watchlist') {
      const movies = await axios.get(`${TRAKT_API_URL}/users/me/watchlist/movies?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${userConfig.traktAccessToken}`
        }
      });
      
      const shows = await axios.get(`${TRAKT_API_URL}/users/me/watchlist/shows?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${userConfig.traktAccessToken}`
        }
      });
      
      const hasMovies = movies.data.length > 0;
      const hasShows = shows.data.length > 0;
      
      console.log(`Trakt watchlist - hasMovies: ${hasMovies}, hasShows: ${hasShows}`);
      
      return {
        movies: movies.data.map(item => ({
          imdb_id: item.movie.ids.imdb,
          title: item.movie.title,
          year: item.movie.year,
          type: 'movie'
        })),
        shows: shows.data.map(item => ({
          imdb_id: item.show.ids.imdb,
          title: item.show.title,
          year: item.show.year,
          type: 'show'
        })),
        hasMovies: hasMovies,
        hasShows: hasShows
      };
    }
    
    if (listId === 'trakt_trending_movies') {
      const response = await axios.get(`${TRAKT_API_URL}/movies/trending?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID
        }
      });
      
      return {
        movies: response.data.map(item => ({
          imdb_id: item.movie.ids.imdb,
          title: item.movie.title,
          year: item.movie.year,
          type: 'movie'
        })),
        shows: [],
        hasMovies: response.data.length > 0,
        hasShows: false
      };
    }
    
    if (listId === 'trakt_trending_shows') {
      const response = await axios.get(`${TRAKT_API_URL}/shows/trending?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID
        }
      });
      
      return {
        movies: [],
        shows: response.data.map(item => ({
          imdb_id: item.show.ids.imdb,
          title: item.show.title,
          year: item.show.year,
          type: 'show'
        })),
        hasMovies: false,
        hasShows: response.data.length > 0
      };
    }
    
    if (listId === 'trakt_popular_movies') {
      const response = await axios.get(`${TRAKT_API_URL}/movies/popular?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID
        }
      });
      
      return {
        movies: response.data.map(item => ({
          imdb_id: item.ids.imdb,
          title: item.title,
          year: item.year,
          type: 'movie'
        })),
        shows: [],
        hasMovies: response.data.length > 0,
        hasShows: false
      };
    }
    
    if (listId === 'trakt_popular_shows') {
      const response = await axios.get(`${TRAKT_API_URL}/shows/popular?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID
        }
      });
      
      return {
        movies: [],
        shows: response.data.map(item => ({
          imdb_id: item.ids.imdb,
          title: item.title,
          year: item.year,
          type: 'show'
        })),
        hasMovies: false,
        hasShows: response.data.length > 0
      };
    }
    
    if (listId === 'trakt_recommendations_movies') {
      const response = await axios.get(`${TRAKT_API_URL}/recommendations/movies?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${userConfig.traktAccessToken}`
        }
      });
      
      return {
        movies: response.data.map(item => ({
          imdb_id: item.ids.imdb,
          title: item.title,
          year: item.year,
          type: 'movie'
        })),
        shows: [],
        hasMovies: response.data.length > 0,
        hasShows: false
      };
    }
    
    if (listId === 'trakt_recommendations_shows') {
      const response = await axios.get(`${TRAKT_API_URL}/recommendations/shows?limit=${limit}&page=${page}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': TRAKT_CLIENT_ID,
          'Authorization': `Bearer ${userConfig.traktAccessToken}`
        }
      });
      
      return {
        movies: [],
        shows: response.data.map(item => ({
          imdb_id: item.ids.imdb,
          title: item.title,
          year: item.year,
          type: 'show'
        })),
        hasMovies: false,
        hasShows: response.data.length > 0
      };
    }
    
    // For regular Trakt lists
    const listSlug = listId.replace('trakt_', '');
    const response = await axios.get(`${TRAKT_API_URL}/users/me/lists/${listSlug}/items?limit=${limit}&page=${page}`, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
        'Authorization': `Bearer ${userConfig.traktAccessToken}`
      }
    });
    
    const moviesFromList = response.data
      .filter(item => item.type === 'movie')
      .map(item => ({
        imdb_id: item.movie.ids.imdb,
        title: item.movie.title,
        year: item.movie.year,
        type: 'movie'
      }));
      
    const showsFromList = response.data
      .filter(item => item.type === 'show')
      .map(item => ({
        imdb_id: item.show.ids.imdb,
        title: item.show.title,
        year: item.show.year,
        type: 'show'
      }));
    
    const hasMovies = moviesFromList.length > 0;
    const hasShows = showsFromList.length > 0;
    
    console.log(`Trakt list ${listId} - hasMovies: ${hasMovies}, hasShows: ${hasShows}`);
    
    return {
      movies: moviesFromList,
      shows: showsFromList,
      hasMovies: hasMovies,
      hasShows: hasShows
    };
  } catch (error) {
    console.error(`Error fetching Trakt list ${listId}:`, error.message);
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