// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');

/**
 * Fetches content for a specific list.
 * This function is also used by the /api/:configHash/lists endpoint to help determine
 * hasMovies/hasShows for listsMetadata if it's not already populated.
 */
async function fetchListContent(listId, userConfig, skip = 0) {
  const { apiKey, traktAccessToken, listsMetadata, sortPreferences, importedAddons } = userConfig;

  // Determine the original list ID for fetching sort preferences
  let originalListIdForSort = listId;
  if (listId.startsWith('aiolists-') && (listId.includes('-L') || listId.includes('-E') || listId.includes('-W'))) {
    const parts = listId.split('-');
    if (parts.length >= 2) {
      originalListIdForSort = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
    }
  } else if (listId.startsWith('mdblisturl_')) {
      const idMatch = listId.match(/^mdblisturl_(\d+)/);
      if (idMatch) {
          originalListIdForSort = idMatch[1];
      }
  } else if (listId.startsWith('trakt_')) {
    // For Trakt lists, sortPreferences are keyed directly by listId (e.g., "trakt_watchlist", "trakt_slug")
    originalListIdForSort = listId;
  }


  const defaultSort = (listId.startsWith('trakt_') && (userConfig.listsMetadata?.[listId]?.isTraktList || userConfig.listsMetadata?.[listId]?.isTraktWatchlist)) 
                      ? { sort: 'rank', order: 'asc' } 
                      : { sort: 'imdbvotes', order: 'desc' };
  const sortPrefs = sortPreferences?.[originalListIdForSort] || defaultSort;

  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      const catalog = addon.catalogs.find(c => String(c.id) === String(listId) || String(c.originalId) === String(listId));
      if (catalog) {
        if (addon.id.startsWith('mdblisturl_') && catalog.url && apiKey) {
          // For URL imported MDBLists, use its specific sort preferences or a default if none
          const mdbUrlSortPrefs = sortPreferences?.[originalListIdForSort] || { sort: 'imdbvotes', order: 'desc' };
          return fetchMDBListItems(catalog.originalId || listId, apiKey, listsMetadata, skip, mdbUrlSortPrefs.sort, mdbUrlSortPrefs.order, true);
        }
        // External addons might not have user-configurable sorting through AIOLists,
        // but we pass sortPrefs in case the fetcher can use them.
        return fetchExternalAddonItems(catalog.originalId || listId, addon, skip, userConfig.rpdbApiKey);
      }
    }
  }
  
  if (listId.startsWith('trakt_') && traktAccessToken) {
    return fetchTraktListItems(listId, userConfig, skip, sortPrefs.sort, sortPrefs.order);
  }

  if (apiKey) { // Assumed to be MDBList if apiKey is present and not handled above
    let mdbListId = listId;
    const listTypeMatch = listId.match(/^aiolists-(\d+)-([ELW])$/);
    if (listTypeMatch) {
      mdbListId = listTypeMatch[1];
    } else if (listId === 'aiolists-watchlist-W') {
      mdbListId = 'watchlist';
    }
    // Ensure originalListIdForSort is the pure MDBList ID for MDBList user lists
    const mdbSortKey = listId.startsWith('aiolists-') ? originalListIdForSort : mdbListId;
    const mdbSortPrefs = sortPreferences?.[mdbSortKey] || { sort: 'imdbvotes', order: 'desc' };
    return fetchMDBListItems(mdbListId, apiKey, listsMetadata, skip, mdbSortPrefs.sort, mdbSortPrefs.order);
  }
  
  return null;
}

