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
 * @param {Object} listsMetadata - Metadata for all lists
 * @param {number} skip - Number of items to skip for pagination
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchListItems(listId, apiKey, listsMetadata, skip = 0) {
  if (!apiKey) return null;
  
  try {
    // Remove aiolists- prefix if present
    const id = listId.replace(/^aiolists-/, '');
    
    // Special case for watchlist
    if (id === 'watchlist') {
      console.log(`Fetching watchlist items with skip=${skip}`);
      const response = await axios.get(`https://api.mdblist.com/watchlist/items?apikey=${apiKey}&limit=100&offset=${skip}`);
      return processApiResponse(response.data);
    }

    // Check if this is an internal or external list using metadata
    const metadata = listsMetadata?.[id];
    const isExternal = metadata?.isExternalList;

    if (isExternal) {
      // Try external list endpoint
      try {
        const response = await axios.get(`https://api.mdblist.com/external/lists/${id}/items?apikey=${apiKey}&limit=100&offset=${skip}`);
        if (response.status === 200 && !response.data.error) {
          return processApiResponse(response.data);
        }
      } catch (err) {
        console.error(`Error fetching external list ${id}:`, err.message);
      }
    } else {
      // Try internal list endpoint
      try {
        const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&limit=100&offset=${skip}`);
        if (response.status === 200 && !response.data.error) {
          return processApiResponse(response.data);
        }
      } catch (err) {
        console.error(`Error fetching internal list ${id}:`, err.message);
      }
    }

    console.error(`Failed to fetch list ${id}`);
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