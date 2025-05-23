// src/addon/addonBuilder.js
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
  } else if (importedAddons) {
      const foundAddonEntry = Object.values(importedAddons).find(addon => addon.catalogs.find(c => c.id === listId));
      if (foundAddonEntry) {
          const foundCatalog = foundAddonEntry.catalogs.find(c => c.id === listId);
          if (foundCatalog && foundCatalog.originalId) {
              originalListIdForSortLookup = foundCatalog.originalId;
          }
      }
  }

  const isPotentiallyTrakt = listId.startsWith('trakt_') || listId.startsWith('traktpublic_') ||
                             (importedAddons && Object.values(importedAddons).some(a => a.isTraktPublicList && a.catalogs.find(c => c.id === listId)));
  const defaultSort = isPotentiallyTrakt ? { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' };
  const sortPrefs = userConfig.sortPreferences?.[originalListIdForSortLookup] || defaultSort;

  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      const catalog = addon.catalogs.find(c => String(c.id) === String(listId));
      if (catalog) {
        if (addon.isMDBListUrlImport && apiKey) {
          return fetchMDBListItems(catalog.originalId, apiKey, listsMetadata, skip, sortPrefs.sort, sortPrefs.order, true);
        } else if (addon.isTraktPublicList) {
           const type = catalog.id.endsWith('_movies') ? 'movie' : (catalog.id.endsWith('_series') ? 'series' : null);
          return fetchTraktListItems(`trakt_${catalog.originalId}`, userConfig, skip, sortPrefs.sort, sortPrefs.order, true, addon.traktUser, type);
        } else if (!addon.isMDBListUrlImport && !addon.isTraktPublicList) {
          return fetchExternalAddonItems(catalog.originalId || catalog.id, addon, skip, rpdbApiKey);
        }
      }
    }
  }
  if (listId.startsWith('trakt_') && traktAccessToken) {
    let itemTypeForTraktSpecial = null;
    if (listId.includes("_movies")) itemTypeForTraktSpecial = "movie";
    else if (listId.includes("_shows")) itemTypeForTraktSpecial = "series";
    return fetchTraktListItems(listId, userConfig, skip, sortPrefs.sort, sortPrefs.order, false, null, itemTypeForTraktSpecial);
  }
  if (apiKey && listId.startsWith('aiolists-')) {
    const match = listId.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalId = match ? match[1] : listId.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (listId === 'aiolists-watchlist-W') mdbListOriginalId = 'watchlist';
    const mdbListSortPrefs = userConfig.sortPreferences?.[mdbListOriginalId] || { sort: 'imdbvotes', order: 'desc' };
    return fetchMDBListItems(mdbListOriginalId, apiKey, listsMetadata, skip, mdbListSortPrefs.sort, mdbListSortPrefs.order, false);
  }
  // console.warn removed for cleanliness, but you might want it back for ops debugging if needed
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
    let manifestListId = originalId;
    if (listInfo.source === 'mdblist') {
      manifestListId = originalId === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${originalId}-${listInfo.listType || 'L'}`;
    }

    if (removedListsSet.has(manifestListId) || removedListsSet.has(originalId)) {
      continue;
    }
    if (hiddenListsSet.has(manifestListId) || hiddenListsSet.has(originalId)) {
      continue;
    }

    let displayName = customListNames[manifestListId] || customListNames[originalId] || listInfo.name;
    const metadata = listsMetadata[originalId] || {};
    let hasMovies = metadata.hasMovies === true;
    let hasShows = metadata.hasShows === true;

    if (listInfo.source === 'trakt' && (metadata.hasMovies === undefined || metadata.hasShows === undefined )) {
        if (listInfo.isMovieList === true) { hasMovies = true; hasShows = false; }
        else if (listInfo.isShowList === true) { hasMovies = false; hasShows = true; }
    }
    if (typeof hasMovies !== 'boolean') hasMovies = false;
    if (typeof hasShows !== 'boolean') hasShows = false;

    if (hasMovies || hasShows) {
      const isMerged = mergedLists[manifestListId] !== false;
      if (hasMovies && hasShows && isMerged) {
        manifest.catalogs.push({ type: 'all', id: manifestListId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
      } else {
        if (hasMovies) {
          manifest.catalogs.push({ type: 'movie', id: manifestListId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        }
        if (hasShows) {
          manifest.catalogs.push({ type: 'series', id: manifestListId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        }
      }
    }
  }

  Object.values(importedAddons || {}).forEach(addon => {
    if (removedListsSet.has(String(addon.id))) {
      return;
    }
    (addon.catalogs || []).forEach(catalog => {
      const catalogIdForManifest = String(catalog.id);
      if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) {
        return;
      }
      let displayName = customListNames[catalogIdForManifest] || catalog.name;
      if (catalog.type === 'movie') {
        manifest.catalogs.push({ type: 'movie', id: catalogIdForManifest, name: displayName, extraSupported: catalog.extraSupported || ["skip"], extraRequired: catalog.extraRequired || [] });
      } else if (catalog.type === 'series') {
        manifest.catalogs.push({ type: 'series', id: catalogIdForManifest, name: displayName, extraSupported: catalog.extraSupported || ["skip"], extraRequired: catalog.extraRequired || [] });
      } else if (catalog.type === 'all') {
         manifest.catalogs.push({ type: 'all', id: catalogIdForManifest, name: displayName, extraSupported: catalog.extraSupported || ["skip"], extraRequired: catalog.extraRequired || [] });
      }
    });
  });
  
  if (listOrder && listOrder.length > 0) {
    const orderMap = new Map();
    listOrder.forEach((id, index) => { orderMap.set(String(id), index); });
    manifest.catalogs.sort((a, b) => {
        const indexA = orderMap.get(String(a.id));
        const indexB = orderMap.get(String(b.id));
        if (indexA !== undefined && indexB !== undefined) return indexA - indexB;
        if (indexA !== undefined) return -1;
        if (indexB !== undefined) return 1;
        return 0; 
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    const items = await fetchListContent(id, userConfig, skip);
    if (!items) return Promise.resolve({ metas: [] });
    let metas = await convertToStremioFormat(items, userConfig.rpdbApiKey);
    if (type !== 'all' && type !== 'movie' && type !== 'series') { /* handle unknown type */ }
    if (type !== 'all') { 
        metas = metas.filter(meta => meta.type === type);
    }
    return Promise.resolve({ metas, cacheMaxAge: isWatchlist(id) ? 0 : (5 * 60) });
  });

  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
    return Promise.resolve({ meta: { id, type, name: "Loading details..." } }); 
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };