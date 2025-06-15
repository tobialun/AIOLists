// src/utils/metadataFetcher.js
const axios = require('axios');
const { batchFetchPosters } = require('./posters');
const { METADATA_BATCH_SIZE } = require('../config');

// Import TMDB functions that use the built-in Bearer token
const { 
  batchConvertImdbToTmdbIds, 
  batchFetchTmdbMetadata
} = require('../integrations/tmdb');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const BATCH_SIZE = METADATA_BATCH_SIZE || 50;

// Fetch metadata from Cinemeta for a chunk of IMDB IDs
async function fetchCinemetaChunk(imdbIdChunk, type) {
  const CINEMETA_TIMEOUT = 5000; // Reduced timeout for faster failure
  
  try {
    const promises = imdbIdChunk.map(async (imdbId) => {
      try {
        // Add circuit breaker - fail fast if Cinemeta is slow
        const response = await Promise.race([
          axios.get(`${CINEMETA_BASE}/meta/${type}/${imdbId}.json`, {
            timeout: CINEMETA_TIMEOUT
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Circuit breaker timeout')), CINEMETA_TIMEOUT + 1000)
          )
        ]);
        
        return { imdbId, data: response.data?.meta };
      } catch (error) {
        if (error.message.includes('Circuit breaker timeout')) {
          console.warn(`[METADATA PERF] Circuit breaker triggered for ${imdbId} (Cinemeta too slow)`);
        }
        return { imdbId, data: null };
      }
    });

    const results = await Promise.all(promises);
    const metadataMap = {};
    
    results.forEach(({ imdbId, data }) => {
      if (data) {
        metadataMap[imdbId] = data;
      }
    });

    return metadataMap;
  } catch (error) {
    console.error('Error fetching Cinemeta chunk:', error.message);
    return {};
  }
}

/**
 * Enrich items with metadata from the specified source
 * @param {Array} items - Array of items to enrich
 * @param {string} metadataSource - 'cinemeta' or 'tmdb'
 * @param {boolean} hasTmdbOAuth - Whether user has TMDB OAuth connected
 * @param {string} tmdbLanguage - TMDB language preference
 * @param {string} tmdbBearerToken - User's TMDB Bearer Token
 * @returns {Promise<Array>} Enriched items
 */
async function enrichItemsWithMetadata(items, metadataSource = 'cinemeta', hasTmdbOAuth = false, tmdbLanguage = 'en-US', tmdbBearerToken = null) {
  if (!items || items.length === 0) return [];
  
  // Skip enrichment if metadataSource is 'none' (used for lightweight checks during manifest generation)
  if (metadataSource === 'none') {
    return items;
  }
  
  const enrichStartTime = Date.now();
  
  // Use TMDB enrichment if requested and we have either OAuth or bearer token
  if (metadataSource === 'tmdb' && (hasTmdbOAuth || tmdbBearerToken)) {
    try {
      const result = await enrichItemsWithTMDB(items, tmdbLanguage, tmdbBearerToken);
      const enrichEndTime = Date.now();
      return result;
    } catch (error) {
      console.error('[DEBUG] TMDB enrichment failed:', error.message);
      const result = await enrichItemsWithCinemeta(items);
      const enrichEndTime = Date.now();
      return result;
    }
  }
  
  // Use Trakt enrichment if requested
  if (metadataSource === 'trakt') {
    try {
      const result = await enrichItemsWithTrakt(items);
      const enrichEndTime = Date.now();
      return result;
    } catch (error) {
      console.error('[DEBUG] Trakt enrichment failed:', error.message);
      const result = await enrichItemsWithCinemeta(items);
      const enrichEndTime = Date.now();
      return result;
    }
  }
  
  // Default to Cinemeta enrichment
  const result = await enrichItemsWithCinemeta(items);
  const enrichEndTime = Date.now();
  return result;
}

/**
 * Enrich items with TMDB metadata (requires OAuth)
 * @param {Array} items - Items to enrich
 * @param {string} language - TMDB language preference
 * @param {string} userBearerToken - User's TMDB Bearer Token
 * @returns {Promise<Array>} Enriched items
 */
async function enrichItemsWithTMDB(items, language = 'en-US', userBearerToken = null) {
  if (!items || items.length === 0) return [];
  
  const { batchConvertImdbToTmdbIds, batchFetchTmdbMetadata } = require('../integrations/tmdb');
  
  // Step 1: Convert IMDB IDs to TMDB IDs
  const imdbIds = items.map(item => item.imdb_id || item.id).filter(id => id && id.startsWith('tt'));
  
  if (imdbIds.length === 0) {
    return items;
  }
  
  try {
    const conversionStartTime = Date.now();
    const imdbToTmdbMap = await batchConvertImdbToTmdbIds(imdbIds, userBearerToken);
    
    // Step 2: Prepare items for TMDB metadata fetch
    const tmdbItems = [];
    items.forEach(item => {
      const imdbId = item.imdb_id || item.id;
      if (imdbId && imdbToTmdbMap[imdbId]) {
        tmdbItems.push({
          imdbId: imdbId,
          tmdbId: imdbToTmdbMap[imdbId].tmdbId,
          type: imdbToTmdbMap[imdbId].type
        });
      }
    });
    
    if (tmdbItems.length === 0) {
      return items;
    }
    
    const metadataStartTime = Date.now();
    const tmdbMetadataMap = await batchFetchTmdbMetadata(tmdbItems, language, userBearerToken);
    
    // Step 3: Merge TMDB metadata with original items and convert IDs to tmdb: format
    const enrichedItems = items.map(item => {
      const imdbId = item.imdb_id || item.id;
      const tmdbMetadata = tmdbMetadataMap[imdbId];
      
      if (tmdbMetadata) {
        // Get the TMDB ID for this item
        const tmdbConversion = imdbToTmdbMap[imdbId];
        const newId = tmdbConversion ? `tmdb:${tmdbConversion.tmdbId}` : item.id;
        
        return {
          ...item,
          ...tmdbMetadata,
          // Use tmdb: format for ID when enriched with TMDB
          id: newId,
          imdb_id: item.imdb_id || item.id,
          type: item.type
        };
      }
      
      return item;
    });
    

    return enrichedItems;
    
  } catch (error) {
    console.error(`[DEBUG] Error in TMDB enrichment process:`, error.message);
    console.error(`[DEBUG] Error stack:`, error.stack);
    throw error; // Re-throw to trigger fallback
  }
}

/**
 * Enrich items with Cinemeta metadata
 * @param {Array} items - Items to enrich
 * @returns {Promise<Array>} Enriched items
 */
async function enrichItemsWithCinemeta(items) {
  if (!items || items.length === 0) return [];

  try {
    // Group items by type for efficient batching
    const movieItems = items.filter(item => item.type === 'movie' && item.imdb_id);
    const seriesItems = items.filter(item => item.type === 'series' && item.imdb_id);
    
    const movieIds = movieItems.map(item => item.imdb_id);
    const seriesIds = seriesItems.map(item => item.imdb_id);
    
    // Fetch metadata in batches
    const [movieMetadata, seriesMetadata] = await Promise.all([
      fetchCinemetaBatched(movieIds, 'movie'),
      fetchCinemetaBatched(seriesIds, 'series')
    ]);
    
    // Combine all metadata
    const allMetadata = { ...movieMetadata, ...seriesMetadata };
    
    // Merge metadata back into items
    const enrichedItems = items.map(item => {
      const metadata = allMetadata[item.imdb_id];
      if (metadata) {
        return {
          ...item,
          ...metadata,
          // Preserve essential fields
          imdb_id: item.imdb_id,
          id: item.imdb_id,
          type: item.type
        };
      }
      return item;
    });

    return enrichedItems;
    
  } catch (error) {
    console.error('Error enriching items with Cinemeta:', error.message);
    return items;
  }
}

async function fetchCinemetaBatched(imdbIds, type) {
  if (!imdbIds || imdbIds.length === 0) return {};
  
  const allMetadata = {};
  
  // Use smaller batch size for Cinemeta to avoid overwhelming it
  const CINEMETA_BATCH_SIZE = Math.min(BATCH_SIZE, 10); // Max 10 at a time for Cinemeta
  const CINEMETA_DELAY = 150; // Increased delay between batches
  

  
  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < imdbIds.length; i += CINEMETA_BATCH_SIZE) {
    const batch = imdbIds.slice(i, i + CINEMETA_BATCH_SIZE);
    const batchStartTime = Date.now();
    
    try {
      const batchMetadata = await fetchCinemetaChunk(batch, type);
      Object.assign(allMetadata, batchMetadata);
      
      const batchEndTime = Date.now();
      // Adaptive delay based on response time
      if (i + CINEMETA_BATCH_SIZE < imdbIds.length) {
        const responseTime = batchEndTime - batchStartTime;
        const adaptiveDelay = responseTime > 2000 ? CINEMETA_DELAY * 2 : CINEMETA_DELAY;
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      }
    } catch (error) {
             console.error(`[METADATA PERF] Cinemeta batch failed, continuing with next batch:`, error.message);
       // Continue with next batch even if this one fails
     }
  }
  
  return allMetadata;
}

module.exports = {
  enrichItemsWithMetadata,
  enrichItemsWithTMDB,
  enrichItemsWithCinemeta
};