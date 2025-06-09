// src/integrations/mdblist.js
const axios = require('axios');
const { ITEMS_PER_PAGE } = require('../config');
const { enrichItemsWithMetadata } = require('../utils/metadataFetcher');

// Helper function for delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_RETRIES = 4;
const INITIAL_RETRY_DELAY_MS = 5000;

async function validateMDBListKey(apiKey) {
  if (!apiKey) return null;
  try {
    const response = await axios.get(`https://api.mdblist.com/user?apikey=${apiKey}`, { timeout: 5000 });
    return (response.status === 200 && response.data) ? response.data : null;
  } catch (error) {
    console.error('Error validating MDBList Key:', error.message);
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
    let currentRetries = 0;
    let success = false;
    while (currentRetries < MAX_RETRIES && !success) {
      try {
        const response = await axios.get(endpoint.url, { timeout: 15000 });
        if (response.data && Array.isArray(response.data)) {
          allLists.push(...response.data.map(list => ({ ...list, listType: endpoint.type, name: list.name })));
        }
        success = true;
      } catch (err) {
        currentRetries++;
        console.error(`Error fetching MDBList ${endpoint.type} lists (attempt ${currentRetries}/${MAX_RETRIES}):`, err.message);
        if (err.response && (err.response.status === 503 || err.response.status === 429) && currentRetries < MAX_RETRIES) {
          const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetries - 1);
          console.log(`Rate limit or server error for ${endpoint.type}, retrying after ${retryDelay}ms...`);
          await delay(retryDelay);
        } else {
          console.error(`Failed to fetch MDBList ${endpoint.type} lists after ${currentRetries} attempts.`);
          break;
        }
      }
    }
    if (success && listEndpoints.indexOf(endpoint) < listEndpoints.length - 1) {
      await delay(2000);
    }
  }
  allLists.push({ id: 'watchlist', name: 'My Watchlist', listType: 'W', isWatchlist: true });
  return allLists;
}

