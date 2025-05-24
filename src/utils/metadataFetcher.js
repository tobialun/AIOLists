// src/utils/metadataFetcher.js
const axios = require('axios');

const MAX_IDS_PER_CINEMETA_REQUEST = 40; // Chunk size for Cinemeta requests (reduced for safety)
const CINEMETA_REQUEST_TIMEOUT = 15000; // 15 seconds timeout for each Cinemeta chunk

/**
 * Fetches detailed metadata from Cinemeta for a chunk of IMDb IDs.
 * @param {string[]} imdbIdChunk - A chunk of IMDb IDs.
 * @param {string} type - 'movie' or 'series'.
 * @returns {Promise<Object>} A map of IMDb ID to Cinemeta meta object for this chunk.
 */
async function fetchCinemetaChunk(imdbIdChunk, type) {
  if (!imdbIdChunk || imdbIdChunk.length === 0) {
    return {};
  }
  const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${type}/last-videos/lastVideosIds=${imdbIdChunk.join(',')}.json`;
  try {
    // console.log(`Workspaceing Cinemeta chunk: ${type}, IDs: ${imdbIdChunk.length}`); // Optional: for debugging
    const response = await axios.get(cinemetaUrl, { timeout: CINEMETA_REQUEST_TIMEOUT });
    const metasDetailed = response.data?.metasDetailed;
    const metadataMapChunk = {};
    if (Array.isArray(metasDetailed)) {
      metasDetailed.forEach(meta => {
        if (meta && (meta.id || meta.imdb_id)) { // meta.id from Cinemeta is the IMDb ID
          metadataMapChunk[meta.id || meta.imdb_id] = meta;
        }
      });
    }
    return metadataMapChunk;
  } catch (error) {
    console.error(`Error fetching Cinemeta chunk for type ${type}, IDs ${imdbIdChunk.join(',')}: ${error.message}`);
    return {}; // Return empty for this chunk on error, allowing other chunks to proceed
  }
}

/**
 * Enriches a list of items with detailed metadata from Cinemeta, with optimized batching.
 * @param {Array<Object>} items - Array of items. Each item must have 'imdb_id' (or 'id' as imdb_id) and 'type'.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of enriched items.
 */
async function enrichItemsWithCinemeta(items) {
  if (!items || items.length === 0) {
    return [];
  }

  const itemsByType = { movie: [], series: [] };
  // Use a map to ensure original item references are preserved if IDs are duplicated across inputs
  const originalItemsByImdbId = new Map();

  items.forEach(item => {
    const imdbId = item.imdb_id || item.id; // Prefer imdb_id, fallback to id if it's the IMDb ID
    if (!imdbId || !item.type) {
      console.warn('Item missing imdb_id or type, cannot enrich:', item.title || 'Unknown Item');
      return; // Skip items that can't be processed
    }
    
    // Store the first occurrence of an item if multiple have the same imdbId
    if (!originalItemsByImdbId.has(imdbId)) {
        originalItemsByImdbId.set(imdbId, item);
    }

    if (itemsByType[item.type]) {
      // Add to list for batching, duplicates will be handled by Set later
      itemsByType[item.type].push(imdbId);
    } else {
      console.warn('Unknown item type for Cinemeta enrichment:', item.type, item.title || 'Unknown Item');
    }
  });

  const allEnrichedMetadataMap = {};

  for (const type in itemsByType) {
    const allIdsForType = Array.from(new Set(itemsByType[type])); // Deduplicate IDs for fetching
    if (allIdsForType.length > 0) {
      const chunkPromises = [];
      for (let i = 0; i < allIdsForType.length; i += MAX_IDS_PER_CINEMETA_REQUEST) {
        const chunk = allIdsForType.slice(i, i + MAX_IDS_PER_CINEMETA_REQUEST);
        chunkPromises.push(fetchCinemetaChunk(chunk, type));
      }

      try {
        const chunkResults = await Promise.all(chunkPromises);
        chunkResults.forEach(chunkMap => {
          Object.assign(allEnrichedMetadataMap, chunkMap); // Merge results from all chunks
        });
      } catch (error) {
        // This catch is more for Promise.all itself failing, though individual chunk errors are handled within fetchCinemetaChunk
        console.error(`Error processing Cinemeta chunks for type ${type}: ${error.message}`);
      }
    }
  }

  // Map over the original input items to maintain order and structure
  return items.map(originalItemFromInput => {
    const imdbId = originalItemFromInput.imdb_id || originalItemFromInput.id;
    const cinemetaItem = imdbId ? allEnrichedMetadataMap[imdbId] : null;
    const baseItem = originalItemsByImdbId.get(imdbId) || originalItemFromInput; // Use the item stored in map

    if (cinemetaItem) {
      // Spread original item first, then Cinemeta item to let Cinemeta override.
      const enriched = { ...baseItem, ...cinemetaItem };
      enriched.id = imdbId; // Ensure Stremio 'id' is the IMDb ID from original source
      enriched.imdb_id = imdbId; // Ensure 'imdb_id' field is present
      // Preserve original type if Cinemeta somehow changes it (should not happen for 'movie'/'series')
      enriched.type = baseItem.type; 
      return enriched;
    }
    
    // If no Cinemeta data, return the original item, ensuring 'id' property based on 'imdb_id'
    const fallbackItem = { ...baseItem };
    if (!fallbackItem.id && fallbackItem.imdb_id) {
        fallbackItem.id = fallbackItem.imdb_id;
    }
    return fallbackItem;
  });
}

module.exports = {
  enrichItemsWithCinemeta,
};