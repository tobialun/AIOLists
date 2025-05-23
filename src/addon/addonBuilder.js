const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');

async function fetchListContent(listId, userConfig, skip = 0) {
  const { apiKey, traktAccessToken, listsMetadata, sortPreferences, importedAddons, rpdbApiKey } = userConfig;

  let originalListIdForSortLookup = listId;
  
  if (listId.startsWith('aiolists-') && (listId.includes('-L') || listId.includes('-E') || listId.includes('-W'))) {
    const parts = listId.split('-');
    if (parts.length >= 2) {
      originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
    }
  } else if (listId.startsWith('trakt_') && !listId.includes('_movies') && !listId.includes('_series')) { 
    originalListIdForSortLookup = listId;
  }

  const isPotentiallyTrakt = listId.startsWith('trakt_') || listId.startsWith('traktpublic_') || (importedAddons && Object.values(importedAddons).some(a => a.isTraktPublicList && a.catalogs.find(c => c.id === listId)));
  const defaultSort = isPotentiallyTrakt 
                      ? { sort: 'rank', order: 'asc' } 
                      : { sort: 'imdbvotes', order: 'desc' };
  
  // Determine the key for sortPreferences:
  let sortPrefKey = originalListIdForSortLookup;
  if (importedAddons) {
      const foundAddon = Object.values(importedAddons).find(addon => addon.catalogs.find(c => c.id === listId));
      if (foundAddon) {
          const foundCatalog = foundAddon.catalogs.find(c => c.id === listId);
          if (foundCatalog && foundCatalog.originalId) {
              sortPrefKey = foundCatalog.originalId;
          }
      }
  }


  const sortPrefs = userConfig.sortPreferences?.[sortPrefKey] || defaultSort;

  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      const catalog = addon.catalogs.find(c => String(c.id) === String(listId)); // listId from manifest is specific (e.g., originalId_movies)
      if (catalog) {
        if (addon.isMDBListUrlImport && apiKey) {
          return fetchMDBListItems(catalog.originalId, apiKey, listsMetadata, skip, sortPrefs.sort, sortPrefs.order, true);
        } else if (addon.isTraktPublicList) {
          const type = catalog.id.endsWith('_movies') ? 'movie' : 'series';
          return fetchTraktListItems(
            `trakt_${catalog.originalId}`,
            userConfig, 
            skip, 
            sortPrefs.sort, 
            sortPrefs.order, 
            true,
            addon.traktUser,
            type
          );
        } else if (!addon.isMDBListUrlImport && !addon.isTraktPublicList) {
          return fetchExternalAddonItems(catalog.originalId || listId, addon, skip, rpdbApiKey);
        }
      }
    }
  }
  
  if (listId.startsWith('trakt_') && traktAccessToken) {
    return fetchTraktListItems(listId, userConfig, skip, sortPrefs.sort, sortPrefs.order, false);
  }

  if (apiKey) { 
    let mdbListId = listId;
    if (listId.startsWith('aiolists-')) {
        const match = listId.match(/^aiolists-([^-]+)-[ELW]$/);
        if (match) mdbListId = match[1];
    }

    const mdbSortPrefKey = mdbListId; 
    const mdbListSortPrefs = userConfig.sortPreferences?.[mdbSortPrefKey] || { sort: 'imdbvotes', order: 'desc' };
    return fetchMDBListItems(mdbListId, apiKey, listsMetadata, skip, mdbListSortPrefs.sort, mdbListSortPrefs.order, false);
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
    listsMetadata = {}
  } = userConfig;

  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));
  let activeListsInfo = []; 

  if (apiKey) {
    const mdbLists = await fetchAllMDBLists(apiKey); 
    activeListsInfo.push(...mdbLists.map(l => ({ ...l, source: 'mdblist' })));
  }

  if (traktAccessToken) {
    const traktFetchedLists = await fetchTraktLists(userConfig); 
    activeListsInfo.push(...traktFetchedLists.map(l => ({ ...l, source: 'trakt' })));
  }
  
  activeListsInfo = activeListsInfo.filter(list => !removedListsSet.has(String(list.id)));

  for (const listInfo of activeListsInfo) {
    const listIdStr = String(listInfo.id);
    if (hiddenListsSet.has(listIdStr)) continue;

    let displayName = customListNames[listIdStr] || listInfo.name;
    
    let catalogIdInManifest = listIdStr; 
    if (listInfo.source === 'mdblist') {
        catalogIdInManifest = listInfo.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${listInfo.id}-${listInfo.listType || 'L'}`;
    }
    
    const metadata = listsMetadata[listIdStr] || {};
    let hasMovies = metadata.hasMovies;
    let hasShows = metadata.hasShows; 

    if (typeof hasMovies !== 'boolean' || typeof hasShows !== 'boolean') {
        if (listInfo.isMovieList === true) { 
            hasMovies = true; hasShows = false;
        } else if (listInfo.isShowList === true) {
            hasMovies = false; hasShows = true;
        } else { 
            hasMovies = false; hasShows = false;
        }
    }
    
    if (hasMovies || hasShows) {
        const shouldMerge = mergedLists[listIdStr] !== false; 
        if (hasMovies && hasShows && shouldMerge) {
          manifest.catalogs.push({ type: 'all', id: catalogIdInManifest, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        } else {
          if (hasMovies) manifest.catalogs.push({ type: 'movie', id: catalogIdInManifest, name: displayName, extraSupported: ["skip"], extraRequired: [] });
          if (hasShows) manifest.catalogs.push({ type: 'series', id: catalogIdInManifest, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        }
    }
  }

  Object.values(importedAddons).forEach(addon => {
    if (removedListsSet.has(addon.id)) return;

    addon.catalogs.forEach(catalog => {
      const catalogIdForManifest = String(catalog.id); 
      if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;
      
      let displayName = customListNames[catalogIdForManifest] || catalog.name;
      const metadata = listsMetadata[catalogIdForManifest] || {};
      
      let addMovies = metadata.hasMovies;
      let addShows = metadata.hasShows;

      if (typeof addMovies !== 'boolean' || typeof addShows !== 'boolean') {
          addMovies = catalog.type === 'movie';
          addShows = catalog.type === 'series';
      }
      
      const shouldMerge = mergedLists[catalogIdForManifest] !== false; 

      if (addMovies) {
        manifest.catalogs.push({
            type: 'movie', id: catalogIdForManifest, name: displayName,
            extraSupported: ["skip"],
            extraRequired: catalog.extra?.some(e => e.isRequired && e.name === 'skip') ? ["skip"] : []
          });
      }
      if (addShows) {
        manifest.catalogs.push({
            type: 'series', id: catalogIdForManifest, name: displayName,
            extraSupported: ["skip"],
            extraRequired: catalog.extra?.some(e => e.isRequired && e.name === 'skip') ? ["skip"] : []
          });
      }
    });
  });
  
  if (listOrder.length > 0) {
    const orderMap = new Map();
    listOrder.forEach((id, index) => {
        orderMap.set(String(id), index);
    });

    manifest.catalogs.sort((a, b) => {
        let idAForSort = String(a.id);
        let idBForSort = String(b.id);

        if (a.id.startsWith('aiolists-')) {
            const match = a.id.match(/^aiolists-([^-]+)-[ELW]$/);
            if (match) idAForSort = match[1];
        }
        if (b.id.startsWith('aiolists-')) {
            const match = b.id.match(/^aiolists-([^-]+)-[ELW]$/);
            if (match) idBForSort = match[1];
        }
        const indexA = orderMap.get(idAForSort) ?? Infinity;
        const indexB = orderMap.get(idBForSort) ?? Infinity;
        return indexA - indexB;
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    const items = await fetchListContent(id, userConfig, skip);
    if (!items) return Promise.resolve({ metas: [] });

    let metas = await convertToStremioFormat(items, userConfig.rpdbApiKey);

    if (type !== 'all') { 
        metas = metas.filter(meta => meta.type === type);
    }
    
    return Promise.resolve({ 
        metas,
        cacheMaxAge: isWatchlist(id) ? 0 : (5 * 60) 
    });
  });

  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
    return Promise.resolve({ meta: { id, type, name: "Loading details..." } }); 
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };