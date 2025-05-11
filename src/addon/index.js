const { addonBuilder } = require('stremio-addon-sdk');
const { fetchPosterFromRPDB } = require('../utils/posters');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { storeListsMetadata } = require('../config');

/**
 * Convert API items to Stremio format
 * @param {Object} items - Items from API
 * @param {number} skip - Number of items to skip
 * @param {number} limit - Number of items to return
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {Promise<Array>} Array of Stremio meta objects
 */
async function convertToStremioFormat(items, skip = 0, limit = 10, rpdbApiKey = null) {
  const metas = [];
  
  // Check if we have a valid RPDB API key
  const useRPDB = !!rpdbApiKey;
  
  // Prepare all items first without posters
  let allItems = [];
  
  // Process movies
  if (items.movies && items.movies.length > 0) {
    for (const movie of items.movies) {
      // Check which IMDB ID format is used
      let imdbId = movie.imdb_id || movie.imdbid;
      
      // Ensure the IMDb ID has the 'tt' prefix
      if (imdbId && !imdbId.startsWith('tt')) {
        imdbId = `tt${imdbId}`;
      }
      
      // Skip items without IMDB ID
      if (!imdbId) {
        continue;
      }
      
      allItems.push({
        id: imdbId,
        type: 'movie',
        name: movie.title,
        poster: movie.poster,
        background: movie.backdrop,
        description: movie.overview,
        releaseInfo: movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : undefined),
        imdbRating: movie.imdbrating ? movie.imdbrating.toFixed(1) : undefined,
        runtime: movie.runtime ? `${movie.runtime} min` : undefined,
        genres: movie.genres ? (typeof movie.genres === 'string' ? movie.genres.split(',').map(g => g.trim()) : movie.genres) : undefined,
        originalItem: movie // Store original item for reference
      });
    }
  }
  
  // Process shows
  if (items.shows && items.shows.length > 0) {
    for (const show of items.shows) {
      // Check which IMDB ID format is used
      let imdbId = show.imdb_id || show.imdbid;
      
      // Ensure the IMDb ID has the 'tt' prefix
      if (imdbId && !imdbId.startsWith('tt')) {
        imdbId = `tt${imdbId}`;
      }
      
      // Skip items without IMDB ID
      if (!imdbId) {
        continue;
      }
      
      allItems.push({
        id: imdbId,
        type: 'series',
        name: show.title,
        poster: show.poster,
        background: show.backdrop,
        description: show.overview,
        releaseInfo: show.release_year || (show.first_air_date ? show.first_air_date.split('-')[0] : undefined),
        imdbRating: show.imdbrating ? show.imdbrating.toFixed(1) : undefined,
        runtime: show.runtime ? `${show.runtime} min` : undefined,
        genres: show.genres ? (typeof show.genres === 'string' ? show.genres.split(',').map(g => g.trim()) : show.genres) : undefined,
        status: show.status,
        videos: [],
        originalItem: show // Store original item for reference
      });
    }
  }
  
  // Only attempt to fetch RPDB posters for the items that will be displayed
  const pageItems = allItems.slice(skip, skip + limit);
  
  // Process RPDB posters only for the current page of items
  if (useRPDB && pageItems.length > 0) {
    for (const item of pageItems) {
      // Try to get RPDB poster if we have a valid API key
      const rpdbPoster = await fetchPosterFromRPDB(item.id, rpdbApiKey);
      if (rpdbPoster) {
        item.poster = rpdbPoster;
      }
      
      // Add to metas without the originalItem property
      const { originalItem, ...meta } = item;
      metas.push(meta);
    }
  } else {
    // If not using RPDB, just add items without fetching posters
    for (const item of pageItems) {
      const { originalItem, ...meta } = item;
      metas.push(meta);
    }
  }
  
  return metas;
}

/**
 * Fetch list items for a specific list
 * @param {string} listId - List ID
 * @param {Object} userConfig - User configuration
 * @param {Object} importedAddons - Imported addons
 * @returns {Promise<Object>} List items
 */
async function fetchListContent(listId, userConfig, importedAddons) {
  // Check if this is an imported addon catalog
  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      // Try direct ID match
      let catalog = addon.catalogs.find(c => c.id === listId);
      
      // Try matching by originalId
      if (!catalog) {
        catalog = addon.catalogs.find(c => c.originalId === listId);
      }
      
      // If we found a matching catalog, fetch its items
      if (catalog) {
        console.log(`Found external catalog: ${catalog.name} (${catalog.id}) in addon: ${addon.name}`);
        return fetchExternalAddonItems(catalog.id, addon);
      }
    }
  }
  
  // Check if this is a Trakt list
  if (listId.startsWith('trakt_')) {
    // Verify we have Trakt config
    if (!userConfig.traktAccessToken) {
      return null;
    }
    return fetchTraktListItems(listId, userConfig);
  }
  
  // Otherwise, assume it's an MDBList list
  return fetchMDBListItems(listId, userConfig.apiKey, userConfig.listsMetadata);
}

/**
 * Create the Stremio addon
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} Stremio addon interface
 */
async function createAddon(userConfig) {
  const manifest = {
    id: 'org.stremio.aiolists',
    version: '1.0.0-' + Date.now(),
    name: 'AIOLists',
    description: 'Manage all your lists in one place.',
    resources: ['catalog'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    logo: 'https://i.imgur.com/nyIDmcb.png',
    "behaviorHints": {
      "configurable": true,
      "configurationRequired": false
    }
  };

  try {
    // Convert hiddenLists to a Set for more efficient lookups
    const hiddenLists = new Set(userConfig.hiddenLists || []);
    
    // Add regular lists
    if (userConfig.apiKey || userConfig.traktAccessToken) {
      let allLists = [];
      
      // Fetch MDBList lists if API key is provided
      if (userConfig.apiKey) {
        const mdbLists = await fetchAllLists(userConfig.apiKey);
        allLists = [...allLists, ...mdbLists];
      }
      
      // Fetch Trakt lists if token is provided
      if (userConfig.traktAccessToken) {
        const traktLists = await fetchTraktLists(userConfig);
        allLists = [...allLists, ...traktLists];
      }
      
      // Use Set's has() method for efficient filtering
      const visibleLists = allLists.filter(list => !hiddenLists.has(String(list.id)));
      
      // Store metadata for the lists
      storeListsMetadata(allLists, userConfig);
      
      visibleLists.forEach(list => {
        const listId = String(list.id);
        let displayName = list.name;
        if (userConfig.customListNames && userConfig.customListNames[listId]) {
          displayName = userConfig.customListNames[listId];
        }
        
        const safeName = displayName.replace(/[^\w\s-]/g, '');
        const catalogId = listId.startsWith('trakt_') ? listId : `aiolists-${listId}`;
        let types = ['movie', 'series'];
        
        if (list.isMovieList) {
          types = ['movie'];
        } else if (list.isShowList) {
          types = ['series'];
        }
        
        types.forEach(type => {
          manifest.catalogs.push({
            type: type,
            id: catalogId,
            name: `${safeName}`,
            extra: [{ name: 'skip' }]
          });
        });
      });
    }

    // Add imported lists
    if (userConfig.importedAddons) {
      for (const addon of Object.values(userConfig.importedAddons)) {
        console.log(`Adding ${addon.catalogs.length} catalogs from ${addon.name} to manifest`);
        
        addon.catalogs
          .filter(catalog => {
            // Ensure consistent handling of string IDs
            const catalogId = String(catalog.id);
            const isHidden = hiddenLists.has(catalogId);
            console.log(`Checking catalog ${catalog.name} (${catalogId}): Hidden = ${isHidden}`);
            return !isHidden;
          })
          .forEach(catalog => {
            // Apply custom names if available
            const catalogId = String(catalog.id);
            let displayName = catalog.name;
            
            if (userConfig.customListNames && userConfig.customListNames[catalogId]) {
              displayName = userConfig.customListNames[catalogId];
              console.log(`Using custom name for ${catalogId}: "${displayName}"`);
            }
            
            // Determine catalog type
            const catalogType = catalog.type === 'anime' ? 'series' : catalog.type;
            
            console.log(`Adding catalog to manifest: ${displayName} (${catalogId}) type=${catalogType}`);
            
            manifest.catalogs.push({
              type: catalogType,
              id: catalogId,
              name: displayName,
              extra: [{ name: 'skip' }]
            });
          });
      }
    }
    
    // Apply list ordering from config if available
    if (userConfig.listOrder && userConfig.listOrder.length > 0) {
      console.log(`Applying list order to ${manifest.catalogs.length} catalogs using order: ${userConfig.listOrder.join(', ')}`);
      
      // Convert to a Map for faster lookup
      const orderMap = new Map(userConfig.listOrder.map((id, index) => [String(id), index]));
      
      // Log the original catalogs for debugging
      console.log("Catalogs before sorting:");
      manifest.catalogs.forEach((catalog, idx) => {
        console.log(`  [${idx}] ${catalog.name} (${catalog.id}) type=${catalog.type}`);
      });
      
      // Sort catalogs based on list order
      manifest.catalogs.sort((a, b) => {
        // Get the clean IDs for comparison
        let aId = String(a.id);
        let bId = String(b.id);
        
        // Handle aiolists prefix for MDBList items
        if (aId.startsWith('aiolists-')) {
          aId = aId.replace('aiolists-', '');
          console.log(`Stripped prefix from: ${a.id} -> ${aId}`);
        }
        
        if (bId.startsWith('aiolists-')) {
          bId = bId.replace('aiolists-', '');
          console.log(`Stripped prefix from: ${b.id} -> ${bId}`);
        }
        
        // Check direct match first
        let aOrder = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
        let bOrder = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
        
        // If no direct match, check if it's a composite ID (with type suffix)
        if (aOrder === Number.MAX_SAFE_INTEGER && aId.includes('_')) {
          const baseId = aId.split('_')[0];
          if (orderMap.has(baseId)) {
            aOrder = orderMap.get(baseId);
            console.log(`Using base ID for ordering: ${aId} -> ${baseId} (order: ${aOrder})`);
          }
        }
        
        if (bOrder === Number.MAX_SAFE_INTEGER && bId.includes('_')) {
          const baseId = bId.split('_')[0];
          if (orderMap.has(baseId)) {
            bOrder = orderMap.get(baseId);
            console.log(`Using base ID for ordering: ${bId} -> ${baseId} (order: ${bOrder})`);
          }
        }
        
        console.log(`Comparing for sort: ${a.id} (${aOrder}) vs ${b.id} (${bOrder})`);
        return aOrder - bOrder;
      });
      
      // Log the sorted catalogs
      console.log("Catalogs after sorting:");
      manifest.catalogs.forEach((catalog, idx) => {
        console.log(`  [${idx}] ${catalog.name} (${catalog.id}) type=${catalog.type}`);
      });
    }

    const builder = new addonBuilder(manifest);
    
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
      if (!userConfig.apiKey && !userConfig.traktAccessToken && !userConfig.importedAddons) {
        return { metas: [] };
      }
      
      try {
        const skip = extra?.skip ? parseInt(extra.skip) : 0;
        
        const items = await fetchListContent(id, userConfig, userConfig.importedAddons);
        if (!items) {
          return { metas: [] };
        }
        
        const allMetas = await convertToStremioFormat(items, skip, 10, userConfig.rpdbApiKey);
        
        let filteredMetas = allMetas;
        if (type === 'movie') {
          filteredMetas = allMetas.filter(item => item.type === 'movie');
        } else if (type === 'series') {
          filteredMetas = allMetas.filter(item => item.type === 'series');
        }
        
        return {
          metas: filteredMetas,
          cacheMaxAge: 3600 * 24
        };
      } catch (error) {
        console.error(`Error in catalog handler: ${error.message}`);
        return { metas: [] };
      }
    });
    
    return builder.getInterface();
  } catch (error) {
    console.error(`Error creating addon: ${error.message}`);
    throw error;
  }
}

/**
 * Force rebuild the addon
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} Stremio addon interface
 */
async function rebuildAddon(userConfig) {
  // Completely rebuild the addon interface
  return await createAddon(userConfig);
}

module.exports = {
  createAddon,
  rebuildAddon,
  convertToStremioFormat,
  fetchListContent
}; 