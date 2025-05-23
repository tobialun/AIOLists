// src/integrations/mdblist.js
const axios = require('axios');
const { ITEMS_PER_PAGE } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher'); // Import the new utility

/**
 * Validate MDBList API key
 * @param {string} apiKey - MDBList API key
 * @returns {Promise<Object|null>} User info if valid, null if invalid
 */
async function validateMDBListKey(apiKey) {
  if (!apiKey) return null;
  try {
    const response = await axios.get(`https://api.mdblist.com/user?apikey=${apiKey}`, { timeout: 5000 });
    return (response.status === 200 && response.data) ? response.data : null;
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
  let allLists = [];
  try {
    const internalResponse = await axios.get(`https://api.mdblist.com/lists/user?apikey=${apiKey}`);
    if (internalResponse.data && Array.isArray(internalResponse.data)) {
      allLists.push(...internalResponse.data.map(list => ({ ...list, listType: 'L' })));
    }
  } catch (err) { console.error('Error fetching MDBList internal lists:', err.message); }
  try {
    const externalResponse = await axios.get(`https://api.mdblist.com/external/lists/user?apikey=${apiKey}`);
    if (externalResponse.data && Array.isArray(externalResponse.data)) {
      allLists.push(...externalResponse.data.map(list => ({ ...list, listType: 'E' })));
    }
  } catch (err) { console.error('Error fetching MDBList external lists:', err.message); }
  allLists.push({ id: 'watchlist', name: 'My Watchlist', listType: 'W' });
  return allLists;
}

/**
 * Process API responses from MDBList to a flat list of items with type
 * @param {Object} data - API response data from MDBList
 * @returns {Array<Object>} A flat array of item objects, each with an 'imdb_id' and 'type'
 */
function processMDBListApiResponse(data) {
  if (!data || data.error) {
    console.error('MDBList API error:', data?.error || 'No data received');
    return [];
  }

  let rawItems = [];
  if (Array.isArray(data.movies)) rawItems.push(...data.movies.map(m => ({ ...m, type: 'movie' })));
  if (Array.isArray(data.shows)) rawItems.push(...data.shows.map(s => ({ ...s, type: 'series' })));
  
  if (rawItems.length === 0) { // Fallback for other MDBList response structures
    let itemsInput = [];
    if (Array.isArray(data)) itemsInput = data;
    else if (Array.isArray(data.items)) itemsInput = data.items;
    else if (Array.isArray(data.results)) itemsInput = data.results;
    else {
      console.warn('MDBList API response format not recognized or empty for fallback:', data);
    }
    rawItems = itemsInput.map(item => ({
        ...item,
        type: (item.type === 'show' || item.mediatype === 'show') ? 'series' : 'movie'
    }));
  }

  return rawItems.map(item => ({
    ...item,
    imdb_id: item.imdb_id || item.imdbid, // Ensure imdb_id field
    // 'type' should already be set above
  })).filter(item => item.imdb_id); // Ensure items have an imdb_id
}

/**
 * Fetch items in a specific MDBList, enriched with Cinemeta data
 */
async function fetchListItems(listId, apiKey, listsMetadata, skip = 0, sort = 'imdbvotes', order = 'desc', isUrlImported = false) {
  if (!apiKey) return null;

  let mdbApiResponseData;
  try {
    const match = listId.match(/^aiolists-(\d+)-([ELW])$/);
    let id = match ? match[1] : listId.replace(/^aiolists-/, '');
    const listTypeFromIdString = match ? match[2] : null;
    let apiUrl;

    if (id === 'watchlist' || id === 'watchlist-W') {
      apiUrl = `https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`;
    } else if (isUrlImported) {
      apiUrl = `https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`;
    } else {
      const metadata = listsMetadata && listsMetadata[String(id)];
      let effectiveListType = listTypeFromIdString;
      if (metadata?.listType) {
        effectiveListType = metadata.listType;
      } else if (!effectiveListType) {
        const allLists = await fetchAllLists(apiKey);
        const listObj = allLists.find(l => String(l.id) === String(id));
        if (!listObj?.listType) {
          console.error(`MDBList ${id} not found or listType missing.`);
          return null;
        }
        effectiveListType = listObj.listType;
      }
      apiUrl = `https://api.mdblist.com/${effectiveListType === 'E' ? 'external/' : ''}lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`;
    }
    
    const response = await axios.get(apiUrl);
    if (response.status === 429) {
      console.error('Rate limited by MDBList API.');
      return null;
    }
    mdbApiResponseData = response.data;
  } catch (error) {
    console.error(`Error fetching MDBList items for ${listId}:`, error.message);
    return null;
  }

  const initialItemsFlat = processMDBListApiResponse(mdbApiResponseData);
  if (!initialItemsFlat || initialItemsFlat.length === 0) {
    return { movies: [], shows: [], hasMovies: false, hasShows: false };
  }

  const enrichedAllItems = await enrichItemsWithCinemeta(initialItemsFlat);

  const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
  enrichedAllItems.forEach(item => {
    if (item.type === 'movie') finalResult.movies.push(item);
    else if (item.type === 'series') finalResult.shows.push(item);
  });

  finalResult.hasMovies = finalResult.movies.length > 0;
  finalResult.hasShows = finalResult.shows.length > 0;
  
  return finalResult;
}

/**
 * Extract list ID and metadata from MDBList URL using API
 */
async function extractListFromUrl(url, apiKey) {
  try {
    const urlPattern = /^https?:\/\/mdblist\.com\/lists\/([\w-]+)\/([\w-]+)\/?$/;
    const urlMatch = url.match(urlPattern);
    if (!urlMatch) throw new Error('Invalid MDBList URL format.');

    const [, username, listSlug] = urlMatch;
    const apiResponse = await axios.get(`https://api.mdblist.com/lists/${username}/${listSlug}?apikey=${apiKey}`);
    
    if (!apiResponse.data || !Array.isArray(apiResponse.data) || apiResponse.data.length === 0) {
      throw new Error('Could not fetch list details from MDBList API or list is empty/not found.');
    }
    const listData = apiResponse.data[0];
    return {
      listId: String(listData.id),
      listName: listData.name,
      isUrlImport: true,
      hasMovies: listData.movies > 0,
      hasShows: listData.shows > 0
    };
  } catch (error) {
    console.error('Error extracting MDBList from URL:', error.response ? error.response.data : error.message);
    throw new Error(`Failed to extract MDBList: ${error.response?.data?.error || error.message}`);
  }
}

module.exports = {
  fetchAllLists,
  fetchListItems,
  validateMDBListKey,
  extractListFromUrl
};