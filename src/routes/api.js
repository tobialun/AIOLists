// src/routes/api.js
const path = require('path');
const { defaultConfig } = require('../config');
const { compressConfig, decompressConfig } = require('../utils/urlConfig');
const { createAddon, fetchListContent } = require('../addon/addonBuilder');
const { convertToStremioFormat } = require('../addon/converters');
const { setCacheHeaders } = require('../utils/common');
const Cache = require('../utils/cache'); // Använd den centraliserade cache-modulen

// Importera integrationsfunktioner
const { validateRPDBKey, clearPosterCache } = require('../utils/posters');
const { authenticateTrakt, getTraktAuthUrl, fetchTraktLists: fetchTraktUserLists } = require('../integrations/trakt');
const { fetchAllLists: fetchAllMDBLists, fetchListItems: fetchMDBListItemsDirect, validateMDBListKey, extractListFromUrl: extractMDBListFromUrl } = require('../integrations/mdblist');
const { importExternalAddon: importExtAddon, fetchExternalAddonItems: fetchExtAddonItems } = require('../integrations/externalAddons');

// Kortvarig cache för manifest för att minska rebuilds vid snabba sidladdningar
const manifestCache = new Cache({ defaultTTL: 1 * 60 * 1000 }); // 1 minut TTL

module.exports = function(router) {
  // Middleware för att läsa och dekomprimera config från URL-hash
  // Detta kommer att köras för alla rutter i denna router som har :configHash
  router.param('configHash', async (req, res, next, configHash) => {
    try {
      req.userConfig = await decompressConfig(configHash);
      req.configHash = configHash; // Spara hash för senare användning om config uppdateras
      next();
    } catch (error) {
      console.error('Fel vid dekomprimering av configHash:', error);
      // Om dekomprimering misslyckas, omdirigera till /configure för att skapa en ny
      if (!res.headersSent) {
        return res.redirect('/configure');
      }
      next(error); // Eller skicka ett fel
    }
  });

  // ----- Rutter som använder :configHash -----

  router.get('/:configHash/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  router.get('/:configHash/manifest.json', async (req, res) => {
    try {
      const cacheKey = `manifest_${req.configHash}`;
      let addonInterface = manifestCache.get(cacheKey);

      if (!addonInterface) {
        addonInterface = await createAddon(req.userConfig);
        manifestCache.set(cacheKey, addonInterface);
      }
      // Viktigt: Stremio cachar manifest baserat på URL. Versionen i manifestet
      // inkluderar Date.now() för att tvinga Stremio att uppdatera.
      setCacheHeaders(res, null); // Sätt korta cache-headers för själva manifest-endpointen
      res.json(addonInterface.manifest);
    } catch (error) {
      console.error('Fel vid servering av manifest:', error);
      res.status(500).json({ error: 'Misslyckades med att servera manifest' });
    }
  });

  router.get('/:configHash/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
      const { type, id } = req.params;
      const skip = parseInt(req.query.skip || req.params.extra?.match(/skip=(\d+)/)?.[1]) || 0;

      setCacheHeaders(res, id); // Sätt cache-headers baserat på om det är en watchlist

      const items = await fetchListContent(id, req.userConfig, skip);
      if (!items) {
        return res.json({ metas: [] });
      }
      
      let metas = await convertToStremioFormat(items, req.userConfig.rpdbApiKey);
      
      // Filtrera efter typ om 'all' inte är den begärda typen
      if (type !== 'all' && type !== 'movie' && type !== 'series') {
         // Om typen är okänd, returnera tom array eller hantera som fel
         return res.json({ metas: [] });
      }
      if (type !== 'all') {
          metas = metas.filter(meta => meta.type === type);
      }
      
      res.json({ metas });
    } catch (error) {
      console.error('Fel i katalog-endpoint:', error);
      res.status(500).json({ error: 'Internt serverfel' });
    }
  });

  router.get('/:configHash/config', (req, res) => {
    // req.userConfig är redan satt av middleware
    res.json({ success: true, config: req.userConfig });
  });
  
  // Spara API-nycklar
  router.post('/:configHash/apikey', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      let configChanged = false;

      if (req.userConfig.rpdbApiKey !== rpdbApiKey) {
        req.userConfig.rpdbApiKey = rpdbApiKey || '';
        configChanged = true;
        console.log('RPDB API key changed. New poster requests will use new cache keys.');
      }
      if (req.userConfig.apiKey !== apiKey) {
        req.userConfig.apiKey = apiKey || '';
        configChanged = true;
      }

      if (configChanged) {
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear(); // Rensa manifestcache när config ändras
        return res.json({ success: true, configHash: newConfigHash });
      }
      return res.json({ success: true, configHash: req.configHash, message: "API keys unchanged" });
    } catch (error) {
      console.error('Fel vid sparande av API-nyckel:', error);
      res.status(500).json({ error: 'Internt serverfel' });
    }
  });

  // Trakt autentisering
  router.post('/:configHash/trakt/auth', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Auktoriseringskod krävs' });

        const traktTokens = await authenticateTrakt(code);
        req.userConfig.traktAccessToken = traktTokens.accessToken;
        req.userConfig.traktRefreshToken = traktTokens.refreshToken;
        req.userConfig.traktExpiresAt = traktTokens.expiresAt;
        req.userConfig.lastUpdated = new Date().toISOString();

        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Autentiserad med Trakt' });
    } catch (error) {
        console.error('Fel vid Trakt-autentisering:', error);
        res.status(500).json({ error: 'Misslyckades med att autentisera med Trakt', details: error.message });
    }
  });

  router.post('/:configHash/trakt/disconnect', async (req, res) => {
    try {
        req.userConfig.traktAccessToken = null;
        req.userConfig.traktRefreshToken = null;
        req.userConfig.traktExpiresAt = null;
        req.userConfig.lastUpdated = new Date().toISOString();

        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Frånkopplad från Trakt' });
    } catch (error) {
        console.error('Fel vid frånkoppling från Trakt:', error);
        res.status(500).json({ error: 'Misslyckades med att frånkoppla Trakt', details: error.message });
    }
  });
  
  // Importera MDBList URL
  router.post('/:configHash/import-mdblist-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'MDBList URL krävs' });
        if (!req.userConfig.apiKey) return res.status(400).json({ error: 'MDBList API-nyckel krävs för att importera URL' });

        const { listId, listName } = await extractMDBListFromUrl(url, req.userConfig.apiKey);
        
        // För att säkerställa att listan hanteras korrekt, lägg till den som ett "importerat tillägg"
        // Detta efterliknar hur externa tillägg hanteras och ger en konsekvent struktur
        const mdbListAddonId = `mdblisturl_${listId}`;
        if (!req.userConfig.importedAddons) req.userConfig.importedAddons = {};

        // Hämta lite innehåll för att bestämma typer (hasMovies, hasShows)
        const tempContent = await fetchMDBListItemsDirect(listId, req.userConfig.apiKey, req.userConfig.listsMetadata, 0, 'imdbvotes', 'desc');
        const hasMovies = tempContent?.movies?.length > 0 || tempContent?.hasMovies === true;
        const hasShows = tempContent?.shows?.length > 0 || tempContent?.hasShows === true;

        const catalogs = [];
        if (hasMovies) catalogs.push({ id: listId, name: listName, type: 'movie', originalId: listId, url: url });
        if (hasShows) catalogs.push({ id: listId, name: listName, type: 'series', originalId: listId, url: url });

        if (catalogs.length === 0) {
            return res.status(400).json({ error: 'Kunde inte hitta filmer eller serier i listan.'})
        }

        req.userConfig.importedAddons[mdbListAddonId] = {
            id: mdbListAddonId,
            name: `MDBList URL: ${listName}`,
            version: '1.0.0',
            description: `Importerad från MDBList URL: ${url}`,
            catalogs: catalogs,
            types: [...new Set(catalogs.map(c => c.type))], // ['movie', 'series'] eller en av dem
            resources: ['catalog', 'meta'], // Standardresurser
            url: url // Spara original-URL för referens
        };
        
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, addon: req.userConfig.importedAddons[mdbListAddonId], message: `Importerade ${listName}` });
    } catch (error) {
        console.error('Fel vid import av MDBList URL:', error);
        res.status(500).json({ error: error.message || 'Misslyckades med att importera MDBList URL' });
    }
  });

  // Importera externt tillägg
  router.post('/:configHash/import-addon', async (req, res) => {
    try {
        const { manifestUrl } = req.body;
        if (!manifestUrl) return res.status(400).json({ error: 'Manifest URL krävs' });

        const addonInfo = await importExtAddon(manifestUrl);
        if (!req.userConfig.importedAddons) req.userConfig.importedAddons = {};
        req.userConfig.importedAddons[addonInfo.id] = addonInfo;
        req.userConfig.lastUpdated = new Date().toISOString();

        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, addon: addonInfo, message: `Importerade ${addonInfo.name}` });
    } catch (error) {
        console.error('Fel vid import av tillägg:', error);
        res.status(500).json({ error: 'Misslyckades med att importera tillägg', details: error.message });
    }
  });
  
  // Ta bort externt tillägg
  router.post('/:configHash/remove-addon', async (req, res) => {
    try {
        const { addonId } = req.body;
        if (!addonId || !req.userConfig.importedAddons || !req.userConfig.importedAddons[addonId]) {
            return res.status(400).json({ error: 'Ogiltigt tilläggs-ID' });
        }
        
        delete req.userConfig.importedAddons[addonId];
        // Ta även bort listor associerade med detta tillägg från listOrder, hiddenLists etc.
        // för fullständig städning (kan implementeras vid behov)
        req.userConfig.lastUpdated = new Date().toISOString();

        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Tillägg borttaget' });
    } catch (error) {
        console.error('Fel vid borttagning av tillägg:', error);
        res.status(500).json({ error: 'Misslyckades med att ta bort tillägg', details: error.message });
    }
  });

  // List management endpoints (names, visibility, order, remove, sort, merge)
  // Anpassa dessa från din ursprungliga api.js, se till att de använder req.userConfig
  // och returnerar newConfigHash efter att ha anropat compressConfig.
  // Exempel för listOrder:
  router.post('/:configHash/lists/order', async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) return res.status(400).json({ error: 'Order måste vara en array' });
        
        req.userConfig.listOrder = order.map(String);
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear(); // Rensa manifestcache då ordningen kan påverka det
        res.json({ success: true, configHash: newConfigHash, message: 'Listordning uppdaterad' });
    } catch (error) {
        console.error('Fel vid uppdatering av listordning:', error);
        res.status(500).json({ error: 'Misslyckades med att uppdatera listordning' });
    }
  });
  
  // Update list name
  router.post('/:configHash/lists/names', async (req, res) => {
    try {
      const { listId, customName } = req.body;
      if (!listId) return res.status(400).json({ error: 'List ID krävs' });
      
      if (!req.userConfig.customListNames) req.userConfig.customListNames = {};
      
      if (customName?.trim()) {
        req.userConfig.customListNames[String(listId)] = customName.trim();
      } else {
        delete req.userConfig.customListNames[String(listId)];
      }
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'Listnamn uppdaterat' });
    } catch (error) {
      console.error('Fel vid uppdatering av listnamn:', error);
      res.status(500).json({ error: 'Misslyckades med att uppdatera listnamn' });
    }
  });

  // Update list visibility
  router.post('/:configHash/lists/visibility', async (req, res) => {
    try {
      const { hiddenLists } = req.body; // Detta bör vara en array av list-IDn
      if (!Array.isArray(hiddenLists)) return res.status(400).json({ error: 'Hidden lists måste vara en array' });
      
      req.userConfig.hiddenLists = hiddenLists.map(String);
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'Listans synlighet uppdaterad' });
    } catch (error) {
      console.error('Fel vid uppdatering av listans synlighet:', error);
      res.status(500).json({ error: 'Misslyckades med att uppdatera listans synlighet' });
    }
  });

  // Remove lists
  router.post('/:configHash/lists/remove', async (req, res) => {
    try {
      const { listIds } = req.body; // Array av list-IDn att ta bort
      if (!Array.isArray(listIds)) return res.status(400).json({ error: 'List IDs måste vara en array' });
      
      const currentRemoved = new Set(req.userConfig.removedLists || []);
      listIds.forEach(id => currentRemoved.add(String(id)));
      req.userConfig.removedLists = Array.from(currentRemoved);
      
      // Ta även bort från hiddenLists om de finns där
      if (req.userConfig.hiddenLists) {
          req.userConfig.hiddenLists = req.userConfig.hiddenLists.filter(id => !listIds.includes(String(id)));
      }
      
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'Listor borttagna' });
    } catch (error) {
      console.error('Fel vid borttagning av listor:', error);
      res.status(500).json({ error: 'Misslyckades med att ta bort listor' });
    }
  });

  // Update sort preferences
  router.post('/:configHash/lists/sort', async (req, res) => {
    try {
      const { listId, sort, order } = req.body;
      if (!listId || !sort) return res.status(400).json({ error: 'List ID och sorteringsfält krävs' });
      
      if (!req.userConfig.sortPreferences) req.userConfig.sortPreferences = {};
      req.userConfig.sortPreferences[String(listId)] = { sort, order: order || 'desc' };
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear(); //EXPERIMENTAL
      res.json({ success: true, configHash: newConfigHash, message: 'Sorteringspreferenser uppdaterade' });
    } catch (error) {
      console.error('Fel vid uppdatering av sorteringspreferenser:', error);
      res.status(500).json({ error: 'Misslyckades med att uppdatera sorteringspreferenser' });
    }
  });
  
  // Update list merge preference
  router.post('/:configHash/lists/merge', async (req, res) => {
    try {
        const { listId, merged } = req.body;
        if (!listId || typeof merged !== 'boolean') {
            return res.status(400).json({ error: 'List ID och merge-preferens (boolean) krävs' });
        }

        if (!req.userConfig.mergedLists) req.userConfig.mergedLists = {};
        req.userConfig.mergedLists[String(listId)] = merged;
        req.userConfig.lastUpdated = new Date().toISOString();

        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: `Lista ${merged ? 'sammanslagen' : 'delad'}` });
    } catch (error) {
        console.error('Fel vid uppdatering av listans merge-preferens:', error);
        res.status(500).json({ error: 'Misslyckades med att uppdatera listans merge-preferens' });
    }
  });


  // ----- Rutter under /api (utan configHash i URL) -----
  
  // Skapa ny konfiguration
  router.post('/config/create', async (req, res) => {
    try {
      const config = { ...defaultConfig, ...req.body, lastUpdated: new Date().toISOString() };
      const configHash = await compressConfig(config);
      res.json({ success: true, configHash });
    } catch (error) {
      console.error('Fel vid skapande av konfiguration:', error);
      res.status(500).json({ error: 'Misslyckades med att skapa konfiguration' });
    }
  });
  
  // Validera API-nycklar (oberoende av specifik configHash)
  router.post('/validate-keys', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      const results = { mdblist: null, rpdb: null };
      if (apiKey) {
        const mdblistResult = await validateMDBListKey(apiKey);
        if (mdblistResult) results.mdblist = { valid: true, username: mdblistResult.username };
      }
      if (rpdbApiKey) {
        results.rpdb = { valid: await validateRPDBKey(rpdbApiKey) };
      }
      res.json(results);
    } catch (error) {
      console.error('Fel vid validering av nycklar:', error);
      res.status(500).json({ error: 'Misslyckades med att validera nycklar' });
    }
  });
  
  // Trakt login redirect (oberoende av configHash initialt)
  router.get('/trakt/login', (req, res) => {
    try {
      const authUrl = getTraktAuthUrl();
      res.redirect(authUrl);
    } catch (error) {
      console.error('Fel i Trakt login:', error);
      res.status(500).json({ error: 'Internt serverfel' });
    }
  });

  // Endpoint för att få listor (används av frontend)
  // Kräver configHash för att veta vilka listor som ska visas
  router.get('/:configHash/lists', async (req, res) => {
    try {
        let allUserLists = [];
        if (req.userConfig.apiKey) {
            const mdbLists = await fetchAllMDBLists(req.userConfig.apiKey);
            allUserLists.push(...mdbLists.map(l => ({...l, source: 'mdblist'})));
        }
        if (req.userConfig.traktAccessToken) {
            const traktLists = await fetchTraktUserLists(req.userConfig);
            allUserLists.push(...traktLists.map(l => ({...l, source: 'trakt'})));
        }

        const removedListsSet = new Set(req.userConfig.removedLists || []);
        let configChangedDueToMetadataFetch = false;

        // Initialize listsMetadata if it doesn't exist
        if (!req.userConfig.listsMetadata) {
            req.userConfig.listsMetadata = {};
        }

        const processedListsPromises = allUserLists
            .filter(list => !removedListsSet.has(String(list.id)))
            .map(async list => {
                const listIdStr = String(list.id);
                let metadata = req.userConfig.listsMetadata[listIdStr] || {};
                
                // Determine hasMovies and hasShows if not already known
                if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
                    console.log(`Metadata for ${listIdStr} (hasMovies/hasShows) is missing. Determining types.`);
                    // Use a minimal fetch to determine types; fetchListContent might be too heavy.
                    // Ideally, fetchListContent would have a lightweight mode or use a dedicated function.
                    // For now, we use existing fetchListContent but this is what slows down manifest.
                    const tempContent = await fetchListContent(listIdStr, req.userConfig, 0); // skip 0, use default sort

                    if (tempContent) {
                        metadata.hasMovies = tempContent.movies?.length > 0 || tempContent.hasMovies === true;
                        metadata.hasShows = tempContent.shows?.length > 0 || tempContent.hasShows === true;
                    } else {
                        // Fallback if content fetch fails or returns null
                        metadata.hasMovies = list.isMovieList === true; // Use list flags if available
                        metadata.hasShows = list.isShowList === true;
                        if (list.isMovieList !== true && list.isShowList !== true) { // If no flags, assume false to be safe
                            metadata.hasMovies = false;
                            metadata.hasShows = false;
                        }
                    }
                    req.userConfig.listsMetadata[listIdStr] = metadata;
                    configChangedDueToMetadataFetch = true;
                    console.log(`Determined for ${listIdStr} - hasMovies: ${metadata.hasMovies}, hasShows: ${metadata.hasShows}`);
                }

                let tagType = list.listType || 'L';
                if (list.source === 'trakt') tagType = 'T';
                if (list.isWatchlist) tagType = 'W';

                return {
                    id: listIdStr,
                    name: list.name,
                    customName: req.userConfig.customListNames?.[listIdStr] || null,
                    isHidden: (req.userConfig.hiddenLists || []).includes(listIdStr),
                    hasMovies: metadata.hasMovies, // Use determined/stored metadata
                    hasShows: metadata.hasShows,   // Use determined/stored metadata
                    isExternalList: !!list.isExternalList,
                    isTraktList: list.source === 'trakt' && list.isTraktList, // Ensure it's a custom list
                    isTraktWatchlist: list.source === 'trakt' && list.isTraktWatchlist,
                    // Add other Trakt list type flags if needed for sort UI
                    isTraktRecommendations: list.isTraktRecommendations,
                    isTraktTrending: list.isTraktTrending,
                    isTraktPopular: list.isTraktPopular,
                    isWatchlist: !!list.isWatchlist,
                    tag: tagType,
                    tagImage: list.source === 'trakt' ? 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico' : null, // Simplified
                    sortPreferences: req.userConfig.sortPreferences?.[listIdStr] || 
                                     { sort: (list.isTraktList || list.isTraktWatchlist) ? 'rank' : 'imdbvotes', 
                                       order: (list.isTraktList || list.isTraktWatchlist) ? 'asc' : 'desc' },
                    isMerged: req.userConfig.mergedLists?.[listIdStr] !== false,
                };
            });
        
        let processedLists = await Promise.all(processedListsPromises);

        // Add imported addon-listor (metadata for these should be part of addon manifest)
        if (req.userConfig.importedAddons) {
            for (const addon of Object.values(req.userConfig.importedAddons)) {
                const addonCatalogs = addon.catalogs
                    .filter(catalog => !removedListsSet.has(String(catalog.id)))
                    .map(catalog => {
                        const catalogIdStr = String(catalog.id);
                        // For imported addons, hasMovies/hasShows usually derived from catalog.type
                        const catType = catalog.type === 'anime' ? 'series' : catalog.type;
                        const hasMovies = catType === 'movie' || catType === 'all';
                        const hasShows = catType === 'series' || catType === 'all' || catType === 'anime';
                         // Ensure metadata is stored if not already
                        if (!req.userConfig.listsMetadata[catalogIdStr] || 
                            typeof req.userConfig.listsMetadata[catalogIdStr].hasMovies !== 'boolean') {
                            req.userConfig.listsMetadata[catalogIdStr] = {
                                ...req.userConfig.listsMetadata[catalogIdStr],
                                hasMovies,
                                hasShows
                            };
                            configChangedDueToMetadataFetch = true;
                        }


                        return {
                            id: catalogIdStr,
                            name: catalog.name,
                            customName: req.userConfig.customListNames?.[catalogIdStr] || null,
                            isHidden: (req.userConfig.hiddenLists || []).includes(catalogIdStr),
                            hasMovies: req.userConfig.listsMetadata[catalogIdStr].hasMovies,
                            hasShows: req.userConfig.listsMetadata[catalogIdStr].hasShows,
                            isExternalList: true, 
                            addonId: addon.id,
                            addonName: addon.name,
                            tag: 'A', 
                            tagImage: addon.logo,
                            sortPreferences: req.userConfig.sortPreferences?.[catalogIdStr] || { sort: 'imdbvotes', order: 'desc' },
                            isMerged: req.userConfig.mergedLists?.[catalogIdStr] !== false, // Default to true for imported unless specified
                        };
                    });
                processedLists.push(...addonCatalogs);
            }
        }
        
        // Sortera listor baserat på config.listOrder
        if (req.userConfig.listOrder?.length > 0) {
          const orderMap = new Map(req.userConfig.listOrder.map((id, index) => [String(id), index]));
          processedLists.sort((a, b) => {
              // Jämför med det rena ID:t (utan prefix/suffix)
              const cleanAId = String(a.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
              const cleanBId = String(b.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '');
              const indexA = orderMap.get(cleanAId) ?? Infinity;
              const indexB = orderMap.get(cleanBId) ?? Infinity;
              return indexA - indexB;
          });
      }
        
        let responsePayload = {
            success: true,
            lists: processedLists,
            importedAddons: req.userConfig.importedAddons || {},
            availableSortOptions: req.userConfig.availableSortOptions || defaultConfig.availableSortOptions,
            traktSortOptions: req.userConfig.traktSortOptions || defaultConfig.traktSortOptions
        };

        if (configChangedDueToMetadataFetch) {
            console.log("Lists metadata was updated, re-compressing config.");
            req.userConfig.lastUpdated = new Date().toISOString();
            const newConfigHash = await compressConfig(req.userConfig);
            manifestCache.clear();
            responsePayload.newConfigHash = newConfigHash;
        }

        res.json(responsePayload);
    } catch (error) {
        console.error('Fel vid hämtning av listor:', error);
        res.status(500).json({ error: 'Misslyckades med att hämta listor', details: error.message });
    }
  });
};