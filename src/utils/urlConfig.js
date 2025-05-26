const zlib = require('zlib');
const { promisify } = require('util');
const { defaultConfig } = require('../config');

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

/**
 * Creates a shareable version of the config by removing sensitive API keys.
 * @param {Object} config The full configuration object.
 * @returns {Object} A configuration object suitable for sharing.
 */
function createShareableConfig(config) {
  const shareableConfig = JSON.parse(JSON.stringify(config)); // Deep clone

  delete shareableConfig.apiKey;
  delete shareableConfig.rpdbApiKey;
  delete shareableConfig.traktAccessToken;
  delete shareableConfig.traktRefreshToken;
  delete shareableConfig.traktExpiresAt;
  delete shareableConfig.mdblistUsername; // Also remove username if present

  return shareableConfig;
}

/**
 * Compress a shareable configuration object into a URL-safe string.
 * @param {Object} config Configuration object to compress (should be pre-stripped of API keys).
 * @returns {Promise<string>} URL-safe compressed string for sharing.
 */
async function compressShareableConfig(config) {
  const shareable = createShareableConfig(config); // Ensure it's stripped
  return compressConfig(shareable);
}

module.exports = {
  compressConfig,
  decompressConfig,
  createShareableConfig,
  compressShareableConfig,
};