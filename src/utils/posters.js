// src/utils/posters.js
const axios = require('axios');
const Cache = require('./cache'); // Corrected path

// Create a cache instance for posters with 1 week TTL
const posterCache = new Cache({ defaultTTL: 7 * 24 * 3600 * 1000 }); // 1 week

/**
 * Generate a cache key that includes a part of the API key to differentiate users
 * but not expose the full key.
 * @param {string} imdbId - IMDb ID
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {string} Cache key
 */
function getPosterCacheKey(imdbId, rpdbApiKey) {
  const keyPrefix = rpdbApiKey ? rpdbApiKey.substring(0, 8) : 'no_key';
  return `poster_${keyPrefix}_${imdbId}`;
}

/**
 * Clear all cached posters.
 * This should be called if the RPDB API key changes.
 */
function clearPosterCache() {
  posterCache.clear();
}
/**
 * Test RPDB key with a validation endpoint
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {Promise<boolean>} Whether the key is valid
 */
async function validateRPDBKey(rpdbApiKey) {
  if (!rpdbApiKey) return false;
  
  try {
    const response = await axios.get(`https://api.ratingposterdb.com/${rpdbApiKey}/isValid`, {
      timeout: 10000
    });
    
    return response.status === 200 && response.data && response.data.valid === true;
  } catch (error) {
    console.error('RPDB key validation error:', error.message);
    return false;
  }
}

async function batchFetchPosters(imdbIds, rpdbApiKey) {
  if (!rpdbApiKey || !imdbIds?.length) return {};
  
  const results = {};
  const uncachedIds = [];
  
  for (const imdbId of imdbIds) {
    const cacheKey = getPosterCacheKey(imdbId, rpdbApiKey);
    const cachedPoster = posterCache.get(cacheKey);
    if (cachedPoster) {
      results[imdbId] = cachedPoster === 'null' ? null : cachedPoster;
    } else {
      uncachedIds.push(imdbId);
    }
  }
  
  if (!uncachedIds.length) return results;
  
  const fetchPromises = uncachedIds.map(async (imdbId) => {
    try {
      const poster = await fetchPosterFromRPDB(imdbId, rpdbApiKey);
      results[imdbId] = poster;
    } catch (error) {
      console.error(`Error fetching poster for ${imdbId}:`, error.message);
      results[imdbId] = null;
    }
  });
  
  await Promise.all(fetchPromises);
  return results;
}

async function fetchPosterFromRPDB(imdbId, rpdbApiKey) {
  if (!rpdbApiKey || !imdbId || !imdbId.match(/^tt\d+$/)) {
    return null;
  }
  
  const cacheKey = getPosterCacheKey(imdbId, rpdbApiKey);
  const cachedPoster = posterCache.get(cacheKey);
  if (cachedPoster) {
    return cachedPoster === 'null' ? null : cachedPoster;
  }
  
  try {
    const url = `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
    try {
      await axios.head(url, { timeout: 5000, validateStatus: status => status === 200 });
      posterCache.set(cacheKey, url);
      return url;
    } catch (headError) {
      if (headError.response?.status === 404) {
        const mediumUrl = url.replace('poster-default', 'poster-medium');
         try {
            await axios.head(mediumUrl, { timeout: 5000, validateStatus: status => status === 200 });
            posterCache.set(cacheKey, mediumUrl);
            return mediumUrl;
        } catch (mediumHeadError) {
            posterCache.set(cacheKey, 'null', 3600 * 1000);
            return null;
        }
      }
      posterCache.set(cacheKey, 'null', 5 * 60 * 1000);
      return null;
    }
  } catch (error) {
    console.error(`Unexpected RPDB error for ${imdbId}:`, error.message);
    posterCache.set(cacheKey, 'null', 5 * 60 * 1000);
    return null;
  }
}

module.exports = {
  validateRPDBKey,
  fetchPosterFromRPDB,
  batchFetchPosters,
  clearPosterCache
};