// Updated function to fetch all lists for a specific MDBList username
async function fetchAllListsForUser(apiKey, username) {
  if (!apiKey || !username) return [];
  let userLists = [];

  // Fetch user's "standard" public lists
  try {
    // Using the path structure you confirmed works: /lists/user/{username}
    const response = await axios.get(`https://api.mdblist.com/lists/user/${username}?apikey=${apiKey}`, { timeout: 10000 });
    if (response.data && Array.isArray(response.data)) {
      // Add a property to distinguish if needed, or rely on list.user_name if present in response
      userLists.push(...response.data.map(list => ({ ...list, listType: 'L', fetchedForUser: username })));
    }
  } catch (error) {
    console.error(`Error fetching lists for MDBList user ${username} (path /lists/user/${username}):`, error.message);
    if (error.response) {
        console.error(`Response status: ${error.response.status}`, error.response.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
    }
  }

  // Fetch user's "external" public lists
  try {
    await delay(1000); // Be respectful to the API
    // Assuming a similar structure for external lists of another user
    const extResponse = await axios.get(`https://api.mdblist.com/external/lists/user/${username}?apikey=${apiKey}`, { timeout: 10000 });
    if (extResponse.data && Array.isArray(extResponse.data)) {
      userLists.push(...extResponse.data.map(list => ({ ...list, listType: 'E', fetchedForUser: username })));
    }
  } catch (error) {
    console.error(`Error fetching external lists for MDBList user ${username} (path /external/lists/user/${username}):`, error.message);
     if (error.response) {
        console.error(`Response status: ${error.response.status}`, error.response.data ? `Data: ${JSON.stringify(error.response.data).substring(0, 200)}` : '');
    }
  }

  // Filter for public lists (MDBList API usually handles this, but an explicit check is good)
  // and ensure the list has items.
  return userLists.filter(list =>
    (list.private === false || list.public === true) && list.items > 0 // Simplified check for public and ensure items
  );
}


function processMDBListApiResponse(data, isWatchlistUnified = false) {
    if (!data || data.error) {
      console.error('MDBList API error:', data?.error || 'No data received from MDBList');
      return { items: [], hasMovies: false, hasShows: false };
    }
  
    let rawItems = [];
    let hasMovies = false;
    let hasShows = false;
  
    if (isWatchlistUnified && Array.isArray(data)) {
      rawItems = data.map(item => {
        const type = (item.type === 'show' || item.mediatype === 'show' || item.media_type === 'show') ? 'series' : 'movie';
        if (type === 'movie') hasMovies = true;
        if (type === 'series') hasShows = true;
        return {
          ...item,
          type,
          imdb_id: item.imdb_id || item.imdbid,
          id: item.imdb_id || item.imdbid,
        };
      });
    } else {
      if (Array.isArray(data.movies) && data.movies.length > 0) {
        rawItems.push(...data.movies.map(m => ({ ...m, type: 'movie' })));
        hasMovies = true;
      }
      if (Array.isArray(data.shows) && data.shows.length > 0) {
        rawItems.push(...data.shows.map(s => ({ ...s, type: 'series' })));
        hasShows = true;
      }
  
      if (rawItems.length === 0) {
        let itemsInput = [];
        if (Array.isArray(data)) itemsInput = data;
        else if (Array.isArray(data.items)) itemsInput = data.items;
        else if (Array.isArray(data.results)) itemsInput = data.results;
  
        rawItems = itemsInput.map(item => {
          const type = (item.type === 'show' || item.mediatype === 'show' || item.media_type === 'show') ? 'series' : 'movie';
          if (type === 'movie') hasMovies = true;
          if (type === 'series') hasShows = true;
          return {
            ...item,
            type
          };
        });
      }
    }
  
    const finalItems = rawItems.map(item => ({
      ...item,
      imdb_id: item.imdb_id || item.imdbid,
      id: item.imdb_id || item.imdbid,
    })).filter(item => item.imdb_id);
  
    return { items: finalItems, hasMovies, hasShows };
  }

async function fetchListItems(
    listId, // This will be the MDBList list ID (numeric) or slug
    apiKey,
    listsMetadata, // Generally not used when fetching a specific list's items directly
    stremioSkip = 0,
    sort = 'default',
    order = 'desc',
    isUrlImported = false, // Not directly relevant here, but part of original signature
    genre = null,
    usernameForRandomList = null, // The username whose list we are fetching
    isMergedByUser = false,
    userConfig = null // Added to access metadata preferences
) {
  if (!apiKey) return null;

  const MAX_ATTEMPTS_FOR_GENRE_FILTER = 1;
  const MDBLIST_PAGE_LIMIT = ITEMS_PER_PAGE;

  let effectiveMdbListId = String(listId); // Ensure it's a string (could be numeric ID or slug)
  // No need to strip prefixes if we are directly passing the listId/slug for a random list

  let mdbListOffset = 0;
  let attemptsForGenreCompletion = 0;
  let allEnrichedGenreItems = [];
  let morePagesFromMdbList = true;
  let allItems = [];
  let hasMovies = false;
  let hasShows = false;

  // The usernameForRandomList parameter indicates we are fetching items for a list from a specific user (not the API key owner)
  const listOwnerUsername = usernameForRandomList;

  if (genre) { // If genre filtering is needed
    while (allEnrichedGenreItems.length < stremioSkip + MDBLIST_PAGE_LIMIT && attemptsForGenreCompletion < MAX_ATTEMPTS_FOR_GENRE_FILTER && morePagesFromMdbList) {
      let apiUrl;
      const params = new URLSearchParams({
        apikey: apiKey,
        sort: sort,
        order: order,
        limit: MDBLIST_PAGE_LIMIT,
        offset: mdbListOffset
      });

      if (isMergedByUser && effectiveMdbListId !== 'watchlist' && effectiveMdbListId !== 'watchlist-W' && !listOwnerUsername) {
          params.append('unified', 'true');
        }

      if (listOwnerUsername) { // Fetching specific user's list (e.g., random catalog's chosen list)
        apiUrl = `https://api.mdblist.com/lists/${listOwnerUsername}/${effectiveMdbListId}/items?${params.toString()}`;
      } else if (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W') { // Authenticated user's watchlist
        params.append('unified', 'true');
        apiUrl = `https://api.mdblist.com/watchlist/items?${params.toString()}`;
      } else { // Authenticated user's own list (not a URL import or random)
        let listPrefix = '';
        // This part is for API key owner's lists, might need listsMetadata to determine if it's 'L' or 'E' type
        // However, for the random catalog, listOwnerUsername will be set, so this branch won't be hit for that.
        const metadata = listsMetadata && (listsMetadata[listId] || listsMetadata[`aiolists-${listId}-L`] || listsMetadata[`aiolists-${listId}-E`]);
        let effectiveListType = metadata?.listType;
        if (!isUrlImported && !effectiveListType) {
            const allUserLists = await fetchAllLists(apiKey); // Fetches for the API key owner
            const listObj = allUserLists.find(l => String(l.id) === String(effectiveMdbListId));
            effectiveListType = listObj?.listType;
        }
        if (effectiveListType === 'E') listPrefix = 'external/';
        apiUrl = `https://api.mdblist.com/${listPrefix}lists/${effectiveMdbListId}/items?${params.toString()}`;
      }

      let response;
      let success = false;
      let currentRetries = 0;
      while(currentRetries < MAX_RETRIES && !success) {
        try {
          response = await axios.get(apiUrl, { timeout: 15000 });
          if (response.status === 429 && currentRetries < MAX_RETRIES) {
            // ... (rate limit handling as before)
            currentRetries++;
            const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetries - 1);
            console.error(`Rate limited by MDBList API for list ${effectiveMdbListId} of user ${listOwnerUsername || 'self'} (offset ${mdbListOffset}), attempt ${currentRetries}/${MAX_RETRIES}. Retrying after ${retryDelay}ms...`);
            await delay(retryDelay);
            continue;
          }
          success = true;
        } catch (error) {
          // ... (error handling as before)
          currentRetries++;
          console.error(`Error fetching MDBList page for list ${effectiveMdbListId} of user ${listOwnerUsername || 'self'} (offset ${mdbListOffset}, attempt ${currentRetries}/${MAX_RETRIES}):`, error.message);
          if (error.response && (error.response.status === 503 || error.response.status === 429) && currentRetries < MAX_RETRIES) {
              const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetries - 1);
              console.log(`Rate limit or server error during genre filtering for ${effectiveMdbListId}, retrying after ${retryDelay}ms...`);
              await delay(retryDelay);
          } else if (error.response && error.response.status === 404 && listOwnerUsername) {
             console.warn(`MDBList user ${listOwnerUsername} or list ${effectiveMdbListId} not found (genre fetch). Returning null.`);
             return null;
          } else {
              console.error(`Failed to fetch page for ${effectiveMdbListId} (genre filter) after ${currentRetries} attempts.`);
              morePagesFromMdbList = false;
              break;
          }
        }
      }
      if (!success || !morePagesFromMdbList) break;
      const mdbApiResponseData = response.data;
      const isWatchlistCall = !listOwnerUsername && (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W');
      const { items: initialItemsFlat, hasMovies: pageHasMovies, hasShows: pageHasShows } = processMDBListApiResponse(mdbApiResponseData, isWatchlistCall);
      if (pageHasMovies) hasMovies = true;
      if (pageHasShows) hasShows = true;

      if (!initialItemsFlat || initialItemsFlat.length === 0) { morePagesFromMdbList = false; break; }
      // Extract metadata config from userConfig if available
      const metadataSource = userConfig?.metadataSource || 'cinemeta';
      const hasTmdbOAuth = !!(userConfig?.tmdbSessionId && userConfig?.tmdbAccountId);
      const tmdbLanguage = userConfig?.tmdbLanguage || 'en-US';
      const tmdbBearerToken = userConfig?.tmdbBearerToken;
      
      const enrichedPageItems = await enrichItemsWithMetadata(initialItemsFlat, metadataSource, hasTmdbOAuth, tmdbLanguage, tmdbBearerToken);
      const genreItemsFromPage = enrichedPageItems.filter(item => item.genres && item.genres.map(g => String(g).toLowerCase()).includes(String(genre).toLowerCase()));
      allEnrichedGenreItems.push(...genreItemsFromPage);
      mdbListOffset += MDBLIST_PAGE_LIMIT;
      attemptsForGenreCompletion++;
      if (morePagesFromMdbList && attemptsForGenreCompletion < MAX_ATTEMPTS_FOR_GENRE_FILTER) await delay(1250);
    }
    allItems = allEnrichedGenreItems.slice(stremioSkip, stremioSkip + ITEMS_PER_PAGE);

  } else { // No genre filtering, direct fetch
    let apiUrl;
    mdbListOffset = stremioSkip;
    const params = new URLSearchParams({
        apikey: apiKey,
        sort: sort,
        order: order,
        limit: ITEMS_PER_PAGE, // Use ITEMS_PER_PAGE from config
        offset: mdbListOffset
      });

    if (isMergedByUser && effectiveMdbListId !== 'watchlist' && effectiveMdbListId !== 'watchlist-W' && !listOwnerUsername) {
        params.append('unified', 'true');
      }

    if (listOwnerUsername) { // Fetching specific user's list (e.g., random catalog's chosen list)
        apiUrl = `https://api.mdblist.com/lists/${listOwnerUsername}/${effectiveMdbListId}/items?${params.toString()}`;
    } else if (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W') { // Authenticated user's watchlist
        params.append('unified', 'true');
        apiUrl = `https://api.mdblist.com/watchlist/items?${params.toString()}`;
    } else { // Authenticated user's own list
        let listPrefix = '';
        // This logic is primarily for the API key owner's lists
        if (!isUrlImported) { // This check might be redundant if listOwnerUsername is the primary switch
            const metadata = listsMetadata && (listsMetadata[listId] || listsMetadata[`aiolists-${listId}-L`] || listsMetadata[`aiolists-${listId}-E`]);
            let originalListType = metadata?.listType;
             if (!originalListType) {
                const allUserLists = await fetchAllLists(apiKey);
                const listObj = allUserLists.find(l => String(l.id) === String(effectiveMdbListId));
                originalListType = listObj?.listType;
            }
            if (originalListType === 'E') listPrefix = 'external/';
        }
        apiUrl = `https://api.mdblist.com/${listPrefix}lists/${effectiveMdbListId}/items?${params.toString()}`;
    }
    // ... (axios call and error handling as before for single page fetch)
    let response;
    let success = false;
    let currentRetries = 0;
    while(currentRetries < MAX_RETRIES && !success) {
      try {
          response = await axios.get(apiUrl, { timeout: 15000 });
          if (response.status === 429 && currentRetries < MAX_RETRIES) {
             currentRetries++;
             const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetries - 1);
             console.error(`Rate limited by MDBList API for list ${effectiveMdbListId} of user ${listOwnerUsername || 'self'} (single page), attempt ${currentRetries}/${MAX_RETRIES}. Retrying after ${retryDelay}ms...`);
             await delay(retryDelay);
             continue;
          }
          success = true;
      } catch (error) {
          currentRetries++;
          console.error(`Error fetching MDBList items for list ${effectiveMdbListId} of user ${listOwnerUsername || 'self'} (offset ${mdbListOffset}, attempt ${currentRetries}/${MAX_RETRIES}):`, error.message);
          if (error.response && (error.response.status === 503 || error.response.status === 429) && currentRetries < MAX_RETRIES) {
              const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetries - 1);
              console.log(`Rate limit or server error fetching single page for ${effectiveMdbListId}, retrying after ${retryDelay}ms...`);
              await delay(retryDelay);
          } else if (error.response && error.response.status === 404 && listOwnerUsername) {
             console.warn(`MDBList user ${listOwnerUsername} or list ${effectiveMdbListId} not found. Returning null.`);
             return null;
          } else {
              console.error(`Failed to fetch items for ${effectiveMdbListId} after ${currentRetries} attempts.`);
              return null;
          }
      }
    }

    if (!success) {
        console.error(`All retries failed for fetching items for list ID ${effectiveMdbListId} of user ${listOwnerUsername || 'self'}.`);
        return null;
    }

    const mdbApiResponseData = response.data;
    const isWatchlistCall = !listOwnerUsername && (effectiveMdbListId === 'watchlist' || effectiveMdbListId === 'watchlist-W');
    const { items: initialItemsFlat, hasMovies: pageHasMovies, hasShows: pageHasShows } = processMDBListApiResponse(mdbApiResponseData, isWatchlistCall);
    if (pageHasMovies) hasMovies = true;
    if (pageHasShows) hasShows = true;

    if (!initialItemsFlat || initialItemsFlat.length === 0) {
        return { allItems: [], hasMovies: false, hasShows: false };
    }
    // Extract metadata config from userConfig if available  
    const metadataSource = userConfig?.metadataSource || 'cinemeta';
    const hasTmdbOAuth = !!(userConfig?.tmdbSessionId && userConfig?.tmdbAccountId);
    const tmdbLanguage = userConfig?.tmdbLanguage || 'en-US';
    const tmdbBearerToken = userConfig?.tmdbBearerToken;
    
    allItems = await enrichItemsWithMetadata(initialItemsFlat, metadataSource, hasTmdbOAuth, tmdbLanguage, tmdbBearerToken);
  }

  const finalResult = { allItems: allItems, hasMovies, hasShows };

  return finalResult;
}

