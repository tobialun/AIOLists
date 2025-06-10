// src/utils/metadataFetcher.js
const axios = require('axios');
const { batchFetchPosters } = require('./posters');

// Import TMDB functions that use the built-in Bearer token
const { 
  batchConvertImdbToTmdbIds, 
  batchFetchTmdbMetadata
} = require('../integrations/tmdb');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const BATCH_SIZE = 50;

// Fetch metadata from Cinemeta for a chunk of IMDB IDs
async function fetchCinemetaChunk(imdbIdChunk, type) {
  try {
    const promises = imdbIdChunk.map(async (imdbId) => {
      try {
        const response = await axios.get(`${CINEMETA_BASE}/meta/${type}/${imdbId}.json`, {
          timeout: 15000
        });
        return { imdbId, data: response.data?.meta };
      } catch (error) {
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
  
  console.log(`[DEBUG] Metadata enrichment called with: source="${metadataSource}", language="${tmdbLanguage}", hasToken=${!!tmdbBearerToken}, hasTmdbOAuth=${hasTmdbOAuth}`);
  console.log(`[DEBUG] tmdbBearerToken value: ${tmdbBearerToken ? 'SET' : 'NULL/UNDEFINED'}`);
  
  // Use TMDB enrichment if requested and we have either OAuth or bearer token
  if (metadataSource === 'tmdb' && (hasTmdbOAuth || tmdbBearerToken)) {
    try {
      console.log(`[DEBUG] Using TMDB enrichment for ${items.length} items`);
      return await enrichItemsWithTMDB(items, tmdbLanguage, tmdbBearerToken);
    } catch (error) {
      console.error('[DEBUG] TMDB enrichment failed:', error.message);
      console.log(`[DEBUG] Using Cinemeta enrichment for ${items.length} items (fallback)`);
      return await enrichItemsWithCinemeta(items);
    }
  }
  
  // Use Trakt enrichment if requested
  if (metadataSource === 'trakt') {
    try {
      console.log(`[DEBUG] Using Trakt enrichment for ${items.length} items`);
      return await enrichItemsWithTrakt(items);
    } catch (error) {
      console.error('[DEBUG] Trakt enrichment failed:', error.message);
      console.log(`[DEBUG] Using Cinemeta enrichment for ${items.length} items (fallback)`);
      return await enrichItemsWithCinemeta(items);
    }
  }
  
  // Default to Cinemeta enrichment
  console.log(`[DEBUG] Using Cinemeta enrichment for ${items.length} items (default)`);
  return await enrichItemsWithCinemeta(items);
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
  
  console.log(`[DEBUG] Starting TMDB enrichment for ${items.length} items with language: ${language}`);
  console.log(`[DEBUG] TMDB userBearerToken: ${userBearerToken ? 'PROVIDED' : 'NULL/UNDEFINED'}`);
  
  const { batchConvertImdbToTmdbIds, batchFetchTmdbMetadata } = require('../integrations/tmdb');
  
  // Step 1: Convert IMDB IDs to TMDB IDs
  const imdbIds = items.map(item => item.imdb_id || item.id).filter(id => id && id.startsWith('tt'));
  
  if (imdbIds.length === 0) {
    console.log('[DEBUG] No valid IMDB IDs found for TMDB enrichment');
    return items;
  }
  
  console.log(`[DEBUG] Converting ${imdbIds.length} IMDB IDs to TMDB IDs`);
  
  try {
    const imdbToTmdbMap = await batchConvertImdbToTmdbIds(imdbIds, userBearerToken);
    console.log(`[DEBUG] IMDB to TMDB conversion completed, got ${Object.keys(imdbToTmdbMap).length} results`);
    
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
      console.log('[DEBUG] No TMDB IDs found for items');
      return items;
    }
    
    console.log(`[DEBUG] Fetching TMDB metadata for ${tmdbItems.length} items`);
    const tmdbMetadataMap = await batchFetchTmdbMetadata(tmdbItems, language, userBearerToken);
    console.log(`[DEBUG] TMDB metadata fetch completed, got ${Object.keys(tmdbMetadataMap).length} results`);
    
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
    
    console.log(`[DEBUG] TMDB enrichment completed successfully for ${enrichedItems.length} items`);
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
  
  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < imdbIds.length; i += BATCH_SIZE) {
    const batch = imdbIds.slice(i, i + BATCH_SIZE);
    const batchMetadata = await fetchCinemetaChunk(batch, type);
    Object.assign(allMetadata, batchMetadata);
    
    // Small delay between batches to be respectful
    if (i + BATCH_SIZE < imdbIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return allMetadata;
}

module.exports = {
  enrichItemsWithMetadata,
  enrichItemsWithTMDB,
  enrichItemsWithCinemeta
};