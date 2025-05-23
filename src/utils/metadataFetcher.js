// src/utils/metadataFetcher.js
const axios = require('axios');

/**
 * Enriches a list of items with detailed metadata from Cinemeta.
 * @param {Array<Object>} items - Array of items. Each item must have at least an 'imdb_id' (or 'id' as imdb_id) and 'type' ('movie' or 'series').
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of enriched items.
 */
async function enrichItemsWithCinemeta(items) {
  if (!items || items.length === 0) {
    return [];
  }

  const itemsByType = {
    movie: [],
    series: []
  };

  const originalItemsMap = {};

  items.forEach(item => {
    const imdbId = item.imdb_id || item.id; // Prefer imdb_id, fallback to id if it's the IMDb ID
    if (!imdbId || !item.type) {
      console.warn('Item missing imdb_id or type, cannot enrich:', item);
      return; // Skip items that can't be processed
    }
    if (itemsByType[item.type]) {
      itemsByType[item.type].push(imdbId);
      originalItemsMap[imdbId] = item; // Store original item
    } else {
      console.warn('Unknown item type for Cinemeta enrichment:', item.type);
    }
  });

  const enrichedItemsMap = {};

  for (const type in itemsByType) {
    const imdbIds = itemsByType[type];
    if (imdbIds.length > 0) {
      const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${type}/last-videos/lastVideosIds=${imdbIds.join(',')}.json`;
      try {
        const response = await axios.get(cinemetaUrl, { timeout: 10000 }); // 10-second timeout
        const metasDetailed = response.data?.metasDetailed;
        if (Array.isArray(metasDetailed)) {
          metasDetailed.forEach(meta => {
            if (meta && meta.id) { // meta.id from Cinemeta is the IMDb ID
              enrichedItemsMap[meta.id] = meta;
            }
          });
        }
      } catch (error) {
        console.error(`Error fetching from Cinemeta for type ${type} and IDs ${imdbIds.join(',')}: ${error.message}`);
      }
    }
  }

  // Merge Cinemeta data with original items
  const result = items.map(originalItem => {
    const imdbId = originalItem.imdb_id || originalItem.id;
    const cinemetaItem = imdbId ? enrichedItemsMap[imdbId] : null;

    if (cinemetaItem) {
      const enriched = { ...originalItem, ...cinemetaItem };
      enriched.id = imdbId; 
      enriched.imdb_id = imdbId;
      return enriched;
    }
    if (!originalItem.id && originalItem.imdb_id) {
        originalItem.id = originalItem.imdb_id;
    }
    return originalItem;
  });

  return result;
}

module.exports = {
  enrichItemsWithCinemeta,
};