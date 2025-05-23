// src/routes/api.js
const path = require('path');
const { defaultConfig } = require('../config');
const { compressConfig, decompressConfig } = require('../utils/urlConfig');
const { createAddon, fetchListContent } = require('../addon/addonBuilder');
const { convertToStremioFormat } = require('../addon/converters');
const { setCacheHeaders } = require('../utils/common');
const Cache = require('../utils/cache');

const { validateRPDBKey } = require('../utils/posters');
const { authenticateTrakt, getTraktAuthUrl, fetchTraktLists: fetchTraktUserLists, fetchPublicTraktListDetails } = require('../integrations/trakt');
const { fetchAllLists: fetchAllMDBLists, fetchListItems: fetchMDBListItemsDirect, validateMDBListKey, extractListFromUrl: extractMDBListFromUrl } = require('../integrations/mdblist');
const { importExternalAddon: importExtAddon } = require('../integrations/externalAddons');

const manifestCache = new Cache({ defaultTTL: 1 * 60 * 1000 }); // Re-enable cache with 1 min TTL

module.exports = function(router) {
  router.param('configHash', async (req, res, next, configHash) => {
    try {
      req.userConfig = await decompressConfig(configHash);
      req.configHash = configHash;
      next();
    } catch (error) {
      console.error('Error decompressing configHash:', configHash, error);
      if (!res.headersSent) { return res.redirect('/configure'); }
      next(error);
    }
  });

  router.get('/:configHash/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  // Re-enable manifest caching
  router.get('/:configHash/manifest.json', async (req, res) => {
    try {
      const cacheKey = `manifest_${req.configHash}`;
      let addonInterface = manifestCache.get(cacheKey);
      if (!addonInterface) {
        addonInterface = await createAddon(req.userConfig);
        manifestCache.set(cacheKey, addonInterface);
      }
      setCacheHeaders(res, null);
      res.json(addonInterface.manifest);
    } catch (error) {
      console.error('Error serving manifest:', error);
      res.status(500).json({ error: 'Failed to serve manifest' });
    }
  });

  router.get('/:configHash/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
      const { type, id } = req.params;
      const skip = parseInt(req.query.skip || req.params.extra?.match(/skip=(\d+)/)?.[1]) || 0;
      setCacheHeaders(res, id);
      const items = await fetchListContent(id, req.userConfig, skip);
      if (!items) return res.json({ metas: [] });
      let metas = await convertToStremioFormat(items, req.userConfig.rpdbApiKey);
      if (type !== 'all' && type !== 'movie' && type !== 'series') return res.json({ metas: [] });
      if (type !== 'all') metas = metas.filter(meta => meta.type === type);
      res.json({ metas });
    } catch (error) {
      console.error('Error in catalog endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:configHash/config', (req, res) => {
    const configToSend = JSON.parse(JSON.stringify(req.userConfig));
    configToSend.hiddenLists = Array.from(new Set(configToSend.hiddenLists || []));
    configToSend.removedLists = Array.from(new Set(configToSend.removedLists || []));
    res.json({ success: true, config: configToSend });
  });
  
  router.post('/:configHash/apikey', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      let configChanged = false;
      if (req.userConfig.rpdbApiKey !== rpdbApiKey) { req.userConfig.rpdbApiKey = rpdbApiKey || ''; configChanged = true; }
      if (req.userConfig.apiKey !== apiKey) { req.userConfig.apiKey = apiKey || ''; configChanged = true; }
      
      if (configChanged) {
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear(); 
        return res.json({ success: true, configHash: newConfigHash });
      }
      return res.json({ success: true, configHash: req.configHash, message: "API keys unchanged" });
    } catch (error) {
      console.error('Error in /apikey:', error);
      res.status(500).json({ error: 'Internal server error in /apikey' });
    }
  });

  router.post('/:configHash/trakt/auth', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Authorization code required' });
        const traktTokens = await authenticateTrakt(code);
        req.userConfig.traktAccessToken = traktTokens.accessToken;
        req.userConfig.traktRefreshToken = traktTokens.refreshToken;
        req.userConfig.traktExpiresAt = traktTokens.expiresAt;
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ 
            success: true, 
            configHash: newConfigHash, 
            accessToken: traktTokens.accessToken,
            refreshToken: traktTokens.refreshToken,
            expiresAt: traktTokens.expiresAt,
            message: 'Authenticated with Trakt' 
        });
    } catch (error) {
        console.error('Error in /trakt/auth:', error);
        res.status(500).json({ error: 'Failed to authenticate with Trakt', details: error.message });
    }
  });

  router.post('/:configHash/trakt/disconnect', async (req, res) => {
    try {
        req.userConfig.traktAccessToken = null; req.userConfig.traktRefreshToken = null; req.userConfig.traktExpiresAt = null;
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Disconnected from Trakt' });
    } catch (error) {
        console.error('Error in /trakt/disconnect:', error);
        res.status(500).json({ error: 'Failed to disconnect from Trakt', details: error.message });
    }
  });
  
  router.post('/:configHash/import-list-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'List URL required' });
        let importedListDetails;
        let addonId; 
        let sourceSystem;
        let listNameForDisplay;
        let isUrlImportedFlag = true;

        if (url.includes('mdblist.com/lists/')) {
            if (!req.userConfig.apiKey) return res.status(400).json({ error: 'MDBList API key required' });
            importedListDetails = await extractMDBListFromUrl(url, req.userConfig.apiKey);
            addonId = `mdblisturl_${importedListDetails.listId}`;
            listNameForDisplay = importedListDetails.listName;
            sourceSystem = "MDBList";
            importedListDetails.isMDBListUrlImport = true;
        } else if (url.includes('trakt.tv/users/') && url.includes('/lists/')) {
            importedListDetails = await fetchPublicTraktListDetails(url);
            addonId = importedListDetails.listId; 
            listNameForDisplay = importedListDetails.listName;
            sourceSystem = "Trakt Public";
            importedListDetails.isTraktPublicList = true;
        } else {
            return res.status(400).json({ error: 'Invalid or unsupported URL.' });
        }
        
        if (!req.userConfig.importedAddons) req.userConfig.importedAddons = {};
        if (req.userConfig.importedAddons[addonId]) {
             return res.status(400).json({ error: `List "${listNameForDisplay}" from ${sourceSystem} with ID ${addonId} is already imported.` });
        }

        if (!importedListDetails.hasMovies && !importedListDetails.hasShows) {
            return res.status(400).json({ error: `List "${listNameForDisplay}" from ${sourceSystem} contains no movie or show content.` });
        }

        const catalogs = [];
        const idPrefixForCatalog = addonId;

        if (importedListDetails.hasMovies) {
            catalogs.push({ 
                id: `${idPrefixForCatalog}_movies`, 
                originalId: importedListDetails.originalTraktSlug || importedListDetails.listId,
                name: `${listNameForDisplay} (Movies)`, type: 'movie', url: url,
                traktUser: importedListDetails.traktUser, traktListSlug: importedListDetails.originalTraktSlug 
            });
        }
        if (importedListDetails.hasShows) {
            catalogs.push({ 
                id: `${idPrefixForCatalog}_series`, 
                originalId: importedListDetails.originalTraktSlug || importedListDetails.listId,
                name: `${listNameForDisplay} (Series)`, type: 'series', url: url, 
                traktUser: importedListDetails.traktUser, traktListSlug: importedListDetails.originalTraktSlug 
            });
        }
        
        if (catalogs.length === 0) {
             return res.status(400).json({ error: `List "${listNameForDisplay}" catalogs could not be created.` });
        }
        
        req.userConfig.importedAddons[addonId] = {
            id: addonId, 
            name: `${sourceSystem}: ${listNameForDisplay}`,
            version: '1.0.0', description: `Imported from ${sourceSystem} URL: ${url}`,
            catalogs: catalogs, types: [...new Set(catalogs.map(c => c.type))],
            resources: ['catalog', 'meta'], url: url,
            isUrlImported: isUrlImportedFlag,
            isTraktPublicList: !!importedListDetails.isTraktPublicList,
            traktUser: importedListDetails.traktUser, 
            traktListSlug: importedListDetails.originalTraktSlug,
            isMDBListUrlImport: !!importedListDetails.isMDBListUrlImport,
            mdblistId: sourceSystem === "MDBList" ? importedListDetails.listId : undefined
        };
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, addon: req.userConfig.importedAddons[addonId], message: `Imported ${listNameForDisplay} from ${sourceSystem}` });
    } catch (error) {
        console.error('Error in /import-list-url:', error);
        res.status(500).json({ error: error.message || `Failed to import URL` });
    }
  });

  router.post('/:configHash/import-addon', async (req, res) => {
    try {
        const { manifestUrl } = req.body;
        if (!manifestUrl) return res.status(400).json({ error: 'Manifest URL required' });
        const addonInfo = await importExtAddon(manifestUrl);
        if (!req.userConfig.importedAddons) req.userConfig.importedAddons = {};
        if (req.userConfig.importedAddons[addonInfo.id]) {
            return res.status(400).json({ error: `Addon with ID ${addonInfo.id} (${addonInfo.name}) is already imported.`});
        }
        addonInfo.isUrlImported = false;
        req.userConfig.importedAddons[addonInfo.id] = addonInfo;
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, addon: addonInfo, message: `Imported ${addonInfo.name}` });
    } catch (error) {
        console.error('Error in /import-addon:', error);
        res.status(500).json({ error: 'Failed to import addon by manifest', details: error.message });
    }
  });
  
  router.post('/:configHash/remove-addon', async (req, res) => {
    try {
        const { addonId } = req.body;
        if (!addonId || !req.userConfig.importedAddons || !req.userConfig.importedAddons[addonId]) {
            return res.status(400).json({ error: 'Invalid addon ID' });
        }
        delete req.userConfig.importedAddons[addonId];
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Addon group removed' });
    } catch (error) {
        console.error('Error in /remove-addon:', error);
        res.status(500).json({ error: 'Failed to remove addon group', details: error.message });
    }
  });

  router.post('/:configHash/lists/order', async (req, res) => {
    try {
        const { order } = req.body; 
        if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array of strings.' });
        req.userConfig.listOrder = order.map(String);
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear(); 
        res.json({ success: true, configHash: newConfigHash, message: 'List order updated' });
    } catch (error) { 
        console.error('Failed to update list order:', error);
        res.status(500).json({ error: 'Failed to update list order' }); 
    }
  });
  
  router.post('/:configHash/lists/names', async (req, res) => {
    try {
      const { listId, customName } = req.body;
      if (!listId) return res.status(400).json({ error: 'List ID required' });
      if (!req.userConfig.customListNames) req.userConfig.customListNames = {};
      if (customName && customName.trim()) {
        req.userConfig.customListNames[String(listId)] = customName.trim();
      } else {
        delete req.userConfig.customListNames[String(listId)];
      }
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'List name updated' });
    } catch (error) { 
        console.error('Failed to update list name:', error);
        res.status(500).json({ error: 'Failed to update list name' }); 
    }
  });

  router.post('/:configHash/lists/visibility', async (req, res) => {
    try {
      const { hiddenLists } = req.body; 
      if (!Array.isArray(hiddenLists)) return res.status(400).json({ error: 'Hidden lists must be an array of strings.' });
      req.userConfig.hiddenLists = hiddenLists.map(String); 
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'List visibility updated' });
    } catch (error) { 
        console.error('Failed to update list visibility:', error);
        res.status(500).json({ error: 'Failed to update list visibility' }); 
    }
  });

  router.post('/:configHash/lists/remove', async (req, res) => {
    try {
      const { listIds } = req.body; 
      if (!Array.isArray(listIds)) return res.status(400).json({ error: 'List IDs must be an array of strings.' });
      const currentRemoved = new Set(req.userConfig.removedLists || []);
      listIds.forEach(id => currentRemoved.add(String(id)));
      req.userConfig.removedLists = Array.from(currentRemoved);
      if (req.userConfig.hiddenLists) {
          req.userConfig.hiddenLists = (req.userConfig.hiddenLists || []).filter(id => !listIds.includes(String(id)));
      }
      listIds.forEach(listIdToRemove => {
          if (req.userConfig.customListNames) delete req.userConfig.customListNames[String(listIdToRemove)];
          if (req.userConfig.mergedLists) delete req.userConfig.mergedLists[String(listIdToRemove)];
      });
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'Lists removed' });
    } catch (error) { 
        console.error('Failed to remove lists:', error);
        res.status(500).json({ error: 'Failed to remove lists' });
    }
  });

  router.post('/:configHash/lists/sort', async (req, res) => {
    try {
      const { listId, sort, order } = req.body;
      if (!listId || !sort) return res.status(400).json({ error: 'List ID (originalId) and sort field required' });
      if (!req.userConfig.sortPreferences) req.userConfig.sortPreferences = {};
      req.userConfig.sortPreferences[String(listId)] = { sort, order: order || 'desc' };
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear(); 
      res.json({ success: true, configHash: newConfigHash, message: 'Sort preferences updated' });
    } catch (error) { 
        console.error('Failed to update sort preferences:', error);
        res.status(500).json({ error: 'Failed to update sort preferences' });
    }
  });
  
  router.post('/:configHash/lists/merge', async (req, res) => {
    try {
        const { listId, merged } = req.body;
        if (!listId || typeof merged !== 'boolean') {
            return res.status(400).json({ error: 'List ID (manifestId) and merge preference required' });
        }
        if (!req.userConfig.mergedLists) req.userConfig.mergedLists = {};
        req.userConfig.mergedLists[String(listId)] = merged;
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: `List ${merged ? 'merged' : 'split'}` });
    } catch (error) { 
        console.error('Failed to update list merge preference:', error);
        res.status(500).json({ error: 'Failed to update list merge preference' });
    }
  });

  router.post('/config/create', async (req, res) => {
    try {
      const initialStructure = {
        listOrder: [], hiddenLists: [], removedLists: [],
        customListNames: {}, mergedLists: {}, sortPreferences: {},
        importedAddons: {}, listsMetadata: {}
      };
      const config = { ...defaultConfig, ...initialStructure, ...req.body, lastUpdated: new Date().toISOString() };
      const configHash = await compressConfig(config);
      res.json({ success: true, configHash });
    } catch (error) { 
        console.error('Error in /config/create:', error);
        res.status(500).json({ error: 'Failed to create configuration' });
    }
  });
  
  router.post('/validate-keys', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      const results = { mdblist: null, rpdb: null };
      if (apiKey) {
        const mdblistResult = await validateMDBListKey(apiKey);
        results.mdblist = (mdblistResult && mdblistResult.username) ? { valid: true, username: mdblistResult.username } : { valid: false };
      }
      if (rpdbApiKey) {
        results.rpdb = { valid: await validateRPDBKey(rpdbApiKey) };
      }
      res.json(results);
    } catch (error) { 
        console.error('Error in /validate-keys:', error);
        res.status(500).json({ error: 'Failed to validate keys' });
    }
  });
  
  router.get('/trakt/login', (req, res) => {
    try { res.redirect(getTraktAuthUrl()); }
    catch (error) { 
        console.error('Error in /trakt/login redirect:', error);
        res.status(500).json({ error: 'Internal server error for Trakt login' });
    }
  });

  router.get('/:configHash/lists', async (req, res) => {
    try {
        let allUserLists = [];
        if (req.userConfig.apiKey) {
            const mdbLists = await fetchAllMDBLists(req.userConfig.apiKey);
            allUserLists.push(...mdbLists.map(l => ({...l, source: 'mdblist', isUrlImportedType: false})));
        }
        if (req.userConfig.traktAccessToken) {
            const traktLists = await fetchTraktUserLists(req.userConfig); 
            allUserLists.push(...traktLists.map(l => ({...l, source: 'trakt', isUrlImportedType: false })));
        }

        const removedListsSet = new Set(req.userConfig.removedLists || []);
        let configChangedDueToMetadataFetch = false;
        if (!req.userConfig.listsMetadata) req.userConfig.listsMetadata = {};
        
        const processedListsPromises = allUserLists
            .filter(list => {
                let potentialManifestId = String(list.id);
                 if (list.source === 'mdblist') {
                    potentialManifestId = list.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${list.id}-${list.listType || 'L'}`;
                }
                return !removedListsSet.has(potentialManifestId);
            })
            .map(async list => {
                const listIdStr = String(list.id);
                let metadata = req.userConfig.listsMetadata[listIdStr] || {};
                let manifestListId = listIdStr;
                let listTypeForTag = list.listType || 'L';
                if (list.source === 'mdblist') {
                    manifestListId = list.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${list.id}-${listTypeForTag}`;
                } else if (list.source === 'trakt'){
                    manifestListId = list.id;
                }

                if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
                    const tempContent = await fetchListContent(manifestListId, req.userConfig, 0); 
                    metadata.hasMovies = tempContent?.movies?.length > 0 || tempContent?.hasMovies === true;
                    metadata.hasShows = tempContent?.shows?.length > 0 || tempContent?.hasShows === true;
                    req.userConfig.listsMetadata[listIdStr] = metadata;
                    configChangedDueToMetadataFetch = true;
                }

                let tagType = listTypeForTag;
                if (list.source === 'trakt') tagType = 'T';
                if (list.isWatchlist) tagType = 'W';
                
                return {
                    id: manifestListId, originalId: listIdStr, name: list.name,
                    customName: req.userConfig.customListNames?.[manifestListId] || null,
                    isHidden: (req.userConfig.hiddenLists || []).includes(manifestListId),
                    hasMovies: metadata.hasMovies, hasShows: metadata.hasShows,   
                    isTraktList: list.source === 'trakt' && list.isTraktList, 
                    isTraktWatchlist: list.source === 'trakt' && list.isTraktWatchlist,
                    isTraktRecommendations: list.isTraktRecommendations,
                    isTraktTrending: list.isTraktTrending,
                    isTraktPopular: list.isTraktPopular,
                    isWatchlist: !!list.isWatchlist,
                    tag: tagType, listType: list.listType,
                    tagImage: list.source === 'trakt' ? 'https://trakt.tv/favicon.ico' : null,
                    sortPreferences: req.userConfig.sortPreferences?.[listIdStr] || 
                                     { sort: (list.source === 'trakt') ? 'rank' : 'imdbvotes', 
                                       order: (list.source === 'trakt') ? 'asc' : 'desc' },
                    isMerged: req.userConfig.mergedLists?.[manifestListId] !== false,
                    source: list.source 
                };
            });
        
        let processedLists = await Promise.all(processedListsPromises);

        if (req.userConfig.importedAddons) {
            for (const addonKey in req.userConfig.importedAddons) {
                const addon = req.userConfig.importedAddons[addonKey];
                if (removedListsSet.has(addon.id)) continue;
                addon.catalogs.forEach(catalog => {
                    const catalogIdStr = String(catalog.id); 
                    if (removedListsSet.has(catalogIdStr)) return;
                    let metadata = req.userConfig.listsMetadata[catalogIdStr] || {};
                    if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
                        metadata.hasMovies = catalog.type === 'movie';
                        metadata.hasShows = catalog.type === 'series';
                    }
                    let tagType = 'A'; let tagImage = addon.logo;
                    if(addon.isMDBListUrlImport) { tagType = 'L'; tagImage = null; }
                    else if (addon.isTraktPublicList) { tagType = 'T'; tagImage = 'https://trakt.tv/favicon.ico'; }

                    processedLists.push({
                        id: catalogIdStr, originalId: catalog.originalId || catalogIdStr, name: catalog.name, 
                        customName: req.userConfig.customListNames?.[catalogIdStr] || null,
                        isHidden: (req.userConfig.hiddenLists || []).includes(catalogIdStr),
                        hasMovies: metadata.hasMovies, hasShows: metadata.hasShows,
                        addonId: addon.id, addonName: addon.name,
                        tag: tagType, tagImage: tagImage,
                        sortPreferences: req.userConfig.sortPreferences?.[catalog.originalId || catalogIdStr] || 
                                         { sort: (addon.isTraktPublicList ? 'rank' : 'imdbvotes'), 
                                           order: (addon.isTraktPublicList ? 'asc' : 'desc') },
                        isMerged: req.userConfig.mergedLists?.[catalogIdStr] !== false,
                        source: addon.isMDBListUrlImport ? 'mdblist_url' : (addon.isTraktPublicList ? 'trakt_public' : 'addon_manifest'),
                        isUrlImportedType: !!addon.isUrlImported,
                        isMDBListUrlImport: !!addon.isMDBListUrlImport,
                        isTraktPublicList: !!addon.isTraktPublicList,
                        traktUser: addon.traktUser, traktListSlug: addon.traktListSlug
                    });
                });
            }
        }
        
        if (req.userConfig.listOrder?.length > 0) {
            const orderMap = new Map(req.userConfig.listOrder.map((id, index) => [String(id), index]));
            processedLists.sort((a, b) => {
                const indexA = orderMap.get(String(a.id));
                const indexB = orderMap.get(String(b.id));
                if (indexA !== undefined && indexB !== undefined) return indexA - indexB;
                if (indexA !== undefined) return -1; 
                if (indexB !== undefined) return 1;  
                return 0; 
            });
        }
        
        let responsePayload = {
            success: true, lists: processedLists,
            importedAddons: req.userConfig.importedAddons || {},
            availableSortOptions: req.userConfig.availableSortOptions || defaultConfig.availableSortOptions,
            traktSortOptions: req.userConfig.traktSortOptions || defaultConfig.traktSortOptions,
            listsMetadata: req.userConfig.listsMetadata
        };

        if (configChangedDueToMetadataFetch) {
            req.userConfig.lastUpdated = new Date().toISOString();
            const newConfigHash = await compressConfig(req.userConfig);
            responsePayload.newConfigHash = newConfigHash;
        }
        res.json(responsePayload);
    } catch (error) {
        console.error('Error fetching /lists:', error);
        res.status(500).json({ error: 'Failed to fetch lists', details: error.message });
    }
  });
};