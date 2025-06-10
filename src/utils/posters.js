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
 * @param {string} language - Language code (optional)
 * @returns {string} Cache key
 */
function getPosterCacheKey(imdbId, rpdbApiKey, language = null) {
  const keyPrefix = rpdbApiKey ? rpdbApiKey.substring(0, 8) : 'no_key';
  const langSuffix = language ? `_${language}` : '';
  return `poster_${keyPrefix}_${imdbId}${langSuffix}`;
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
      timeout: 15000
    });
    
    return response.status === 200 && response.data && response.data.valid === true;
  } catch (error) {
    console.error('RPDB key validation error:', error.message);
    return false;
  }
}

/**
 * Batch fetch posters from RPDB with language support
 * @param {string[]} imdbIds - Array of IMDB IDs
 * @param {string} rpdbApiKey - RPDB API key
 * @param {string} language - Language code (optional, e.g., 'en', 'fr')
 * @returns {Promise<Object>} Map of IMDB ID to poster URL
 */
async function batchFetchPosters(imdbIds, rpdbApiKey, language = null) {
  if (!rpdbApiKey || !imdbIds?.length) return {};
  
  const results = {};
  const uncachedIds = [];
  
  for (const imdbId of imdbIds) {
    const cacheKey = getPosterCacheKey(imdbId, rpdbApiKey, language);
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
      const poster = await fetchPosterFromRPDB(imdbId, rpdbApiKey, language);
      results[imdbId] = poster;
    } catch (error) {
      console.error(`Error fetching poster for ${imdbId}:`, error.message);
      results[imdbId] = null;
    }
  });
  
  await Promise.all(fetchPromises);
  return results;
}

/**
 * Fetch poster from RPDB with language support
 * @param {string} imdbId - IMDB ID
 * @param {string} rpdbApiKey - RPDB API key
 * @param {string} language - Language code (optional, e.g., 'en', 'fr')
 * @returns {Promise<string|null>} Poster URL or null
 */
async function fetchPosterFromRPDB(imdbId, rpdbApiKey, language = null) {
  if (!rpdbApiKey || !imdbId || !imdbId.match(/^tt\d+$/)) {
    return null;
  }
  
  const cacheKey = getPosterCacheKey(imdbId, rpdbApiKey, language);
  const cachedPoster = posterCache.get(cacheKey);
  if (cachedPoster) {
    return cachedPoster === 'null' ? null : cachedPoster;
  }
  
  try {
    // Build URL with optional language parameter
    let url = `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
    if (language) {
      url += `?lang=${language}`;
    }
    
    try {
      await axios.head(url, { timeout: 10000, validateStatus: status => status === 200 });
      posterCache.set(cacheKey, url);
      return url;
    } catch (headError) {
      if (headError.response?.status === 404) {
        // Try medium poster as fallback
        let mediumUrl = `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-medium/${imdbId}.jpg`;
        if (language) {
          mediumUrl += `?lang=${language}`;
        }
        
        try {
          await axios.head(mediumUrl, { timeout: 10000, validateStatus: status => status === 200 });
          posterCache.set(cacheKey, mediumUrl);
          return mediumUrl;
        } catch (mediumHeadError) {
          // If language-specific poster not found, try without language
          if (language) {
            console.log(`RPDB poster with language ${language} not found for ${imdbId}, trying default`);
            const defaultUrl = `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-default/${imdbId}.jpg`;
            try {
              await axios.head(defaultUrl, { timeout: 10000, validateStatus: status => status === 200 });
              posterCache.set(cacheKey, defaultUrl);
              return defaultUrl;
            } catch (defaultError) {
              // Try medium without language as final fallback
              const defaultMediumUrl = `https://api.ratingposterdb.com/${rpdbApiKey}/imdb/poster-medium/${imdbId}.jpg`;
              try {
                await axios.head(defaultMediumUrl, { timeout: 10000, validateStatus: status => status === 200 });
                posterCache.set(cacheKey, defaultMediumUrl);
                return defaultMediumUrl;
              } catch (finalError) {
                posterCache.set(cacheKey, 'null', 3600 * 1000);
                return null;
              }
            }
          } else {
            posterCache.set(cacheKey, 'null', 3600 * 1000);
            return null;
          }
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