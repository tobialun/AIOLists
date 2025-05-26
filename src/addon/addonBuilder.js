// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');
const { staticGenres, defaultConfig } = require('../config');

// Helper function for delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Configuration for metadata fetching orchestration
const METADATA_FETCH_RETRY_DELAY_MS = 5000; // Initial delay for retrying metadata fetch of a single list
const MAX_METADATA_FETCH_RETRIES = 2;     // Number of retries at this addonBuilder level for a single list's metadata
const DELAY_BETWEEN_DIFFERENT_MDBLISTS_MS = 1500; // Delay after processing one MDBList before the next
const DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS = 500; // Optional: Shorter delay for Trakt if needed

async function fetchListContent(listId, userConfig, skip = 0, genre = null, stremioCatalogType = 'all') {
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey } = userConfig;
  const catalogIdFromRequest = listId;
  const itemTypeHintForFetching = (stremioCatalogType === 'all') ? null : stremioCatalogType;

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
      if (!found && !originalListIdForSortLookup.startsWith('trakt_')) {
        originalListIdForSortLookup = catalogIdFromRequest;
      }
  }


  const sortPrefsForImported = userConfig.sortPreferences?.[originalListIdForSortLookup] ||
                               ( (catalogIdFromRequest.startsWith('traktpublic_') || (addonDetails?.isTraktPublicList && originalListIdForSortLookup.startsWith('traktpublic_'))) ?
                                 { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' } );

  let itemsResult;

  if (isUrlImport) {
    const addonConfig = importedAddons[catalogIdFromRequest];
    if (addonConfig.isTraktPublicList) {
      itemsResult = await fetchTraktListItems(
        addonConfig.id, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order,
        true, addonConfig.traktUser, itemTypeHintForFetching, genre
      );
    } else if (addonConfig.isMDBListUrlImport && apiKey) {
      itemsResult = await fetchMDBListItems( // This is fetchListItems from mdblist.js
        addonConfig.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order,
        true, genre
      );
    }
  }


  if (!itemsResult && importedAddons) {
    for (const parentAddon of Object.values(importedAddons)) {
      if (parentAddon.isMDBListUrlImport || parentAddon.isTraktPublicList) continue;
      const catalogEntry = parentAddon.catalogs?.find(c => String(c.id) === String(catalogIdFromRequest));
      if (catalogEntry) {
        // const subCatalogSortPrefs = userConfig.sortPreferences?.[catalogEntry.originalId] || { sort: 'imdbvotes', order: 'desc' };
        // Genre and sort for external addons are usually passed directly if supported by their manifest/API structure
        itemsResult = await fetchExternalAddonItems(
          catalogEntry.originalId, catalogEntry.originalType, parentAddon, skip, rpdbApiKey, genre
        );
        break;
      }
    }
  }

  if (!itemsResult && catalogIdFromRequest.startsWith('trakt_') && !catalogIdFromRequest.startsWith('traktpublic_') && traktAccessToken) {
    let sortPrefs = sortPreferences?.[originalListIdForSortLookup] ||
                      (catalogIdFromRequest.startsWith('trakt_watchlist') ? { sort: 'added', order: 'desc'} : { sort: 'rank', order: 'asc' });
    
    if (catalogIdFromRequest === 'trakt_watchlist' && itemTypeHintForFetching === null) {
        sortPrefs.sort = 'added'; 
    }

    let actualItemTypeHint = itemTypeHintForFetching;
    if (catalogIdFromRequest.includes("_movies")) actualItemTypeHint = 'movie';
    if (catalogIdFromRequest.includes("_shows")) actualItemTypeHint = 'series';
    if (catalogIdFromRequest === 'trakt_watchlist' && itemTypeHintForFetching === null) {
      actualItemTypeHint = 'all'; 
    }

    itemsResult = await fetchTraktListItems(
      catalogIdFromRequest, userConfig, skip, sortPrefs.sort, sortPrefs.order,
      false, null, actualItemTypeHint, genre
    );
  }

  if (!itemsResult && apiKey && catalogIdFromRequest.startsWith('aiolists-')) {
    const match = catalogIdFromRequest.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalIdFromCatalog = match ? match[1] : catalogIdFromRequest.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (catalogIdFromRequest === 'aiolists-watchlist-W') {
      mdbListOriginalIdFromCatalog = 'watchlist';
    }
    const mdbListSortPrefs = sortPreferences?.[mdbListOriginalIdFromCatalog] || { sort: 'imdbvotes', order: 'desc' };
    
    let sortForMdbList = mdbListSortPrefs.sort;
    if (mdbListOriginalIdFromCatalog === 'watchlist' && itemTypeHintForFetching === null) { 
        sortForMdbList = 'added'; 
    }

    itemsResult = await fetchMDBListItems( // This is fetchListItems from mdblist.js
      mdbListOriginalIdFromCatalog, apiKey, listsMetadata, skip, sortForMdbList, mdbListSortPrefs.order,
      false, genre
    );
  }
  return itemsResult || null;
}

async function createAddon(userConfig) {
  const manifest = {
    id: 'org.stremio.aiolists',
    version: `1.0.0-${Date.now()}`, // Ensures manifest is always fresh for Stremio
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
    apiKey, traktAccessToken, listOrder = [], hiddenLists = [], removedLists = [],
    customListNames = {}, mergedLists = {}, importedAddons = {}, listsMetadata = {},
    disableGenreFilter
  } = userConfig;

  const includeGenresInManifest = !disableGenreFilter;
  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));

  let activeListsInfo = [];
  if (apiKey) {
    const mdbLists = await fetchAllMDBLists(apiKey); // from mdblist.js
    activeListsInfo.push(...mdbLists.map(l => ({ ...l, source: 'mdblist', originalId: String(l.id) })));
  }
  if (traktAccessToken) {
    const traktFetchedLists = await fetchTraktLists(userConfig); // from trakt.js
    activeListsInfo.push(...traktFetchedLists.map(l => ({ ...l, source: 'trakt', originalId: String(l.id) })));
  }

  // Process active lists (MDBList, Trakt native) sequentially for metadata
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

    let displayName = customListNames[manifestListIdBase] || listInfo.name;
    let metadata = { ...(listsMetadata[manifestListIdBase] || listsMetadata[originalId] || {}) };
    let hasMovies = metadata.hasMovies === true;
    let hasShows = metadata.hasShows === true;
    
    let shouldFetchMetadata = true;
    if (listInfo.source === 'mdblist' && !apiKey) shouldFetchMetadata = false;
    if (listInfo.source === 'trakt' && !traktAccessToken && !listInfo.id?.startsWith('traktpublic_')) shouldFetchMetadata = false;


    if ((typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean' || metadata.errorFetching) && shouldFetchMetadata) {
        let success = false;
        let fetchRetries = 0;
        // metadata.errorFetching might be true from a previous failed attempt, so retry.
        if(metadata.errorFetching) delete metadata.errorFetching;


        console.log(`[addonBuilder] Preparing to fetch metadata for ${listInfo.source} list: ${displayName} (ID: ${manifestListIdBase})`);

        while (!success && fetchRetries < MAX_METADATA_FETCH_RETRIES) {
            try {
                // Pass only necessary parts of userConfig to avoid issues if full userConfig is mutated elsewhere
                const tempUserConfigForMetadata = { 
                    apiKey: userConfig.apiKey, 
                    traktAccessToken: userConfig.traktAccessToken,
                    traktRefreshToken: userConfig.traktRefreshToken, // For potential refresh within fetchTraktListItems
                    traktExpiresAt: userConfig.traktExpiresAt,       // For potential refresh
                    listsMetadata: {}, // Use a clean slate for this specific fetch's listsMetadata context if needed by downstream
                    rpdbApiKey: null,  // Avoid RPDB calls during this metadata check
                    // DO NOT pass the main listsMetadata here, it will be updated below
                };

                let typeForMetaCheck = 'all'; // Default for fetching mixed content to check types
                if (listInfo.isMovieList) typeForMetaCheck = 'movie';
                else if (listInfo.isShowList) typeForMetaCheck = 'series';
                
                // More specific type hints for known Trakt recommendation/trending/popular lists
                if (manifestListIdBase.startsWith('trakt_recommendations_') || manifestListIdBase.startsWith('trakt_trending_') || manifestListIdBase.startsWith('trakt_popular_')) {
                    if (manifestListIdBase.includes("_shows")) typeForMetaCheck = 'series';
                    else if (manifestListIdBase.includes("_movies")) typeForMetaCheck = 'movie';
                }
                if (manifestListIdBase === 'trakt_watchlist') typeForMetaCheck = 'all'; // For Trakt watchlist, 'all' fetches both

                const content = await fetchListContent(manifestListIdBase, tempUserConfigForMetadata, 0, null, typeForMetaCheck);
                
                hasMovies = content?.hasMovies || false;
                hasShows = content?.hasShows || false;
                
                if (!userConfig.listsMetadata) userConfig.listsMetadata = {};
                userConfig.listsMetadata[manifestListIdBase] = { 
                    ...(userConfig.listsMetadata[manifestListIdBase] || {}), 
                    hasMovies, 
                    hasShows,
                    lastChecked: new Date().toISOString()
                };
                success = true;
                console.log(`[addonBuilder] Successfully fetched metadata for ${manifestListIdBase}: Movies=${hasMovies}, Shows=${hasShows}`);
            } catch (error) {
                fetchRetries++;
                console.error(`[addonBuilder] Error fetching metadata for ${manifestListIdBase} (attempt ${fetchRetries}/${MAX_METADATA_FETCH_RETRIES}): ${error.message}`);
                if (fetchRetries < MAX_METADATA_FETCH_RETRIES) {
                    const currentRetryDelay = METADATA_FETCH_RETRY_DELAY_MS * Math.pow(2, fetchRetries - 1);
                    console.log(`[addonBuilder] Retrying metadata fetch for ${manifestListIdBase} after ${currentRetryDelay}ms`);
                    await delay(currentRetryDelay);
                } else {
                    console.error(`[addonBuilder] Failed to fetch metadata for ${manifestListIdBase} after ${MAX_METADATA_FETCH_RETRIES} attempts. Marking as no content or using stale if available.`);
                    // Keep potentially stale hasMovies/hasShows if they existed, otherwise default to false
                    hasMovies = userConfig.listsMetadata[manifestListIdBase]?.hasMovies || false;
                    hasShows = userConfig.listsMetadata[manifestListIdBase]?.hasShows || false;
                    if (!userConfig.listsMetadata) userConfig.listsMetadata = {};
                    userConfig.listsMetadata[manifestListIdBase] = { 
                        ...(userConfig.listsMetadata[manifestListIdBase] || {}), 
                        hasMovies, 
                        hasShows, 
                        errorFetching: true, // Mark that the latest attempt failed
                        lastChecked: new Date().toISOString()
                    };
                }
            }
        } // End of retry while loop

        // Apply delay only if metadata was fetched for this list and it's an MDBList or Trakt list
        if (shouldFetchMetadata) {
            if (listInfo.source === 'mdblist') {
                console.log(`[addonBuilder] Processed MDBList ${manifestListIdBase}. Waiting ${DELAY_BETWEEN_DIFFERENT_MDBLISTS_MS}ms before next list metadata fetch.`);
                await delay(DELAY_BETWEEN_DIFFERENT_MDBLISTS_MS);
            } else if (listInfo.source === 'trakt' && !manifestListIdBase.startsWith('traktpublic_')) { // Assuming Trakt public lists don't need this delay
                console.log(`[addonBuilder] Processed Trakt list ${manifestListIdBase}. Waiting ${DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS}ms.`);
                await delay(DELAY_BETWEEN_DIFFERENT_TRAKT_LISTS_MS);
            }
        }
    } // End of if metadata needs fetching

    // Add to manifest catalogs
    if (hasMovies || hasShows) {
      const isMerged = (hasMovies && hasShows) ? (mergedLists[manifestListIdBase] !== false) : false;
      const commonCatalogProps = {
        name: displayName,
        extraSupported: ["skip"],
        extraRequired: [],
      };
      if (includeGenresInManifest) {
        commonCatalogProps.extraSupported.push("genre");
        commonCatalogProps.genres = staticGenres;
      }

      if (hasMovies && hasShows && isMerged) {
        manifest.catalogs.push({ id: manifestListIdBase, type: 'all', ...commonCatalogProps });
      } else {
        if (hasMovies) manifest.catalogs.push({ id: manifestListIdBase, type: 'movie', ...commonCatalogProps });
        if (hasShows) manifest.catalogs.push({ id: manifestListIdBase, type: 'series', ...commonCatalogProps });
      }
    }
  } // End of for...of activeListsInfo

  // Process imported addons (URL imports and manifest imports)
  Object.values(importedAddons || {}).forEach(addon => {
    const addonGroupId = String(addon.id);
    if (removedListsSet.has(addonGroupId) || hiddenListsSet.has(addonGroupId)) {
        return; 
    }

    const isMDBListUrlImport = !!addon.isMDBListUrlImport;
    const isTraktPublicList = !!addon.isTraktPublicList;

    if (isMDBListUrlImport || isTraktPublicList) { 
      if (isMDBListUrlImport && !apiKey) return; // Skip if MDBList key missing for MDBList URL import
      
      // For URL imports, hasMovies/hasShows is determined at import time and stored in addon object
      if (addon.hasMovies || addon.hasShows) { 
        let displayName = customListNames[addonGroupId] || addon.name;
        const canBeMerged = addon.hasMovies && addon.hasShows;
        const isMerged = canBeMerged ? (mergedLists?.[addonGroupId] !== false) : false;
        
        const catalogPropsForUrlImport = {
            name: displayName,
            extraSupported: ["skip"],
            extraRequired: []
        };
        if (includeGenresInManifest) {
            catalogPropsForUrlImport.extraSupported.push("genre");
            catalogPropsForUrlImport.genres = staticGenres;
        }

        if (isMerged) { 
          manifest.catalogs.push({ id: addonGroupId, type: 'all', ...catalogPropsForUrlImport });
        } else {
          if (addon.hasMovies) manifest.catalogs.push({ id: addonGroupId, type: 'movie', ...catalogPropsForUrlImport });
          if (addon.hasShows) manifest.catalogs.push({ id: addonGroupId, type: 'series', ...catalogPropsForUrlImport });
        }
      }
    } else if (addon.catalogs && addon.catalogs.length > 0) { // Handle Manifest imports
      (addon.catalogs || []).forEach(catalog => {
          const catalogIdForManifest = String(catalog.id);
          if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;
          
          let displayName = customListNames[catalogIdForManifest] || catalog.name;
          
          let tempExtraSupported = (catalog.extraSupported || catalog.extra || [])
              .map(e => (typeof e === 'string' ? e : ({ ...e }))) // Ensure deep copy if objects
              .filter(e => { // Remove skip/genre if already there, we'll add them controlledly
                  if (typeof e === 'string') return e !== 'skip' && e !== 'genre';
                  if (typeof e === 'object' && e !== null) return e.name !== 'skip' && e.name !== 'genre';
                  return true; 
              });

          let extraSupportedForCatalog = ['skip']; // Always support skip
          extraSupportedForCatalog.push(...tempExtraSupported); // Add other supported extras from original manifest

          let genresForThisCatalog = undefined; 
          if (includeGenresInManifest) {
              if (!extraSupportedForCatalog.some(e => (typeof e === 'string' && e === 'genre') || (typeof e === 'object' && e.name === 'genre'))) {
                 extraSupportedForCatalog.push('genre'); // Add genre if not already declared as supported
              }
              genresForThisCatalog = staticGenres; // Provide our static list of genres
          }
          
          extraSupportedForCatalog = [...new Set(extraSupportedForCatalog.map(e => typeof e === 'string' ? e : e.name))];
          // Ensure final extraSupported is an array of strings or correct objects if needed by Stremio SDK

          manifest.catalogs.push({
              id: catalogIdForManifest, 
              type: catalog.type, 
              name: displayName,
              extraSupported: extraSupportedForCatalog,
              extraRequired: catalog.extraRequired || [], 
              genres: genresForThisCatalog // Add genres if applicable
          });
      });
    }
  });

  // Sort catalogs based on listOrder
  if (listOrder && listOrder.length > 0) {
    const orderMap = new Map(listOrder.map((id, index) => [String(id), index]));
    manifest.catalogs.sort((a, b) => {
      const indexA = orderMap.get(String(a.id));
      const indexB = orderMap.get(String(b.id));
      if (indexA !== undefined && indexB !== undefined) {
        if (indexA !== indexB) return indexA - indexB;
        // If same order index, sort by type (movie then series)
        if (a.type === 'movie' && b.type === 'series') return -1;
        if (a.type === 'series' && b.type === 'movie') return 1;
        return 0;
      }
      if (indexA !== undefined) return -1; // Ordered items first
      if (indexB !== undefined) return 1;  // Ordered items first
      return (a.name || '').localeCompare(b.name || ''); // Fallback sort for unordered items
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    const genre = extra?.genre || null;
    
    console.log(`[CatalogHandler] Request for catalog: ID=${id}, Type=${type}, Skip=${skip}, Genre=${genre}`);
    
    const itemsResult = await fetchListContent(id, userConfig, skip, genre, type);
    
    if (!itemsResult) {
        console.log(`[CatalogHandler] No itemsResult for ID=${id}, Type=${type}. Returning empty.`);
        return Promise.resolve({ metas: [] });
    }
    
    let metas = await convertToStremioFormat(itemsResult, userConfig.rpdbApiKey);

    // Filter by type if not 'all'
    if (type !== 'all' && (type === 'movie' || type === 'series')) {
      metas = metas.filter(meta => meta.type === type);
    } 
    console.log(`[CatalogHandler] Returning ${metas.length} metas for ID=${id}, Type=${type}`);
    return Promise.resolve({ metas, cacheMaxAge: isWatchlist(id) ? 0 : (5 * 60) }); // 5 min cache for non-watchlists
  });

  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
    return Promise.resolve({ meta: { id, type, name: "Loading details..." } }); 
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };