const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const isProduction = process.env.NODE_ENV === 'production';

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
  customListNames: {}    // Store custom names for lists
};

/**
 * Load configuration from file
 * @returns {Object} The loaded configuration
 */
function loadConfig() {
  try {
    let loadedConfig = { ...defaultConfig };
    
    if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
      const data = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
      loadedConfig = { ...defaultConfig, ...JSON.parse(data) };
    }
    
    // Default lastUpdated if not present
    if (!loadedConfig.lastUpdated) {
      loadedConfig.lastUpdated = new Date().toISOString();
    }
    
    return loadedConfig;
  } catch (err) {
    if (!isProduction) {
      console.error('Failed to load config:', err);
    }
    
    return { ...defaultConfig, lastUpdated: new Date().toISOString() };
  }
}

/**
 * Save configuration to file
 * @param {Object} config - The configuration to save
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    if (!isProduction) {
      console.error('Failed to save config:', err);
    }
    return false;
  }
}

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
  
  // Save the updated config
  saveConfig(config);
  
  return config;
}

module.exports = {
  loadConfig,
  saveConfig,
  storeListsMetadata,
  DEFAULT_CONFIG_PATH,
  isProduction
}; 