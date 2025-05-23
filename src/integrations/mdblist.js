// src/integrations/mdblist.js
const axios = require('axios');
const { ITEMS_PER_PAGE } = require('../config');

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
          endpoint: `/lists/${list.id}/items`,
          isInternalList: true,
          isExternalList: false
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
          endpoint: `/external/lists/${list.id}/items`,
          isInternalList: false,
          isExternalList: true
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
      endpoint: '/watchlist/items',
      isInternalList: false,
      isExternalList: false,
      isWatchlist: true
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
 * @param {string} [sort='imdbvotes'] - Sort field
 * @param {string} [order='desc'] - Sort order (asc or desc)
 * @param {boolean} [isUrlImported=false] - Flag if the list is from a URL import
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchListItems(listId, apiKey, listsMetadata, skip = 0, sort = 'imdbvotes', order = 'desc', isUrlImported = false) {
  if (!apiKey) return null;

  try {
      const match = listId.match(/^aiolists-(\d+)-([ELW])$/);
      let id = match ? match[1] : listId.replace(/^aiolists-/, ''); // Clean ID
      const listTypeFromIdString = match ? match[2] : null;

      if (id === 'watchlist' || id === 'watchlist-W') {
          try {
              const response = await axios.get(`https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
              if (response.status === 429) {
                  console.error('Rate limited by MDBList API for watchlist.');
                  return null;
              }
              return processApiResponse(response.data);
          } catch (error) {
              if (error.response?.status === 429) {
                  console.error('Rate limited by MDBList API for watchlist.');
                  return null;
              }
              console.error(`Error fetching MDBList watchlist:`, error.message);
              return null;
          }
      }
      
      // If it's a URL imported list, the ID should be the direct MDBList ID.
      // The listType 'L' is assumed for public lists fetched by ID/slug.
      if (isUrlImported) {
          // console.log(`Workspaceing MDBList (URL imported): ${id} as type L`);
          try {
              const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
              if (response.status === 200 && !response.data.error) {
                  // console.log(`Successfully fetched MDBList ${id} (URL import)`);
                  return processApiResponse(response.data);
              }
              console.error(`Failed to fetch MDBList ${id} (URL import). Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
              return null;
          } catch (error) {
              console.error(`Error fetching MDBList ${id} (URL import):`, error.message);
              return null;
          }
      } else {
          // Logic for user's personal lists (not URL-imported)
          const metadata = listsMetadata && listsMetadata[String(id)];
          let effectiveListType = listTypeFromIdString;

          if (metadata && metadata.listType) {
              effectiveListType = metadata.listType;
          } else if (!effectiveListType) {
              const allLists = await fetchAllLists(apiKey);
              const listObj = allLists.find(l => String(l.id) === String(id));

              if (!listObj || !listObj.listType) {
                  console.error(`MDBList ${id} not found in user's personal lists or listType missing in fetched object.`);
                  return null;
              }
              effectiveListType = listObj.listType;
          }


          if (effectiveListType === 'E') {
              try {
                  const response = await axios.get(`https://api.mdblist.com/external/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
                  return processApiResponse(response.data);
              } catch (error) {
                  console.error(`Error fetching EXTERNAL MDBList ${id}:`, error.message);
                  return null;
              }
          } else if (effectiveListType === 'L') {
               try {
                  const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
                  return processApiResponse(response.data);
              } catch (error) {
                  console.error(`Error fetching INTERNAL MDBList ${id}:`, error.message);
                  return null;
              }
          } else {
              console.error(`Unknown or undefined effectiveListType ('${effectiveListType}') for MDBList ID ${id}`);
              return null;
          }
      }
  } catch (error) {
      console.error(`Critical error in fetchListItems for MDBList ID ${listId}:`, error);
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
    console.error('MDBList API error:', data?.error || 'No data');
    return null;
  }
  
  if (data.movies !== undefined || data.shows !== undefined) {
    const hasMovies = Array.isArray(data.movies) && data.movies.length > 0;
    const hasShows = Array.isArray(data.shows) && data.shows.length > 0;
    return {
      movies: Array.isArray(data.movies) ? data.movies : [],
      shows: Array.isArray(data.shows) ? data.shows : [],
      hasMovies: hasMovies,
      hasShows: hasShows
    };
  }
  
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray(data.items)) {
    items = data.items;
  } else if (Array.isArray(data.results)) {
    items = data.results;
  }
  
  const movies = items.filter(item => item && (item.type === 'movie' || item.mediatype === 'movie'));
  const shows = items.filter(item => item && (item.type === 'show' || item.mediatype === 'show'));
  
  return {
    movies: movies,
    shows: shows,
    hasMovies: movies.length > 0,
    hasShows: shows.length > 0
  };
}

/**
 * Extract list ID and metadata from MDBList URL using API
 * @param {string} url - MDBList URL (e.g., https://mdblist.com/lists/username/list-name)
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<{listId: string, listName: string, isUrlImport: boolean, hasMovies: boolean, hasShows: boolean}>} List ID, name, and content flags
 * @throws {Error} If list ID cannot be extracted or list not found
 */
async function extractListFromUrl(url, apiKey) {
  try {
    const urlPattern = /^https?:\/\/mdblist\.com\/lists\/([\w-]+)\/([\w-]+)\/?$/;
    const urlMatch = url.match(urlPattern);
    if (!urlMatch) {
      throw new Error('Invalid MDBList URL format. Expected: https://mdblist.com/lists/username/list-slug');
    }

    const [, username, listSlug] = urlMatch;

    const apiResponse = await axios.get(`https://api.mdblist.com/lists/${username}/${listSlug}?apikey=${apiKey}`);
    
    if (!apiResponse.data || !Array.isArray(apiResponse.data) || apiResponse.data.length === 0) {
      throw new Error('Could not fetch list details from MDBList API or list is empty/not found.');
    }

    const listData = apiResponse.data[0];
    
    return {
      listId: String(listData.id), // Ensure ID is a string
      listName: listData.name,
      isUrlImport: true, // Mark as URL import
      hasMovies: listData.movies > 0,
      hasShows: listData.shows > 0
    };
  } catch (error) {
    console.error('Error extracting MDBList from URL:', error.response ? error.response.data : error.message);
    throw new Error(`Failed to extract MDBList: ${error.response && error.response.data && error.response.data.error ? error.response.data.error : error.message}`);
  }
}

module.exports = {
  fetchAllLists,
  fetchListItems,
  validateMDBListKey,
  extractListFromUrl
};