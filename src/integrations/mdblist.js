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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    } catch (err) {
      console.error(`Error fetching MDBList ${endpoint.type} lists:`, err.message);
      if (err.response && (err.response.status === 503 || err.response.status === 429)) {
        console.log(`Rate limit or server error for ${endpoint.type}, adding a longer delay...`);
        await delay(1000);
      }
    }
    await delay(1000);
  }
  allLists.push({ id: 'watchlist', name: 'My Watchlist', listType: 'W', isWatchlist: true });
  return allLists;
}

function processMDBListApiResponse(data, isWatchlistUnified = false) {
  if (!data || data.error) {
    console.error('MDBList API error:', data?.error || 'No data received from MDBList');
    return [];
  }
  let rawItems = [];

  if (isWatchlistUnified && Array.isArray(data)) {
    rawItems = data.map(item => ({
        ...item,
        type: (item.type === 'show' || item.mediatype === 'show' || item.media_type === 'show') ? 'series' : 'movie', 
        imdb_id: item.imdb_id || item.imdbid,
        id: item.imdb_id || item.imdbid,
    }));
  } else {
    if (Array.isArray(data.movies)) rawItems.push(...data.movies.map(m => ({ ...m, type: 'movie' })));
    if (Array.isArray(data.shows)) rawItems.push(...data.shows.map(s => ({ ...s, type: 'series' })));
    if (rawItems.length === 0) {
      let itemsInput = [];
      if (Array.isArray(data)) itemsInput = data;
      else if (Array.isArray(data.items)) itemsInput = data.items;
      else if (Array.isArray(data.results)) itemsInput = data.results;
      rawItems = itemsInput.map(item => ({
          ...item,
          type: (item.type === 'show' || item.mediatype === 'show' || item.media_type === 'show') ? 'series' : 'movie'
      }));
    }
    rawItems = rawItems.map(item => ({
      ...item,
      imdb_id: item.imdb_id || item.imdbid,
      id: item.imdb_id || item.imdbid,
    }));
  }
  return rawItems.filter(item => item.imdb_id);
}

async function fetchListItems(
    listId,
    apiKey, 
    listsMetadata,
    stremioSkip = 0,
    sort = 'imdbvotes', 
    order = 'desc', 
    isUrlImported = false,
    genre = null
) {
  if (!apiKey) return null;

  const MAX_ATTEMPTS_FOR_GENRE_FILTER = 5; 
  const MDBLIST_PAGE_LIMIT = ITEMS_PER_PAGE; 

  let effectiveMdbListId = listId;
  if (isUrlImported && listId.startsWith('mdblisturl_')) {
    effectiveMdbListId = listId.replace('mdblisturl_', '');
  }
  
  let mdbListOffset = 0;
  let attempts = 0;
  let allEnrichedGenreItems = [];
  let morePagesFromMdbList = true;
  let allItems = []; // For unified watchlist or genre-filtered items

  if (genre) {
    while (allEnrichedGenreItems.length < stremioSkip + MDBLIST_PAGE_LIMIT && attempts < MAX_ATTEMPTS_FOR_GENRE_FILTER && morePagesFromMdbList) {
      let apiUrl;
      const params = new URLSearchParams({
        apikey: apiKey,
        sort: sort,
        order: order,
        limit: MDBLIST_PAGE_LIMIT,
        offset: mdbListOffset
      });
      if (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W') {
        params.append('unified', 'true'); // Keep unified for genre filtering on watchlist
        apiUrl = `https://api.mdblist.com/watchlist/items?${params.toString()}`;
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
        apiUrl = `https://api.mdblist.com/${listPrefix}lists/${effectiveMdbListId}/items?${params.toString()}`;
      }

      try {
        const response = await axios.get(apiUrl, { timeout: 15000 });
        if (response.status === 429) {
          console.error('Rate limited by MDBList API.'); break;
        }
        const mdbApiResponseData = response.data;
        const isWatchlistCall = effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W';
        const initialItemsFlat = processMDBListApiResponse(mdbApiResponseData, isWatchlistCall);


        if (!initialItemsFlat || initialItemsFlat.length === 0) {
          morePagesFromMdbList = false;
          break;
        }

        const enrichedPageItems = await enrichItemsWithCinemeta(initialItemsFlat);
        const genreItemsFromPage = enrichedPageItems.filter(item => item.genres && item.genres.map(g => String(g).toLowerCase()).includes(String(genre).toLowerCase()));
        allEnrichedGenreItems.push(...genreItemsFromPage);

        mdbListOffset += MDBLIST_PAGE_LIMIT;
        attempts++;
      } catch (error) {
        console.error(`Error fetching MDBList page for list ID ${listId} (offset ${mdbListOffset}):`, error.message);
        morePagesFromMdbList = false;
        break;
      }
    }
    
    allItems = allEnrichedGenreItems.slice(stremioSkip, stremioSkip + ITEMS_PER_PAGE);

  } else {
    let apiUrl;
    mdbListOffset = stremioSkip;
    const params = new URLSearchParams({
        apikey: apiKey,
        sort: sort,
        order: order,
        limit: ITEMS_PER_PAGE,
        offset: mdbListOffset
      });

    if (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W') {
        params.append('unified', 'true');
        apiUrl = `https://api.mdblist.com/watchlist/items?${params.toString()}`;
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
        apiUrl = `https://api.mdblist.com/${listPrefix}lists/${effectiveMdbListId}/items?${params.toString()}`;
    }

    try {
        const response = await axios.get(apiUrl, { timeout: 15000 });
        if (response.status === 429) {
          console.error('Rate limited by MDBList API.'); return null;
        }
        const mdbApiResponseData = response.data;
        const isWatchlistCall = effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W';
        const initialItemsFlat = processMDBListApiResponse(mdbApiResponseData, isWatchlistCall);


        if (!initialItemsFlat || initialItemsFlat.length === 0) {
          return { allItems: [], hasMovies: false, hasShows: false };
        }
        
        allItems = await enrichItemsWithCinemeta(initialItemsFlat);
    } catch (error) {
        console.error(`Error fetching MDBList items for list ID ${listId} (offset ${mdbListOffset}):`, error.message);
        return null;
    }
  }
  
  const finalResult = { allItems: allItems, hasMovies: false, hasShows: false };
    allItems.forEach(item => {
        if (item.type === 'movie') finalResult.hasMovies = true;
        else if (item.type === 'series') finalResult.hasShows = true;
    });
  return finalResult;
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