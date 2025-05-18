const { validateRPDBKey } = require('../utils/posters');
const { authenticateTrakt, getTraktAuthUrl, fetchTraktLists } = require('../integrations/trakt');
const { fetchAllLists, fetchListItems, validateMDBListKey, extractListFromUrl } = require('../integrations/mdblist');
const { importExternalAddon, fetchExternalAddonItems } = require('../integrations/externalAddons');
const { rebuildAddon, convertToStremioFormat, fetchListContent } = require('../addon');
const { compressConfig, decompressConfig, defaultConfig } = require('../utils/urlConfig');
const path = require('path');
const { ITEMS_PER_PAGE } = require('../config');
const Cache = require('../cache');
const axios = require('axios');

// Create cache instances
const listsCache = new Cache({ defaultTTL: 30 * 60 * 1000 }); // 30 minutes
const metadataCache = new Cache({ defaultTTL: 60 * 60 * 1000 }); // 1 hour

/**
 * Generate cache key for lists
 * @param {string} configHash - Configuration hash
 * @returns {string} Cache key
 */
function getListsCacheKey(configHash) {
  return `lists_${configHash}`;
}

/**
 * Generate cache key for metadata
 * @param {string} listId - List ID
 * @param {number} skip - Skip value
 * @param {string} type - Content type
 * @returns {string} Cache key
 */
function getMetadataCacheKey(listId, skip, type) {
  return `metadata_${listId}_${skip}_${type}`;
}

/**
 * Rebuild the addon interface with the given configuration
 * @param {Object} config Configuration object
 * @returns {Promise<Object>} Updated addon interface
 */
async function rebuildAddonWithConfig(config) {
  try {
    return await rebuildAddon(config);
  } catch (error) {
    console.error('Error rebuilding addon:', error);
    throw error;
  }
}

