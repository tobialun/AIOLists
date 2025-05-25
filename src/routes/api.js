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

const manifestCache = new Cache({ defaultTTL: 1 * 60 * 1000 }); // 1 minute for manifest

module.exports = function(router) {
  router.param('configHash', async (req, res, next, configHash) => {
    try {
      req.userConfig = await decompressConfig(configHash);
      req.configHash = configHash;
      next();
    } catch (error) {
      console.error('Error decompressing configHash:', configHash, error);
      if (!res.headersSent) { return res.redirect('/configure'); } // Redirect if possible
      next(error); // Pass error to Express error handler
    }
  });

  // Serve main configuration page
  router.get('/:configHash/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  // Serve manifest.json
  router.get('/:configHash/manifest.json', async (req, res) => {
    try {
      const cacheKey = `manifest_${req.configHash}`;
      let addonInterface = manifestCache.get(cacheKey);
      if (!addonInterface) {
        addonInterface = await createAddon(req.userConfig);
        manifestCache.set(cacheKey, addonInterface);
      }
      setCacheHeaders(res, null); // No specific list ID for manifest itself
      res.json(addonInterface.manifest);
    } catch (error) {
      console.error('Error serving manifest:', error);
      res.status(500).json({ error: 'Failed to serve manifest' });
    }
  });

  // Serve catalog content
  router.get('/:configHash/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
      const { type, id } = req.params;
      const skip = parseInt(req.query.skip || req.params.extra?.match(/skip=(\d+)/)?.[1]) || 0;
      const genre = req.query.genre || req.params.extra?.match(/genre=([^&]+)/)?.[1] || null; // Extract genre

      setCacheHeaders(res, id); // Set cache headers based on list ID

      const items = await fetchListContent(id, req.userConfig, skip, genre); // Pass genre
      if (!items) return res.json({ metas: [] });

      let metas = await convertToStremioFormat(items, req.userConfig.rpdbApiKey);

      // Filter by type (movie/series) if not 'all'
      if (type !== 'all' && (type === 'movie' || type === 'series')) {
        metas = metas.filter(meta => meta.type === type);
      } else if (type !== 'all') { // Invalid type if not movie, series, or all
        return res.json({ metas: [] });
      }
      
      // Fallback genre filtering if not handled by fetchListContent
      if (genre && metas.length > 0) {
        const isPotentiallyUnfiltered = metas.some(meta => !(meta.genres && meta.genres.includes(genre)));
        if (isPotentiallyUnfiltered) {
            metas = metas.filter(meta => meta.genres && meta.genres.includes(genre));
        }
      }

      res.json({ metas });
    } catch (error) {
      console.error('Error in catalog endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get current configuration
  router.get('/:configHash/config', (req, res) => {
    // Deep clone and ensure sets are arrays for JSON transport
    const configToSend = JSON.parse(JSON.stringify(req.userConfig));
    configToSend.hiddenLists = Array.from(new Set(configToSend.hiddenLists || []));
    configToSend.removedLists = Array.from(new Set(configToSend.removedLists || []));
    res.json({ success: true, config: configToSend });
  });
  
  // Update API keys
  router.post('/:configHash/apikey', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      let configChanged = false;

      // Normalize to empty string if null or undefined
      const newApiKey = apiKey || '';
      const newRpdbApiKey = rpdbApiKey || '';

      if (req.userConfig.rpdbApiKey !== newRpdbApiKey) {
        req.userConfig.rpdbApiKey = newRpdbApiKey;
        configChanged = true;
      }
      if (req.userConfig.apiKey !== newApiKey) {
        req.userConfig.apiKey = newApiKey;
        configChanged = true;
      }
      
      if (configChanged) {
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear(); // Invalidate manifest cache on config change
        return res.json({ success: true, configHash: newConfigHash });
      }
      return res.json({ success: true, configHash: req.configHash, message: "API keys unchanged" });
    } catch (error) {
      console.error('Error in /apikey:', error);
      res.status(500).json({ error: 'Internal server error in /apikey' });
    }
  });

  // Trakt Authentication
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
            // Return tokens for client-side, though server now stores them
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

  // Trakt Disconnect
  router.post('/:configHash/trakt/disconnect', async (req, res) => {
    try {
        req.userConfig.traktAccessToken = null;
        req.userConfig.traktRefreshToken = null;
        req.userConfig.traktExpiresAt = null;
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Disconnected from Trakt' });
    } catch (error) {
        console.error('Error in /trakt/disconnect:', error);
        res.status(500).json({ error: 'Failed to disconnect from Trakt', details: error.message });
    }
  });
  
  // Import List from URL
  router.post('/:configHash/import-list-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'List URL required' });

        let importedListDetails;
        let addonId; 
        let sourceSystem;
        let listNameForDisplay;

        if (url.includes('mdblist.com/lists/')) {
            if (!req.userConfig.apiKey) return res.status(400).json({ error: 'MDBList API key required' });
            importedListDetails = await extractMDBListFromUrl(url, req.userConfig.apiKey);
            addonId = `mdblisturl_${importedListDetails.listId}`; // Unique prefix for MDBList URL imports
            listNameForDisplay = importedListDetails.listName;
            sourceSystem = "MDBList";
        } else if (url.includes('trakt.tv/users/') && url.includes('/lists/')) {
            importedListDetails = await fetchPublicTraktListDetails(url);
            // Use the ID structure from fetchPublicTraktListDetails directly (e.g., traktpublic_username_slug)
            addonId = importedListDetails.listId; 
            listNameForDisplay = importedListDetails.listName;
            sourceSystem = "Trakt Public";
        } else {
            return res.status(400).json({ error: 'Invalid or unsupported URL. Must be a MDBList or Trakt public list URL.' });
        }
        
        if (!req.userConfig.importedAddons) req.userConfig.importedAddons = {};
        if (req.userConfig.importedAddons[addonId]) {
             // More specific error
             return res.status(400).json({ error: `List "${listNameForDisplay}" from ${sourceSystem} with ID ${addonId} is already imported.` });
        }

        // Check if list has content
        if (!importedListDetails.hasMovies && !importedListDetails.hasShows) {
            return res.status(400).json({ error: `List "${listNameForDisplay}" from ${sourceSystem} contains no movie or show content.` });
        }
        
        // Store structured addon info
        req.userConfig.importedAddons[addonId] = {
            id: addonId, // This is the key in importedAddons and also the manifest catalog ID
            name: `${sourceSystem}: ${listNameForDisplay}`, // Default name
            version: '1.0.0', // Placeholder version
            description: `Imported from ${sourceSystem} URL: ${url}`,
            url: url,
            isUrlImported: true,
            hasMovies: importedListDetails.hasMovies,
            hasShows: importedListDetails.hasShows,
            // Specific flags for logic later
            isTraktPublicList: sourceSystem === "Trakt Public",
            traktUser: sourceSystem === "Trakt Public" ? importedListDetails.traktUser : undefined, // Store Trakt user for public lists
            traktListSlug: sourceSystem === "Trakt Public" ? importedListDetails.originalTraktSlug : undefined, // Store Trakt slug
            isMDBListUrlImport: sourceSystem === "MDBList",
            mdblistId: sourceSystem === "MDBList" ? importedListDetails.listId : undefined, // Store MDBList original ID
            // For manifest generation (can be simplified if only one type)
            catalogs: [], // URL imports will be treated as a single "group" catalog initially
            types: [
                ...(importedListDetails.hasMovies ? ['movie'] : []),
                ...(importedListDetails.hasShows ? ['series'] : [])
            ],
            resources: ['catalog', 'meta'] // Standard resources
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

  // Import Addon from Manifest URL
  router.post('/:configHash/import-addon', async (req, res) => {
    try {
        const { manifestUrl } = req.body;
        if (!manifestUrl) return res.status(400).json({ error: 'Manifest URL required' });

        const addonInfo = await importExtAddon(manifestUrl); // Assuming this function is robust
        if (!req.userConfig.importedAddons) req.userConfig.importedAddons = {};

        // Check if addon with the same ID already exists
        if (req.userConfig.importedAddons[addonInfo.id]) {
            return res.status(400).json({ error: `Addon with ID ${addonInfo.id} (${addonInfo.name}) is already imported.`});
        }
        
        // Mark as not a direct URL list import (it's a full addon manifest)
        addonInfo.isUrlImported = false; 
        // Determine if it has movies/shows based on its own manifest types
        addonInfo.hasMovies = addonInfo.types.includes('movie');
        addonInfo.hasShows = addonInfo.types.includes('series');

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
  
  // Remove Imported Addon Group (works for both URL imports and manifest imports)
  router.post('/:configHash/remove-addon', async (req, res) => {
    try {
        const { addonId } = req.body; // addonId is the key in importedAddons (e.g., 'mdblisturl_123' or 'community.stremio.anime')
        if (!addonId || !req.userConfig.importedAddons || !req.userConfig.importedAddons[addonId]) {
            return res.status(400).json({ error: 'Invalid addon ID' });
        }

        delete req.userConfig.importedAddons[addonId];
        // Also ensure related settings like custom names, removed lists (if they used this ID) are cleaned up or handled.
        // For simplicity, direct deletion here. More complex cleanup might be needed.
        if(req.userConfig.customListNames) delete req.userConfig.customListNames[addonId];
        if(req.userConfig.mergedLists) delete req.userConfig.mergedLists[addonId];
        if(req.userConfig.sortPreferences) delete req.userConfig.sortPreferences[addonId];
        // If this addonId was in listOrder or hiddenLists, remove it
        if(req.userConfig.listOrder) req.userConfig.listOrder = req.userConfig.listOrder.filter(id => id !== addonId);
        if(req.userConfig.hiddenLists) req.userConfig.hiddenLists = req.userConfig.hiddenLists.filter(id => id !== addonId);
        if(req.userConfig.removedLists) req.userConfig.removedLists = req.userConfig.removedLists.filter(id => id !== addonId);


        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear();
        res.json({ success: true, configHash: newConfigHash, message: 'Addon group removed' });
    } catch (error) {
        console.error('Error in /remove-addon:', error);
        res.status(500).json({ error: 'Failed to remove addon group', details: error.message });
    }
  });

  // Update list order
  router.post('/:configHash/lists/order', async (req, res) => {
    try {
        const { order } = req.body; // Expects an array of list IDs in the new order
        if (!Array.isArray(order)) return res.status(400).json({ error: 'Order must be an array of strings.' });
        req.userConfig.listOrder = order.map(String); // Ensure all IDs are strings
        req.userConfig.lastUpdated = new Date().toISOString();
        const newConfigHash = await compressConfig(req.userConfig);
        manifestCache.clear(); 
        res.json({ success: true, configHash: newConfigHash, message: 'List order updated' });
    } catch (error) { 
        console.error('Failed to update list order:', error);
        res.status(500).json({ error: 'Failed to update list order' }); 
    }
  });
  
  // Update custom list names
  router.post('/:configHash/lists/names', async (req, res) => {
    try {
      const { listId, customName } = req.body; // listId here is the manifest ID
      if (!listId) return res.status(400).json({ error: 'List ID required' });
      if (!req.userConfig.customListNames) req.userConfig.customListNames = {};
      if (customName && customName.trim()) {
        req.userConfig.customListNames[String(listId)] = customName.trim();
      } else {
        delete req.userConfig.customListNames[String(listId)]; // Remove if name is empty
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

  // Update list visibility
  router.post('/:configHash/lists/visibility', async (req, res) => {
    try {
      const { hiddenLists } = req.body; // Expects an array of list IDs to hide
      if (!Array.isArray(hiddenLists)) return res.status(400).json({ error: 'Hidden lists must be an array of strings.' });
      req.userConfig.hiddenLists = hiddenLists.map(String); // Ensure all IDs are strings
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear();
      res.json({ success: true, configHash: newConfigHash, message: 'List visibility updated' });
    } catch (error) { 
        console.error('Failed to update list visibility:', error);
        res.status(500).json({ error: 'Failed to update list visibility' }); 
    }
  });

  // Remove lists (mark as removed)
  router.post('/:configHash/lists/remove', async (req, res) => {
    try {
      const { listIds } = req.body; // Expects an array of list IDs to remove
      if (!Array.isArray(listIds)) return res.status(400).json({ error: 'List IDs must be an array of strings.' });
      
      const currentRemoved = new Set(req.userConfig.removedLists || []);
      listIds.forEach(id => currentRemoved.add(String(id)));
      req.userConfig.removedLists = Array.from(currentRemoved);

      // Also remove from hiddenLists if present
      if (req.userConfig.hiddenLists) {
          req.userConfig.hiddenLists = (req.userConfig.hiddenLists || []).filter(id => !listIds.includes(String(id)));
      }
      // Clean up other settings for these lists
      listIds.forEach(listIdToRemove => {
          const idStr = String(listIdToRemove);
          if (req.userConfig.customListNames) delete req.userConfig.customListNames[idStr];
          if (req.userConfig.mergedLists) delete req.userConfig.mergedLists[idStr];
          // For sortPreferences, the key is originalId, which might be different.
          // This part needs careful handling if listId passed is manifestId.
          // For now, assume listId is the one used as key where applicable.
          // A better approach would be to find the originalId from the manifestId if needed.
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

  // Update sort preferences for a list
  router.post('/:configHash/lists/sort', async (req, res) => {
    try {
      const { listId, sort, order } = req.body; // listId here should be the originalId used for sorting keys
      if (!listId || !sort) return res.status(400).json({ error: 'List ID (originalId) and sort field required' });
      if (!req.userConfig.sortPreferences) req.userConfig.sortPreferences = {};
      req.userConfig.sortPreferences[String(listId)] = { sort, order: order || 'desc' }; // Default order to 'desc'
      req.userConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(req.userConfig);
      manifestCache.clear(); 
      res.json({ success: true, configHash: newConfigHash, message: 'Sort preferences updated' });
    } catch (error) { 
        console.error('Failed to update sort preferences:', error);
        res.status(500).json({ error: 'Failed to update sort preferences' });
    }
  });
  
  // Update merge preference for a list (split/merge movies & series)
  router.post('/:configHash/lists/merge', async (req, res) => {
    try {
        const { listId, merged } = req.body; // listId is the manifest ID
        if (!listId || typeof merged !== 'boolean') {
            return res.status(400).json({ error: 'List ID (manifestId) and merge preference (boolean) required' });
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

  // Create a new default configuration
  router.post('/config/create', async (req, res) => {
    try {
      // Start with a clean default structure, then overlay any body params (e.g., from URL query if any)
      const initialStructure = {
        listOrder: [], hiddenLists: [], removedLists: [],
        customListNames: {}, mergedLists: {}, sortPreferences: {},
        importedAddons: {}, listsMetadata: {}
      };
      // Merge defaultConfig, then initialStructure to ensure all keys are present, then req.body for overrides
      const config = { ...defaultConfig, ...initialStructure, ...req.body, lastUpdated: new Date().toISOString() };
      const configHash = await compressConfig(config);
      res.json({ success: true, configHash });
    } catch (error) { 
        console.error('Error in /config/create:', error);
        res.status(500).json({ error: 'Failed to create configuration' });
    }
  });
  
  // Validate API keys (MDBList, RPDB)
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
  
  // Redirect to Trakt login
  router.get('/trakt/login', (req, res) => {
    try { res.redirect(getTraktAuthUrl()); }
    catch (error) { 
        console.error('Error in /trakt/login redirect:', error);
        res.status(500).json({ error: 'Internal server error for Trakt login' });
    }
  });

  // Fetch combined lists for the configuration UI
  router.get('/:configHash/lists', async (req, res) => {
    try {
        let allUserLists = [];
        // Fetch MDBLists if API key is present
        if (req.userConfig.apiKey) {
            const mdbLists = await fetchAllMDBLists(req.userConfig.apiKey);
            allUserLists.push(...mdbLists.map(l => ({...l, source: 'mdblist'})));
        }
        // Fetch Trakt lists if authenticated
        if (req.userConfig.traktAccessToken) {
            const traktLists = await fetchTraktUserLists(req.userConfig); 
            allUserLists.push(...traktLists.map(l => ({...l, source: 'trakt'})));
        }

        const removedListsSet = new Set(req.userConfig.removedLists || []);
        let configChangedDueToMetadataFetch = false;
        if (!req.userConfig.listsMetadata) req.userConfig.listsMetadata = {};
        
        let processedLists = [];

        // Process native MDBList and Trakt lists
        const activeListsProcessingPromises = allUserLists
            .map(async list => {
                const originalListIdStr = String(list.id); // e.g., '12345' for MDB, 'watchlist' or 'trending_movies' for Trakt
                let manifestListId = originalListIdStr; // Default
                let defaultListTypeChar = 'L'; // Default MDBList type
                let tagType; // For UI display

                if (list.source === 'mdblist') {
                    const listTypeSuffix = list.listType || 'L'; // L, E, or W from MDBList fetch
                    manifestListId = list.id === 'watchlist' ? `aiolists-watchlist-W` : `aiolists-${list.id}-${listTypeSuffix}`;
                    tagType = listTypeSuffix;
                } else if (list.source === 'trakt'){
                    manifestListId = list.id; // e.g., trakt_watchlist, trakt_userlist_slug
                    tagType = 'T'; // Trakt
                } else {
                    // Should not happen with current logic but as a fallback
                    tagType = defaultListTypeChar;
                }
                
                if (list.isWatchlist) { // MDBList watchlist specifically
                    tagType = 'W';
                }

                if (removedListsSet.has(manifestListId)) return null; // Skip if removed

                // Fetch metadata (hasMovies, hasShows) if not already present
                let metadata = req.userConfig.listsMetadata[manifestListId] || req.userConfig.listsMetadata[originalListIdStr] || {};
                if (typeof metadata.hasMovies !== 'boolean' || typeof metadata.hasShows !== 'boolean') {
                  // Use a slimmed down config for this fetch to avoid loops or excessive data
                  const tempContent = await fetchListContent(manifestListId, { ...req.userConfig, rpdbApiKey: null }, 0); // No RPDB for this check
                  metadata.hasMovies = tempContent?.movies?.length > 0 || tempContent?.hasMovies === true;
                  metadata.hasShows = tempContent?.shows?.length > 0 || tempContent?.hasShows === true;
                  req.userConfig.listsMetadata[manifestListId] = metadata; // Store it back
                  configChangedDueToMetadataFetch = true;
                }
                
                return {
                    id: manifestListId, // ID used in manifest and for UI list items
                    originalId: originalListIdStr, // Original ID from source (MDBList numerical, Trakt slug/special ID)
                    name: list.name,
                    customName: req.userConfig.customListNames?.[manifestListId] || null,
                    isHidden: (req.userConfig.hiddenLists || []).includes(manifestListId),
                    hasMovies: metadata.hasMovies, 
                    hasShows: metadata.hasShows,   
                    // Trakt specific flags
                    isTraktList: list.source === 'trakt' && list.isTraktList, 
                    isTraktWatchlist: list.source === 'trakt' && list.isTraktWatchlist,
                    isTraktRecommendations: list.isTraktRecommendations,
                    isTraktTrending: list.isTraktTrending,
                    isTraktPopular: list.isTraktPopular,
                    // MDBList specific
                    isWatchlist: !!list.isWatchlist, // Generic watchlist flag
                    tag: tagType, // For UI: L, E, W, T
                    listType: list.listType, // Original MDBList type if available
                    tagImage: list.source === 'trakt' ? 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico' : null,
                    sortPreferences: req.userConfig.sortPreferences?.[originalListIdStr] || 
                                     { sort: (list.source === 'trakt') ? 'rank' : 'imdbvotes', 
                                       order: (list.source === 'trakt') ? 'asc' : 'desc' },
                    isMerged: (metadata.hasMovies && metadata.hasShows) ? (req.userConfig.mergedLists?.[manifestListId] !== false) : false,
                    source: list.source // 'mdblist' or 'trakt'
                };
            });
        
        const activeListsResults = (await Promise.all(activeListsProcessingPromises)).filter(p => p !== null);
        processedLists.push(...activeListsResults);

        // Process imported addons (both URL-based and manifest-based)
        if (req.userConfig.importedAddons) {
            for (const addonKey in req.userConfig.importedAddons) {
                const addon = req.userConfig.importedAddons[addonKey];
                const addonGroupId = String(addon.id); // This is the primary ID for the imported addon group/URL
                if (removedListsSet.has(addonGroupId)) continue;

                let currentListEntry = null;

                // Case 1: Imported via URL (MDBList or Trakt Public)
                if (addon.isUrlImported) {
                    // This addon group itself acts as a "list" in the UI if it has content
                    if ((addon.hasMovies || addon.hasShows) && !(req.userConfig.hiddenLists || []).includes(addonGroupId)) {
                        let tagType = 'A'; // Default for addon
                        let tagImage = addon.logo; // Use addon logo if available
                        if(addon.isMDBListUrlImport) { tagType = 'L'; tagImage = null; }
                        else if (addon.isTraktPublicList) { tagType = 'T'; tagImage = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico'; }
                        
                        // The originalId for sort prefs should be specific to the source if known
                        let sortOriginalId = addon.mdblistId || (addon.isTraktPublicList ? `traktpublic_${addon.traktUser}_${addon.traktListSlug}` : addonGroupId);

                        currentListEntry = {
                            id: addonGroupId, // Manifest/UI ID
                            originalId: sortOriginalId, 
                            name: addon.name, // User-facing name (can be customized)
                            customName: req.userConfig.customListNames?.[addonGroupId] || null,
                            isHidden: (req.userConfig.hiddenLists || []).includes(addonGroupId),
                            hasMovies: addon.hasMovies,
                            hasShows: addon.hasShows,
                            addonId: addonGroupId, // Reference to its own group ID
                            addonName: addon.name, // Original name of the addon group
                            tag: tagType, 
                            tagImage: tagImage,
                            sortPreferences: req.userConfig.sortPreferences?.[sortOriginalId] || 
                                             { sort: (addon.isTraktPublicList ? 'rank' : 'imdbvotes'), 
                                               order: (addon.isTraktPublicList ? 'asc' : 'desc') },
                            isMerged: (addon.hasMovies && addon.hasShows) ? (req.userConfig.mergedLists?.[addonGroupId] !== false) : false,
                            source: addon.isMDBListUrlImport ? 'mdblist_url' : (addon.isTraktPublicList ? 'trakt_public' : 'addon_url_import'),
                            isUrlImportedType: true, // Flag for UI
                            isMDBListUrlImport: !!addon.isMDBListUrlImport,
                            isTraktPublicList: !!addon.isTraktPublicList,
                            traktUser: addon.traktUser, 
                            traktListSlug: addon.traktListSlug
                        };
                        processedLists.push(currentListEntry);
                    }
                } 
                // Case 2: Imported via Manifest URL (external addon with its own catalogs)
                else if (addon.catalogs && addon.catalogs.length > 0) { 
                    (addon.catalogs || []).forEach(catalog => {
                        const catalogIdStr = String(catalog.id); // This is the unique ID AIOLists gives to the sub-catalog
                        if (removedListsSet.has(catalogIdStr) || (req.userConfig.hiddenLists || []).includes(catalogIdStr)) return;
                        
                        // Determine movie/show content based on catalog type and parent addon types
                        let catalogHasMovies = catalog.type === 'movie' || (catalog.type === 'all' && (addon.types?.includes('movie') || !!addon.hasMovies));
                        let catalogHasShows = catalog.type === 'series' || (catalog.type === 'all' && (addon.types?.includes('series') || !!addon.hasShows));

                        let tagType = 'A'; // Default for addon sub-catalog
                        let tagImage = addon.logo; // Use parent addon logo

                        // The originalId for sort prefs for sub-catalogs is their own originalId from the source manifest
                        let sortOriginalIdForSubCatalog = catalog.originalId || catalogIdStr;

                        processedLists.push({
                            id: catalogIdStr, // Manifest/UI ID for this specific sub-catalog
                            originalId: sortOriginalIdForSubCatalog, 
                            name: catalog.name, // Name from the sub-catalog's manifest entry
                            customName: req.userConfig.customListNames?.[catalogIdStr] || null,
                            isHidden: (req.userConfig.hiddenLists || []).includes(catalogIdStr),
                            hasMovies: catalogHasMovies, 
                            hasShows: catalogHasShows,
                            addonId: addon.id, // Parent addon group ID
                            addonName: addon.name, // Parent addon group name
                            tag: tagType, 
                            tagImage: tagImage,
                            sortPreferences: req.userConfig.sortPreferences?.[sortOriginalIdForSubCatalog] || 
                                             { sort: 'imdbvotes', order: 'desc' }, // Default sort for external catalogs
                            isMerged: false, // Sub-catalogs from manifests are typically not mergeable by AIOLists directly
                            source: 'addon_manifest', // Indicates it's a sub-catalog from an imported manifest
                            isUrlImportedType: false, // Not a direct URL import itself
                            isMDBListUrlImport: false, 
                            isTraktPublicList: false,
                        });
                    });
                }
            }
        }
        
        // Apply overall list order
        if (req.userConfig.listOrder?.length > 0) {
            const orderMap = new Map(req.userConfig.listOrder.map((id, index) => [String(id), index]));
            processedLists.sort((a, b) => {
                const indexA = orderMap.get(String(a.id));
                const indexB = orderMap.get(String(b.id));
                if (indexA !== undefined && indexB !== undefined) return indexA - indexB;
                if (indexA !== undefined) return -1; 
                if (indexB !== undefined) return 1;  
                return 0; // Keep original relative order for new/unsorted items
            });
        }
        
        let responsePayload = {
            success: true, lists: processedLists,
            importedAddons: req.userConfig.importedAddons || {},
            availableSortOptions: req.userConfig.availableSortOptions || defaultConfig.availableSortOptions,
            traktSortOptions: req.userConfig.traktSortOptions || defaultConfig.traktSortOptions,
            listsMetadata: req.userConfig.listsMetadata // Send back potentially updated metadata
        };

        // If metadata was fetched and changed config, provide new hash
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