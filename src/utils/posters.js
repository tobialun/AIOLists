const axios = require('axios');
const Cache = require('../cache');

// Create a cache instance for posters with 24 hour TTL
const posterCache = new Cache({ defaultTTL: 24 * 3600 * 1000 });

/**
 * Test RPDB key with a validation endpoint
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {Promise<boolean>} Whether the key is valid
 */
async function validateRPDBKey(rpdbApiKey) {
  if (!rpdbApiKey) return false;
  
  try {
    const response = await axios.get(`https://api.ratingposterdb.com/${rpdbApiKey}/isValid`, {
      timeout: 5000 // 5 second timeout
    });
    
    return response.status === 200 && response.data && response.data.valid === true;
  } catch (error) {
    console.error('RPDB key validation error:', error.message);
    return false;
  }
}

/**
 * Fetch poster from RatingPosterDB
 * @param {string} imdbId - IMDb ID
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {Promise<string|null>} Poster URL or null
 */
async function fetchPosterFromRPDB(imdbId, rpdbApiKey) {
  if (!rpdbApiKey || !imdbId) return null;
  
  // Only process valid IMDb IDs
  if (!imdbId.match(/^tt\d+$/)) {
    return null;
  }
  
  // Check cache first
  const cacheKey = `poster_${imdbId}`;
  const cachedPoster = posterCache.get(cacheKey);
  if (cachedPoster) {
    return cachedPoster;
  }
  
  try {
    const url = `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
    
    const response = await axios.head(url, { 
      timeout: 3000 // 3 second timeout
    });
    
    if (response.status === 200) {
      // Cache the poster URL
      posterCache.set(cacheKey, url);
      return url;
    }
    return null;
  } catch (error) {
    // Don't log 404s as they're expected
    if (error.response && error.response.status !== 404) {
      console.error(`RPDB error for ${imdbId}:`, error.message);
    }
    return null;
  }
}

/**
 * Test RPDB key with known IMDb IDs
 * @param {string} rpdbApiKey - RPDB API key
 */
function testRPDBKey(rpdbApiKey) {
  if (!rpdbApiKey) return;
  
  const testIds = ['tt0111161', 'tt0068646', 'tt0468569'];
  
  testIds.forEach(id => {
    fetchPosterFromRPDB(id, rpdbApiKey)
      .then(url => {
        // Success, do nothing
      })
      .catch(err => {
        console.error(`RPDB test error for ${id}: ${err.message}`);
      });
  });
}

module.exports = {
  validateRPDBKey,
  fetchPosterFromRPDB,
  testRPDBKey,
  posterCache
}; 