function setupApiRoutes(app) {
  // Root endpoint - serve the UI
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  // Serve UI for configure endpoint
  app.get('/:configHash/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  // Serve manifest.json
  app.get('/:configHash/manifest.json', async (req, res) => {
    try {
      const { configHash } = req.params;
      if (!configHash) {
        return res.status(400).json({ error: 'Config hash is required' });
      }

      const config = await decompressConfig(configHash);
      
      // Create a cache key for this manifest based on relevant config parts
      // We only need to rebuild if lists, API keys, or imported addons change
      const manifestCacheKey = `manifest_${configHash}`;
      let manifest = null;
      
      // Check if we have the manifest cached
      if (metadataCache.has(manifestCacheKey)) {
        manifest = metadataCache.get(manifestCacheKey);
      } else {
        // If not cached, rebuild the addon interface
        const addonInterface = await rebuildAddonWithConfig(config);
        manifest = addonInterface.manifest;
        
        // Cache the manifest
        metadataCache.set(manifestCacheKey, manifest, 3600 * 1000); // Cache for 1 hour
      }

      // Set cache control headers
      res.setHeader('Cache-Control', 'max-age=3600, public'); // Cache for 1 hour

      // Add a timestamp to version to prevent aggressive caching
      const timestampedManifest = {
        ...manifest,
        version: `${manifest.version.split('-')[0]}-${Date.now()}`
      };

      res.json(timestampedManifest);
    } catch (error) {
      console.error('Error serving manifest:', error);
      res.status(500).json({ error: 'Failed to serve manifest' });
    }
  });

  // Serve catalog content
  app.get('/:configHash/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
      const { configHash, type, id } = req.params;
      let { skip = 0 } = req.query;
      
      if (!configHash || !type || !id) {
        return res.status(400).json({ error: 'Config hash, type, and ID are required' });
      }

      const config = await decompressConfig(configHash);

      // Parse skip parameter from extra
      if (req.params.extra && req.params.extra.includes('skip=')) {
        const skipMatch = req.params.extra.match(/skip=(\d+)/);
        if (skipMatch && skipMatch[1]) {
          skip = parseInt(skipMatch[1]);
        }
      }

      // Extract the list ID - handle both aiolists- and plain IDs
      let listId = id;
      let listType = null;
      
      // Check for the new ID format that includes list type
      const listWithTypeMatch = id.match(/^aiolists-(\d+)-([ELW])$/);
      if (listWithTypeMatch) {
        listId = listWithTypeMatch[1];
        listType = listWithTypeMatch[2];
      } else if (listId.startsWith('aiolists-')) {
        listId = listId.substring(9);
      }

      // Check if ID contains skip parameter
      if (listId.includes('/skip=')) {
        const parts = listId.split('/');
        listId = parts[0];
        const skipMatch = parts[1]?.match(/skip=(\d+)/);
        if (skipMatch && skipMatch[1]) {
          skip = parseInt(skipMatch[1]);
        }
      }

      // Validate the list ID format
      if (!listId.match(/^[a-zA-Z0-9_-]+$/)) {
        return res.status(400).json({ error: 'Invalid catalog ID format' });
      }

      // Check if this list is hidden - but don't block the content, just mark it for hiding in the main view
      // This allows hidden lists to still be accessible through the Discover tab
      const hiddenLists = new Set((config.hiddenLists || []).map(String));
      // We won't return empty content here, just track if it's hidden
      const isHidden = hiddenLists.has(String(listId));

      // Get sort preferences for this list
      const sortPrefs = config.sortPreferences?.[listId] || { sort: 'imdbvotes', order: 'desc' };

      // For watchlists, don't cache the response
      if (listId === 'watchlist' || listId === 'watchlist-W' || listId === 'trakt_watchlist') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        // For regular metadata, cache for 1 day
        res.setHeader('Cache-Control', `max-age=86400, public`);
      }

      // Create cache key based on all relevant parameters
      const cacheKey = getMetadataCacheKey(listId, skip, type);
      
      // Add sort preferences to cache key if available
      const fullCacheKey = sortPrefs 
        ? `${cacheKey}_${sortPrefs.sort}_${sortPrefs.order}` 
        : cacheKey;
        
      // Skip cache for watchlists which should always be fresh
      const shouldUseCache = !(listId === 'watchlist' || listId === 'watchlist-W' || listId === 'trakt_watchlist');
      
      // Check cache first for non-watchlist items
      if (shouldUseCache && metadataCache.has(fullCacheKey)) {
        return res.json(metadataCache.get(fullCacheKey));
      }

      // For other external addons, fetch from their API
      const addonCatalog = Object.values(config.importedAddons || {}).find(addon => 
        addon.catalogs.some(cat => cat.id === listId || cat.originalId === listId)
      );

      if (addonCatalog) {
        const catalog = addonCatalog.catalogs.find(cat => cat.id === listId || cat.originalId === listId);
        
        // For MDBList imported URLs, fetch directly using our API
        if (addonCatalog.id.startsWith('mdblist_') && catalog?.url) {
          // If we have a listType, set it in the metadata
          if (listType) {
            if (!config.listsMetadata) config.listsMetadata = {};
            config.listsMetadata[listId] = {
              ...(config.listsMetadata[listId] || {}),
              listType
            };
          }
          const items = await fetchListItems(listId, config.apiKey, config.listsMetadata, skip, sortPrefs.sort, sortPrefs.order);
          if (!items) {
            return res.json({ metas: [] });
          }

          // Save content type information to config
          if (!config.listsMetadata) config.listsMetadata = {};
          if (!config.listsMetadata[listId]) config.listsMetadata[listId] = {};
          
          const hasMovies = items.hasMovies === true || (Array.isArray(items.movies) && items.movies.length > 0);
          const hasShows = items.hasShows === true || (Array.isArray(items.shows) && items.shows.length > 0);
          
          config.listsMetadata[listId].hasMovies = hasMovies;
          config.listsMetadata[listId].hasShows = hasShows;
          
          console.log(`Catalog endpoint - updating metadata for ${listId}: hasMovies=${hasMovies}, hasShows=${hasShows}`);
          
          // Save the updated config with new metadata
          await compressConfig(config);

          // Convert to Stremio format
          const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, config.rpdbApiKey);

          // Filter by type
          let filteredMetas = allMetas;
          if (type === 'movie') {
            filteredMetas = allMetas.filter(item => item.type === 'movie');
          } else if (type === 'series') {
            filteredMetas = allMetas.filter(item => item.type === 'series');
          }

          const result = {
            metas: filteredMetas,
            cacheMaxAge: listId.includes('watchlist') ? 0 : 86400,
            // Include content type information
            hasMovies: items.hasMovies === true || (Array.isArray(items.movies) && items.movies.length > 0),
            hasShows: items.hasShows === true || (Array.isArray(items.shows) && items.shows.length > 0)
          };
          
          // Cache the result if it's not a watchlist
          if (shouldUseCache) {
            metadataCache.set(fullCacheKey, result);
          }
          
          return res.json(result);
        }

        // For other external addons, fetch from their API
        const items = await fetchExternalAddonItems(listId, addonCatalog, skip, config.rpdbApiKey);
        
        // Cache the result and return it
        const result = {
          metas: items,
          cacheMaxAge: listId.includes('watchlist') ? 0 : 86400,
          // Include content type information
          hasMovies: items.hasMovies === true || (Array.isArray(items.movies) && items.movies.length > 0),
          hasShows: items.hasShows === true || (Array.isArray(items.shows) && items.shows.length > 0)
        };
        
        // Cache the result if it's not a watchlist
        if (shouldUseCache) {
          metadataCache.set(fullCacheKey, result);
        }
        
        return res.json(result);
      }

      // For regular lists, fetch content normally
      // If we have a listType, add it to the metadata
      if (listType) {
        if (!config.listsMetadata) config.listsMetadata = {};
        config.listsMetadata[listId] = {
          ...(config.listsMetadata[listId] || {}),
          listType
        };
      }
      const items = await fetchListContent(listId, config, config.importedAddons, skip, sortPrefs.sort, sortPrefs.order);
      if (!items) {
        console.error(`No items returned for list ${listId}`);
        return res.json({ metas: [] });
      }

      // Save content type information to config
      if (!config.listsMetadata) config.listsMetadata = {};
      if (!config.listsMetadata[listId]) config.listsMetadata[listId] = {};
      
      const hasMovies = items.hasMovies === true || (Array.isArray(items.movies) && items.movies.length > 0);
      const hasShows = items.hasShows === true || (Array.isArray(items.shows) && items.shows.length > 0);
      
      config.listsMetadata[listId].hasMovies = hasMovies;
      config.listsMetadata[listId].hasShows = hasShows;
      
      console.log(`Catalog endpoint - updating metadata for ${listId}: hasMovies=${hasMovies}, hasShows=${hasShows}`);
      
      // Save the updated config with new metadata
      await compressConfig(config);

      // Convert to Stremio format with RPDB posters
      const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, config.rpdbApiKey);

      // Filter by type
      let filteredMetas = allMetas;
      if (type === 'movie') {
        filteredMetas = allMetas.filter(item => item.type === 'movie');
      } else if (type === 'series') {
        filteredMetas = allMetas.filter(item => item.type === 'series');
      }

      // Prepare response
      const result = {
        metas: filteredMetas,
        cacheMaxAge: listId.includes('watchlist') ? 0 : 86400,
        // Include content type information
        hasMovies: items.hasMovies === true || (Array.isArray(items.movies) && items.movies.length > 0),
        hasShows: items.hasShows === true || (Array.isArray(items.shows) && items.shows.length > 0)
      };
      
      // Cache the result if it's not a watchlist
      if (shouldUseCache) {
        metadataCache.set(fullCacheKey, result);
      }
      
      // Return response
      res.json(result);
    } catch (error) {
      console.error('Error in catalog endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get configuration endpoint
  app.get('/:configHash/config', async (req, res) => {
    try {
      const { configHash } = req.params;
      if (!configHash) {
        return res.json({ success: true, config: defaultConfig });
      }
      const config = await decompressConfig(configHash);
      res.json({ success: true, config });
    } catch (error) {
      console.error('Error loading configuration:', error);
      res.json({ success: true, config: defaultConfig });
    }
  });

  // Create new configuration
  app.post('/api/config/create', async (req, res) => {
    try {
      const config = { ...defaultConfig, ...req.body };
      config.lastUpdated = new Date().toISOString();
      const configHash = await compressConfig(config);
      res.json({ success: true, configHash });
    } catch (error) {
      console.error('Error creating configuration:', error);
      res.status(500).json({ error: 'Failed to create configuration' });
    }
  });

  // Trakt endpoints
  app.get('/api/trakt/login', (req, res) => {
    try {
      const authUrl = getTraktAuthUrl();
      res.redirect(authUrl);
    } catch (error) {
      console.error('Error in Trakt login:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/config/trakt', (req, res) => {
    try {
      const authUrl = getTraktAuthUrl();
      res.json({
        authUrl,
        hasAccessToken: false,
        expiresAt: null
      });
    } catch (error) {
      console.error('Error getting Trakt config:', error);
      res.status(500).json({ error: 'Failed to get Trakt configuration' });
    }
  });

  app.post('/api/config/:configHash/trakt/auth', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({ error: 'Authorization code is required' });
      }
      
      const config = await decompressConfig(configHash);
      const traktTokens = await authenticateTrakt(code);
      
      const updatedConfig = {
        ...config,
        traktAccessToken: traktTokens.accessToken,
        traktRefreshToken: traktTokens.refreshToken,
        traktExpiresAt: traktTokens.expiresAt,
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'Successfully authenticated with Trakt'
      });
    } catch (error) {
      console.error('Error authenticating with Trakt:', error);
      res.status(500).json({
        error: 'Failed to authenticate with Trakt',
        details: error.response?.data?.error_description || error.message
      });
    }
  });

  app.post('/api/config/:configHash/trakt/disconnect', async (req, res) => {
    try {
      const { configHash } = req.params;
      const config = await decompressConfig(configHash);
      
      // Remove Trakt tokens
      const updatedConfig = {
        ...config,
        traktAccessToken: null,
        traktRefreshToken: null,
        traktExpiresAt: null,
        lastUpdated: new Date().toISOString()
      };

      // Remove Trakt lists from manifest
      if (updatedConfig.lists) {
        updatedConfig.lists = updatedConfig.lists.filter(list => !list.isTraktList);
      }
      
      const newConfigHash = await compressConfig(updatedConfig);
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'Successfully disconnected from Trakt'
      });
    } catch (error) {
      console.error('Error disconnecting from Trakt:', error);
      res.status(500).json({
        error: 'Failed to disconnect from Trakt',
        details: error.message
      });
    }
  });

  // Update configuration
  app.post('/api/config/:configHash/update', async (req, res) => {
    try {
      const { configHash } = req.params;
      const currentConfig = await decompressConfig(configHash);
      const updatedConfig = { ...currentConfig, ...req.body };
      updatedConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(updatedConfig);
      
      // Clear caches when config is updated
      listsCache.clear();
      metadataCache.clear();
      
      res.json({ success: true, configHash: newConfigHash });
    } catch (error) {
      console.error('Error updating configuration:', error);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });

  // Save API keys
  app.post('/api/config/:configHash/apikey', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { apiKey, rpdbApiKey } = req.body;
      
      // Remove validation check to allow empty API key for disconnection
      const config = await decompressConfig(configHash);
      const updatedConfig = {
        ...config,
        apiKey: apiKey || '', // Ensure empty string if apiKey is null/undefined
        rpdbApiKey: rpdbApiKey || '',
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({ success: true, configHash: newConfigHash });
    } catch (error) {
      console.error('Error saving API key:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Lists endpoints
  app.get('/:configHash/lists', async (req, res) => {
    try {
      const { configHash } = req.params;
      
      // Check cache first
      const cacheKey = getListsCacheKey(configHash);
      const cachedLists = listsCache.get(cacheKey);
      if (cachedLists) {
        return res.json(cachedLists);
      }
      
      const config = await decompressConfig(configHash);
      let allLists = [];
      
      // Fetch MDBList lists if API key is provided
      if (config.apiKey) {
        const mdbLists = await fetchAllLists(config.apiKey);
        allLists = [...allLists, ...mdbLists];
      }
      
      // Fetch Trakt lists if token is provided
      if (config.traktAccessToken) {
        const traktLists = await fetchTraktLists(config);
        allLists = [...allLists, ...traktLists];
      }
      
      // Convert removed lists to a Set for quicker lookup
      const removedLists = new Set(config.removedLists || []);
      
      // Filter out completely removed lists
      allLists = allLists.filter(list => !removedLists.has(String(list.id)));
      
      // For lists that don't have content type info, try to fetch it
      for (const list of allLists) {
        const listId = String(list.id);
        
        // Check if we already have metadata for this list
        if (!config.listsMetadata?.[listId]?.hasOwnProperty('hasMovies') ||
            !config.listsMetadata?.[listId]?.hasOwnProperty('hasShows')) {
          
          try {
            console.log(`Fetching content types for list ${listId}`);
            // Fetch first page to determine content types
            const listContent = await fetchListContent(listId, config, config.importedAddons, 0);
            
            if (listContent) {
              if (!config.listsMetadata) config.listsMetadata = {};
              if (!config.listsMetadata[listId]) config.listsMetadata[listId] = {};
              
              // Set content type flags based on actual content
              config.listsMetadata[listId].hasMovies = !!(listContent.hasMovies === true || 
                (Array.isArray(listContent.movies) && listContent.movies.length > 0));
              
              config.listsMetadata[listId].hasShows = !!(listContent.hasShows === true || 
                (Array.isArray(listContent.shows) && listContent.shows.length > 0));
              
              console.log(`Set content types for ${listId}: movies=${config.listsMetadata[listId].hasMovies}, shows=${config.listsMetadata[listId].hasShows}`);
            }
          } catch (error) {
            console.error(`Failed to fetch content types for list ${listId}:`, error);
          }
        }
      }
      
      // Process lists with updated metadata
      const lists = allLists.map(list => {
        const listId = String(list.id);
        const metadata = config.listsMetadata?.[listId] || {};
        
        return {
          id: listId,
          name: list.name,
          customName: config.customListNames?.[listId] || null,
          isHidden: (config.hiddenLists || []).includes(listId),
          isMovieList: list.isMovieList,
          isShowList: list.isShowList,
          isExternalList: list.isExternalList,
          listType: list.listType || 'L',
          isTraktList: list.isTraktList,
          isWatchlist: list.isWatchlist,
          tag: list.listType || 'L',
          // Add content type information - only set to true when explicitly true
          hasMovies: metadata.hasMovies === true,
          hasShows: metadata.hasShows === true,
          // Add merged preference
          isMerged: config.mergedLists?.[listId] !== false, // Default to merged if not specified
          sortPreferences: config.sortPreferences?.[listId] || { sort: 'imdbvotes', order: 'desc' }
        };
      });
      
      // Add imported addon lists (filtering out removed ones)
      if (config.importedAddons) {
        for (const addon of Object.values(config.importedAddons)) {
          const addonLists = addon.catalogs
            .filter(catalog => !removedLists.has(String(catalog.id)))
            .map(catalog => ({
              id: String(catalog.id),
              name: catalog.name,
              customName: config.customListNames?.[String(catalog.id)] || null,
              isHidden: (config.hiddenLists || []).includes(String(catalog.id)),
              isMovieList: catalog.type === 'movie',
              isShowList: catalog.type === 'series' || catalog.type === 'anime',
              isExternalList: true,
              listType: 'A',
              addonId: addon.id,
              addonName: addon.name,
              addonLogo: addon.logo || null,
              tag: 'A',
              tagImage: addon.logo,
              // Set hasMovies and hasShows based on catalog type
              hasMovies: catalog.type === 'movie' || catalog.type === 'all',
              hasShows: catalog.type === 'series' || catalog.type === 'anime' || catalog.type === 'all',
              sortPreferences: config.sortPreferences?.[String(catalog.id)] || { sort: 'imdbvotes', order: 'desc' }
            }));
          lists.push(...addonLists);
        }
      }
      
      // Sort lists based on config.listOrder
      if (config.listOrder?.length > 0) {
        const orderMap = new Map(config.listOrder.map((id, index) => [String(id), index]));
        lists.sort((a, b) => {
          // Clean IDs for comparison (match logic in createAddon)
          let aId = String(a.id);
          let bId = String(b.id);
          
          // Handle aiolists prefix
          if (aId.startsWith('aiolists-')) {
            aId = aId.replace(/^aiolists-(\d+)-[ELW]$/, '$1');
          }
          
          if (bId.startsWith('aiolists-')) {
            bId = bId.replace(/^aiolists-(\d+)-[ELW]$/, '$1');
          }
          
          // Check direct match first
          let posA = orderMap.has(aId) ? orderMap.get(aId) : Number.MAX_SAFE_INTEGER;
          let posB = orderMap.has(bId) ? orderMap.get(bId) : Number.MAX_SAFE_INTEGER;
          
          // If no direct match, check if it's a composite ID with underscore
          if (posA === Number.MAX_SAFE_INTEGER && aId.includes('_')) {
            const baseId = aId.split('_')[0];
            if (orderMap.has(baseId)) {
              posA = orderMap.get(baseId);
            }
          }
          
          if (posB === Number.MAX_SAFE_INTEGER && bId.includes('_')) {
            const baseId = bId.split('_')[0];
            if (orderMap.has(baseId)) {
              posB = orderMap.get(baseId);
            }
          }
          
          return posA - posB;
        });
      }
      
      const result = {
        success: true,
        lists,
        importedAddons: config.importedAddons || {},
        availableSortOptions: config.availableSortOptions || []
      };
      
      // Cache the result
      listsCache.set(cacheKey, result);
      
      res.json(result);
    } catch (error) {
      console.error('Error fetching lists:', error);
      res.status(500).json({ error: 'Failed to fetch lists' });
    }
  });

  // Update list name
  app.post('/api/config/:configHash/lists/names', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { listId, customName } = req.body;
      
      if (!listId) {
        return res.status(400).json({ error: 'List ID is required' });
      }
      
      const config = await decompressConfig(configHash);
      const updatedConfig = { ...config };
      
      if (!updatedConfig.customListNames) {
        updatedConfig.customListNames = {};
      }
      
      const normalizedListId = String(listId);
      if (customName?.trim()) {
        updatedConfig.customListNames[normalizedListId] = customName.trim();
      } else {
        delete updatedConfig.customListNames[normalizedListId];
      }
      
      updatedConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(updatedConfig);
      
      // Don't rebuild the full addon for name changes - these are UI-only changes
      // and don't require refetching content from APIs
      // await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'List name updated successfully'
      });
    } catch (error) {
      console.error('Error updating list name:', error);
      res.status(500).json({ error: 'Failed to update list name' });
    }
  });

  // Update list visibility
  app.post('/api/config/:configHash/lists/visibility', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { hiddenLists } = req.body;
      
      if (!Array.isArray(hiddenLists)) {
        return res.status(400).json({ error: 'Hidden lists must be an array' });
      }
      
      const config = await decompressConfig(configHash);
      const updatedConfig = {
        ...config,
        hiddenLists: hiddenLists.map(String),
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      
      // Don't rebuild the full addon for visibility changes - these are UI-only changes
      // and don't require refetching content from APIs
      // await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'List visibility updated successfully'
      });
    } catch (error) {
      console.error('Error updating list visibility:', error);
      res.status(500).json({ error: 'Failed to update list visibility' });
    }
  });

  // Remove lists completely
  app.post('/api/config/:configHash/lists/remove', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { listIds } = req.body;
      
      if (!Array.isArray(listIds)) {
        return res.status(400).json({ error: 'List IDs must be an array' });
      }
      
      const config = await decompressConfig(configHash);
      
      // Get current removed lists or initialize empty array
      const currentRemovedLists = config.removedLists || [];
      
      // Add new list IDs to removed lists
      const updatedRemovedLists = [...new Set([...currentRemovedLists, ...listIds.map(String)])];
      
      // Remove these IDs from hiddenLists if they're there
      const updatedHiddenLists = (config.hiddenLists || [])
        .filter(id => !listIds.includes(String(id)));
      
      const updatedConfig = {
        ...config,
        removedLists: updatedRemovedLists,
        hiddenLists: updatedHiddenLists,
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'Lists removed successfully'
      });
    } catch (error) {
      console.error('Error removing lists:', error);
      res.status(500).json({ error: 'Failed to remove lists' });
    }
  });

  // Update list order
  app.post('/api/config/:configHash/lists/order', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { order } = req.body;
      
      if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Order must be an array' });
      }
      
      const config = await decompressConfig(configHash);
      const updatedConfig = {
        ...config,
        listOrder: order.map(String),
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      
      // Don't rebuild the full addon for order changes - these are UI-only changes
      // and don't require refetching content from APIs
      // await rebuildAddonWithConfig(updatedConfig);
      
      res.json({ 
        success: true,
        configHash: newConfigHash,
        message: 'List order updated successfully'
      });
    } catch (error) {
      console.error('Error updating list order:', error);
      res.status(500).json({ error: 'Failed to update list order' });
    }
  });

  // Import external addon
  app.post('/api/config/:configHash/import-addon', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { manifestUrl } = req.body;
      
      if (!manifestUrl) {
        return res.status(400).json({ error: 'Manifest URL is required' });
      }
      
      let config;
      try {
        config = await decompressConfig(configHash);
      } catch (error) {
        console.log('Failed to decompress config, using default');
        config = { ...defaultConfig };
      }

      const addonInfo = await importExternalAddon(manifestUrl);
      
      const updatedConfig = {
        ...config,
        importedAddons: {
          ...(config.importedAddons || {}),
          [addonInfo.id]: addonInfo
        },
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: `Successfully imported ${addonInfo.catalogs.length} lists from ${addonInfo.name}`,
        addon: addonInfo
      });
    } catch (error) {
      console.error('Error importing addon:', error);
      res.status(500).json({
        error: 'Failed to import addon',
        details: error.message
      });
    }
  });

  // Remove external addon
  app.post('/api/config/:configHash/remove-addon', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { addonId } = req.body;
      
      const config = await decompressConfig(configHash);
      
      if (!addonId || !config.importedAddons?.[addonId]) {
        return res.status(400).json({ error: 'Invalid addon ID' });
      }
      
      const updatedConfig = {
        ...config,
        lastUpdated: new Date().toISOString()
      };
      
      // Create a new importedAddons object without the removed addon
      const { [addonId]: removedAddon, ...remainingAddons } = config.importedAddons;
      updatedConfig.importedAddons = remainingAddons;
      
      const newConfigHash = await compressConfig(updatedConfig);
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'Addon removed successfully'
      });
    } catch (error) {
      console.error('Error removing addon:', error);
      res.status(500).json({ error: 'Failed to remove addon' });
    }
  });

  // Validate API keys
  app.post('/api/validate-keys', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      const results = { mdblist: null, rpdb: null };
      
      // Validate MDBList key
      if (apiKey) {
        const mdblistResult = await validateMDBListKey(apiKey);
        if (mdblistResult) {
          results.mdblist = {
            valid: true,
            username: mdblistResult.username
          };
        }
      }
      
      // Validate RPDB key
      if (rpdbApiKey) {
        const rpdbValid = await validateRPDBKey(rpdbApiKey);
        results.rpdb = {
          valid: rpdbValid
        };
      }
      
      res.json(results);
    } catch (error) {
      console.error('Error validating keys:', error);
      res.status(500).json({ error: 'Failed to validate keys' });
    }
  });

  // Import MDBList URL
  app.post('/api/config/:configHash/import-mdblist-url', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { url, rpdbApiKey } = req.body;
      
      if (!url) {
        return res.status(400).json({ error: 'MDBList URL is required' });
      }
      
      const config = await decompressConfig(configHash);
      
      // Check if MDBList API key is configured
      if (!config.apiKey) {
        return res.status(400).json({ error: 'MDBList API key is required' });
      }
      
      console.log(`Starting import for URL: ${url}`);
      
      // Extract list ID, name and type from URL, passing the API key
      const { listId, listName, isUrlImport } = await extractListFromUrl(url, config.apiKey);
      console.log(`Extracted list: ID=${listId}, Name=${listName}, isUrlImport=${isUrlImport}`);
      
      // Set a flag to indicate this is a URL import
      if (!config.listsMetadata) {
        config.listsMetadata = {};
      }
      
      // Update metadata to indicate this is a URL imported list (internal list)
      config.listsMetadata[listId] = {
        isExternalList: false,
        isInternalList: true,
        isUrlImport: true,
        name: listName,
        listType: 'L'  // Mark explicitly as internal list type
      };
      
      // Mark that we're importing from URL for this API call
      config.listsMetadata._importingUrl = true;
      
      // Fetch the actual list content to determine what types it contains
      console.log(`Fetching list content to determine types for ID: ${listId}`);
      const listContent = await fetchListItems(listId, config.apiKey, config.listsMetadata);
      
      // Remove the importing flag after fetch
      delete config.listsMetadata._importingUrl;
      
      if (!listContent) {
        console.error(`Could not fetch list content for ID: ${listId}`);
        throw new Error('Could not fetch list content');
      }
      
      console.log(`List content fetched. Movies: ${listContent.movies?.length || 0}, Shows: ${listContent.shows?.length || 0}`);

      // Determine which types to include based on actual content
      const hasMovies = listContent.movies && listContent.movies.length > 0;
      const hasShows = listContent.shows && listContent.shows.length > 0;
      
      console.log(`List has movies: ${hasMovies}, has shows: ${hasShows}`);
      
      // Create a manifest for the MDBList with catalogs based on content
      const manifest = {
        id: `mdblist_${listId}`,
        name: `MDBList - ${listName}`,
        version: '1.0.0',
        description: `Imported from MDBList: ${url}`,
        catalogs: [],
        resources: ['catalog', 'meta'],
        types: []
      };

      // Only add movie catalog if there are movies
      if (hasMovies) {
        manifest.catalogs.push({
          id: listId,
          name: listName,
          type: 'movie',
          url: url,
          listType: 'L', // Mark explicitly as internal list
          extra: [{ name: 'skip' }]
        });
        manifest.types.push('movie');
      }

      // Only add series catalog if there are shows
      if (hasShows) {
        manifest.catalogs.push({
          id: listId,
          name: listName,
          type: 'series',
          url: url,
          listType: 'L', // Mark explicitly as internal list
          extra: [{ name: 'skip' }]
        });
        manifest.types.push('series');
      }

      // If no content was found, throw an error
      if (!hasMovies && !hasShows) {
        console.error(`List appears to be empty`);
        throw new Error('List appears to be empty');
      }

      // Get existing MDBList imports
      const existingMDBLists = Object.entries(config.importedAddons || {})
        .filter(([key]) => key.startsWith('mdblist_'))
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

      // Update the config with RPDB key if provided and preserve existing MDBList imports
      const updatedConfig = {
        ...config,
        rpdbApiKey: rpdbApiKey || config.rpdbApiKey,
        importedAddons: {
          ...config.importedAddons,
          ...existingMDBLists,
          [`mdblist_${listId}`]: manifest
        },
        lastUpdated: new Date().toISOString()
      };
      
      const newConfigHash = await compressConfig(updatedConfig);
      await rebuildAddonWithConfig(updatedConfig);
      
      console.log(`Successfully imported list: ${listName}`);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        addon: manifest,
        message: `Successfully imported ${listName}`
      });
    } catch (error) {
      console.error('Error importing MDBList URL:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update sort preferences
  app.post('/api/config/:configHash/lists/sort', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { listId, sort, order } = req.body;
      
      if (!listId || !sort) {
        return res.status(400).json({ error: 'List ID and sort field are required' });
      }
      
      const config = await decompressConfig(configHash);
      const updatedConfig = { ...config };
      
      if (!updatedConfig.sortPreferences) {
        updatedConfig.sortPreferences = {};
      }
      
      updatedConfig.sortPreferences[listId] = {
        sort,
        order: order || 'desc'
      };
      
      updatedConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(updatedConfig);
      
      // Clear cache for this specific list's content since sort order affects content
      // But don't rebuild the entire addon
      const listCacheKey = `metadata_${listId}`;
      if (metadataCache) {
        // Delete any entries starting with this prefix
        Array.from(metadataCache.cache.keys())
          .filter(key => key.startsWith(listCacheKey))
          .forEach(key => metadataCache.delete(key));
      }
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: 'Sort preferences updated successfully'
      });
    } catch (error) {
      console.error('Error updating sort preferences:', error);
      res.status(500).json({ error: 'Failed to update sort preferences' });
    }
  });

  // Update list merge/split preference
  app.post('/api/config/:configHash/lists/merge', async (req, res) => {
    try {
      const { configHash } = req.params;
      const { listId, merged } = req.body;
      
      if (!listId || merged === undefined) {
        return res.status(400).json({ error: 'List ID and merged preference are required' });
      }
      
      const config = await decompressConfig(configHash);
      const updatedConfig = { ...config };
      
      if (!updatedConfig.mergedLists) {
        updatedConfig.mergedLists = {};
      }
      
      // Store the merge preference (true = merged, false = split)
      updatedConfig.mergedLists[listId] = !!merged;
      
      updatedConfig.lastUpdated = new Date().toISOString();
      const newConfigHash = await compressConfig(updatedConfig);
      
      // Rebuild the addon to update the catalogs
      await rebuildAddonWithConfig(updatedConfig);
      
      res.json({
        success: true,
        configHash: newConfigHash,
        message: `List ${merged ? 'merged' : 'split'} successfully`
      });
    } catch (error) {
      console.error('Error updating list merge preference:', error);
      res.status(500).json({ error: 'Failed to update list merge preference' });
    }
  });

  return app;
}

module.exports = setupApiRoutes; 