// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists, fetchAllListsForUser } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');
const { staticGenres } = require('../config');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const METADATA_FETCH_RETRY_DELAY_MS = 5000;
const MAX_METADATA_FETCH_RETRIES = 2;
const DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS = 500;

// This function to get the manifest catalog NAME remains the same.
// It prioritizes the pencil-edit name, then the original name.
// The customMediaTypeNames will NOT be used for the catalog's "name" field.
const getManifestCatalogName = (listId, originalName, customListNames) => {
  const customPencilName = customListNames?.[listId]?.trim();
  if (customPencilName) {
    return customPencilName;
  }
  return originalName;
};


async function fetchListContent(listId, userConfig, skip = 0, genre = null, stremioCatalogType = 'all') {
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey, randomMDBListUsernames, enableRandomListFeature, customMediaTypeNames = {} } = userConfig;
  const catalogIdFromRequest = String(listId);
  
  // If a custom media type string is set (e.g. "Hi"), Stremio itself will handle it.
  // For fetching content, we still need to know if we should fetch movies, series or both.
  // The custom type implies "all" for content fetching purposes if Stremio's type is not 'movie' or 'series'.
  let itemTypeHintForFetching = stremioCatalogType;
  const customUserDefinedType = customMediaTypeNames?.[catalogIdFromRequest]?.trim();

  if (customUserDefinedType && customUserDefinedType.toLowerCase() !== 'movie' && customUserDefinedType.toLowerCase() !== 'series') {
    // If user defined a custom type like "Hi", for fetching purposes, we treat it as 'all'
    // unless Stremio is specifically asking for 'movie' or 'series' from this "Hi" catalog.
    if (stremioCatalogType !== 'movie' && stremioCatalogType !== 'series') {
        itemTypeHintForFetching = 'all';
    }
  } else if (stremioCatalogType === 'all') {
    itemTypeHintForFetching = null; // null often means fetch both for providers
  }


  let originalListIdForSortLookup = catalogIdFromRequest;
  const addonDetails = importedAddons?.[catalogIdFromRequest];
  const isUrlImport = addonDetails && (addonDetails.isMDBListUrlImport || addonDetails.isTraktPublicList);

  if (catalogIdFromRequest.startsWith('aiolists-') && (catalogIdFromRequest.includes('-L') || catalogIdFromRequest.includes('-E') || catalogIdFromRequest.includes('-W'))) {
    const parts = catalogIdFromRequest.split('-');
    if (parts.length >= 2) originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
  } else if (isUrlImport) {
    if (addonDetails.isMDBListUrlImport) originalListIdForSortLookup = addonDetails.mdblistId;
    else if (addonDetails.isTraktPublicList) originalListIdForSortLookup = addonDetails.id;
    else originalListIdForSortLookup = addonDetails.id;
  } else if (catalogIdFromRequest === 'random_mdblist_catalog') {
    originalListIdForSortLookup = 'random_mdblist_catalog';
  } else if (importedAddons) {
      let found = false;
      for (const addon of Object.values(importedAddons)) {
          if (addon.isMDBListUrlImport || addon.isTraktPublicList) continue;
          const foundCatalog = addon.catalogs?.find(c => c.id === catalogIdFromRequest);
          if (foundCatalog) {
              originalListIdForSortLookup = foundCatalog.originalId;
              found = true;
              break;
          }
      }
      if (!found && !originalListIdForSortLookup.startsWith('trakt_') && originalListIdForSortLookup !== 'random_mdblist_catalog') {
        originalListIdForSortLookup = catalogIdFromRequest;
      }
  }

  const sortPrefsForImportedOrRandom = userConfig.sortPreferences?.[originalListIdForSortLookup] ||
                               ( (catalogIdFromRequest.startsWith('traktpublic_') || (addonDetails?.isTraktPublicList && originalListIdForSortLookup?.startsWith('traktpublic_'))) ?
                                 { sort: 'rank', order: 'asc' } : { sort: 'default', order: 'desc' } );

  let itemsResult;

  if (catalogIdFromRequest === 'random_mdblist_catalog' && enableRandomListFeature && apiKey && randomMDBListUsernames && randomMDBListUsernames.length > 0) {
    const randomUsername = randomMDBListUsernames[Math.floor(Math.random() * randomMDBListUsernames.length)];
    const userLists = await fetchAllListsForUser(apiKey, randomUsername);
    if (userLists && userLists.length > 0) {
      const randomUserList = userLists[Math.floor(Math.random() * userLists.length)];
      const listIdentifierToFetch = randomUserList.slug || String(randomUserList.id);
      const randomCatalogSortPrefs = sortPreferences?.['random_mdblist_catalog'] || { sort: 'default', order: 'desc' };
      itemsResult = await fetchMDBListItems( listIdentifierToFetch, apiKey, {}, skip, randomCatalogSortPrefs.sort, randomCatalogSortPrefs.order, false, genre, randomUsername );
    } else {
      itemsResult = { allItems: [], hasMovies: false, hasShows: false };
    }
  }

  if (!itemsResult && isUrlImport) {
    const addonConfig = importedAddons[catalogIdFromRequest];
    if (addonConfig.isTraktPublicList) {
      itemsResult = await fetchTraktListItems( addonConfig.id, userConfig, skip, sortPrefsForImportedOrRandom.sort, sortPrefsForImportedOrRandom.order, true, addonConfig.traktUser, itemTypeHintForFetching, genre );
    } else if (addonConfig.isMDBListUrlImport && apiKey) {
      itemsResult = await fetchMDBListItems( addonConfig.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImportedOrRandom.sort, sortPrefsForImportedOrRandom.order, true, genre, null, userConfig.mergedLists?.[catalogIdFromRequest] !== false );
    }
  }

  if (!itemsResult && importedAddons) {
    for (const parentAddon of Object.values(importedAddons)) {
      if (parentAddon.isMDBListUrlImport || parentAddon.isTraktPublicList) continue;
      const catalogEntry = parentAddon.catalogs?.find(c => String(c.id) === String(catalogIdFromRequest));
      if (catalogEntry) {
        // For external addons, the itemTypeHintForFetching should respect Stremio's request primarily,
        // as the external addon handles its own content.
        itemsResult = await fetchExternalAddonItems( catalogEntry.originalId, catalogEntry.originalType, parentAddon, skip, rpdbApiKey, genre );
        break;
      }
    }
  }

  if (!itemsResult && catalogIdFromRequest.startsWith('trakt_') && !catalogIdFromRequest.startsWith('traktpublic_') && traktAccessToken) {
    let sortPrefs = sortPreferences?.[originalListIdForSortLookup] || (catalogIdFromRequest.startsWith('trakt_watchlist') ? { sort: 'added', order: 'desc'} : { sort: 'rank', order: 'asc' });
    if (catalogIdFromRequest === 'trakt_watchlist' && itemTypeHintForFetching === null) { sortPrefs.sort = 'added'; }
    
    let actualTraktItemTypeHint = itemTypeHintForFetching;
    // If specific trakt list implies a type (e.g., _movies, _shows), that should be respected for the Trakt API call.
    if (catalogIdFromRequest.includes("_movies")) actualTraktItemTypeHint = 'movie';
    else if (catalogIdFromRequest.includes("_shows")) actualTraktItemTypeHint = 'series';
    else if (catalogIdFromRequest === 'trakt_watchlist' && itemTypeHintForFetching === null) actualTraktItemTypeHint = 'all';
    // If custom type is set, for Trakt API, 'all' (or null) makes sense to get all items.
    if (customUserDefinedType && customUserDefinedType.toLowerCase() !== 'movie' && customUserDefinedType.toLowerCase() !== 'series') {
        actualTraktItemTypeHint = 'all';
    }


    itemsResult = await fetchTraktListItems( catalogIdFromRequest, userConfig, skip, sortPrefs.sort, sortPrefs.order, false, null, actualTraktItemTypeHint, genre );
  }

  if (!itemsResult && apiKey && catalogIdFromRequest.startsWith('aiolists-')) {
    const match = catalogIdFromRequest.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalIdFromCatalog = match ? match[1] : catalogIdFromRequest.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (catalogIdFromRequest === 'aiolists-watchlist-W') { mdbListOriginalIdFromCatalog = 'watchlist'; }
    const mdbListSortPrefs = sortPreferences?.[mdbListOriginalIdFromCatalog] || { sort: 'default', order: 'desc' };
    let sortForMdbList = mdbListSortPrefs.sort;
    if (mdbListOriginalIdFromCatalog === 'watchlist' && itemTypeHintForFetching === null) { sortForMdbList = 'added'; }
    const isListUserMerged = userConfig.mergedLists?.[catalogIdFromRequest] !== false;
    itemsResult = await fetchMDBListItems( mdbListOriginalIdFromCatalog, apiKey, listsMetadata, skip, sortForMdbList, mdbListSortPrefs.order, false, genre, null, isListUserMerged );
  }
  return itemsResult || null;
}


