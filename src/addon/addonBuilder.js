// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists, initTraktApi } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists, fetchAllListsForUser } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');
const { staticGenres } = require('../config');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const METADATA_FETCH_RETRY_DELAY_MS = 5000;
const MAX_METADATA_FETCH_RETRIES = 2;
const DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS = 500;

const getManifestCatalogName = (listId, originalName, customListNames) => {
  const customPencilName = customListNames?.[listId]?.trim();
  if (customPencilName) {
    return customPencilName;
  }
  return originalName;
};

async function fetchListContent(listId, userConfig, skip = 0, genre = null, stremioCatalogType = 'all') {
  const catalogIdFromRequest = String(listId);

  if (catalogIdFromRequest.startsWith('trakt_') && !catalogIdFromRequest.startsWith('traktpublic_')) {
    await initTraktApi(userConfig);
  }

  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey, randomMDBListUsernames, enableRandomListFeature, customMediaTypeNames = {} } = userConfig;
  
  let itemTypeHintForFetching = (stremioCatalogType === 'movie' || stremioCatalogType === 'series') ? stremioCatalogType : 'all';

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
      const isListUserMerged = userConfig.mergedLists?.[catalogIdFromRequest] !== false;
      itemsResult = await fetchMDBListItems( addonConfig.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImportedOrRandom.sort, sortPrefsForImportedOrRandom.order, true, genre, null, isListUserMerged );
    }
  }

  if (!itemsResult && importedAddons) {
    for (const parentAddon of Object.values(importedAddons)) {
      if (parentAddon.isMDBListUrlImport || parentAddon.isTraktPublicList) continue;
      const catalogEntry = parentAddon.catalogs?.find(c => String(c.id) === String(catalogIdFromRequest));
      if (catalogEntry) {
        itemsResult = await fetchExternalAddonItems( catalogEntry.originalId, catalogEntry.originalType, parentAddon, skip, rpdbApiKey, genre );
        break;
      }
    }
  }

  if (!itemsResult && catalogIdFromRequest.startsWith('trakt_') && !catalogIdFromRequest.startsWith('traktpublic_') && traktAccessToken) {
    let sortPrefs = sortPreferences?.[originalListIdForSortLookup] || (catalogIdFromRequest.startsWith('trakt_watchlist') ? { sort: 'added', order: 'desc'} : { sort: 'rank', order: 'asc' });
    if (catalogIdFromRequest === 'trakt_watchlist' && itemTypeHintForFetching === 'all') { sortPrefs.sort = 'added'; } 
    
    let actualTraktItemTypeHint = itemTypeHintForFetching;
    if (itemTypeHintForFetching === 'all') {
        if (catalogIdFromRequest.includes("_movies")) actualTraktItemTypeHint = 'movie';
        else if (catalogIdFromRequest.includes("_shows")) actualTraktItemTypeHint = 'series';
    }
    itemsResult = await fetchTraktListItems( catalogIdFromRequest, userConfig, skip, sortPrefs.sort, sortPrefs.order, false, null, actualTraktItemTypeHint, genre );
  }

  if (!itemsResult && apiKey && catalogIdFromRequest.startsWith('aiolists-')) {
    const match = catalogIdFromRequest.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalIdFromCatalog = match ? match[1] : catalogIdFromRequest.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (catalogIdFromRequest === 'aiolists-watchlist-W') { mdbListOriginalIdFromCatalog = 'watchlist'; }
    const mdbListSortPrefs = sortPreferences?.[mdbListOriginalIdFromCatalog] || { sort: 'default', order: 'desc' };
    let sortForMdbList = mdbListSortPrefs.sort;
    if (mdbListOriginalIdFromCatalog === 'watchlist' && itemTypeHintForFetching === 'all') { sortForMdbList = 'added'; }
    const isListUserMerged = userConfig.mergedLists?.[catalogIdFromRequest] !== false;
    itemsResult = await fetchMDBListItems( mdbListOriginalIdFromCatalog, apiKey, listsMetadata, skip, sortForMdbList, mdbListSortPrefs.order, false, genre, null, isListUserMerged );
  }
  return itemsResult || null;
}


