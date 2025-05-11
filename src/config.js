// Default config structure
const defaultConfig = {
  apiKey: '',            // MDBList API key
  rpdbApiKey: '',        // RPDB API key for posters
  traktClientId: '',     // Trakt Client ID
  traktClientSecret: '', // Trakt Client Secret
  traktAccessToken: '',  // Trakt Access Token
  traktRefreshToken: '', // Trakt Refresh Token
  traktExpiresAt: null,  // Trakt token expiration date
  listOrder: [],
  lastUpdated: null,
  listsMetadata: {},
  hiddenLists: [],
  customListNames: {},   // Store custom names for lists
  importedAddons: {}     // Store imported addon configurations
};

/**
 * Store metadata for lists to be used later
 * @param {Array} lists - Lists with metadata
 * @param {Object} config - Current configuration
 * @returns {Object} Updated configuration
 */
function storeListsMetadata(lists, config) {
  if (!config.listsMetadata) {
    config.listsMetadata = {};
  }
  
  lists.forEach(list => {
    config.listsMetadata[list.id] = {
      isExternalList: !!list.isExternalList,
      isInternalList: !!list.isInternalList,
      isWatchlist: !!list.isWatchlist,
      name: list.name
    };
  });
  
  return config;
}

module.exports = {
  defaultConfig,
  storeListsMetadata
}; 