const axios = require('axios');

/**
 * Validate MDBList API key
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<Object|null>} User info if valid, null if invalid
 */
async function validateMDBListKey(apiKey) {
  if (!apiKey) return null;
  
  try {
    const response = await axios.get(`https://api.mdblist.com/user?apikey=${apiKey}`, {
      timeout: 5000 // 5 second timeout
    });
    
    if (response.status === 200 && response.data) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.error('MDBList key validation error:', error.message);
    return null;
  }
}

/**
 * Fetch all user lists from MDBList API
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<Array>} Array of lists
 */
async function fetchAllLists(apiKey) {
  if (!apiKey) return [];
  
  try {
    let allLists = [];
    
    // Fetch internal lists (these use /lists/{id}/items endpoint)
    try {
      const internalResponse = await axios.get(`https://api.mdblist.com/lists/user?apikey=${apiKey}`);
      if (internalResponse.data && Array.isArray(internalResponse.data)) {
        const internalLists = internalResponse.data.map(list => ({
          ...list,
          listType: 'L',
          endpoint: `/lists/${list.id}/items`
        }));
        allLists = [...allLists, ...internalLists];
      }
    } catch (err) {
      console.error('Error fetching internal lists:', err.message);
    }

    // Fetch external lists (these use /external/lists/{id}/items endpoint)
    try {
      const externalResponse = await axios.get(`https://api.mdblist.com/external/lists/user?apikey=${apiKey}`);
      if (externalResponse.data && Array.isArray(externalResponse.data)) {
        const externalLists = externalResponse.data.map(list => ({
          ...list,
          listType: 'E',
          endpoint: `/external/lists/${list.id}/items`
        }));
        allLists = [...allLists, ...externalLists];
      }
    } catch (err) {
      console.error('Error fetching external lists:', err.message);
    }

    // Add watchlist (uses /watchlist/items endpoint)
    allLists.push({
      id: 'watchlist',
      name: 'My Watchlist',
      listType: 'W',
      endpoint: '/watchlist/items'
    });

    return allLists;
  } catch (error) {
    console.error('Error in fetchAllLists:', error);
    return [];
  }
}

/**
 * Fetch items in a specific MDBList
 * @param {string} listId - List ID
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchListItems(listId, apiKey) {
  if (!apiKey) return null;
  
  try {
    // Remove aiolists- prefix if present
    const id = listId.replace(/^aiolists-/, '');
    
    // Special case for watchlist
    if (id === 'watchlist') {
      console.log('Fetching watchlist items');
      const response = await axios.get(`https://api.mdblist.com/watchlist/items?apikey=${apiKey}`);
      return processApiResponse(response.data);
    }
    
    // First try as external list
    try {
      console.log(`Trying external list ${id}`);
      const externalResponse = await axios.get(`https://api.mdblist.com/external/lists/${id}/items?apikey=${apiKey}`);
      if (externalResponse.status === 200 && !externalResponse.data.error) {
        return processApiResponse(externalResponse.data);
      }
    } catch (err) {
      console.log(`List ${id} is not external, trying internal`);
    }
    
    // If external fails, try as internal list
    try {
      console.log(`Trying internal list ${id}`);
      const internalResponse = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}`);
      if (internalResponse.status === 200 && !internalResponse.data.error) {
        return processApiResponse(internalResponse.data);
      }
    } catch (err) {
      console.log(`List ${id} is not internal either`);
    }
    
    console.error(`Failed to fetch list ${id} from either endpoint`);
    return null;
  } catch (error) {
    console.error(`Error in fetchListItems for ${listId}:`, error);
    return null;
  }
}

/**
 * Process API responses from MDBList
 * @param {Object} data - API response data
 * @returns {Object} Processed items with movies and shows
 */
function processApiResponse(data) {
  if (!data || data.error) {
    console.error('API error:', data?.error || 'No data');
    return null;
  }
  
  // Handle direct movies/shows response
  if (data.movies !== undefined || data.shows !== undefined) {
    return {
      movies: Array.isArray(data.movies) ? data.movies : [],
      shows: Array.isArray(data.shows) ? data.shows : []
    };
  }
  
  // Handle items array response
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data.items)) {
    items = data.items;
  } else if (Array.isArray(data.results)) {
    items = data.results;
  }
  
  return {
    movies: items.filter(item => item && (item.type === 'movie' || item.mediatype === 'movie')),
    shows: items.filter(item => item && (item.type === 'show' || item.mediatype === 'show'))
  };
}

module.exports = {
  fetchAllLists,
  fetchListItems,
  validateMDBListKey
}; 