const axios = require('axios');

/**
 * Fetch all user lists from MDBList API
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<Array>} Array of lists
 */
async function fetchAllLists(apiKey) {
  if (!apiKey) return [];
  
  try {
    let allLists = [];
    
    // Fetch user's regular internal lists from MDBList
    try {
      const userListsResponse = await axios.get(`https://api.mdblist.com/lists/user?apikey=${apiKey}`);
      const userLists = (userListsResponse.data || []).map(list => ({
        ...list, 
        listType: 'L',
        isInternalList: true
      }));
      allLists = [...allLists, ...userLists];
    
      // Fetch user's external lists from MDBList
      const externalListsResponse = await axios.get(`https://api.mdblist.com/external/lists/user?apikey=${apiKey}`);
      const externalLists = (externalListsResponse.data || []).map(list => ({
        ...list, 
        listType: 'E',
        isExternalList: true
      }));
      allLists = [...allLists, ...externalLists];
    
      // Add the MDBList watchlist
      allLists.push({
        id: 'watchlist',
        user_id: 'current',
        name: 'My Watchlist',
        updated: new Date().toISOString(),
        isWatchlist: true,
        listType: 'W'
      });
    } catch (err) {
      console.error('Error fetching MDBList lists:', err.message);
    }
    
    return allLists;
  } catch (error) {
    console.error('Error fetching MDBList lists:', error);
    return [];
  }
}

/**
 * Fetch items in a specific MDBList
 * @param {string} listId - List ID
 * @param {string} apiKey - MDBList API key
 * @param {Object} listsMetadata - Metadata for lists
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchListItems(listId, apiKey, listsMetadata = {}) {
  if (!apiKey) return null;
  
  try {
    // Determine the appropriate URL based on list type
    let url;
    let listType = 'unknown';
    
    // Check if we have list metadata
    const listMetadata = listsMetadata[listId];
    
    if (listId === 'watchlist') {
      url = `https://api.mdblist.com/watchlist/items?apikey=${apiKey}`;
      listType = 'watchlist';
    } else if (listMetadata && listMetadata.isExternalList) {
      url = `https://api.mdblist.com/external/lists/${listId}/items?apikey=${apiKey}`;
      listType = 'external';
    } else {
      url = `https://api.mdblist.com/lists/${listId}/items?apikey=${apiKey}`;
      listType = 'internal';
    }
    
    const response = await axios.get(url);
    
    if (response.status !== 200) {
      console.error(`Failed to fetch list ${listId}: ${response.status}`);
      return null;
    }
    
    return processApiResponse(response.data, listId);
  } catch (error) {
    console.error(`Error fetching list ${listId}:`, error);
    if (error.response) {
      console.error('API Error Response:', error.response.data);
    }
    return null;
  }
}

/**
 * Process API responses from MDBList
 * @param {Object} data - API response data
 * @param {string} listId - List ID
 * @returns {Object} Processed items with movies and shows
 */
function processApiResponse(data, listId) {
  if (data.error) {
    console.error(`API error for list ${listId}: ${data.error}`);
    return null;
  }
  
  // MDBList API might directly return movies and shows properties
  if (data.movies !== undefined || data.shows !== undefined) {
    return {
      movies: Array.isArray(data.movies) ? data.movies : [],
      shows: Array.isArray(data.shows) ? data.shows : []
    };
  }
  
  // Attempt to find items in the response - different API endpoints might have different structures
  let itemsArray = [];
  
  // Check standard format
  if (data.items && Array.isArray(data.items)) {
    itemsArray = data.items;
  } 
  // Check if data itself is an array (some APIs directly return an array)
  else if (Array.isArray(data)) {
    itemsArray = data;
  }
  // Check if data has a 'results' field (common in many APIs)
  else if (data.results && Array.isArray(data.results)) {
    itemsArray = data.results;
  }
  
  // If we still don't have items, return empty arrays
  if (itemsArray.length === 0) {
    return {
      movies: [],
      shows: []
    };
  }
  
  // Now we have items, filter by type (if type property exists)
  // Some APIs use mediatype instead of type
  return {
    movies: itemsArray.filter(item => item && (item.type === 'movie' || item.mediatype === 'movie')),
    shows: itemsArray.filter(item => item && (item.type === 'show' || item.mediatype === 'show'))
  };
}

module.exports = {
  fetchAllLists,
  fetchListItems
}; 