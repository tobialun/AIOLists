// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');


async function fetchListContent(listId, userConfig, skip = 0) {
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey, tmdbApiKey /*, simklAccessToken */ } = userConfig;
  let originalListIdForSortLookup = listId;

  if (listId.startsWith('aiolists-') && (listId.includes('-L') || listId.includes('-E') || listId.includes('-W'))) {
    const parts = listId.split('-');
    if (parts.length >= 2) {
      originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
    }
  } else if ((listId.startsWith('trakt_') || listId.startsWith('tmdb_') || listId.startsWith('simkl_')) &&
             !listId.includes('_movies') && !listId.includes('_series') && !listId.includes('_shows') /* simkl uses shows */) {
    originalListIdForSortLookup = listId;
  } else if (importedAddons) {
      const foundAddonEntry = Object.values(importedAddons).find(addon => addon.catalogs && addon.catalogs.find(c => c.id === listId));
      if (foundAddonEntry) {
          const foundCatalog = foundAddonEntry.catalogs.find(c => c.id === listId);
          if (foundCatalog && foundCatalog.originalId) {
              originalListIdForSortLookup = foundCatalog.originalId;
          }
      }
  }


  const isPotentiallyTrakt = listId.startsWith('trakt_') || listId.startsWith('traktpublic_') ||
                             (importedAddons && Object.values(importedAddons).some(a => a.isTraktPublicList && a.catalogs && a.catalogs.find(c => c.id === listId)));
  const defaultSort = isPotentiallyTrakt ? { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' };
  const sortPrefs = userConfig.sortPreferences?.[originalListIdForSortLookup] || defaultSort;

  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      if (!addon.catalogs) continue;
      const catalog = addon.catalogs.find(c => String(c.id) === String(listId));
      if (catalog) {
        if (addon.isMDBListUrlImport && apiKey) {
          return fetchMDBListItems(catalog.originalId, apiKey, listsMetadata, skip, sortPrefs.sort, sortPrefs.order, true);
        } else if (addon.isTraktPublicList) {
           const type = catalog.id.endsWith('_movies') ? 'movie' : (catalog.id.endsWith('_series') ? 'series' : null);
          return fetchTraktListItems(`trakt_${catalog.originalId}`, userConfig, skip, sortPrefs.sort, sortPrefs.order, true, addon.traktUser, type);
        }
        else if (!addon.isMDBListUrlImport && !addon.isTraktPublicList /* && !addon.isTmdbUrlImport etc. */) {
          return fetchExternalAddonItems(catalog.originalId || catalog.id, addon, skip, rpdbApiKey);
        }
      }
    }
  }

  // Direct list fetching
  if (listId.startsWith('trakt_') && traktAccessToken) {
    let itemTypeForTraktSpecial = null; // For specific catalogs like trakt_watchlist_movies
    if (listId.startsWith('trakt_watchlist_')) { // e.g. trakt_watchlist_movies
        itemTypeForTraktSpecial = listId.endsWith('_movies') ? 'movie' : (listId.endsWith('_series') || listId.endsWith('_shows') ? 'series' : null);
    } else if (listId.includes("_movies")) itemTypeForTraktSpecial = "movie";
    else if (listId.includes("_shows") || listId.includes("_series")) itemTypeForTraktSpecial = "series"; // broader check
    return fetchTraktListItems(listId, userConfig, skip, sortPrefs.sort, sortPrefs.order, false, null, itemTypeForTraktSpecial);
  }
  if (apiKey && listId.startsWith('aiolists-')) { // MDBList user lists
    const match = listId.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalId = match ? match[1] : listId.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (listId === 'aiolists-watchlist-W') mdbListOriginalId = 'watchlist';
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
    apiKey, traktAccessToken, tmdbApiKey, /* simklAccessToken, */
    listOrder = [],
    hiddenLists = [],
    removedLists = [],
    customListNames = {},
    mergedLists = {},
    importedAddons = {},
    listsMetadata = {} // This should be populated by the /lists endpoint primarily
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
    const originalId = String(listInfo.originalId); // e.g., trakt_watchlist, mblist_123, simkl_plantowatch/shows
    let manifestListId = originalId;

    if (listInfo.source === 'mdblist') {
      manifestListId = originalId === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${originalId}-${listInfo.listType || 'L'}`;
    }
    if (listInfo.source === 'simkl' || listInfo.source === 'simkl_custom') {
        manifestListId = listInfo.id; // Use the ID generated in fetchSimklLists
    }


    if (removedListsSet.has(manifestListId) || removedListsSet.has(originalId)) {
      continue;
    }
    if (hiddenListsSet.has(manifestListId) || hiddenListsSet.has(originalId)) {
      continue;
    }

    let displayName = customListNames[manifestListId] || customListNames[originalId] || listInfo.name;
    let metadata = listsMetadata[manifestListId] || listsMetadata[originalId] || {}; // Check both IDs

    let hasMovies = metadata.hasMovies === true;
    let hasShows = metadata.hasShows === true;

    // If metadata is missing, try to determine it, especially for Trakt Watchlist
    if (listInfo.source === 'trakt' && listInfo.isTraktWatchlist && (metadata.hasMovies === undefined || metadata.hasShows === undefined)) {
        const watchlistContent = await fetchTraktListItems('trakt_watchlist', userConfig, 0);
        hasMovies = watchlistContent?.hasMovies || false;
        hasShows = watchlistContent?.hasShows || false;
    } else if (listInfo.source === 'trakt') { // Other Trakt lists (recommendations, trending, custom)
        if (listInfo.isMovieList === true) { hasMovies = true; hasShows = false; }
        else if (listInfo.isShowList === true) { hasMovies = false; hasShows = true; }
    } else if (listInfo.source === 'simkl' || listInfo.source === 'simkl_custom') {
        if (metadata.hasMovies === undefined && metadata.hasShows === undefined) {
            hasMovies = listInfo.simklMediaType === 'movies' || (listInfo.simklListObject && listInfo.simklListObject.stats?.movie_count > 0);
            hasShows = listInfo.simklMediaType === 'shows' || listInfo.simklMediaType === 'anime' || (listInfo.simklListObject && (listInfo.simklListObject.stats?.show_count > 0 || listInfo.simklListObject.stats?.anime_count > 0));
        }
    }
    // Fallback if still undefined
    if (typeof hasMovies !== 'boolean') hasMovies = listInfo.hasMovies === true; // Use listInfo as fallback
    if (typeof hasShows !== 'boolean') hasShows = listInfo.hasShows === true;   // Use listInfo as fallback


    if (hasMovies || hasShows) {
      const isMerged = mergedLists[manifestListId] !== false; // Default to merged
      if (hasMovies && hasShows && isMerged) {
        manifest.catalogs.push({ type: 'all', id: manifestListId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
      } else {
        if (hasMovies) {
          const movieListName = (hasMovies && hasShows && !isMerged) ? `${displayName} (Movies)` : displayName;
          // Ensure unique ID if splitting
          const movieListId = (hasMovies && hasShows && !isMerged) ? `${manifestListId}_movies` : manifestListId;
          manifest.catalogs.push({ type: 'movie', id: movieListId, name: movieListName, extraSupported: ["skip"], extraRequired: [] });
        }
        if (hasShows) {
          const seriesListName = (hasMovies && hasShows && !isMerged) ? `${displayName} (Series)` : displayName;
          const seriesListId = (hasMovies && hasShows && !isMerged) ? `${manifestListId}_series` : manifestListId; // or _shows
          manifest.catalogs.push({ type: 'series', id: seriesListId, name: seriesListName, extraSupported: ["skip"], extraRequired: [] });
        }
      }
    }
  }

  // Process imported addons (URL imports and manifest imports)
  Object.values(importedAddons || {}).forEach(addon => {
    if (removedListsSet.has(String(addon.id))) { // addon.id is the group ID
      return;
    }
    (addon.catalogs || []).forEach(catalog => {
      const catalogIdForManifest = String(catalog.id); // This is the unique ID like traktpublic_user_slug_movies
      if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) {
        return;
      }
      let displayName = customListNames[catalogIdForManifest] || catalog.name;
      manifest.catalogs.push({
        type: catalog.type, // 'movie', 'series', or potentially 'all' if the source addon provided it
        id: catalogIdForManifest,
        name: displayName,
        extraSupported: catalog.extraSupported || ["skip"],
        extraRequired: catalog.extraRequired || []
      });
    });
  });

  if (listOrder && listOrder.length > 0) {
    const orderMap = new Map();
    listOrder.forEach((id, index) => { orderMap.set(String(id), index); });

    manifest.catalogs.sort((a, b) => {
        const idA = String(a.id).replace(/_movies$|_series$|_shows$/, ''); // Get base ID for sorting
        const idB = String(b.id).replace(/_movies$|_series$|_shows$/, '');
        const indexA = orderMap.get(idA);
        const indexB = orderMap.get(idB);

        if (indexA !== undefined && indexB !== undefined) {
            if (indexA !== indexB) return indexA - indexB;
            if (a.id.endsWith('_movies') && (b.id.endsWith('_series') || b.id.endsWith('_shows'))) return -1;
            if ((a.id.endsWith('_series') || a.id.endsWith('_shows')) && b.id.endsWith('_movies')) return 1;
            return 0;
        }
        if (indexA !== undefined) return -1;
        if (indexB !== undefined) return 1;
        return 0;
    });
  }


  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    let baseListId = id;
    let forcedType = type;

    if (id.endsWith('_movies')) {
        baseListId = id.substring(0, id.length - '_movies'.length);
        forcedType = 'movie';
    } else if (id.endsWith('_series') || id.endsWith('_shows')) {
        baseListId = id.substring(0, id.length - (id.endsWith('_series') ? '_series'.length : '_shows'.length));
        forcedType = 'series';
    }
    if (id.startsWith('trakt_watchlist_')) {
        baseListId = 'trakt_watchlist';
    }


    const items = await fetchListContent(baseListId, userConfig, skip); // Pass baseListId
    if (!items) return Promise.resolve({ metas: [] });

    let metas = await convertToStremioFormat(items, userConfig.rpdbApiKey);
    if (forcedType !== 'all') {
        metas = metas.filter(meta => meta.type === forcedType);
    }
    return Promise.resolve({ metas, cacheMaxAge: isWatchlist(baseListId) ? 0 : (5 * 60) });
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