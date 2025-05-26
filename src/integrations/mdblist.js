// src/integrations/mdblist.js
const axios = require('axios');
const { ITEMS_PER_PAGE } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');

async function validateMDBListKey(apiKey) {
  if (!apiKey) return null;
  try {
    const response = await axios.get(`https://api.mdblist.com/user?apikey=${apiKey}`, { timeout: 5000 });
    return (response.status === 200 && response.data) ? response.data : null;
  } catch (error) {
    return null;
  }
}

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
  allLists.push({ id: 'watchlist', name: 'My Watchlist', listType: 'W', isWatchlist: true });
  return allLists;
}

function processMDBListApiResponse(data) {
  if (!data || data.error) {
    console.error('MDBList API error:', data?.error || 'No data received from MDBList');
    return [];
  }
  let rawItems = [];
  if (Array.isArray(data.movies)) rawItems.push(...data.movies.map(m => ({ ...m, type: 'movie' })));
  if (Array.isArray(data.shows)) rawItems.push(...data.shows.map(s => ({ ...s, type: 'series' })));
  if (rawItems.length === 0) {
    let itemsInput = [];
    if (Array.isArray(data)) itemsInput = data;
    else if (Array.isArray(data.items)) itemsInput = data.items;
    else if (Array.isArray(data.results)) itemsInput = data.results;
    rawItems = itemsInput.map(item => ({
        ...item,
        type: (item.type === 'show' || item.mediatype === 'show') ? 'series' : 'movie'
    }));
  }
  return rawItems.map(item => ({
    ...item,
    imdb_id: item.imdb_id || item.imdbid,
    id: item.imdb_id || item.imdbid,
  })).filter(item => item.imdb_id);
}