async function extractListFromUrl(url, apiKey) {
  let currentRetries = 0;
  while (currentRetries < MAX_RETRIES) {
    try {
      const urlPattern = /^https?:\/\/mdblist\.com\/lists\/([\w-]+)\/([\w-]+)\/?$/;
      const urlMatch = url.match(urlPattern);
      if (!urlMatch) throw new Error('Invalid MDBList URL format. Expected: https://mdblist.com/lists/username/list-slug');
      const [, usernameFromUrl, listSlug] = urlMatch; // Renamed to avoid confusion with username in response

      const apiResponse = await axios.get(`https://api.mdblist.com/lists/${usernameFromUrl}/${listSlug}?apikey=${apiKey}`, { timeout: 15000 });

      if (!apiResponse.data || !Array.isArray(apiResponse.data) || apiResponse.data.length === 0) {
        throw new Error('Could not fetch list details from MDBList API or list is empty/not found. Response: ' + JSON.stringify(apiResponse.data));
      }

      const listData = apiResponse.data[0]; // Correct: Access the first (and only) object in the array

      if (typeof listData.user_name === 'undefined') {
        const actualResponse = JSON.stringify(listData);
        throw new Error(`API response did not include expected 'user_name'. Response: ${actualResponse}`);
      }

      return {
        listId: String(listData.id),
        listSlug: listData.slug,
        username: listData.user_name,
        listName: listData.name,
        isUrlImport: true,
        hasMovies: listData.movies > 0,
        hasShows: listData.shows > 0
      };
    } catch (error) {
      currentRetries++;
      console.error(`Error extracting MDBList from URL (attempt ${currentRetries}/${MAX_RETRIES}):`, error.response ? (error.response.data || error.response.status) : error.message);
      if (error.response && (error.response.status === 503 || error.response.status === 429) && currentRetries < MAX_RETRIES) {
        const retryDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, currentRetries - 1);
        console.log(`Retrying after ${retryDelay}ms...`);
        await delay(retryDelay);
      } else {
        const errorMessage = error.response?.data?.error || error.message;
        const actualResponseContent = error.response?.data ? JSON.stringify(error.response.data) : (error.message.includes("Response:") ? error.message.split("Response:")[1] : "No detailed response data in error.");
        throw new Error(`Failed to extract MDBList: ${errorMessage}. Actual API response structure: ${actualResponseContent}`);
      }
    }
  }
  throw new Error('Failed to extract MDBList from URL after multiple retries.');
}

module.exports = {
  fetchAllLists,
  fetchAllListsForUser,
  fetchListItems,
  validateMDBListKey,
  extractListFromUrl
};