async function createAddon(userConfig) {
  await initTraktApi(userConfig);
  const manifest = {
    id: 'org.stremio.aiolists',
    version: `1.1.1-${Date.now()}`,
    name: 'AIOLists',
    description: 'Manage all your lists in one place.',
    resources: ['catalog', 'meta'],
    types: [], // Will be populated dynamically
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

  const allKnownTypes = new Set(['movie', 'series', 'all']);

  // Add types from customMediaTypeNames (user overrides)
  Object.values(userConfig.customMediaTypeNames || {}).forEach(type => {
      if (type && typeof type === 'string') {
          allKnownTypes.add(type.toLowerCase());
      }
  });

  // Add types from imported addon catalogs themselves and their declared types
  if (userConfig.importedAddons) {
      Object.values(userConfig.importedAddons).forEach(addon => {
          // Types from the catalogs within the addon
          if (addon.catalogs && Array.isArray(addon.catalogs)) {
              addon.catalogs.forEach(catalog => {
                  if (catalog.type && typeof catalog.type === 'string') {
                      allKnownTypes.add(catalog.type.toLowerCase());
                  }
              });
          }
          // Types declared in the imported addon's manifest.types array
          if (addon.types && Array.isArray(addon.types)) {
              addon.types.forEach(type => {
                   if (type && typeof type === 'string') {
                      allKnownTypes.add(type.toLowerCase());
                  }
              });
          }
      });
  }
  manifest.types = Array.from(allKnownTypes);

  const includeGenresInManifest = !disableGenreFilter;
  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));
  
  let tempGeneratedCatalogs = [];

  if (enableRandomListFeature && apiKey && randomMDBListUsernames && randomMDBListUsernames.length > 0) {
    const randomCatalogId = 'random_mdblist_catalog';
    let randomCatalogDisplayName = getManifestCatalogName(randomCatalogId, "Discovery", customListNames);
     if (customMediaTypeNames?.[randomCatalogId]?.trim()){
        randomCatalogDisplayName = customMediaTypeNames[randomCatalogId].trim();
     }
    const randomCatalogExtra = [{ name: "skip" }];
    if (includeGenresInManifest) {
        randomCatalogExtra.push({ name: "genre", options: staticGenres, isRequired: false });
    }
    tempGeneratedCatalogs.push({
        id: randomCatalogId,
        type: customMediaTypeNames?.[randomCatalogId]?.trim() || 'all',
        name: randomCatalogDisplayName,
        extra: randomCatalogExtra,
        extraSupported: randomCatalogExtra.map(e => e.name)
    });
  }

  let activeListsInfo = [];
  if (apiKey) {
    const mdbLists = await fetchAllMDBLists(apiKey);
    activeListsInfo.push(...mdbLists.map(l => ({ ...l, source: 'mdblist', originalId: String(l.id) })));
  }
  if (traktAccessToken) {
    const traktFetchedLists = await fetchTraktLists(userConfig); // This might modify userConfig (token refresh)
    activeListsInfo.push(...traktFetchedLists.map(l => ({ ...l, source: 'trakt', originalId: String(l.id) })));
  }
  
  const processListForManifest = async (listSourceInfo, currentListId, isImportedSubCatalog = false, parentAddon = null) => {
    if (removedListsSet.has(currentListId)) {
        return;
    }

    const isHidden = hiddenListsSet.has(currentListId);
    let originalName = listSourceInfo.name;
    let displayName = getManifestCatalogName(currentListId, originalName, customListNames);

    const catalogExtraForThisList = [{ name: "skip" }];
    if (includeGenresInManifest) {
        let genreOpts = staticGenres;
        if (isImportedSubCatalog && listSourceInfo.extraSupported && Array.isArray(listSourceInfo.extraSupported)) {
            const genreExtraDef = listSourceInfo.extraSupported.find(e => typeof e === 'object' && e.name === 'genre');
            if (genreExtraDef && Array.isArray(genreExtraDef.options) && genreExtraDef.options.length > 0) {
                genreOpts = genreExtraDef.options;
            }
        }
        catalogExtraForThisList.push({
            name: "genre",
            options: genreOpts,
            isRequired: isHidden
        });
    }

    const baseCatalogProps = {
        extra: catalogExtraForThisList,
        extraSupported: catalogExtraForThisList.map(e => e.name),
    };

    if (isImportedSubCatalog) {
        const manifestCatalogType = customMediaTypeNames?.[currentListId]?.trim() || listSourceInfo.type;

        if (!manifestCatalogType) {
          console.warn(`[AIOLists AddonBuilder] Manifest catalog type for imported sub-catalog ${currentListId} is undefined (source type: ${listSourceInfo.type}). Skipping.`);
          return;
        }
        if (!displayName) {
          console.warn(`[AIOLists AddonBuilder] Display name for imported sub-catalog ${currentListId} is undefined. Skipping.`);
          return;
        }

        tempGeneratedCatalogs.push({
            id: currentListId,
            type: manifestCatalogType,
            name: displayName,
            ...baseCatalogProps
        });
        return; 
    }

    let sourceHasMovies, sourceHasShows;
    if (listSourceInfo.source === 'mdblist' || listSourceInfo.source === 'mdblist_url') {
      // Check both the list info and stored metadata for MDBList lists
      let metadata = userConfig.listsMetadata[currentListId] || userConfig.listsMetadata[listSourceInfo.originalId] || {};
      sourceHasMovies = listSourceInfo.hasMovies || metadata.hasMovies === true;
      sourceHasShows = listSourceInfo.hasShows || metadata.hasShows === true;
      

  } else if (listSourceInfo.source === 'trakt_public') {
      sourceHasMovies = listSourceInfo.hasMovies;
      sourceHasShows = listSourceInfo.hasShows;
  } else if (listSourceInfo.source === 'trakt') { // This now only handles private trakt
      let metadata = userConfig.listsMetadata[currentListId] || userConfig.listsMetadata[listSourceInfo.originalId] || {};
      sourceHasMovies = metadata.hasMovies === true;
      sourceHasShows = metadata.hasShows === true;

        if (listSourceInfo.source === 'trakt' && (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean' || metadata.errorFetching) && traktAccessToken) {
            let success = false; let fetchRetries = 0; if(metadata.errorFetching) delete metadata.errorFetching;
            while (!success && fetchRetries < MAX_METADATA_FETCH_RETRIES) {
                try {
                    const tempUserConfigForMetadata = { ...userConfig, listsMetadata: {}, rpdbApiKey: null, customMediaTypeNames: {} }; // Pass a clean config for fetching
                    let typeForMetaCheck = 'all';
                     if (currentListId.startsWith('trakt_recommendations_') || currentListId.startsWith('trakt_trending_') || currentListId.startsWith('trakt_popular_')) {
                        if (currentListId.includes("_shows")) typeForMetaCheck = 'series'; else if (currentListId.includes("_movies")) typeForMetaCheck = 'movie';
                    }
                    if (currentListId === 'trakt_watchlist') typeForMetaCheck = 'all'; // Watchlist can have mixed types

                    const content = await fetchListContent(currentListId, tempUserConfigForMetadata, 0, null, typeForMetaCheck);
                    sourceHasMovies = content?.hasMovies || false;
                    sourceHasShows = content?.hasShows || false;
                    
                    const currentMetaForUpdate = userConfig.listsMetadata[currentListId] || {}; // Ensure listsMetadata exists
                    userConfig.listsMetadata[currentListId] = {
                        ...currentMetaForUpdate, hasMovies: sourceHasMovies, hasShows: sourceHasShows, lastChecked: new Date().toISOString()
                    };
                    delete userConfig.listsMetadata[currentListId].errorFetching;
                    success = true;
                } catch (error) {
                    fetchRetries++;
                    console.error(`Metadata fetch attempt ${fetchRetries} for Trakt list ${currentListId} failed:`, error.message);
                    if (fetchRetries >= MAX_METADATA_FETCH_RETRIES) {
                        const fallbackMeta = userConfig.listsMetadata[currentListId] || {};
                        sourceHasMovies = fallbackMeta.hasMovies || false;
                        sourceHasShows = fallbackMeta.hasShows || false;
                        userConfig.listsMetadata[currentListId] = { ...fallbackMeta, errorFetching: true, lastChecked: new Date().toISOString() };
                         console.error(`Failed to fetch metadata for ${currentListId} after ${MAX_METADATA_FETCH_RETRIES} retries. Using potentially stale data.`);
                    } else { 
                        await delay(METADATA_FETCH_RETRY_DELAY_MS * Math.pow(2, fetchRetries - 1)); 
                    }
                }
            }
            if (traktAccessToken && activeListsInfo.length > 1 && activeListsInfo.some(l => l.source === 'trakt')) { // Ensure there's a next Trakt list
                 await delay(DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS);
            }
        }
    } else { // Fallback if source type is unknown or properties missing
        sourceHasMovies = listSourceInfo.hasMovies || false;
        sourceHasShows = listSourceInfo.hasShows || false;
    }

    const sourceIsStructurallyMergeable = sourceHasMovies && sourceHasShows;
    const customUserDefinedType = customMediaTypeNames?.[currentListId]?.trim();
    
    if (!sourceHasMovies && !sourceHasShows && !customUserDefinedType) {
        // If no content and no custom type, don't add catalog (unless it's explicitly an 'all' type list with no content yet)
        if (listSourceInfo.type !== 'all' || (listSourceInfo.type === 'all' && (listSourceInfo.hasMovies === false && listSourceInfo.hasShows === false))) {
             console.warn(`[AIOLists AddonBuilder] List ${currentListId} ('${displayName}') has no movie/series content and no custom type. Skipping manifest entry.`);
             return;
        }
    }
    
    const isUserMerged = sourceIsStructurallyMergeable ? (mergedLists[currentListId] !== false) : false;

    if (isUserMerged && sourceIsStructurallyMergeable) {
        const catalogType = customUserDefinedType || 'all';
        tempGeneratedCatalogs.push({ id: currentListId, type: catalogType, name: displayName, ...baseCatalogProps });
    } else if (!isUserMerged && sourceIsStructurallyMergeable) {
        let movieCatalogName = displayName;
        let seriesCatalogName = displayName;
        if (customUserDefinedType) {
            movieCatalogName = `${displayName}`;
            seriesCatalogName = `${displayName}`;
        }
        if (sourceHasMovies) {
            tempGeneratedCatalogs.push({ id: currentListId, type: 'movie', name: movieCatalogName, ...baseCatalogProps });
        }
        if (sourceHasShows) {
            tempGeneratedCatalogs.push({ id: currentListId, type: 'series', name: seriesCatalogName, ...baseCatalogProps });
        }
    } else {
        if (customUserDefinedType) {
             tempGeneratedCatalogs.push({ id: currentListId, type: customUserDefinedType, name: displayName, ...baseCatalogProps });
        } else {
            if (sourceHasMovies) {
                tempGeneratedCatalogs.push({ id: currentListId, type: 'movie', name: displayName, ...baseCatalogProps });
            } else if (sourceHasShows) {
                tempGeneratedCatalogs.push({ id: currentListId, type: 'series', name: displayName, ...baseCatalogProps });
            } else if (listSourceInfo.type === 'all' && !customUserDefinedType) {
                tempGeneratedCatalogs.push({ id: currentListId, type: 'all', name: displayName, ...baseCatalogProps });
            }
        }
    }
  };
  
  for (const listInfo of activeListsInfo) {
    if (listInfo.source === 'mdblist') {
        const originalMdbListId = String(listInfo.id); 
        const listTypeSuffix = listInfo.listType || 'L';
        const fullManifestListId = originalMdbListId === 'watchlist' ? 
            `aiolists-watchlist-W` : 
            `aiolists-${originalMdbListId}-${listTypeSuffix}`; 

        let listDataForProcessing = { 
            ...listInfo, 
            id: fullManifestListId,        
            originalId: originalMdbListId  
        };

        let determinedHasMovies, determinedHasShows;
        if (originalMdbListId === 'watchlist') {
            determinedHasMovies = true;
            determinedHasShows = true;
        } else {
            // First check if we have stored metadata for this list
            const existingMetadata = userConfig.listsMetadata[fullManifestListId];
            if (existingMetadata && typeof existingMetadata.hasMovies === 'boolean' && typeof existingMetadata.hasShows === 'boolean') {
                determinedHasMovies = existingMetadata.hasMovies;
                determinedHasShows = existingMetadata.hasShows;
            } else {
                // Fall back to API response data
                const moviesCount = parseInt(listInfo.movies) || 0;
                const showsCount = parseInt(listInfo.shows) || 0;
                determinedHasMovies = moviesCount > 0;
                determinedHasShows = showsCount > 0;

                if (moviesCount === 0 && showsCount === 0) {
                    const mediatype = listInfo.mediatype;
                    if (mediatype === 'movie') {
                        determinedHasMovies = true;
                    } else if (mediatype === 'show' || mediatype === 'series') {
                        determinedHasShows = true;
                    }
                }
            }
            

        }

        listDataForProcessing.hasMovies = determinedHasMovies;
        listDataForProcessing.hasShows = determinedHasShows;
        
        if (!userConfig.listsMetadata) userConfig.listsMetadata = {};
        userConfig.listsMetadata[fullManifestListId] = {
            ...(userConfig.listsMetadata[fullManifestListId] || {}),
            hasMovies: determinedHasMovies,
            hasShows: determinedHasShows,
            lastChecked: new Date().toISOString()
        };
        
        await processListForManifest(listDataForProcessing, fullManifestListId, false, null);

    } else if (listInfo.source === 'trakt') {
        const currentListId = String(listInfo.id);
        let listDataForProcessing = { ...listInfo, originalId: currentListId, source: 'trakt' }; 
        await processListForManifest(listDataForProcessing, currentListId, false, null);
    }
  }

  for (const addon of Object.values(importedAddons || {})) {
    const addonGroupId = String(addon.id); 
    if (removedListsSet.has(addonGroupId) || hiddenListsSet.has(addonGroupId)) {
        continue;
    }

    const isMDBListUrlImport = !!addon.isMDBListUrlImport;
    const isTraktPublicList = !!addon.isTraktPublicList;

    if (isMDBListUrlImport || isTraktPublicList) {
      if (isMDBListUrlImport && !apiKey) continue; 
      let listDataForUrlImport = {
          id: addonGroupId, // The AIOLists unique ID for this imported URL list
          name: addon.name,
          hasMovies: addon.hasMovies, // From initial import scan
          hasShows: addon.hasShows,   // From initial import scan
          source: isMDBListUrlImport ? 'mdblist_url' : 'trakt_public' // Corrected source
      };
      await processListForManifest(listDataForUrlImport, addonGroupId, false, null);

    } else if (addon.catalogs && addon.catalogs.length > 0) { 
      for (const catalog_from_imported_addon of addon.catalogs) {
        const catalogIdForManifest = String(catalog_from_imported_addon.id); 
        
        if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) {
            continue;
        }

        let subCatalogData = {
          name: catalog_from_imported_addon.name,
          type: catalog_from_imported_addon.type, 
          extraSupported: catalog_from_imported_addon.extraSupported,
          extraRequired: catalog_from_imported_addon.extraRequired,
          // No source needed here, isImportedSubCatalog=true implies it
        };
        await processListForManifest(subCatalogData, catalogIdForManifest, true, addon);
      }
    }
  }
  
  if (userConfig.listOrder && userConfig.listOrder.length > 0) {
    const orderMap = new Map();
    userConfig.listOrder.forEach((id, index) => {
        orderMap.set(String(id), index);
    });

    tempGeneratedCatalogs.sort((a, b) => {
        const idA_base = String(a.id); 
        const idB_base = String(b.id);
        const indexA = orderMap.get(idA_base);
        const indexB = orderMap.get(idB_base);

        if (indexA !== undefined && indexB !== undefined) {
            if (indexA === indexB) { 
                const typeOrder = { 'movie': 1, 'series': 2 }; // Prioritize movie then series if IDs are same
                let priorityA = typeOrder[a.type];
                let priorityB = typeOrder[b.type];
                if (customMediaTypeNames?.[idA_base] === a.type || a.type === 'all' || !priorityA ) priorityA = 0;
                if (customMediaTypeNames?.[idB_base] === b.type || b.type === 'all' || !priorityB ) priorityB = 0;
                
                return priorityA - priorityB;
            }
            return indexA - indexB; 
        }
        if (indexA !== undefined) return -1; 
        if (indexB !== undefined) return 1;  
        const nameCompare = (a.name || '').localeCompare(b.name || '');
        if (nameCompare !== 0) return nameCompare;
        return (a.type || '').localeCompare(b.type || ''); 
    });
  } else { 
    tempGeneratedCatalogs.sort((a, b) => {
        const nameCompare = (a.name || '').localeCompare(b.name || '');
        if (nameCompare !== 0) return nameCompare;
        return (a.type || '').localeCompare(b.type || '');
    });
  }

  manifest.catalogs = tempGeneratedCatalogs;
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    const genre = extra?.genre || null;
    
    // Pass the 'type' from the Stremio request to fetchListContent as stremioCatalogType
    const itemsResult = await fetchListContent(id, userConfig, skip, genre, type); 
    if (!itemsResult || !itemsResult.allItems) return Promise.resolve({ metas: [] });

    let metas = await convertToStremioFormat(itemsResult, userConfig.rpdbApiKey);

    if (type === 'movie' || type === 'series') {
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