// src/integrations/simkl.js
const axios = require('axios');
const { SIMKL_CLIENT_ID, ITEMS_PER_PAGE } = require('../config');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');

const SIMKL_API_URL = 'https://api.simkl.com';

/**
 * Initiates the PIN authentication process with the Simkl API.
 * @returns {Promise<Object>} An object containing user_code, verification_url, device_code, and polling details.
 */
async function getSimklAuthPin() {
  const url = `${SIMKL_API_URL}/oauth/pin?client_id=${SIMKL_CLIENT_ID}&redirect=urn:ietf:wg:oauth:2.0:oob`;
  try {
    const response = await axios.get(url);
    if (response.data && response.data.result === 'OK') {
      return response.data;
    } else {
      throw new Error(response.data.message || 'Failed to get a device code from Simkl.');
    }
  } catch (error) {
    console.error('[SimklIntegration] Error requesting device code:', error.response ? error.response.data : error.message);
    throw new Error('Could not start authentication with Simkl.');
  }
}

/**
 * Polls the Simkl API to check if the user has authorized the app.
 * @param {string} userCode The code displayed to the user.
 * @returns {Promise<Object>} An object containing the access_token.
 */
async function pollForSimklToken(userCode) {
  const url = `${SIMKL_API_URL}/oauth/pin/${userCode}?client_id=${SIMKL_CLIENT_ID}`;
  try {
    const response = await axios.get(url);
    return response.data; // This will contain result, message, or access_token
  } catch (error) {
    console.error(`[SimklIntegration] Error polling for PIN status for code ${userCode}:`, error.response ? error.response.data : error.message);
    return {
        result: 'KO',
        message: 'An error occurred while checking authorization status.'
    };
  }
}

/**
 * Generates Simkl list definitions based on user's selections.
 * @param {Object} userConfig The user's configuration containing the access token and list selections.
 * @returns {Promise<Array>} A promise that resolves to an array of list objects for the manifest.
 */
async function fetchSimklLists(userConfig) {
  if (!userConfig.simklAccessToken || !userConfig.simklLists) {
    console.log('[SimklIntegration] No Simkl Access Token or selections, skipping list fetch.');
    return [];
  }

  const selectedLists = userConfig.simklLists;
  const statusMap = {
    'watching': 'Watching',
    'plantowatch': 'Plan to Watch',
    'hold': 'On Hold',
    'completed': 'Completed',
    'dropped': 'Dropped'
  };
  let allSimklLists = [];

  // **FIX**: Correctly iterate using `mediaType` variable
  for (const mediaType of Object.keys(selectedLists)) { // e.g., 'shows', 'movies'
    for (const status of selectedLists[mediaType]) { // e.g., 'watching', 'completed'
      const apiMediaType = mediaType === 'shows' ? 'tv' : mediaType;
      allSimklLists.push({
        id: `simkl_${apiMediaType}_${status}`,
        name: `Simkl ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}: ${statusMap[status] || status}`,
        source: 'simkl',
        mediaType: apiMediaType,
        listStatus: status
      });
    }
  }

  return allSimklLists;
}

/**
 * Fetches items for a specific Simkl list.
 * @param {string} listId The ID of the list (e.g., "simkl_tv_watching").
 * @param {Object} userConfig The user's configuration.
 * @param {number} skip The number of items to skip for pagination.
 * @returns {Promise<Object|null>} A promise that resolves to an object containing the list items.
 */
async function fetchSimklListItems(listId, userConfig, skip = 0) {
  if (!userConfig.simklAccessToken) {
    console.error('[SimklIntegration] No Access Token for fetchSimklListItems');
    return null;
  }

  const parts = listId.split('_');
  if (parts.length < 3 || parts[0] !== 'simkl') {
    console.error(`[SimklIntegration] Invalid Simkl listId format: ${listId}`);
    return null;
  }
  const mediaType = parts[1]; // 'tv', 'movies', 'anime'
  const status = parts[2];

  const apiMediaType = mediaType === 'tv' ? 'shows' : mediaType;

  const url = `${SIMKL_API_URL}/sync/all-items/${apiMediaType}/${status}`;

  try {
    const headers = {
      'Authorization': `Bearer ${userConfig.simklAccessToken}`,
      'simkl-api-key': SIMKL_CLIENT_ID
    };

    const response = await axios.get(url, { headers, params: { extended: 'full' } });
    const data = response.data;

    if (!data || !Array.isArray(data[apiMediaType])) {
      return { allItems: [], hasMovies: false, hasShows: false };
    }

    const items = data[apiMediaType].map(item => {
      const mediaObject = item.movie || item.show || item.anime;
      if (!mediaObject || !mediaObject.ids || !mediaObject.ids.imdb) {
        return null;
      }
      return {
        imdb_id: mediaObject.ids.imdb,
        title: mediaObject.title,
        year: mediaObject.year,
        overview: mediaObject.overview,
        type: (mediaType === 'tv' || mediaType === 'anime') ? 'series' : 'movie'
      };
    }).filter(item => item !== null);

    const paginatedItems = items.slice(skip, skip + ITEMS_PER_PAGE);
    const enrichedAllItems = await enrichItemsWithCinemeta(paginatedItems);

    return { allItems: enrichedAllItems, hasMovies: mediaType === 'movies', hasShows: mediaType !== 'movies' };
  } catch (error) {
    console.error(`[SimklIntegration] Error fetching items for list ${listId}:`, error.response ? error.response.data : error.message);
    return null;
  }
}

module.exports = {
  getSimklAuthPin,
  pollForSimklToken,
  fetchSimklLists,
  fetchSimklListItems,
};