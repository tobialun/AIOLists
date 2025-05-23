const axios = require('axios');
const cheerio = require('cheerio');
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
 * @param {string} [sort='imdbvotes'] - Sort field
 * @param {string} [order='desc'] - Sort order (asc or desc)
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchListItems(listId, apiKey, listsMetadata, skip = 0, sort = 'imdbvotes', order = 'desc', isUrlImported = false) {
  if (!apiKey) return null;

  try {
      const match = listId.match(/^aiolists-(\d+)-([ELW])$/);
      const id = match ? match[1] : listId.replace(/^aiolists-/, ''); // Rent ID
      const listTypeFromIdString = match ? match[2] : null; // Typ från ID-strängen (kan vara null)

      // Utökad loggning för bättre felsökning
      console.log(`MDBList fetchListItems - Input listId: ${listId}, Cleaned ID: ${id}, Type from ID string: ${listTypeFromIdString}, Skip: ${skip}, isUrlImported: ${isUrlImported}`);

      if (id === 'watchlist' || id === 'watchlist-W') {
          console.log('Fetching MDBList watchlist items');
          try {
              const response = await axios.get(`https://api.mdblist.com/watchlist/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
              if (response.status === 429) {
                  console.error('Rate limited by MDBList API for watchlist. Please wait a moment before trying again.');
                  return null;
              }
              return processApiResponse(response.data);
          } catch (error) {
              if (error.response?.status === 429) {
                  console.error('Rate limited by MDBList API for watchlist. Please wait a moment before trying again.');
                  return null;
              }
              console.error(`Error fetching MDBList watchlist:`, error.message);
              return null;
          }
      }

      let effectiveListType;

      if (isUrlImported) {
          // URL-importerade publika MDBLists hämtas alltid via den "interna" list-API:n, vilket motsvarar typ 'L'.
          effectiveListType = 'L';
          console.log(`Workspaceing MDBList (URL imported): ${id} as type ${effectiveListType}`);
          try {
              const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
              if (response.status === 200 && !response.data.error) {
                  console.log(`Successfully fetched MDBList ${id} (URL import)`);
                  return processApiResponse(response.data);
              }
              console.error(`Failed to fetch MDBList ${id} (URL import). Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
              return null;
          } catch (error) {
              console.error(`Error fetching MDBList ${id} (URL import):`, error.message);
              return null;
          }
      } else {
          // Logik för användarens personliga listor (ej URL-importerade)
          const metadata = listsMetadata && listsMetadata[String(id)]; // Säkerställ att id är en sträng för lookup

          if (metadata && metadata.listType) {
              effectiveListType = metadata.listType;
              console.log(`Using MDBList type from metadata: ${effectiveListType} for list ${id}`);
          } else if (listTypeFromIdString) { // Använd typen från ID-strängen om den finns
              effectiveListType = listTypeFromIdString;
              console.log(`Using MDBList type from ID string: ${effectiveListType} for list ${id}`);
          } else {
              // Om ingen metadata och ingen typ i ID-strängen, hämta alla listor för att bestämma typ
              console.log(`No MDBList metadata for list ${id} and no type in ID string, fetching all lists to determine type...`);
              const allLists = await fetchAllLists(apiKey);
              const listObj = allLists.find(l => String(l.id) === String(id));

              if (!listObj || !listObj.listType) {
                  console.error(`MDBList ${id} not found in user's personal lists or listType missing in fetched object.`);
                  return null;
              }
              effectiveListType = listObj.listType;
              console.log(`MDBList ${id} found in allLists with listType: ${effectiveListType}`);
          }

          // Använd nu effectiveListType för API-anrop
          if (effectiveListType === 'E') {
              console.log(`Workspaceing EXTERNAL MDBList ${id}`);
              try {
                  const response = await axios.get(`https://api.mdblist.com/external/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
                  if (response.status === 200 && !response.data.error) {
                      return processApiResponse(response.data);
                  }
                  console.error(`Failed to fetch EXTERNAL MDBList ${id}. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
                  return null;
              } catch (error) {
                  console.error(`Error fetching EXTERNAL MDBList ${id}:`, error.message);
                  return null;
              }
          } else if (effectiveListType === 'L') {
              console.log(`Workspaceing INTERNAL MDBList ${id}`);
               try {
                  const response = await axios.get(`https://api.mdblist.com/lists/${id}/items?apikey=${apiKey}&sort=${sort}&order=${order}&limit=${ITEMS_PER_PAGE}&offset=${skip}`);
                  if (response.status === 200 && !response.data.error) {
                      return processApiResponse(response.data);
                  }
                  console.error(`Failed to fetch INTERNAL MDBList ${id}. Status: ${response.status}, Data: ${JSON.stringify(response.data)}`);
                  return null;
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
    console.error('API error:', data?.error || 'No data');
    return null;
  }
  
  // Handle direct movies/shows response
  if (data.movies !== undefined || data.shows !== undefined) {
    const hasMovies = Array.isArray(data.movies) && data.movies.length > 0;
    const hasShows = Array.isArray(data.shows) && data.shows.length > 0;
    
    console.log(`MDBList API direct response - hasMovies: ${hasMovies}, hasShows: ${hasShows}`);
    
    return {
      movies: Array.isArray(data.movies) ? data.movies : [],
      shows: Array.isArray(data.shows) ? data.shows : [],
      hasMovies: hasMovies,
      hasShows: hasShows
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
  
  const hasMovies = movies.length > 0;
  const hasShows = shows.length > 0;
  
  console.log(`MDBList API items response - hasMovies: ${hasMovies}, hasShows: ${hasShows}`);
  
  return {
    movies: movies,
    shows: shows,
    hasMovies: hasMovies,
    hasShows: hasShows
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