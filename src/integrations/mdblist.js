// src/integrations/mdblist.js
const axios = require('axios');
const { ITEMS_PER_PAGE } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher'); // Import the new utility

/**
 * Validate MDBList API key
 */
async function validateMDBListKey(apiKey) {
  if (!apiKey) return null;
  try {
    const response = await axios.get(`https://api.mdblist.com/user?apikey=${apiKey}`, { timeout: 5000 });
    return (response.status === 200 && response.data) ? response.data : null;
  } catch (error) {
    // console.error('MDBList key validation error:', error.message);
    return null;
  }
}

/**
 * Fetch all user lists from MDBList API
 */
async function fetchAllLists(apiKey) {
  if (!apiKey) return [];
  let allLists = [];
  const listEndpoints = [
    { url: `https://api.mdblist.com/lists/user?apikey=${apiKey}`, type: 'L' },
    { url: `https://api.mdblist.com/external/lists/user?apikey=${apiKey}`, type: 'E' }
  ];
  for (const endpoint of listEndpoints) {
    try {
      const response = await axios.get(endpoint.url);
      if (response.data && Array.isArray(response.data)) {
        allLists.push(...response.data.map(list => ({ ...list, listType: endpoint.type, name: list.name })));
      }
    } catch (err) { console.error(`Error fetching MDBList ${endpoint.type} lists:`, err.message); }
  }
  allLists.push({ id: 'watchlist', name: 'My Watchlist', listType: 'W' });
  return allLists;
}

/**
 * Process API responses from MDBList to a flat list of items with type
 */
function processMDBListApiResponse(data) {
  if (!data || data.error) {
    console.error('MDBList API error:', data?.error || 'No data received from MDBList');
    return [];
  }

  let rawItems = [];
  // Standard MDBList response for list items often has { movies: [], shows: [] }
  if (Array.isArray(data.movies)) rawItems.push(...data.movies.map(m => ({ ...m, type: 'movie' })));
  if (Array.isArray(data.shows)) rawItems.push(...data.shows.map(s => ({ ...s, type: 'series' })));
  
  // Fallback for direct array responses (e.g., some watchlist endpoints or older API versions)
  if (rawItems.length === 0) {
    let itemsInput = [];
    if (Array.isArray(data)) itemsInput = data;
    else if (Array.isArray(data.items)) itemsInput = data.items; // Common for some MDBList structures
    else if (Array.isArray(data.results)) itemsInput = data.results;
    else {
      // console.warn('MDBList API response format not directly recognized, attempting generic parse or empty:', data);
    }
    // Try to determine type if not explicit and it's a flat array
    rawItems = itemsInput.map(item => ({
        ...item,
        // Ensure 'type' is 'movie' or 'series'. MDBList might use 'show'.
        type: (item.type === 'show' || item.mediatype === 'show') ? 'series' : (item.type === 'movie' || item.mediatype === 'movie' ? 'movie' : 'movie') // Default to movie if unclear
    }));
  }

  return rawItems.map(item => ({
    ...item,
    imdb_id: item.imdb_id || item.imdbid, // Ensure imdb_id field for enrichment key
    id: item.imdb_id || item.imdbid,      // Ensure Stremio 'id' is also set
    // 'type' should be correctly set to 'movie' or 'series' above
  })).filter(item => item.imdb_id); // Critical: ensure items have an imdb_id for enrichment
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
        const allUserLists = await fetchAllLists(apiKey); // Renamed to avoid conflict
        const listObj = allUserLists.find(l => String(l.id) === String(id));
        if (!listObj?.listType) {
          console.error(`MDBList original ID ${id} not found in user's lists or listType missing.`);
          return null;
        }
        effectiveListType = listObj.listType;
      }
      const listPrefix = effectiveListType === 'E' ? 'external/' : '';
      apiUrl = `https://api.mdblist.com/${listPrefix}lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`;
    }
    
    const response = await axios.get(apiUrl, { timeout: 15000 }); // MDBList API timeout
    if (response.status === 429) {
      console.error('Rate limited by MDBList API.'); return null;
    }
    mdbApiResponseData = response.data;
  } catch (error) {
    console.error(`Error fetching MDBList items for list ID ${listId} (API ID ${listId.replace(/^aiolists-|-.$/g, '')}):`, error.message);
    return null;
  }

  const initialItemsFlat = processMDBListApiResponse(mdbApiResponseData);
  if (!initialItemsFlat || initialItemsFlat.length === 0) {
    return { movies: [], shows: [], hasMovies: false, hasShows: false };
  }
  
  // Enrich these flat items using the utility
  const enrichedAllItems = await enrichItemsWithCinemeta(initialItemsFlat);

  const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
  enrichedAllItems.forEach(item => {
    // Ensure item.type is correctly 'movie' or 'series' after enrichment
    if (item.type === 'movie') finalResult.movies.push(item);
    else if (item.type === 'series') finalResult.shows.push(item);
    else console.warn("Item with unknown type after enrichment:", item);
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
    if (!urlMatch) throw new Error('Invalid MDBList URL format. Expected: https://mdblist.com/lists/username/list-slug');

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