const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');
const { staticGenres } = require('../config'); // Import static genres

// Removed getUniqueGenres helper as it's no longer needed for manifest generation here

async function fetchListContent(listId, userConfig, skip = 0, genre = null) { // Added genre parameter
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey, tmdbApiKey } = userConfig;
  let originalListIdForSortLookup = listId;

  // Logic to determine originalListIdForSortLookup (remains the same)
  if (listId.startsWith('aiolists-') && (listId.includes('-L') || listId.includes('-E') || listId.includes('-W'))) {
    const parts = listId.split('-');
    if (parts.length >= 2) {
      originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
    }
  } else if (listId.startsWith('trakt_') || listId.startsWith('tmdb_') || listId.startsWith('simkl_')) {
    originalListIdForSortLookup = listId;
  } else if (importedAddons) {
      const foundAddonEntry = Object.values(importedAddons).find(addon => {
        if (addon.id === listId) return true; 
        return addon.catalogs && addon.catalogs.find(c => c.id === listId);
      });
      if (foundAddonEntry) {
          if (foundAddonEntry.id === listId && (foundAddonEntry.isUrlImported)) {
            originalListIdForSortLookup = foundAddonEntry.mdblistId || (foundAddonEntry.isTraktPublicList ? `traktpublic_${foundAddonEntry.traktUser}_${foundAddonEntry.traktListSlug}`: foundAddonEntry.id);
          } else {
            const foundCatalog = foundAddonEntry.catalogs?.find(c => c.id === listId);
            if (foundCatalog && foundCatalog.originalId) {
                originalListIdForSortLookup = foundCatalog.originalId;
            } else if (foundCatalog) {
                originalListIdForSortLookup = foundCatalog.id; // Fallback if originalId is missing in processed catalog
            }
          }
      }
  }


  const sortPrefsForImported = userConfig.sortPreferences?.[originalListIdForSortLookup] ||
                               ( (importedAddons[originalListIdForSortLookup]?.isTraktPublicList) ?
                                 { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' } );

  let itemsResult;

  if (importedAddons) {
    const addonGroup = importedAddons[listId]; 
    if (addonGroup && addonGroup.isUrlImported && addonGroup.hasMovies && addonGroup.hasShows) {
        if (addonGroup.isMDBListUrlImport && apiKey) {
            itemsResult = await fetchMDBListItems(addonGroup.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, genre);
        } else if (addonGroup.isTraktPublicList) {
            itemsResult = await fetchTraktListItems(addonGroup.listId, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, addonGroup.traktUser, null, genre);
        }
    } else { 
        for (const addon of Object.values(importedAddons)) {
          if (!addon.catalogs && !(addon.isUrlImported && (addon.hasMovies || addon.hasShows) && !(addon.hasMovies && addon.hasShows))) continue;
          
          if (addon.id === listId && addon.isUrlImported && (addon.hasMovies || addon.hasShows) && !(addon.hasMovies && addon.hasShows) ) {
             if (addon.isMDBListUrlImport && apiKey) {
                itemsResult = await fetchMDBListItems(addon.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, genre); 
                break;
            } else if (addon.isTraktPublicList) {
                const itemTypeHint = addon.hasMovies ? 'movie' : (addon.hasShows ? 'series' : null);
                itemsResult = await fetchTraktListItems(addon.listId, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order, true, addon.traktUser, itemTypeHint, genre); 
                break;
            }
          }
    
          const catalog = addon.catalogs?.find(c => String(c.id) === String(listId));
          if (catalog) {
            // originalListIdForSortLookup for sub-catalogs is catalog.originalId
            const subCatalogSortPrefs = userConfig.sortPreferences?.[catalog.originalId] || { sort: 'imdbvotes', order: 'desc' };

            if (addon.isMDBListUrlImport && apiKey) { // This condition might be mutually exclusive with catalog finding from non-URL import
               itemsResult = await fetchMDBListItems(catalog.originalId, apiKey, listsMetadata, skip, subCatalogSortPrefs.sort, subCatalogSortPrefs.order, true, genre); 
            } else if (addon.isTraktPublicList) {
               const itemTypeHint = catalog.type; // Use the type from the processed catalog
               itemsResult = await fetchTraktListItems(catalog.originalId, userConfig, skip, subCatalogSortPrefs.sort, subCatalogSortPrefs.order, true, addon.traktUser, itemTypeHint, genre);
            } else if (!addon.isUrlImported) { // True external addon (not a URL import)
              itemsResult = await fetchExternalAddonItems(catalog.originalId, catalog.originalType, addon, skip, userConfig.rpdbApiKey, genre);
            }
            break; 
          }
        }
    }
  }
  
  if (!itemsResult) { 
    const sortPrefs = userConfig.sortPreferences?.[originalListIdForSortLookup] ||
                      ( (listId.startsWith('trakt_') || listId.startsWith('traktpublic_')) ?
                        { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' } );

    if (listId.startsWith('trakt_') && traktAccessToken) {
      let itemTypeHint = null;
      if (listId.includes("_movies")) itemTypeHint = 'movie';
      if (listId.includes("_shows")) itemTypeHint = 'series';
      itemsResult = await fetchTraktListItems(listId, userConfig, skip, sortPrefs.sort, sortPrefs.order, false, null, itemTypeHint, genre);
    } else if (apiKey && listId.startsWith('aiolists-')) {
      const match = listId.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
      let mdbListOriginalId = match ? match[1] : listId.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
      if (listId === 'aiolists-watchlist-W') {
          mdbListOriginalId = 'watchlist';
      }
      const mdbListSortPrefs = userConfig.sortPreferences?.[mdbListOriginalId] || { sort: 'imdbvotes', order: 'desc' };
      itemsResult = await fetchMDBListItems(mdbListOriginalId, apiKey, listsMetadata, skip, mdbListSortPrefs.sort, mdbListSortPrefs.order, false, genre);
    }
  }

  return itemsResult || null;
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

  // REMOVED: The block that pre-fetched allCatalogMetas for dynamic genres.
  // We will now use staticGenres.

  for (const listInfo of activeListsInfo) {
    const originalId = String(listInfo.originalId);
    let manifestListIdBase = originalId;

    if (listInfo.source === 'mdblist') {
      manifestListIdBase = originalId === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${originalId}-${listInfo.listType || 'L'}`;
    } else if (listInfo.source === 'trakt') {
      manifestListIdBase = originalId;
    }

    if (removedListsSet.has(manifestListIdBase) || removedListsSet.has(originalId) || hiddenListsSet.has(manifestListIdBase) || hiddenListsSet.has(originalId)) {
      continue;
    }

    let displayName = customListNames[manifestListIdBase] || customListNames[originalId] || listInfo.name;
    let metadata = listsMetadata[manifestListIdBase] || listsMetadata[originalId] || {};

    let hasMovies = metadata.hasMovies === true;
    let hasShows = metadata.hasShows === true;

    // This block remains: fetch content IF hasMovies/hasShows metadata is missing.
    if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
        // Use a config that won't make further poster/RPDB calls during this metadata check
        const tempUserConfigForMetadata = { ...userConfig, rpdbApiKey: null };
        const content = await fetchListContent(manifestListIdBase, tempUserConfigForMetadata, 0);
        hasMovies = content?.hasMovies || false;
        hasShows = content?.hasShows || false;
        if (!userConfig.listsMetadata) userConfig.listsMetadata = {}; // Ensure listsMetadata exists
        userConfig.listsMetadata[manifestListIdBase] = { ...userConfig.listsMetadata[manifestListIdBase], hasMovies, hasShows };
        // Note: This mutation to userConfig.listsMetadata won't be saved back to the client's config hash
        // immediately unless the manifest generation itself triggers a config save.
        // This is primarily for the current manifest generation.
    }

    if (hasMovies || hasShows) {
      const isMerged = mergedLists[manifestListIdBase] !== false;
      
      const catalogBase = {
        id: manifestListIdBase,
        name: displayName,
        extraSupported: ["skip", "genre"],
        extraRequired: [],
        genres: staticGenres // Use static genres
      };

      if (hasMovies && hasShows && isMerged) {
        manifest.catalogs.push({ ...catalogBase, type: 'all' });
      } else {
        if (hasMovies) manifest.catalogs.push({ ...catalogBase, type: 'movie' });
        if (hasShows) manifest.catalogs.push({ ...catalogBase, type: 'series' });
      }
    }
  }

  Object.values(importedAddons || {}).forEach(addon => {
    const addonGroupId = String(addon.id);
    if (removedListsSet.has(addonGroupId) || hiddenListsSet.has(addonGroupId)) return;

    const catalogBaseProps = {
        extraSupported: ["skip", "genre"],
        extraRequired: [],
        genres: staticGenres // Use static genres
    };

    if (addon.isUrlImported) { // For lists imported via URL
        if (addon.hasMovies || addon.hasShows) {
            let displayName = customListNames[addonGroupId] || addon.name;
            const isMerged = (addon.hasMovies && addon.hasShows) ? (userConfig.mergedLists?.[addonGroupId] !== false) : false;

            if (isMerged) {
                manifest.catalogs.push({ ...catalogBaseProps, type: 'all', id: addonGroupId, name: displayName });
            } else {
                if (addon.hasMovies) manifest.catalogs.push({ ...catalogBaseProps, type: 'movie', id: addonGroupId, name: displayName });
                if (addon.hasShows) manifest.catalogs.push({ ...catalogBaseProps, type: 'series', id: addonGroupId, name: displayName });
            }
        }
    } else if (addon.catalogs && addon.catalogs.length > 0) { // For addons imported via manifest URL
        (addon.catalogs || []).forEach(catalog => {
            const catalogIdForManifest = String(catalog.id);
            if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;
            
            let displayName = customListNames[catalogIdForManifest] || catalog.name;
            manifest.catalogs.push({
                type: catalog.type, 
                id: catalogIdForManifest,
                name: displayName,
                extraSupported: catalog.extraSupported ? [...new Set([...catalog.extraSupported, "skip", "genre"])] : ["skip", "genre"],
                extraRequired: catalog.extraRequired || [],
                genres: staticGenres // Use static genres for sub-catalogs too
            });
        });
    }
  });

  // Sorting logic for manifest catalogs (remains the same)
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
    const genre = extra?.genre || null;
    
    const baseListIdToFetch = id;
    const typeToFilterBy = type;

    const itemsResult = await fetchListContent(baseListIdToFetch, userConfig, skip, genre);
    
    let metas = [];
    if (itemsResult) { // Check if itemsResult is not null
        metas = await convertToStremioFormat(itemsResult, userConfig.rpdbApiKey);
    } else {
        return Promise.resolve({ metas: [] }); // No content found or error in fetchListContent
    }


    if (typeToFilterBy !== 'all') {
        metas = metas.filter(meta => meta.type === typeToFilterBy);
    }
    
    // Fallback genre filtering: This is applied if the source fetching (fetchListContent -> specific fetcher)
    // did not already filter by genre (e.g., MDBList, Trakt user lists).
    // For Trakt Recommendation/Trending/Popular, genre filtering is done by Trakt API, so this might be redundant for them.
    if (genre && metas.length > 0) {
        const needsFiltering = metas.some(meta => !(meta.genres && meta.genres.includes(genre)));
        if (needsFiltering) {
            metas = metas.filter(meta => meta.genres && meta.genres.includes(genre));
        }
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