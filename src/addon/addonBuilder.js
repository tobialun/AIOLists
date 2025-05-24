// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');


async function fetchListContent(listId, userConfig, skip = 0) {
  // listId is expected to be the base ID of the list, e.g., "aiolists-watchlist-W", "trakt_watchlist"
  // console.log(`[AIOLists Debug] fetchListContent called with listId: ${listId}`);
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey, tmdbApiKey } = userConfig;
  let originalListIdForSortLookup = listId; // Default to the passed listId

  // Determine the originalListId for fetching sort preferences more accurately
  if (listId.startsWith('aiolists-') && (listId.includes('-L') || listId.includes('-E') || listId.includes('-W'))) {
    const parts = listId.split('-');
    if (parts.length >= 2) {
      originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
    }
  } else if (listId.startsWith('trakt_') || listId.startsWith('tmdb_') || listId.startsWith('simkl_')) {
    // For these, the listId itself is usually the key for sort preferences unless it's from an import
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


  const isPotentiallyTrakt = originalListIdForSortLookup.startsWith('trakt_') || originalListIdForSortLookup.startsWith('traktpublic_');
  const defaultSort = isPotentiallyTrakt ? { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' };
  const sortPrefs = userConfig.sortPreferences?.[originalListIdForSortLookup] || defaultSort;

  // Handling for imported addons (these typically have unique catalog.id values already)
  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      if (!addon.catalogs) continue;
      // `listId` here is the full unique catalog ID from the manifest (e.g. traktpublic_user_list_movies)
      const catalog = addon.catalogs.find(c => String(c.id) === String(listId));
      if (catalog) {
        if (addon.isMDBListUrlImport && apiKey) {
          return fetchMDBListItems(catalog.originalId, apiKey, listsMetadata, skip, sortPrefs.sort, sortPrefs.order, true);
        } else if (addon.isTraktPublicList) {
           const itemTypeHint = catalog.type; // 'movie' or 'series' from the catalog definition
          return fetchTraktListItems(`trakt_${catalog.originalId}`, userConfig, skip, sortPrefs.sort, sortPrefs.order, true, addon.traktUser, itemTypeHint);
        }
        else if (!addon.isMDBListUrlImport && !addon.isTraktPublicList) { // Standard external addon
          return fetchExternalAddonItems(catalog.originalId || catalog.id, addon, skip, rpdbApiKey);
        }
      }
    }
  }

  // Direct list fetching
  // listId here is the base ID (e.g., "aiolists-watchlist-W", "trakt_watchlist")
  if (listId.startsWith('trakt_') && traktAccessToken) {
    // For base Trakt lists, fetchTraktListItems usually gets all content.
    // Filtering happens in catalog handler. `itemTypeHint` is for specific Trakt API behaviors.
    let itemTypeHint = null;
    // Example: if listId was 'trakt_recommendations_movies', fetchTraktListItems handles it.
    // If listId is 'trakt_watchlist', itemTypeHint remains null to fetch all.
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
        if (listInfo.source === 'trakt') {
            if (listInfo.isTraktWatchlist || manifestListIdBase === 'trakt_watchlist') {
                const content = await fetchTraktListItems(manifestListIdBase, userConfig, 0);
                hasMovies = content?.hasMovies || false;
                hasShows = content?.hasShows || false;
            } else if (manifestListIdBase.endsWith("_movies") || listInfo.isMovieList) {
                hasMovies = true; hasShows = false;
            } else if (manifestListIdBase.endsWith("_shows") || manifestListIdBase.endsWith("_series") || listInfo.isShowList) {
                hasMovies = false; hasShows = true;
            } else {
                const content = await fetchTraktListItems(manifestListIdBase, userConfig, 0);
                hasMovies = content?.hasMovies || false;
                hasShows = content?.hasShows || false;
            }
        } else if (listInfo.source === 'mdblist') {
            const content = await fetchMDBListItems(originalId, apiKey, listsMetadata, 0, 'imdbvotes', 'desc', false);
            hasMovies = content?.hasMovies || false;
            hasShows = content?.hasShows || false;
        }
    }

    if (hasMovies || hasShows) {
      const isMerged = mergedLists[manifestListIdBase] !== false;

      if (hasMovies && hasShows && isMerged) {
        // MERGED: Create a single 'all' catalog using the base ID
        manifest.catalogs.push({
          type: 'all',
          id: manifestListIdBase, // Use the base ID
          name: displayName,
          extraSupported: ["skip"],
          extraRequired: []
        });
      } else { // SPLIT or single-type list
        if (hasMovies) {
          // For SPLIT lists, use the SAME base ID, but with type 'movie'
          // For lists that are naturally movies-only, use their base ID and type 'movie'
          manifest.catalogs.push({
            type: 'movie',
            id: manifestListIdBase, // Use the base ID
            name: displayName, // Potentially: `${displayName} (Movies)` if you want to differentiate by name
            extraSupported: ["skip"],
            extraRequired: []
          });
        }
        if (hasShows) {
          // For SPLIT lists, use the SAME base ID, but with type 'series'
          // For lists that are naturally series-only, use their base ID and type 'series'
          manifest.catalogs.push({
            type: 'series',
            id: manifestListIdBase, // Use the base ID
            name: displayName, // Potentially: `${displayName} (Series)`
            extraSupported: ["skip"],
            extraRequired: []
          });
        }
      }
    }
  }

  Object.values(importedAddons || {}).forEach(addon => {
    if (removedListsSet.has(String(addon.id))) return;
    (addon.catalogs || []).forEach(catalog => {
      const catalogIdForManifest = String(catalog.id);
      if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;
      let displayName = customListNames[catalogIdForManifest] || catalog.name;
      manifest.catalogs.push({
        type: catalog.type, // Imported addons already have distinct types and IDs
        id: catalogIdForManifest,
        name: displayName,
        extraSupported: catalog.extraSupported || ["skip"],
        extraRequired: catalog.extraRequired || []
      });
    });
  });

  if (listOrder && listOrder.length > 0) {
    const orderMap = new Map(listOrder.map((id, index) => [String(id), index]));
    manifest.catalogs.sort((a, b) => {
      const catalogIdA = String(a.id); // This ID is now the base ID for split lists
      const catalogIdB = String(b.id);

      const indexA = orderMap.get(catalogIdA);
      const indexB = orderMap.get(catalogIdB);

      if (indexA !== undefined && indexB !== undefined) {
        if (indexA !== indexB) return indexA - indexB;
        // If IDs are the same (e.g., "aiolists-watchlist-W" for both movie and series catalogs),
        // sort by type: movie before series.
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
    // console.log(`[AIOLists Debug] Catalog Handler received: type=${type}, id=${id}`);
    const skip = parseInt(extra?.skip) || 0;
    
    // With the new manifest strategy, 'id' is the baseListId, and 'type' is the specific type.
    // No suffix stripping is needed here anymore for your primary lists.
    const baseListIdToFetch = id; 
    const typeToFilterBy = type;

    // Suffix stripping might still be relevant if you have imported addons
    // that use a _movies/_series suffix pattern in their *catalog.id* values.
    // For this example, we assume `id` from your primary lists is already the base ID.

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