async function createAddon(userConfig) {
  const manifest = {
    id: 'org.stremio.aiolists',
    version: `1.0.0-${Date.now()}`,
    name: 'AIOLists',
    description: 'Manage all your lists in one place.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    logo: `https://i.imgur.com/nyIDmcb.png`,
    behaviorHints: {
      configurable: true,
      configurationRequired: false 
    }
  };

  const { 
    apiKey, traktAccessToken, listOrder = [], 
    hiddenLists = [], removedLists = [], customListNames = {}, 
    mergedLists = {}, importedAddons = {}, 
    listsMetadata = {} // Crucially, use this
  } = userConfig;

  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));
  let activeListsInfo = []; // Will store list objects with their source for processing

  // Prepare MDBList lists info
  if (apiKey) {
    const mdbLists = await fetchAllMDBLists(apiKey); // This returns list definitions
    activeListsInfo.push(...mdbLists.map(l => ({ ...l, source: 'mdblist' })));
  }

  // Prepare Trakt lists info
  if (traktAccessToken) {
    const traktFetchedLists = await fetchTraktLists(userConfig); // This returns list definitions
    activeListsInfo.push(...traktFetchedLists.map(l => ({ ...l, source: 'trakt' })));
  }
  
  activeListsInfo = activeListsInfo.filter(list => !removedListsSet.has(String(list.id)));

  // Process MDBList and Trakt lists for the manifest
  for (const listInfo of activeListsInfo) {
    const listIdStr = String(listInfo.id);
    if (hiddenListsSet.has(listIdStr)) continue;

    let displayName = customListNames[listIdStr] || listInfo.name;
    
    // Determine the catalog ID used in the manifest
    let catalogIdInManifest = listIdStr; // Default for Trakt lists and others
    if (listInfo.source === 'mdblist') {
        catalogIdInManifest = listInfo.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${listInfo.id}-${listInfo.listType || 'L'}`;
    }
    
    const metadata = listsMetadata[listIdStr] || {}; // Get from pre-populated metadata
    let hasMovies = metadata.hasMovies;
    let hasShows = metadata.hasShows; 

    // Fallback if metadata is still not definitively set (should be rare with new /lists endpoint logic)
    if (typeof hasMovies !== 'boolean' || typeof hasShows !== 'boolean') {
        console.warn(`Manifest: Metadata for ${listIdStr} (hasMovies/hasShows) still undefined. Defaulting based on list flags or to false.`);
        if (listInfo.isMovieList === true) { // Check flags on the list object itself
            hasMovies = true;
            hasShows = false;
        } else if (listInfo.isShowList === true) {
            hasMovies = false;
            hasShows = true;
        } else { 
            // If truly unknown and no flags, assume no content to avoid errors or empty catalogs
            hasMovies = false; 
            hasShows = false;
        }
        // Note: We don't try to fetch content *here* anymore to keep manifest generation fast.
        // The /api/:configHash/lists endpoint is responsible for populating listsMetadata.
    }
    
    if (hasMovies || hasShows) {
        const shouldMerge = mergedLists[listIdStr] !== false; 
        if (hasMovies && hasShows && shouldMerge) {
          manifest.catalogs.push({ type: 'all', id: catalogIdInManifest, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        } else {
          if (hasMovies) manifest.catalogs.push({ type: 'movie', id: catalogIdInManifest, name: displayName, extraSupported: ["skip"], extraRequired: [] });
          if (hasShows) manifest.catalogs.push({ type: 'series', id: catalogIdInManifest, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        }
    } else {
        console.log(`Manifest: Skipping catalog for ${listIdStr} (${displayName}) as it's determined to have no movie/series content.`);
    }
  }

  // Add imported external addons catalogs
  Object.values(importedAddons).forEach(addon => {
    addon.catalogs.forEach(catalog => {
      const catalogIdStr = String(catalog.id);
      if (removedListsSet.has(catalogIdStr) || hiddenListsSet.has(catalogIdStr)) return;
      
      let displayName = customListNames[catalogIdStr] || catalog.name;
      const metadata = listsMetadata[catalogIdStr] || {}; // Use stored metadata
      
      let type = catalog.type === 'anime' ? 'series' : catalog.type;
      let addMovies = metadata.hasMovies;
      let addShows = metadata.hasShows;

      if (typeof addMovies !== 'boolean' || typeof addShows !== 'boolean') {
          // If metadata is missing for imported addon catalogs (should be set by /lists endpoint too)
          addMovies = type === 'movie' || type === 'all';
          addShows = type === 'series' || type === 'all' || type === 'anime';
          console.warn(`Manifest: Metadata for imported catalog ${catalogIdStr} was missing. Deduced from type: movies=${addMovies}, shows=${addShows}`);
      }
      
      const shouldMerge = mergedLists[catalogIdStr] !== false;

      if (addMovies && addShows && shouldMerge) {
          manifest.catalogs.push({
            type: 'all', id: catalogIdStr, name: displayName,
            extraSupported: ["skip"],
            extraRequired: catalog.extra?.some(e => e.isRequired && e.name === 'skip') ? ["skip"] : []
          });
      } else {
          if (addMovies) {
            manifest.catalogs.push({
                type: 'movie', id: catalogIdStr, name: displayName,
                extraSupported: ["skip"],
                extraRequired: catalog.extra?.some(e => e.isRequired && e.name === 'skip') ? ["skip"] : []
              });
          }
          if (addShows) {
            manifest.catalogs.push({
                type: 'series', id: catalogIdStr, name: displayName,
                extraSupported: ["skip"],
                extraRequired: catalog.extra?.some(e => e.isRequired && e.name === 'skip') ? ["skip"] : []
              });
          }
      }
      if (!addMovies && !addShows) {
          console.log(`Manifest: Skipping imported catalog ${catalogIdStr} (${displayName}) due to no content.`);
      }
    });
  });
  
  if (listOrder.length > 0) {
    const orderMap = new Map(listOrder.map((id, index) => [String(id).replace(/^aiolists-/, '').replace(/-[ELW]$/, ''), index]));
    manifest.catalogs.sort((a, b) => {
      const cleanAId = String(a.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
      const cleanBId = String(b.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
      const indexA = orderMap.get(cleanAId) ?? Infinity;
      const indexB = orderMap.get(cleanBId) ?? Infinity;
      return indexA - indexB;
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    const items = await fetchListContent(id, userConfig, skip);
    if (!items) return Promise.resolve({ metas: [] });

    let metas = await convertToStremioFormat(items, userConfig.rpdbApiKey);

    if (type !== 'all') { // type here is 'movie' or 'series' from Stremio request
        metas = metas.filter(meta => meta.type === type);
    }
    
    return Promise.resolve({ 
        metas,
        cacheMaxAge: isWatchlist(id) ? 0 : (5 * 60) 
    });
  });

  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
    return Promise.resolve({ meta: { id, type, name: "Loading metadata..." } }); 
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };