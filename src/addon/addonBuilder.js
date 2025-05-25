const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');
const { staticGenres, defaultConfig } = require('../config');

async function fetchListContent(listId, userConfig, skip = 0, genre = null, stremioCatalogType = 'all') {
  const { apiKey, traktAccessToken, listsMetadata = {}, sortPreferences = {}, importedAddons = {}, rpdbApiKey } = userConfig;
  const catalogIdFromRequest = listId;
  const itemTypeHintForFetching = (stremioCatalogType === 'all') ? null : stremioCatalogType;

  // console.log(`[DEBUG fetchListContent] Called for ID: ${catalogIdFromRequest}, Type: ${stremioCatalogType}, Skip: ${skip}, Genre: ${genre}`);

  let originalListIdForSortLookup = catalogIdFromRequest;
  if (catalogIdFromRequest.startsWith('aiolists-') && (catalogIdFromRequest.includes('-L') || catalogIdFromRequest.includes('-E') || catalogIdFromRequest.includes('-W'))) {
    const parts = catalogIdFromRequest.split('-');
    if (parts.length >= 2) originalListIdForSortLookup = parts[1] === 'watchlist' ? 'watchlist' : parts[1];
  } else if (importedAddons && importedAddons[catalogIdFromRequest] && importedAddons[catalogIdFromRequest].isUrlImported) {
    const addonConf = importedAddons[catalogIdFromRequest];
    if (addonConf.isMDBListUrlImport) originalListIdForSortLookup = addonConf.mdblistId;
    else if (addonConf.isTraktPublicList) originalListIdForSortLookup = addonConf.id;
    else originalListIdForSortLookup = addonConf.id;
  } else if (importedAddons) {
      let found = false;
      for (const addon of Object.values(importedAddons)) {
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
                               ( (catalogIdFromRequest.startsWith('traktpublic_') || originalListIdForSortLookup.startsWith('traktpublic_')) ?
                                 { sort: 'rank', order: 'asc' } : { sort: 'imdbvotes', order: 'desc' } );

  let itemsResult;

  if (importedAddons && importedAddons[catalogIdFromRequest]) {
    const addonConfig = importedAddons[catalogIdFromRequest];
    if (addonConfig.isUrlImported) {
      // console.log(`[DEBUG fetchListContent] Handling URL import for ${catalogIdFromRequest}`);
      if (addonConfig.isTraktPublicList) {
        itemsResult = await fetchTraktListItems(
          addonConfig.id, userConfig, skip, sortPrefsForImported.sort, sortPrefsForImported.order,
          true, addonConfig.traktUser, itemTypeHintForFetching, genre
        );
      } else if (addonConfig.isMDBListUrlImport && apiKey) {
        itemsResult = await fetchMDBListItems(
          addonConfig.mdblistId, apiKey, listsMetadata, skip, sortPrefsForImported.sort, sortPrefsForImported.order,
          true, genre
        );
      }
    }
  }

  if (!itemsResult && importedAddons) {
    for (const parentAddon of Object.values(importedAddons)) {
      if (parentAddon.isUrlImported) continue;
      const catalogEntry = parentAddon.catalogs?.find(c => String(c.id) === String(catalogIdFromRequest));
      if (catalogEntry) {
        // console.log(`[DEBUG fetchListContent] Handling manifest sub-catalog ${catalogIdFromRequest} from parent ${parentAddon.id}`);
        const subCatalogSortPrefs = userConfig.sortPreferences?.[catalogEntry.originalId] || { sort: 'imdbvotes', order: 'desc' };
        itemsResult = await fetchExternalAddonItems(
          catalogEntry.originalId, catalogEntry.originalType, parentAddon, skip, rpdbApiKey, genre
        );
        break;
      }
    }
  }

  if (!itemsResult && catalogIdFromRequest.startsWith('trakt_') && !catalogIdFromRequest.startsWith('traktpublic_') && traktAccessToken) {
    // console.log(`[DEBUG fetchListContent] Handling native Trakt list ${catalogIdFromRequest}`);
    const sortPrefs = sortPreferences?.[catalogIdFromRequest] ||
                      (catalogIdFromRequest.startsWith('trakt_watchlist') ? { sort: 'added', order: 'desc'} : { sort: 'rank', order: 'asc' });
    
    let actualItemTypeHint = itemTypeHintForFetching;
    if (catalogIdFromRequest.includes("_movies")) actualItemTypeHint = 'movie';
    if (catalogIdFromRequest.includes("_shows")) actualItemTypeHint = 'series';

    itemsResult = await fetchTraktListItems(
      catalogIdFromRequest, userConfig, skip, sortPrefs.sort, sortPrefs.order,
      false, null, actualItemTypeHint, genre
    );
  }

  if (!itemsResult && apiKey && catalogIdFromRequest.startsWith('aiolists-')) {
    // console.log(`[DEBUG fetchListContent] Handling native MDBList ${catalogIdFromRequest}`);
    const match = catalogIdFromRequest.match(/^aiolists-([^-]+(?:-[^-]+)*)-([ELW])$/);
    let mdbListOriginalIdFromCatalog = match ? match[1] : catalogIdFromRequest.replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
    if (catalogIdFromRequest === 'aiolists-watchlist-W') {
      mdbListOriginalIdFromCatalog = 'watchlist';
    }
    const mdbListSortPrefs = sortPreferences?.[mdbListOriginalIdFromCatalog] || { sort: 'imdbvotes', order: 'desc' };
    itemsResult = await fetchMDBListItems(
      mdbListOriginalIdFromCatalog, apiKey, listsMetadata, skip, mdbListSortPrefs.sort, mdbListSortPrefs.order,
      false, genre
    );
  }
  // console.log(`[DEBUG fetchListContent] Result for ID ${catalogIdFromRequest}:`, JSON.stringify(itemsResult, null, 2)?.substring(0, 300));
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
    apiKey, traktAccessToken, listOrder = [], hiddenLists = [], removedLists = [],
    customListNames = {}, mergedLists = {}, importedAddons = {}, listsMetadata = {},
    disableGenreFilter
  } = userConfig;

  const includeGenresInManifest = !disableGenreFilter
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
      const listTypeSuffix = listInfo.listType || 'L';
      manifestListIdBase = listInfo.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${listInfo.id}-${listTypeSuffix}`;
    } else if (listInfo.source === 'trakt') {
      manifestListIdBase = listInfo.id;
    }

    if (removedListsSet.has(manifestListIdBase) || hiddenListsSet.has(manifestListIdBase)) {
      continue;
    }

    let displayName = customListNames[manifestListIdBase] || listInfo.name;
    let metadata = { ...(listsMetadata[manifestListIdBase] || {}) }; // Ensure fresh object

    let hasMovies = metadata.hasMovies === true;
    let hasShows = metadata.hasShows === true;
    
    if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
      const tempUserConfigForMetadata = { ...userConfig, rpdbApiKey: null, listsMetadata: {} };
      
      let typeForMetaCheck = 'all';
      if (listInfo.isMovieList) typeForMetaCheck = 'movie';
      else if (listInfo.isShowList) typeForMetaCheck = 'series';
      
      // Forcing type for known series-only lists during metadata check
      if (manifestListIdBase === 'trakt_recommendations_shows' || manifestListIdBase === 'trakt_trending_shows' || manifestListIdBase === 'trakt_popular_shows') {
          typeForMetaCheck = 'series';
      }


      const content = await fetchListContent(manifestListIdBase, tempUserConfigForMetadata, 0, null, typeForMetaCheck);
      
      hasMovies = content?.hasMovies || false;
      hasShows = content?.hasShows || false;
      
      // This mutation should be done carefully or ideally when config is saved.
      // For the manifest generation, this ensures it uses the fresh values.
      if (!userConfig.listsMetadata) userConfig.listsMetadata = {}; // Should be initialized earlier
      userConfig.listsMetadata[manifestListIdBase] = { ...userConfig.listsMetadata[manifestListIdBase], hasMovies, hasShows };
    }
    

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
    } else {
        console.log(`[DEBUG createAddon] SKIPPING ${manifestListIdBase} (${displayName}) from manifest because hasMovies and hasShows are both false.`);
    }
  }

  Object.values(importedAddons || {}).forEach(addon => {
    const addonGroupId = String(addon.id);
    if (removedListsSet.has(addonGroupId) || hiddenListsSet.has(addonGroupId)) return;

    if (addon.isUrlImported) {
      if (addon.hasMovies || addon.hasShows) {
        let displayName = customListNames[addonGroupId] || addon.name;
        const isMerged = (addon.hasMovies && addon.hasShows) ? (mergedLists?.[addonGroupId] !== false) : false;
        
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
    } else if (addon.catalogs && addon.catalogs.length > 0) { 
      (addon.catalogs || []).forEach(catalog => {
          const catalogIdForManifest = String(catalog.id);
          if (removedListsSet.has(catalogIdForManifest) || hiddenListsSet.has(catalogIdForManifest)) return;
          
          let displayName = customListNames[catalogIdForManifest] || catalog.name;
          
          let extraSupportedForCatalog = catalog.extraSupported ? 
                                         [...new Set(catalog.extraSupported.map(e => typeof e === 'string' ? e : ({ ...e })))] : 
                                         [];

          if (!extraSupportedForCatalog.some(e => (typeof e === 'string' && e === 'skip') || (typeof e === 'object' && e !== null && e.name === 'skip'))) {
              extraSupportedForCatalog.push('skip');
          }

          let genresForThisCatalog = undefined; 

          if (includeGenresInManifest) {
              extraSupportedForCatalog = extraSupportedForCatalog.filter(e => {
                  if (typeof e === 'object' && e !== null) {
                      return e.name !== 'genre'; 
                  }
                  return e !== 'genre'; 
              });

              if (!extraSupportedForCatalog.includes('genre')) {
                 extraSupportedForCatalog.push('genre');
              }
              
              genresForThisCatalog = staticGenres;
          } else {
              extraSupportedForCatalog = extraSupportedForCatalog.filter(e => {
                  if (typeof e === 'string') return e !== 'genre';
                  if (typeof e === 'object' && e !== null) return e.name !== 'genre';
                  return true;
              });
          }

          manifest.catalogs.push({
              id: catalogIdForManifest, 
              type: catalog.type, 
              name: displayName,
              extraSupported: extraSupportedForCatalog,
              extraRequired: catalog.extraRequired || (catalog.extra || []).filter(e => typeof e === 'object' && e !== null && e.isRequired),
              genres: genresForThisCatalog
          });
      });
    }
  });

  if (listOrder && listOrder.length > 0) {
    const orderMap = new Map(listOrder.map((id, index) => [String(id), index]));
    manifest.catalogs.sort((a, b) => {
      const indexA = orderMap.get(String(a.id));
      const indexB = orderMap.get(String(b.id));
      if (indexA !== undefined && indexB !== undefined) {
        if (indexA !== indexB) return indexA - indexB;
        if (a.type === 'movie' && b.type === 'series') return -1;
        if (a.type === 'series' && b.type === 'movie') return 1;
        return 0;
      }
      if (indexA !== undefined) return -1; if (indexB !== undefined) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    const genre = extra?.genre || null;
    // console.log(`[DEBUG CatalogHandler] Request for ID: ${id}, Type: ${type}, Skip: ${skip}, Genre: ${genre}`);
    
    const itemsResult = await fetchListContent(id, userConfig, skip, genre, type);
    
    if (!itemsResult) {
        // console.log(`[DEBUG CatalogHandler] No itemsResult for ID: ${id}, Type: ${type}. Returning empty metas.`);
        return Promise.resolve({ metas: [] });
    }

    let metas = await convertToStremioFormat(itemsResult, userConfig.rpdbApiKey);

    if (genre && metas.length > 0) {
        const lowerGenre = String(genre).toLowerCase();
        metas = metas.filter(meta => meta.genres && meta.genres.map(g => String(g).toLowerCase()).includes(lowerGenre));
    }
    // console.log(`[DEBUG CatalogHandler] Final metas for ID: ${id}, Type: ${type}: ${metas.length} items`);
    return Promise.resolve({ metas, cacheMaxAge: isWatchlist(id) ? 0 : (5 * 60) });
  });

  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
    return Promise.resolve({ meta: { id, type, name: "Loading details..." } });
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };