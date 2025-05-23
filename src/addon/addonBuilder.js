// src/addon/addonBuilder.js
const { addonBuilder } = require('stremio-addon-sdk');
const { fetchTraktListItems, fetchTraktLists } = require('../integrations/trakt');
const { fetchListItems: fetchMDBListItems, fetchAllLists: fetchAllMDBLists } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { convertToStremioFormat } = require('./converters');
const { isWatchlist } = require('../utils/common');

/**
 * Hämtar innehåll för en specifik lista.
 */
async function fetchListContent(listId, userConfig, skip = 0) {
  const { apiKey, traktAccessToken, listsMetadata, sortPreferences, importedAddons } = userConfig;
  const sortPrefs = sortPreferences?.[listId] || { sort: 'imdbvotes', order: 'desc' };

  if (importedAddons) {
    for (const addon of Object.values(importedAddons)) {
      const catalog = addon.catalogs.find(c => c.id === listId || c.originalId === listId);
      if (catalog) {
        if (addon.id.startsWith('mdblisturl_') && catalog.url && apiKey) {
          return fetchMDBListItems(catalog.originalId || listId, apiKey, listsMetadata, skip, sortPrefs.sort, sortPrefs.order, true);
        }
        return fetchExternalAddonItems(catalog.originalId || listId, addon, skip, userConfig.rpdbApiKey);
      }
    }
  }
  
  // Hantera Trakt-listor
  if (listId.startsWith('trakt_') && traktAccessToken) {
    return fetchTraktListItems(listId, userConfig, skip);
  }

  // Hantera MDBList-listor
  if (apiKey) {
    // Normalisera listId för MDBList (ta bort eventuella prefix som lagts till för unika katalog-ID)
    let mdbListId = listId;
    const listTypeMatch = listId.match(/^aiolists-(\d+)-([ELW])$/);
    if (listTypeMatch) {
      mdbListId = listTypeMatch[1];
    } else if (listId === 'aiolists-watchlist-W') {
      mdbListId = 'watchlist';
    }
    return fetchMDBListItems(mdbListId, apiKey, listsMetadata, skip, sortPrefs.sort, sortPrefs.order);
  }
  
  return null;
}

async function createAddon(userConfig) {
  const manifest = {
    id: 'org.stremio.aiolists',
    version: `1.0.0-${Date.now()}`, // Dynamisk version för att hjälpa till med cache-busting
    name: 'AIOLists',
    description: 'Manage all your lists in one place.',
    resources: ['catalog', 'meta'],
    types: ['movie', 'series'], // Stödjer både film och serier
    idPrefixes: ['tt'],
    catalogs: [],
    logo: `https://i.imgur.com/nyIDmcb.png`, // Din logo
    behaviorHints: {
      configurable: true,
      configurationRequired: false 
    }
  };

  const { apiKey, traktAccessToken, listOrder = [], hiddenLists = [], removedLists = [], customListNames = {}, mergedLists = {}, importedAddons = {} } = userConfig;
  const hiddenListsSet = new Set(hiddenLists.map(String));
  const removedListsSet = new Set(removedLists.map(String));

  let activeLists = [];

  // Hämta MDBList-listor
  if (apiKey) {
    const mdbLists = await fetchAllMDBLists(apiKey);
    activeLists.push(...mdbLists.map(l => ({ ...l, source: 'mdblist' })));
  }

  // Hämta Trakt-listor
  if (traktAccessToken) {
    const traktFetchedLists = await fetchTraktLists(userConfig);
    activeLists.push(...traktFetchedLists.map(l => ({ ...l, source: 'trakt' })));
  }
  
  // Filtrera bort helt borttagna listor
  activeLists = activeLists.filter(list => !removedListsSet.has(String(list.id)));

  // Processa och lägg till kataloger för MDBList och Trakt
  for (const list of activeLists) {
    const listIdStr = String(list.id);
    if (hiddenListsSet.has(listIdStr)) continue;

    let displayName = customListNames[listIdStr] || list.name;
    let catalogId = listIdStr;
    if (list.source === 'mdblist') {
        catalogId = list.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${list.id}-${list.listType || 'L'}`;
    }
    
    const metadata = userConfig.listsMetadata?.[listIdStr] || {};
    let hasMovies = metadata.hasMovies;
    let hasShows = metadata.hasShows; 

    if (typeof hasMovies !== 'boolean' || typeof hasShows !== 'boolean') {
        console.log(`Metadata for ${listIdStr} types (hasMovies/hasShows) is missing or incomplete. Attempting to fetch content to determine types.`);
        const tempContent = await fetchListContent(listIdStr, userConfig, 0);

        if (tempContent) {
            hasMovies = tempContent.movies?.length > 0 || tempContent.hasMovies === true;
            hasShows = tempContent.shows?.length > 0 || tempContent.hasShows === true;
            if (userConfig.listsMetadata) {
                userConfig.listsMetadata[listIdStr] = { ...(userConfig.listsMetadata[listIdStr] || {}), hasMovies, hasShows };
            }
            console.log(`For list ${listIdStr}, determined hasMovies: ${hasMovies}, hasShows: ${hasShows}`);
        } else {
            console.warn(`Could not fetch tempContent for list ${listIdStr} to determine types. Defaulting to allow catalog creation based on list properties or general assumptions.`);
            
            if (list.isMovieList === true) {
                hasMovies = true;
                hasShows = false;
            } else if (list.isShowList === true) {
                hasMovies = false;
                hasShows = true;
            } else {
                hasMovies = true;
                hasShows = true; 
            }
            console.log(`Defaulted for ${listIdStr} - hasMovies: ${hasMovies}, hasShows: ${hasShows}`);
        }
    }
    
    // Lägg bara till katalogen om den antas ha antingen filmer eller serier
    if (hasMovies || hasShows) {
        const shouldMerge = mergedLists[listIdStr] !== false; // Standard till merged

        if (hasMovies && hasShows && shouldMerge) {
          manifest.catalogs.push({ type: 'all', id: catalogId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        } else {
          if (hasMovies) manifest.catalogs.push({ type: 'movie', id: catalogId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
          if (hasShows) manifest.catalogs.push({ type: 'series', id: catalogId, name: displayName, extraSupported: ["skip"], extraRequired: [] });
        }
    } else {
        console.log(`Skipping catalog for ${listIdStr} as it was determined to have no content after initial check.`);
    }
  }

  // Lägg till importerade externa tilläggskataloger
  Object.values(importedAddons).forEach(addon => {
    addon.catalogs.forEach(catalog => {
      const catalogIdStr = String(catalog.id);
      if (removedListsSet.has(catalogIdStr) || hiddenListsSet.has(catalogIdStr)) return;
      let displayName = customListNames[catalogIdStr] || catalog.name;
      manifest.catalogs.push({
        type: catalog.type === 'anime' ? 'series' : catalog.type, // Mappa anime till serier
        id: catalogIdStr,
        name: displayName,
        extraSupported: ["skip"],
        extraRequired: catalog.extra?.some(e => e.isRequired && e.name === 'skip') ? ["skip"] : [] // Hantera extra
      });
    });
  });
  
  // Sortera kataloger baserat på listOrder
  if (listOrder.length > 0) {
    const orderMap = new Map(listOrder.map((id, index) => [String(id).replace(/^aiolists-/, '').replace(/-[ELW]$/, ''), index]));
    manifest.catalogs.sort((a, b) => {
      const cleanAId = String(a.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
      const cleanBId = String(b.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
      const indexA = orderMap.get(cleanAId) ?? Infinity;
      const indexB = orderMap.get(cleanBId) ?? Infinity;
      return indexA - indexB;
    });
  }

  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const skip = parseInt(extra?.skip) || 0;
    
    // Hämta den fullständiga konfigurationen (inklusive API-nycklar) som är associerad med configHash.
    // Detta sker i api.js, här antar vi att userConfig redan är den dekomprimerade konfigurationen.
    const items = await fetchListContent(id, userConfig, skip);
    if (!items) return Promise.resolve({ metas: [] });

    let metas = await convertToStremioFormat(items, userConfig.rpdbApiKey);

    // Filtrera efter typ om 'all' inte är den begärda typen
    if (type !== 'all') {
        metas = metas.filter(meta => meta.type === type);
    }
    
    return Promise.resolve({ 
        metas,
        cacheMaxAge: isWatchlist(id) ? 0 : (5 * 60) // 5 minuters cache för icke-watchlists
    });
  });

  // Meta handler (förblir enkel, förlitar sig på Cinemeta)
  builder.defineMetaHandler(({ type, id }) => {
    if (!id.startsWith('tt')) return Promise.resolve({ meta: null });
    return Promise.resolve({ meta: { id, type, name: "Laddar..." } });
  });

  return builder.getInterface();
}

module.exports = { createAddon, fetchListContent };