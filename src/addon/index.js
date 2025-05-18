const { addonBuilder } = require('stremio-addon-sdk');
const { batchFetchPosters } = require('../utils/posters');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { storeListsMetadata, ITEMS_PER_PAGE } = require('../config');
const axios = require('axios');

/**
 * Convert API items to Stremio format
 * @param {Object} items - Items from API
 * @param {number} skip - Number of items to skip
 * @param {number} limit - Number of items to return (default 100 for pagination)
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {Promise<Array>} Array of Stremio meta objects
 */
async function convertToStremioFormat(items, skip = 0, limit = ITEMS_PER_PAGE, rpdbApiKey = null) {
  let metas = [];
  
  // Check if we have a valid RPDB API key
  const useRPDB = !!rpdbApiKey;
  
  // If the response is already in Stremio format (has metas array)
  if (items.metas && Array.isArray(items.metas)) {
    // Get the slice we need
    const pageItems = items.metas.slice(skip, skip + limit);
    
    // If we have RPDB key, update the posters
    if (useRPDB) {
      // Collect all IMDb IDs first
      const imdbIds = pageItems
        .map(item => item.imdb_id || item.id)
        .filter(id => id && id.startsWith('tt'));
      
      // Batch fetch all posters
      const posterMap = await batchFetchPosters(imdbIds, rpdbApiKey);
      
      // Update items with fetched posters
      metas = pageItems.map(item => {
        const imdbId = item.imdb_id || item.id;
        if (imdbId && posterMap[imdbId]) {
          return { ...item, poster: posterMap[imdbId] };
        }
        return item;
      });
    } else {
      metas = pageItems;
    }
    
    return metas;
  }

  // Preserve the catalog order if it exists
  const catalogOrder = items.catalogOrder;
  
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
      
      const meta = {
        id: imdbId,
        type: 'movie',
        name: movie.title || movie.name,
        poster: movie.poster,
        background: movie.backdrop || movie.background,
        description: movie.overview || movie.description,
        releaseInfo: movie.year || movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : undefined),
        imdbRating: movie.imdbRating || (movie.imdbrating ? movie.imdbrating.toFixed(1) : undefined),
        runtime: movie.runtime ? `${movie.runtime}`.includes(' min') ? movie.runtime : `${movie.runtime} min` : undefined,
        genres: movie.genres || movie.genre,
        cast: movie.cast,
        director: movie.director,
        writer: movie.writer,
        awards: movie.awards,
        country: movie.country,
        trailers: movie.trailers,
        trailerStreams: movie.trailerStreams,
        dvdRelease: movie.dvdRelease,
        links: movie.links,
        popularity: movie.popularity,
        slug: movie.slug,
        behaviorHints: movie.behaviorHints || {
          hasScheduledVideos: false
        },
        catalogOrder: catalogOrder
      };

      // Clean up undefined values
      Object.keys(meta).forEach(key => meta[key] === undefined && delete meta[key]);
      
      // Ensure genres is an array
      if (meta.genres && typeof meta.genres === 'string') {
        meta.genres = meta.genres.split(',').map(g => g.trim());
      }

      allItems.push(meta);
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
      
      const meta = {
        id: imdbId,
        type: 'series',
        name: show.title || show.name,
        poster: show.poster,
        background: show.backdrop || show.background,
        description: show.overview || show.description,
        releaseInfo: show.year || show.release_year || (show.first_air_date ? show.first_air_date.split('-')[0] : undefined),
        imdbRating: show.imdbRating || (show.imdbrating ? show.imdbrating.toFixed(1) : undefined),
        runtime: show.runtime ? `${show.runtime}`.includes(' min') ? show.runtime : `${show.runtime} min` : undefined,
        genres: show.genres || show.genre,
        cast: show.cast,
        director: show.director,
        writer: show.writer,
        awards: show.awards,
        country: show.country,
        trailers: show.trailers,
        trailerStreams: show.trailerStreams,
        dvdRelease: show.dvdRelease,
        links: show.links,
        popularity: show.popularity,
        slug: show.slug,
        status: show.status,
        behaviorHints: show.behaviorHints || {
          hasScheduledVideos: false
        },
        catalogOrder: catalogOrder
      };

      // Clean up undefined values
      Object.keys(meta).forEach(key => meta[key] === undefined && delete meta[key]);
      
      // Ensure genres is an array
      if (meta.genres && typeof meta.genres === 'string') {
        meta.genres = meta.genres.split(',').map(g => g.trim());
      }

      allItems.push(meta);
    }
  }
  
  // Only attempt to fetch RPDB posters for the items that will be displayed
  const pageItems = allItems.slice(skip, skip + limit);
  
  // Process RPDB posters only for the current page of items
  if (useRPDB && pageItems.length > 0) {
    // Collect all IMDb IDs
    const imdbIds = pageItems.map(item => item.id).filter(id => id && id.startsWith('tt'));
    
    // Batch fetch all posters
    const posterMap = await batchFetchPosters(imdbIds, rpdbApiKey);
    
    // Update items with fetched posters
    metas = pageItems.map(item => {
      if (item.id && posterMap[item.id]) {
        return { ...item, poster: posterMap[item.id] };
      }
      return item;
    });
  } else {
    // If not using RPDB, just add items without fetching posters
    metas.push(...pageItems);
  }
  
  return metas;
}

/**
 * Fetch list items for a specific list
 * @param {string} listId - List ID
 * @param {Object} userConfig - User configuration
 * @param {Object} importedAddons - Imported addons
 * @param {number} skip - Number of items to skip
 * @param {string} [sort='rank'] - Sort field
 * @param {string} [order='desc'] - Sort order
 * @returns {Promise<Object>} List items
 */
async function fetchListContent(listId, userConfig, importedAddons, skip = 0, sort = 'rank', order = 'desc') {
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
        
        // If this is a MDBList catalog with a direct URL
        if (catalog.url && addon.id.startsWith('mdblist_')) {
          try {
            const listType = catalog.listType || 'L'; // Default to Internal list type (L) for URL imports
            
            // Add or update metadata in userConfig to properly set this as an internal list
            userConfig.listsMetadata[listId] = {
              ...(userConfig.listsMetadata[listId] || {}),
              isExternalList: false,
              isInternalList: true,
              isUrlImport: true,
              listType: listType
            };
            
            // Use fetchListItems with the proper listType setting for better API URL selection
            return fetchMDBListItems(listId, userConfig.apiKey, userConfig.listsMetadata, skip, sort, order);
          } catch (error) {
            console.error(`Error fetching MDBList catalog: ${error.message}`);
            return null;
          }
        }
        
        // Otherwise use the regular external addon fetching
        const items = await fetchExternalAddonItems(catalog.id, addon, skip);
        return items;
      }
    }
  }
  
  // If list ID has a listType directly in it, extract and use that
  const listTypeMatch = listId.match(/^aiolists-(\d+)-([ELW])$/);
  if (listTypeMatch) {
    const actualId = listTypeMatch[1];
    const listType = listTypeMatch[2];
    
    // Create a temporary metadata for this request
    const tempMetadata = {};
    tempMetadata[actualId] = { listType };
    
    // Call fetchListItems with the extracted ID and type
    return fetchMDBListItems(actualId, userConfig.apiKey, tempMetadata, skip, sort, order);
  }
  
  // Special case for watchlist with list type
  if (listId === 'aiolists-watchlist-W') {
    console.log('Handling watchlist with type suffix (W)');
    return fetchMDBListItems('watchlist', userConfig.apiKey, userConfig.listsMetadata, skip, sort, order);
  }
  
  // Check if this is a Trakt list
  if (listId.startsWith('trakt_')) {
    // Verify we have Trakt config
    if (!userConfig.traktAccessToken) {
      return null;
    }
    return fetchTraktListItems(listId, userConfig, skip);
  }
  
  // Otherwise, assume it's an MDBList list
  return fetchMDBListItems(listId, userConfig.apiKey, userConfig.listsMetadata, skip, sort, order);
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
    resources: ['catalog', 'meta'],
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
      
      // Process lists in parallel and collect all catalogs
      const catalogPromises = visibleLists.map(async list => {
        const listId = String(list.id);
        let displayName = list.name;
        if (userConfig.customListNames && userConfig.customListNames[listId]) {
          displayName = userConfig.customListNames[listId];
        }
        
        const safeName = displayName.replace(/[^\w\s-]/g, '');
        // Special case for watchlist to keep consistent ID format
        let catalogId;
        if (listId.startsWith('trakt_')) {
          catalogId = listId;
        } else if (listId === 'watchlist') {
          catalogId = `aiolists-watchlist-W`;
        } else {
          catalogId = `aiolists-${listId}-${list.listType || 'L'}`;
        }
        
        const catalogs = [];
        
        // Check if we have cached content type information
        const metadata = userConfig.listsMetadata?.[listId] || {};
        const hasMovies = metadata.hasMovies !== false; // Default to true if not specified
        const hasShows = metadata.hasShows !== false;   // Default to true if not specified
        
        // For most lists, create both movie and series catalogs by default
        // or use the cached type information if available
        if (hasMovies && hasShows && !listId.startsWith('trakt_')) {
          catalogs.push({
            type: 'all', // custom type for merged row
            id: catalogId,
            name: safeName,
            extra: [{ name: "skip" }],
            extraSupported: ["skip"],
            originalListId: listId,
            listType: list.listType || 'L' // Add listType
          });
        } else {
          if (hasMovies || list.isMovieList) {
            catalogs.push({
              type: 'movie',
              id: catalogId,
              name: safeName,
              extra: [{ name: "skip" }],
              extraSupported: ["skip"],
              originalListId: listId,
              listType: list.listType || 'L' // Add listType
            });
          }
          if (hasShows || list.isShowList) {
            catalogs.push({
              type: 'series',
              id: catalogId,
              name: safeName,
              extra: [{ name: "skip" }],
              extraSupported: ["skip"],
              originalListId: listId,
              listType: list.listType || 'L' // Add listType
            });
          }
        }

        return catalogs;
      });

      // Wait for all catalog promises to resolve
      const allCatalogs = (await Promise.all(catalogPromises)).flat();

      // If we have a list order, sort the catalogs
      if (userConfig.listOrder && userConfig.listOrder.length > 0) {
        const orderMap = new Map(userConfig.listOrder.map((id, index) => [String(id), index]));
        
        allCatalogs.sort((a, b) => {
          // Get the clean IDs for comparison
          let aId = String(a.originalListId);
          let bId = String(b.originalListId);
          
          // Special case for watchlist - just pass through the ID as it should match what's in the list order
          
          // Handle aiolists prefix with consistent regex
          if (aId.startsWith('aiolists-')) {
            aId = aId.replace(/^aiolists-(\d+)-[ELW]$/, '$1');
          }
          
          if (bId.startsWith('aiolists-')) {
            bId = bId.replace(/^aiolists-(\d+)-[ELW]$/, '$1');
          }
          
          // Check direct match first
          let aOrder = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
          let bOrder = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
          
          // If no direct match, check if it's a composite ID with underscore
          if (aOrder === Number.MAX_SAFE_INTEGER && aId.includes('_')) {
            const baseId = aId.split('_')[0];
            if (orderMap.has(baseId)) {
              aOrder = orderMap.get(baseId);
            }
          }
          
          if (bOrder === Number.MAX_SAFE_INTEGER && bId.includes('_')) {
            const baseId = bId.split('_')[0];
            if (orderMap.has(baseId)) {
              bOrder = orderMap.get(baseId);
            }
          }
          
          return aOrder - bOrder;
        });
      }

      // Remove the temporary originalListId property and add to manifest
      allCatalogs.forEach(catalog => {
        delete catalog.originalListId;
        manifest.catalogs.push(catalog);
      });
    }

    // Add imported lists
    if (userConfig.importedAddons) {
      for (const addon of Object.values(userConfig.importedAddons)) {
        
        addon.catalogs
          .filter(catalog => {
            // Ensure consistent handling of string IDs
            const catalogId = String(catalog.id);
            const isHidden = hiddenLists.has(catalogId);
            return !isHidden;
          })
          .forEach(catalog => {
            // Apply custom names if available
            const catalogId = String(catalog.id);
            let displayName = catalog.name;
            
            if (userConfig.customListNames && userConfig.customListNames[catalogId]) {
              displayName = userConfig.customListNames[catalogId];
            }
            
            // Determine catalog type
            const catalogType = catalog.type === 'anime' ? 'series' : catalog.type;
            
            
            const catalogEntry = {
              type: catalogType,
              id: catalogId,
              name: displayName,
              extra: [
                { name: "skip" }
              ],
              extraSupported: ["skip"]
            };

            // Add redirectUrl for MDBList catalogs
            if (addon.id.startsWith('mdblist_') && catalog.url) {
              catalogEntry.redirectUrl = catalog.url;
            }
            
            manifest.catalogs.push(catalogEntry);
          });
      }
    }
    
    // Apply list ordering from config if available
    if (userConfig.listOrder && userConfig.listOrder.length > 0) {
      
      // Convert to a Map for faster lookup
      const orderMap = new Map(userConfig.listOrder.map((id, index) => [String(id), index]));
            
      // Sort catalogs based on list order
      manifest.catalogs.sort((a, b) => {
        // Get the clean IDs for comparison
        let aId = String(a.id);
        let bId = String(b.id);
        
        // Special case for watchlist
        if (aId === 'aiolists-watchlist-W') {
          aId = 'watchlist';
        }
        
        if (bId === 'aiolists-watchlist-W') {
          bId = 'watchlist';
        }
        
        // Handle aiolists prefix for MDBList items with consistent regex
        if (aId.startsWith('aiolists-')) {
          aId = aId.replace(/^aiolists-(\d+)-[ELW]$/, '$1');
        }
        
        if (bId.startsWith('aiolists-')) {
          bId = bId.replace(/^aiolists-(\d+)-[ELW]$/, '$1');
        }
        
        // Check direct match first
        let aOrder = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
        let bOrder = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
        
        // If no direct match, check if it's a composite ID (with type suffix)
        if (aOrder === Number.MAX_SAFE_INTEGER && aId.includes('_')) {
          const baseId = aId.split('_')[0];
          if (orderMap.has(baseId)) {
            aOrder = orderMap.get(baseId);
          }
        }
        
        if (bOrder === Number.MAX_SAFE_INTEGER && bId.includes('_')) {
          const baseId = bId.split('_')[0];
          if (orderMap.has(baseId)) {
            bOrder = orderMap.get(baseId);
          }
        }
        
        return aOrder - bOrder;
      });
      
    }

    const builder = new addonBuilder(manifest);
    
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
      if (!userConfig.apiKey && !userConfig.traktAccessToken && !userConfig.importedAddons) {
        return { metas: [] };
      }
      
      try {
        // Extract skip value - could be in different formats
        let skip = 0;
        if (extra && extra.skip) {
          skip = parseInt(extra.skip) || 0;
        }
        
        // Log the pagination request
        console.log(`Handling catalog request for ${id} with type=${type} and skip=${skip}`);
        console.log(`Extra params:`, JSON.stringify(extra));
        
        // Ensure skip is a valid number
        const skipValue = isNaN(skip) ? 0 : skip;

        // Find the catalog's position in the manifest
        const catalogIndex = manifest.catalogs.findIndex(c => c.id === id && c.type === type);
        
        const items = await fetchListContent(id, userConfig, userConfig.importedAddons, skipValue);
        if (!items) {
          return { metas: [] };
        }
        
        // Add manifest order to items
        items.catalogOrder = catalogIndex;
        
        // Log how many items we got back
        const totalMovies = items.movies?.length || 0;
        const totalShows = items.shows?.length || 0;
        
        // Store content type information for future manifest generation
        // Extract the real list ID from catalog ID if needed
        let realListId = id;
        const listTypeMatch = id.match(/^aiolists-(\d+)-([ELW])$/);
        if (listTypeMatch) {
          realListId = listTypeMatch[1];
        } else if (id === 'aiolists-watchlist-W') {
          realListId = 'watchlist';
        }
        
        // Update metadata with content type information
        if (!userConfig.listsMetadata) {
          userConfig.listsMetadata = {};
        }
        if (!userConfig.listsMetadata[realListId]) {
          userConfig.listsMetadata[realListId] = {};
        }
        userConfig.listsMetadata[realListId].hasMovies = totalMovies > 0;
        userConfig.listsMetadata[realListId].hasShows = totalShows > 0;
        
        // When we fetch items with skip parameter, we don't need to skip again in convertToStremioFormat
        const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, userConfig.rpdbApiKey);
        
        let filteredMetas = allMetas;
        if (type === 'movie') {
          filteredMetas = allMetas.filter(item => item.type === 'movie');
        } else if (type === 'series') {
          filteredMetas = allMetas.filter(item => item.type === 'series');
        } else if (type === 'all') {
          // For custom merged row, return both movies and series
          filteredMetas = allMetas;
        }
        
        // Sort by manifest order
        filteredMetas.sort((a, b) => {
          const orderA = a.catalogOrder !== undefined ? a.catalogOrder : Number.MAX_SAFE_INTEGER;
          const orderB = b.catalogOrder !== undefined ? b.catalogOrder : Number.MAX_SAFE_INTEGER;
          return orderA - orderB;
        });
        
        
        // If we have a full page of results, indicate that there might be more
        const hasMore = filteredMetas.length >= ITEMS_PER_PAGE;
        console.log(`Has more pages: ${hasMore}`);
        
        return {
          metas: filteredMetas,
          cacheMaxAge: 86400 // 1 day in seconds
        };
      } catch (error) {
        console.error(`Error in catalog handler: ${error.message}`);
        return { metas: [] };
      }
    });

    // Add meta handler to pass through to Cinemeta
    builder.defineMetaHandler(({ type, id }) => {
      // We only handle imdb ids with the "tt" prefix
      if (!id.startsWith('tt')) {
        return Promise.resolve({ meta: null });
      }
      
      // Return basic meta information but delegate to Cinemeta for detailed information
      return Promise.resolve({
        meta: {
          id: id,
          type: type,
          name: "Loading via Cinemeta...",
          background: null,
          logo: null,
          posterShape: "regular",
          runtime: null,
          genres: [],
          description: null
        },
        cacheMaxAge: 86400 // 1 day in seconds
      });
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