async function fetchListItems(
    listId, // This is the original MDBList ID (numeric string) or 'watchlist'
    apiKey, 
    listsMetadata, // Potentially unused here if fetching fresh every time for this logic
    stremioSkip = 0, // Renamed to avoid confusion with MDBList's offset
    sort = 'imdbvotes', 
    order = 'desc', 
    isUrlImported = false, // Used to adjust ID if it's a URL import prefix
    genre = null
) {
  if (!apiKey) return null;

  const MAX_ATTEMPTS_FOR_GENRE_FILTER = 5; // Fetch up to 5 MDBList pages to find enough genre items
  const MDBLIST_PAGE_LIMIT = ITEMS_PER_PAGE; // MDBList's own page limit for fetching

  let effectiveMdbListId = listId;
  if (isUrlImported && listId.startsWith('mdblisturl_')) {
    effectiveMdbListId = listId.replace('mdblisturl_', '');
  }
  
  let mdbListOffset = 0;
  let attempts = 0;
  let allEnrichedGenreItems = [];
  let morePagesFromMdbList = true;

  if (genre) {
    // Loop to accumulate enough genre-specific items
    while (allEnrichedGenreItems.length < stremioSkip + MDBLIST_PAGE_LIMIT && attempts < MAX_ATTEMPTS_FOR_GENRE_FILTER && morePagesFromMdbList) {
      let apiUrl;
      if (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W') {
        apiUrl = `https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${MDBLIST_PAGE_LIMIT}&offset=${mdbListOffset}`;
      } else {
        // For regular lists (including URL imported ones after ID extraction)
        // Determine listType (L or E) if not a watchlist and not a direct URL import
        let listPrefix = '';
        if (!isUrlImported) {
            const metadata = listsMetadata && (listsMetadata[listId] || listsMetadata[`aiolists-${listId}-L`] || listsMetadata[`aiolists-${listId}-E`]);
            let effectiveListType = metadata?.listType;
            if (!effectiveListType) {
                const allUserLists = await fetchAllLists(apiKey);
                const listObj = allUserLists.find(l => String(l.id) === String(effectiveMdbListId));
                effectiveListType = listObj?.listType;
            }
            if (effectiveListType === 'E') listPrefix = 'external/';
        }
        apiUrl = `https://api.mdblist.com/${listPrefix}lists/${effectiveMdbListId}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${MDBLIST_PAGE_LIMIT}&offset=${mdbListOffset}`;
      }

      try {
        const response = await axios.get(apiUrl, { timeout: 15000 });
        if (response.status === 429) {
          console.error('Rate limited by MDBList API.'); break;
        }
        const mdbApiResponseData = response.data;
        const initialItemsFlat = processMDBListApiResponse(mdbApiResponseData);

        if (!initialItemsFlat || initialItemsFlat.length === 0) {
          morePagesFromMdbList = false; // No more items from MDBList
          break;
        }

        const enrichedPageItems = await enrichItemsWithCinemeta(initialItemsFlat);
        const genreItemsFromPage = enrichedPageItems.filter(item => item.genres && item.genres.includes(genre));
        allEnrichedGenreItems.push(...genreItemsFromPage);

        mdbListOffset += MDBLIST_PAGE_LIMIT;
        attempts++;
      } catch (error) {
        console.error(`Error fetching MDBList page for list ID ${listId} (offset ${mdbListOffset}):`, error.message);
        morePagesFromMdbList = false; // Stop on error
        break;
      }
    }

    // Now, paginate from the accumulated genre-specific items
    const itemsToReturn = allEnrichedGenreItems.slice(stremioSkip, stremioSkip + ITEMS_PER_PAGE);
    const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
    itemsToReturn.forEach(item => {
      if (item.type === 'movie') finalResult.movies.push(item);
      else if (item.type === 'series') finalResult.shows.push(item);
    });
    finalResult.hasMovies = finalResult.movies.length > 0;
    finalResult.hasShows = finalResult.shows.length > 0;
    return finalResult;

  } else {
    // Original logic: no genre filter, so fetch directly based on stremioSkip
    let apiUrl;
    mdbListOffset = stremioSkip; // Use Stremio's skip directly as MDBList offset

    if (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W') {
        apiUrl = `https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${mdbListOffset}`;
    } else {
        let listPrefix = '';
         if (!isUrlImported) {
            const metadata = listsMetadata && (listsMetadata[listId] || listsMetadata[`aiolists-${listId}-L`] || listsMetadata[`aiolists-${listId}-E`]);
            let effectiveListType = metadata?.listType;
             if (!effectiveListType) {
                const allUserLists = await fetchAllLists(apiKey);
                const listObj = allUserLists.find(l => String(l.id) === String(effectiveMdbListId));
                effectiveListType = listObj?.listType;
            }
            if (effectiveListType === 'E') listPrefix = 'external/';
        }
        apiUrl = `https://api.mdblist.com/${listPrefix}lists/${effectiveMdbListId}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${mdbListOffset}`;
    }

    try {
        const response = await axios.get(apiUrl, { timeout: 15000 });
        if (response.status === 429) {
          console.error('Rate limited by MDBList API.'); return null;
        }
        const mdbApiResponseData = response.data;
        const initialItemsFlat = processMDBListApiResponse(mdbApiResponseData);

        if (!initialItemsFlat || initialItemsFlat.length === 0) {
          return { movies: [], shows: [], hasMovies: false, hasShows: false };
        }
        
        const enrichedAllItems = await enrichItemsWithCinemeta(initialItemsFlat);
        // No genre filtering here as 'genre' is null

        const finalResult = { movies: [], shows: [], hasMovies: false, hasShows: false };
        enrichedAllItems.forEach(item => {
          if (item.type === 'movie') finalResult.movies.push(item);
          else if (item.type === 'series') finalResult.shows.push(item);
        });
        finalResult.hasMovies = finalResult.movies.length > 0;
        finalResult.hasShows = finalResult.shows.length > 0;
        return finalResult;
    } catch (error) {
        console.error(`Error fetching MDBList items for list ID ${listId} (offset ${mdbListOffset}):`, error.message);
        return null;
    }
  }
}

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