const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Compress configuration object into a URL-safe string
 * @param {Object} config Configuration object to compress
 * @returns {Promise<string>} URL-safe compressed string
 */
async function compressConfig(config) {
  try {
    const configString = JSON.stringify(config);
    const compressed = await gzip(Buffer.from(configString, 'utf-8'));
    // Convert to base64 and make URL safe
    return compressed.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (error) {
    console.error('Error compressing config:', error);
    throw new Error('Failed to compress configuration');
  }
}

/**
 * Decompress URL-safe string back into configuration object
 * @param {string} compressed URL-safe compressed string
 * @returns {Promise<Object>} Configuration object
 */
async function decompressConfig(compressed) {
  try {

    if (compressed === 'configure') {
      return { ...defaultConfig };
    }

    if (!compressed || typeof compressed !== 'string') {
      return { ...defaultConfig };
    }

    // Clean the input string
    const cleanCompressed = compressed.trim();
    if (!cleanCompressed) {
      return { ...defaultConfig };
    }

    // Restore base64 standard characters
    const base64 = cleanCompressed
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    // Add padding if needed
    const pad = base64.length % 4;
    const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;

    try {
      const buffer = Buffer.from(paddedBase64, 'base64');
      const decompressed = await gunzip(buffer);
      const configString = decompressed.toString('utf-8');
      
      try {
        const config = JSON.parse(configString);
        // Ensure all required fields exist by merging with default config
        return { ...defaultConfig, ...config };
      } catch (parseError) {
        console.error('Error parsing decompressed config:', parseError);
        return { ...defaultConfig };
      }
    } catch (decompressError) {
      console.error('Error decompressing config:', decompressError);
      return { ...defaultConfig };
    }
  } catch (error) {
    console.error('Unexpected error in decompressConfig:', error);
    return { ...defaultConfig };
  }
}

// Default configuration structure
const defaultConfig = {
  apiKey: '',            // MDBList API key
  rpdbApiKey: '',        // RPDB API key for posters
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

module.exports = {
  compressConfig,
  decompressConfig,
  defaultConfig
}; 