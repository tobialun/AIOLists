const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');

async function fetchListContent(listId, userConfig, skip = 0) {
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey, tmdbApiKey } = userConfig;
  let originalListIdForSortLookup = listId;

  if (listId.startsWith('aiolists-') && (listId.includes('-L') || listId.includes('-E') || listId.includes('-W'))) {
    const parts = listId.split('-');
    if (parts.length >= 2) {
      originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
    }
  } else if (listId.startsWith('trakt_') || listId.startsWith('tmdb_') || listId.startsWith('simkl_')) {
    originalListIdForSortLookup = listId;
  } else if (importedAddons) {
      const foundAddonEntry = Object.values(importedAddons).find(addon => {
        if (addon.id === listId) return true; // For URL imported groups
        return addon.catalogs && addon.catalogs.find(c => c.id === listId); // For manifest sub-catalogs
      });
      if (foundAddonEntry) {
          if (foundAddonEntry.id === listId && (foundAddonEntry.isUrlImported)) {
            originalListIdForSortLookup = foundAddonEntry.id;
          } else {
            const foundCatalog = foundAddonEntry.catalogs?.find(c => c.id === listId);
            if (foundCatalog && foundCatalog.originalId) {
                originalListIdForSortLookup = foundCatalog.originalId;
            }
          }
      }
  }

  const sortPrefsForImported = userConfig.sortPreferences?.[originalListIdForSortLookup] || 
                               ( (importedAddons[originalListIdForSortLookup]?.isTraktPublicList) ? 
                                 { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' } );


  if (importedAddons) {
    const addonGroup = importedAddons[listId]; // Check if listId is an addon group ID first
    if (addonGroup && addonGroup.isUrlImported && addonGroup.hasMovies && addonGroup.hasShows) {
        if (addonGroup.isMDBListUrlImport && apiKey) {
            return fetchMDBListItems(addonGroup.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true);
        } else if (addonGroup.isTraktPublicList) {
            return fetchTraktListItems(`trakt_${addonGroup.traktListSlug}`, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, addonGroup.traktUser, null);
        }
    }

    for (const addon of Object.values(importedAddons)) {
      if (!addon.catalogs && !(addon.isUrlImported && addon.hasMovies && addon.hasShows)) continue;
      
      if (addon.id === listId && addon.isUrlImported && (addon.hasMovies || addon.hasShows) && !(addon.hasMovies && addon.hasShows) ) {
         if (addon.isMDBListUrlImport && apiKey) {
            return fetchMDBListItems(addon.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true);
        } else if (addon.isTraktPublicList) {
            const itemTypeHint = addon.hasMovies ? 'movie' : (addon.hasShows ? 'series' : null);
            return fetchTraktListItems(`trakt_${addon.traktListSlug}`, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, addon.traktUser, itemTypeHint);
        }
      }

      const catalog = addon.catalogs?.find(c => String(c.id) === String(listId));
      if (catalog) {
        if (addon.isMDBListUrlImport && apiKey) {
           return fetchMDBListItems(catalog.originalId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true);
        } else if (addon.isTraktPublicList) {
           const itemTypeHint = catalog.type;
           return fetchTraktListItems(`trakt_${catalog.originalId}`, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, addon.traktUser, itemTypeHint);
        }
        else if (!addon.isMDBListUrlImport && !addon.isTraktPublicList) {
          return fetchExternalAddonItems(catalog.originalId, catalog.originalType, addon, skip, userConfig.rpdbApiKey, null);
        }
      }
    }
  }
  
  const sortPrefs = userConfig.sortPreferences?.[originalListIdForSortLookup] || 
                    ( (listId.startsWith('trakt_') || listId.startsWith('traktpublic_')) ? 
                      { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' } );


  if (listId.startsWith('trakt_') && traktAccessToken) {
    let itemTypeHint = null;
    if (listId.includes("_movies")) itemTypeHint = 'movie';
    if (listId.includes("_shows")) itemTypeHint = 'series';
    return fetchTraktListItems(listId, userConfig, skip, sortPrefs.sort, sortPrefs.order, false, null, itemTypeHint);
  }

  if (apiKey && listId.startsWith('aiolists-')) {
    const match = listId.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalId = match ? match[1] : listId.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (listId === 'aiolists-watchlist-W') {
        mdbListOriginalId = 'watchlist';
    }
    const mdbListSortPrefs = userConfig.sortPreferences?.[mdbListOriginalId] || { sort: 'imdbvotes', order: 'desc' };
    return fetchMDBListItems(mdbListOriginalId, apiKey, listsMetadata, skip, mdbListSortPrefs.sort, mdbListSortPrefs.order, false);
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
    types: ['movie', 'series', 'all'],
    idPrefixes: ['tt'],
    catalogs: [],
    logo: `https://i.imgur.com/nyIDmcb.png`,
    behaviorHints: { configurable: true, configurationRequired: false }
  };

  const {
    apiKey, traktAccessToken,
    listOrder = [],
    hiddenLists = [],
    removedLists = [],
    customListNames = {},
    mergedLists = {},
    importedAddons = {},
    listsMetadata = {}
  } = userConfig;

  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));

  let activeListsInfo = [];
  if (apiKey) {
    const mdbLists = await fetchAllMDBLists(apiKey);
    activeListsInfo.push(...mdbLists.map(l => ({ ...l, source: 'mdblist', originalId: String(l.id) })));
  }
  if (traktAccessToken) {
    const traktFetchedLists = await fetchTraktLists(userConfig);
    activeListsInfo.push(...traktFetchedLists.map(l => ({ ...l, source: 'trakt', originalId: String(l.id) })));
  }

  for (const listInfo of activeListsInfo) {
    const originalId = String(listInfo.originalId);
    let manifestListIdBase = originalId;

    if (listInfo.source === 'mdblist') {
      manifestListIdBase = originalId === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${originalId}-${listInfo.listType || 'L'}`;
    } else if (listInfo.source === 'trakt') {
      manifestListIdBase = originalId;
    }

    if (removedListsSet.has(manifestListIdBase) || removedListsSet.has(originalId)) {
      continue;
    }
    if (hiddenListsSet.has(manifestListIdBase) || hiddenListsSet.has(originalId)) {
      continue;
    }

    let displayName = customListNames[manifestListIdBase] || customListNames[originalId] || listInfo.name;
    let metadata = listsMetadata[manifestListIdBase] || listsMetadata[originalId] || {};

    let hasMovies = metadata.hasMovies === true;
    let hasShows = metadata.hasShows === true;

    if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
        const content = await fetchListContent(manifestListIdBase, userConfig, 0);
        hasMovies = content?.hasMovies || false;
        hasShows = content?.hasShows || false;
        if (!listsMetadata[manifestListIdBase] && !listsMetadata[originalId]) {
             if(!userConfig.listsMetadata) userConfig.listsMetadata = {};
             userConfig.listsMetadata[manifestListIdBase] = { hasMovies, hasShows };
        }
    }


    if (hasMovies || hasShows) {
      const isMerged = mergedLists[manifestListIdBase] !== false;

      if (hasMovies && hasShows && isMerged) {
        manifest.catalogs.push({
          type: 'all',
          id: manifestListIdBase,
          name: displayName,
          extraSupported: ["skip"],
          extraRequired: []
        });
      } else {
        if (hasMovies) {
          manifest.catalogs.push({
            type: 'movie',
            id: manifestListIdBase,
            name: displayName,
            extraSupported: ["skip"],
            extraRequired: []
          });
        }
        if (hasShows) {
          manifest.catalogs.push({
            type: 'series',
            id: manifestListIdBase,
            name: displayName,
            extraSupported: ["skip"],
            extraRequired: []
          });
        }
      }
    }
  }

  Object.values(importedAddons || {}).forEach(addon => {
    const addonGroupId = String(addon.id);
    if (removedListsSet.has(addonGroupId)) return;

    if (addon.isUrlImported && addon.hasMovies && addon.hasShows) {
        if (hiddenListsSet.has(addonGroupId)) return;
        let displayName = customListNames[addonGroupId] || addon.name;
        const isMerged = userConfig.mergedLists?.[addonGroupId] !== false;

        if (isMerged) {
            manifest.catalogs.push({
                type: 'all',
                id: addonGroupId,
                name: displayName,
                extraSupported: ["skip"],
                extraRequired: []
            });
        } else {
            if (addon.hasMovies) {
                manifest.catalogs.push({
                    type: 'movie',
                    id: addonGroupId, 
                    name: displayName,
                    extraSupported: ["skip"],
                    extraRequired: []
                });
            }
            if (addon.hasShows) {
                manifest.catalogs.push({
                    type: 'series',
                    id: addonGroupId,
                    name: displayName,
                    extraSupported: ["skip"],
                    extraRequired: []
                });
            }
        }
    } else if (addon.catalogs && addon.catalogs.length > 0) { 
        (addon.catalogs || []).forEach(catalog => {
            const catalogIdForManifest = String(catalog.id);
            if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;
            
            let displayName = customListNames[catalogIdForManifest] || catalog.name;
            manifest.catalogs.push({
                type: catalog.type, 
                id: catalogIdForManifest,
                name: displayName,
                extraSupported: catalog.extraSupported || ["skip"],
                extraRequired: catalog.extraRequired || []
            });
        });
    } else if (addon.isUrlImported && (addon.hasMovies || addon.hasShows)) { // Single type URL import
        if (hiddenListsSet.has(addonGroupId)) return;
        let displayName = customListNames[addonGroupId] || addon.name;
        const type = addon.hasMovies ? 'movie' : 'series';
         manifest.catalogs.push({
            type: type,
            id: addonGroupId,
            name: displayName,
            extraSupported: ["skip"],
            extraRequired: []
        });
    }
  });

  if (listOrder && listOrder.length > 0) {
    const orderMap = new Map(listOrder.map((id, index) => [String(id), index]));
    manifest.catalogs.sort((a, b) => {
      const catalogIdA = String(a.id);
      const catalogIdB = String(b.id);

      const indexA = orderMap.get(catalogIdA);
      const indexB = orderMap.get(catalogIdB);

      if (indexA !== undefined && indexB !== undefined) {
        if (indexA !== indexB) return indexA - indexB;
        if (a.type === 'movie' && b.type === 'series') return -1;
        if (a.type === 'series' && b.type === 'movie') return 1;
        return 0;
      }
      if (indexA !== undefined) return -1;
      if (indexB !== undefined) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    
    const baseListIdToFetch = id; 
    const typeToFilterBy = type;

    const items = await fetchListContent(baseListIdToFetch, userConfig, skip);
    if (!items) return Promise.resolve({ metas: [] });

    let metas = await convertToStremioFormat(items, userConfig.rpdbApiKey);

    if (typeToFilterBy !== 'all') {
        metas = metas.filter(meta => meta.type === typeToFilterBy);
    }

    return Promise.resolve({ metas, cacheMaxAge: isWatchlist(baseListIdToFetch) ? 0 : (5 * 60) });
  });

  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) {
        return Promise.resolve({ meta: null });
    }
    return Promise.resolve({ meta: { id, type, name: "Loading details..." } });
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };