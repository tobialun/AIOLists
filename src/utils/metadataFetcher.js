// src/utils/metadataFetcher.js
const axios = require('axios');
const { batchFetchPosters } = require('./posters');

// Import TMDB functions that use the built-in Bearer token
const { 
  batchConvertImdbToTmdbIds, 
  batchFetchTmdbMetadata,
  convertImdbToTmdbId,
  fetchTmdbMetadata 
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
  
  // Use TMDB only if user has OAuth connected and explicitly chose TMDB
  if (metadataSource === 'tmdb' && hasTmdbOAuth && tmdbBearerToken) {
    return await enrichItemsWithTMDB(items, tmdbLanguage, tmdbBearerToken);
  }
  
  // Default to Cinemeta for all other cases
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

  try {
    // Step 1: Convert IMDB IDs to TMDB IDs for items that need it
    const itemsNeedingConversion = items.filter(item => 
      item.imdb_id && item.imdb_id.startsWith('tt') && !item.tmdb_id
    );
    
    let imdbToTmdbMap = {};
    if (itemsNeedingConversion.length > 0) {
      const imdbIds = itemsNeedingConversion.map(item => item.imdb_id);
      imdbToTmdbMap = await batchConvertImdbToTmdbIds(imdbIds, userBearerToken);
    }

    // Step 2: Prepare items for metadata fetching
    const tmdbItems = items.map(item => {
      let tmdbId = item.tmdb_id;
      let type = item.type === 'series' ? 'series' : 'movie';
      
      // Try to get TMDB ID from conversion if we don't have one
      if (!tmdbId && item.imdb_id && imdbToTmdbMap[item.imdb_id]) {
        tmdbId = imdbToTmdbMap[item.imdb_id].tmdbId;
        type = imdbToTmdbMap[item.imdb_id].type;
      }
      
      return tmdbId ? {
        tmdbId,
        type,
        imdbId: item.imdb_id,
        originalItem: item
      } : null;
    }).filter(Boolean);

    // Step 3: Fetch metadata from TMDB
    let tmdbMetadataMap = {};
    if (tmdbItems.length > 0) {
      tmdbMetadataMap = await batchFetchTmdbMetadata(tmdbItems, language, userBearerToken);
    }

    // Step 4: Merge metadata back into original items
    const enrichedItems = items.map(item => {
      const identifier = item.imdb_id || `tmdb:${item.tmdb_id}`;
      const tmdbData = tmdbMetadataMap[identifier];
      
      if (tmdbData) {
        return {
          ...item,
          ...tmdbData,
          // Preserve original fields that might be important
          imdb_id: item.imdb_id || tmdbData.imdb_id,
          id: item.imdb_id || tmdbData.id,
          type: item.type || tmdbData.type
        };
      }
      
      return item;
    });

    return enrichedItems;

  } catch (error) {
    console.error('Error enriching items with TMDB:', error.message);
    // Fallback to original items if enrichment fails
    return items;
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