async function createAddon(userConfig) {
  const manifest = {
    id: 'org.stremio.aiolists',
    version: `1.0.3-${Date.now()}`,
    name: 'AIOLists',
    description: 'Manage all your lists in one place.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series', 'all', ...(Object.values(userConfig.customMediaTypeNames || {}) || []) ], // Add custom types to manifest
    idPrefixes: ['tt'],
    catalogs: [],
    logo: `https://i.imgur.com/DigFuAQ.png`,
    behaviorHints: { configurable: true, configurationRequired: false }
  };

  const {
    apiKey, traktAccessToken, listOrder = [], hiddenLists = [], removedLists = [],
    customListNames = {}, customMediaTypeNames = {}, mergedLists = {}, importedAddons = {}, listsMetadata = {},
    disableGenreFilter, enableRandomListFeature, randomMDBListUsernames
  } = userConfig;

  const includeGenresInManifest = !disableGenreFilter;
  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));

  if (enableRandomListFeature && apiKey && randomMDBListUsernames && randomMDBListUsernames.length > 0) {
    const randomCatalogId = 'random_mdblist_catalog';
    let randomCatalogDisplayName = getManifestCatalogName(randomCatalogId, "Discovery", customListNames); // Use the helper
    // If a custom media type name is set FOR the random catalog itself, it acts as its name.
     if (customMediaTypeNames?.[randomCatalogId]?.trim()){
        randomCatalogDisplayName = customMediaTypeNames[randomCatalogId].trim();
     }

    const randomCatalogExtra = [{ name: "skip" }];
    if (includeGenresInManifest) {
        randomCatalogExtra.push({ name: "genre", options: staticGenres });
    }
    manifest.catalogs.push({
        id: randomCatalogId,
        type: customMediaTypeNames?.[randomCatalogId]?.trim() || 'all', // Use custom type if set, else 'all'
        name: randomCatalogDisplayName,
        extra: randomCatalogExtra,
        extraSupported: randomCatalogExtra.map(e => e.name),
        extraRequired: []
    });
  }

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
      const listTypeSuffix = listInfo.listType || 'L';
      manifestListIdBase = listInfo.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${listInfo.id}-${listTypeSuffix}`;
    } else if (listInfo.source === 'trakt') {
      manifestListIdBase = listInfo.id;
    }

    if (removedListsSet.has(manifestListIdBase) || hiddenListsSet.has(manifestListIdBase)) {
      continue;
    }

    let displayName = getManifestCatalogName(manifestListIdBase, listInfo.name, customListNames);
    let hasMovies, hasShows;
    let canBeMerged = false;

    if (listInfo.source === 'mdblist') {
        const mediatype = listInfo.mediatype;
        const dynamic = listInfo.dynamic;
        hasMovies = (mediatype === 'movie' || !mediatype || mediatype === '');
        hasShows = (mediatype === 'show' || mediatype === 'series' || !mediatype || mediatype === '');
        canBeMerged = (dynamic === false || !mediatype || mediatype === '');

        if (!userConfig.listsMetadata) userConfig.listsMetadata = {};
        userConfig.listsMetadata[manifestListIdBase] = {
            ...(userConfig.listsMetadata[manifestListIdBase] || {}),
            hasMovies,
            hasShows,
            canBeMerged,
            lastChecked: new Date().toISOString()
        };
        if (apiKey) {
            await delay(100);
        }
    } else if (listInfo.source === 'trakt') {
      let metadata = { ...(listsMetadata[manifestListIdBase] || listsMetadata[originalId] || {}) };
      hasMovies = metadata.hasMovies === true; hasShows = metadata.hasShows === true; canBeMerged = true; // Trakt lists can always be merged conceptually
      if ((typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean' || metadata.errorFetching) && traktAccessToken) {
          let success = false; let fetchRetries = 0; if(metadata.errorFetching) delete metadata.errorFetching;
          while (!success && fetchRetries < MAX_METADATA_FETCH_RETRIES) {
               try {
                  const tempUserConfigForMetadata = { ...userConfig, listsMetadata: {}, rpdbApiKey: null, customMediaTypeNames: {} };
                  let typeForMetaCheck = 'all';
                  if (manifestListIdBase.startsWith('trakt_recommendations_') || manifestListIdBase.startsWith('trakt_trending_') || manifestListIdBase.startsWith('trakt_popular_')) {
                      if (manifestListIdBase.includes("_shows")) typeForMetaCheck = 'series'; else if (manifestListIdBase.includes("_movies")) typeForMetaCheck = 'movie';
                  }
                  if (manifestListIdBase === 'trakt_watchlist') typeForMetaCheck = 'all';
                  const content = await fetchListContent(manifestListIdBase, tempUserConfigForMetadata, 0, null, typeForMetaCheck);
                  hasMovies = content?.hasMovies || false; hasShows = content?.hasShows || false;
                  if (!userConfig.listsMetadata) userConfig.listsMetadata = {};
                  userConfig.listsMetadata[manifestListIdBase] = {
                      ...(userConfig.listsMetadata[manifestListIdBase] || {}), hasMovies, hasShows, canBeMerged: true, lastChecked: new Date().toISOString()
                  };
                  success = true;
              } catch (error) { fetchRetries++;
                  if (fetchRetries >= MAX_METADATA_FETCH_RETRIES) {
                      hasMovies = userConfig.listsMetadata[manifestListIdBase]?.hasMovies || false; hasShows = userConfig.listsMetadata[manifestListIdBase]?.hasShows || false;
                  } else { await delay(METADATA_FETCH_RETRY_DELAY_MS * Math.pow(2, fetchRetries - 1)); }
              }
          }
          if (traktAccessToken) await delay(DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS);
      }
  } else { hasMovies = false; hasShows = false; canBeMerged = false; }


  if (hasMovies || hasShows) {
    const isEffectivelyMergeable = canBeMerged && hasMovies && hasShows;
    const isUserMerged = isEffectivelyMergeable ? (mergedLists[manifestListIdBase] !== false) : false;
    const customUserDefinedType = customMediaTypeNames?.[manifestListIdBase]?.trim();

    const catalogExtra = [{ name: "skip" }];
    if (includeGenresInManifest) catalogExtra.push({ name: "genre", options: staticGenres });
    
    const finalCatalogProps = { name: displayName, extra: catalogExtra, extraSupported: catalogExtra.map(e=>e.name), extraRequired: []};

    if (customUserDefinedType) {
      // If user defined a type like "Hi", use that as the manifest type.
      manifest.catalogs.push({ id: manifestListIdBase, type: customUserDefinedType, ...finalCatalogProps });
    } else if (isUserMerged) {
      manifest.catalogs.push({ id: manifestListIdBase, type: 'all', ...finalCatalogProps });
    } else {
      // Not custom, not merged: create separate movie/series if content allows
      if (hasMovies) {
        manifest.catalogs.push({ id: manifestListIdBase, type: 'movie', ...finalCatalogProps });
      }
      if (hasShows) {
        manifest.catalogs.push({ id: manifestListIdBase, type: 'series', ...finalCatalogProps });
      }
    }
  }
}

Object.values(importedAddons || {}).forEach(addon => {
  const addonGroupId = String(addon.id);
  if (removedListsSet.has(addonGroupId) || hiddenListsSet.has(addonGroupId)) return;

  const isMDBListUrlImport = !!addon.isMDBListUrlImport;
  const isTraktPublicList = !!addon.isTraktPublicList;

  if (isMDBListUrlImport || isTraktPublicList) {
    if (isMDBListUrlImport && !apiKey) return;
    let urlImportHasMovies = addon.hasMovies;
    let urlImportHasShows = addon.hasShows;
    let urlImportCanBeMerged = true;

    if (urlImportHasMovies || urlImportHasShows) {
      let currentDisplayName = getManifestCatalogName(addonGroupId, addon.name, customListNames);
      
      const isEffectivelyMergeableForUrl = urlImportCanBeMerged && urlImportHasMovies && urlImportHasShows;
      const isUserMergedForUrl = isEffectivelyMergeableForUrl ? (mergedLists?.[addonGroupId] !== false) : false;
      const customUserDefinedType = customMediaTypeNames?.[addonGroupId]?.trim();

      const catalogExtraForUrlImport = [{ name: "skip" }];
      if (includeGenresInManifest) catalogExtraForUrlImport.push({ name: "genre", options: staticGenres });
      const catalogPropsForUrlImport = { name: currentDisplayName, extra: catalogExtraForUrlImport, extraSupported: catalogExtraForUrlImport.map(e=>e.name), extraRequired: []};

      if (customUserDefinedType) {
          manifest.catalogs.push({ id: addonGroupId, type: customUserDefinedType, ...catalogPropsForUrlImport });
      } else if (isUserMergedForUrl) {
        manifest.catalogs.push({ id: addonGroupId, type: 'all', ...catalogPropsForUrlImport });
      } else {
        if (urlImportHasMovies) {
          manifest.catalogs.push({ id: addonGroupId, type: 'movie', ...catalogPropsForUrlImport });
        }
        if (urlImportHasShows) {
          manifest.catalogs.push({ id: addonGroupId, type: 'series', ...catalogPropsForUrlImport });
        }
      }
    }
  } else if (addon.catalogs && addon.catalogs.length > 0) { 
     (addon.catalogs || []).forEach(catalog => {
        const catalogIdForManifest = String(catalog.id); 
        if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;

        let currentDisplayName = getManifestCatalogName(catalogIdForManifest, catalog.name, customListNames);
        const customUserDefinedType = customMediaTypeNames?.[catalogIdForManifest]?.trim();
        
        let subCatalogHasMovies = catalog.type === 'movie' || (catalog.type === 'all' && addon.types?.includes('movie'));
        let subCatalogHasShows = catalog.type === 'series' || catalog.type === 'tv' || (catalog.type === 'all' && (addon.types?.includes('series') || addon.types?.includes('tv')));
        const subCatalogCanBeMerged = subCatalogHasMovies && subCatalogHasShows;
        const subCatalogIsUserMerged = subCatalogCanBeMerged ? (mergedLists?.[catalogIdForManifest] !== false) : (catalog.type === 'all');

        let finalManifestType = catalog.type; 
        if (customUserDefinedType) {
          finalManifestType = customUserDefinedType;
        } else if (subCatalogIsUserMerged && subCatalogCanBeMerged && catalog.type === 'all') {
          finalManifestType = 'all';
        } else if (catalog.type === 'all' && !(subCatalogHasMovies && subCatalogHasShows)) { 
          if (subCatalogHasMovies) finalManifestType = 'movie';
          else if (subCatalogHasShows) finalManifestType = 'series';
          else finalManifestType = 'all'; 
        }
        // If the original catalog.type is 'movie' or 'series', it remains that unless a custom type is set.

        const finalExtraForImported = [{ name: "skip" }];
        // ... (extra processing remains)
        const originalExtras = (catalog.extraSupported || catalog.extra || []);
        let importedGenreOptions = null;
        originalExtras.forEach(ext => {
            const extName = (typeof ext === 'string') ? ext : ext.name;
            const extOptions = (typeof ext === 'object' && ext.options) ? ext.options : undefined;
            if (extName === "skip") return;
            if (extName === "genre") { if (extOptions) importedGenreOptions = extOptions; return; }
            if (typeof ext === 'string') finalExtraForImported.push({ name: ext });
            else finalExtraForImported.push({ name: extName, options: extOptions, isRequired: (typeof ext === 'object' && ext.isRequired) ? ext.isRequired : false });
        });
        if (includeGenresInManifest) {
            finalExtraForImported.push({ name: "genre", options: importedGenreOptions || staticGenres });
        }


        manifest.catalogs.push({ 
          id: catalogIdForManifest, 
          type: finalManifestType, 
          name: currentDisplayName, 
          extra: finalExtraForImported, 
          extraSupported: [...new Set(finalExtraForImported.map(e => e.name))], // Ensure unique names
          extraRequired: catalog.extraRequired || [] 
        });
    });
  }
});

const builder = new addonBuilder(manifest);
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const skip = parseInt(extra?.skip) || 0;
  const genre = extra?.genre || null;
  
  let contentTypeToFetch = type;
  if (type !== 'movie' && type !== 'series') {
      contentTypeToFetch = 'all';
  }

  const itemsResult = await fetchListContent(id, userConfig, skip, genre, contentTypeToFetch);
  if (!itemsResult) return Promise.resolve({ metas: [] });

  let metas = await convertToStremioFormat(itemsResult, userConfig.rpdbApiKey);

  if ((type === 'movie' || type === 'series') && (contentTypeToFetch === 'all')) {
      metas = metas.filter(meta => meta.type === type);
  }
  
  const cacheMaxAge = (id === 'random_mdblist_catalog' || isWatchlist(id)) ? 0 : (5 * 60);
  return Promise.resolve({ metas, cacheMaxAge });
});
 builder.defineMetaHandler(({ type, id }) => {
  if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
  return Promise.resolve({ meta: { id, type, name: "Loading details..." } });
});

return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };
