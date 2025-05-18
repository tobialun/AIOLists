const axios = require('axios');
const cheerio = require('cheerio');

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
 * @param {string} [sort='rank'] - Sort field
 * @param {string} [order='desc'] - Sort order (asc or desc)
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchListItems(listId, apiKey, listsMetadata, skip = 0, sort = 'rank', order = 'desc') {
  if (!apiKey) return null;
  
  try {
    // Remove aiolists- prefix if present
    const id = listId.replace(/^aiolists-/, '');    
    
    // Special case for watchlist
    if (id === 'watchlist') {
      try {
        console.log('Fetching watchlist items (W)');
        const response = await axios.get(`https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
        if (response.status === 429) {
          console.error('Rate limited by MDBList API. Please wait a moment before trying again.');
          return null;
        }
        return processApiResponse(response.data);
      } catch (error) {
        if (error.response?.status === 429) {
          console.error('Rate limited by MDBList API. Please wait a moment before trying again.');
          return null;
        }
        throw error;
      }
    }
    
    // Also handle watchlist with W type suffix
    if (id === 'watchlist-W') {
      try {
        console.log('Fetching watchlist items with type suffix (W)');
        const response = await axios.get(`https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
        if (response.status === 429) {
          console.error('Rate limited by MDBList API. Please wait a moment before trying again.');
          return null;
        }
        return processApiResponse(response.data);
      } catch (error) {
        if (error.response?.status === 429) {
          console.error('Rate limited by MDBList API. Please wait a moment before trying again.');
          return null;
        }
        throw error;
      }
    }

    // When importing from URL, use internal endpoint
    if (listsMetadata && listsMetadata._importingUrl) {
      console.log(`Fetching INTERNAL list for URL import: ${id}`);
      try {
        const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
        if (response.status === 200 && !response.data.error) {
          console.log(`Successfully fetched internal list ${id} for URL import`);
          return processApiResponse(response.data);
        }
      } catch (error) {
        console.error(`Error fetching internal list ${id} for URL import:`, error.message);
        return null;
      }
    }

    // Get metadata for this list
    const metadata = listsMetadata && listsMetadata[id];
    if (!metadata) {
      console.log(`No metadata for list ${id}, fetching all lists to determine type...`);
      // Fetch list metadata if not available
      const allLists = await fetchAllLists(apiKey);
      const list = allLists.find(l => l.id === id);
      
      if (!list) {
        console.error(`List ${id} not found in user's lists`);
        return null;
      }
      
      console.log(`List ${id} found with listType: ${list.listType}`);
      
      // Use the listType from fetchAllLists
      if (list.listType === 'E') {
        console.log(`Fetching EXTERNAL list ${id}`);
        try {
          const response = await axios.get(`https://api.mdblist.com/external/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
          if (response.status === 200 && !response.data.error) {
            console.log(`Successfully fetched external list ${id}`);
            return processApiResponse(response.data);
          }
        } catch (error) {
          console.error(`Error fetching external list ${id}:`, error.message);
          return null;
        }
      } else if (list.listType === 'L') {
        console.log(`Fetching INTERNAL list ${id}`);
        try {
          const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
          if (response.status === 200 && !response.data.error) {
            console.log(`Successfully fetched internal list ${id}`);
            return processApiResponse(response.data);
          }
        } catch (error) {
          console.error(`Error fetching internal list ${id}:`, error.message);
          return null;
        }
      }
    } else {
      // Use the metadata listType directly
      if (metadata.listType === 'E') {
        console.log(`Fetching EXTERNAL list ${id} (Type E)`);
        try {
          const response = await axios.get(`https://api.mdblist.com/external/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
          if (response.status === 200 && !response.data.error) {
            console.log(`Successfully fetched external list ${id}`);
            return processApiResponse(response.data);
          }
        } catch (error) {
          console.error(`Error fetching external list ${id}:`, error.message);
          return null;
        }
      } else if (metadata.listType === 'L') {
        console.log(`Fetching INTERNAL list ${id} (Type L)`);
        try {
          const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=100&offset=${skip}`);
          if (response.status === 200 && !response.data.error) {
            console.log(`Successfully fetched internal list ${id}`);
            return processApiResponse(response.data);
          }
        } catch (error) {
          console.error(`Error fetching internal list ${id}:`, error.message);
          return null;
        }
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
  
  const movies = items.filter(item => item && (item.type === 'movie' || item.mediatype === 'movie'));
  const shows = items.filter(item => item && (item.type === 'show' || item.mediatype === 'show'));
  
  
  return {
    movies: movies,
    shows: shows
  };
}

/**
 * Extract list ID and metadata from MDBList URL
 * @param {string} url - MDBList URL (e.g., https://mdblist.com/lists/username/list-name)
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<{listId: string, listName: string}>} List ID and name
 * @throws {Error} If list ID cannot be extracted or list not found
 */
async function extractListFromUrl(url, apiKey) {
  try {
    console.log(`DEBUG: Extracting list from URL: ${url}`);
    // Validate URL format
    const urlPattern = /^https?:\/\/mdblist\.com\/lists\/([\w-]+)\/([\w-]+)$/;
    const urlMatch = url.match(urlPattern);
    if (!urlMatch) {
      throw new Error('Invalid MDBList URL format');
    }

    const [, username, listSlug] = urlMatch;
    console.log(`DEBUG: URL matched pattern. Username: ${username}, Slug: ${listSlug}`);

    // First scrape the page to get the list ID
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    // Find the meta tag with og:image property which contains the list ID
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (!ogImage) {
      throw new Error('Could not find list image metadata');
    }
    console.log(`DEBUG: Found og:image: ${ogImage}`);

    // Extract list ID from the image URL
    const idMatch = ogImage.match(/[?&]id=(\d+)/);
    if (!idMatch) {
      throw new Error('Could not extract list ID from image URL');
    }

    const listId = idMatch[1];
    console.log(`DEBUG: Extracted list ID: ${listId}`);

    // Now fetch list details from API to get name
    const apiResponse = await axios.get(`https://api.mdblist.com/lists/${listId}?apikey=${apiKey}`);
    if (!apiResponse.data?.[0]) {
      throw new Error('Could not fetch list details from API');
    }

    const listData = apiResponse.data[0];
    console.log(`DEBUG: List name from API: ${listData.name}`);
    
    return {
      listId: listId,
      listName: listData.name,
      isUrlImport: true
    };
  } catch (error) {
    console.error('Error extracting list from URL:', error);
    throw error;
  }
}

module.exports = {
  fetchAllLists,
  fetchListItems,
  validateMDBListKey,
  extractListFromUrl
}; 