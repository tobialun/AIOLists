const { validateRPDBKey } = require('../utils/posters');
const { authenticateTrakt, getTraktAuthUrl, fetchTraktLists } = require('../integrations/trakt');
const { fetchAllLists, fetchListItems, validateMDBListKey, extractListFromUrl } = require('../integrations/mdblist');
const { importExternalAddon, fetchExternalAddonItems } = require('../integrations/externalAddons');
const { rebuildAddon, convertToStremioFormat, fetchListContent } = require('../addon');
const { compressConfig, decompressConfig } = require('../utils/urlConfig');
const path = require('path');
const { ITEMS_PER_PAGE } = require('../config');
const Cache = require('../cache');

// Cache durations
const CACHE_DURATIONS = {
  LISTS: 1800,            // 30 minutes
  METADATA: 3600,         // 1 hour
  MANIFEST: 3600,         // 1 hour
  REGULAR_CONTENT: 86400  // 1 day
};

// Create cache instances
const listsCache = new Cache({ defaultTTL: CACHE_DURATIONS.LISTS });
const metadataCache = new Cache({ defaultTTL: CACHE_DURATIONS.METADATA });

/**
 * Check if a list ID represents a watchlist
 * @param {string} listId - List ID to check
 * @returns {boolean} Whether the list is a watchlist
 */
function isWatchlist(listId) {
  return listId === 'watchlist' || 
         listId === 'watchlist-W' || 
         listId === 'trakt_watchlist' ||
         listId === 'aiolists-watchlist-W';
}

/**
 * Check if content has movies or shows
 * @param {Object} items - Content items
 * @returns {Object} Object with hasMovies and hasShows flags
 */
function checkContentTypes(items) {
  const hasMovies = items.hasMovies === true || (Array.isArray(items.movies) && items.movies.length > 0);
  const hasShows = items.hasShows === true || (Array.isArray(items.shows) && items.shows.length > 0);
  return { hasMovies, hasShows };
}

/**
 * Parse and normalize a list ID
 * @param {string} id - Raw list ID
 * @returns {Object} Parsed list ID and type
 */
function parseListId(id) {
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
  }

  return { listId, listType };
}

/**
 * Filter metas by content type
 * @param {Array} allMetas - All metadata items
 * @param {string} type - Content type to filter by
 * @returns {Array} Filtered metadata items
 */
function filterMetasByType(allMetas, type) {
  if (type === 'movie') {
    return allMetas.filter(item => item.type === 'movie');
  } else if (type === 'series') {
    return allMetas.filter(item => item.type === 'series');
  }
  return allMetas;
}

/**
 * Create a standard response object
 * @param {Array} metas - Metadata items
 * @param {Object} items - Original items with content type info
 * @param {string} listId - List ID
 * @returns {Object} Standardized response object
 */
function createResponseObject(metas, items, listId) {
  const { hasMovies, hasShows } = checkContentTypes(items);
  return {
    metas,
    cacheMaxAge: isWatchlist(listId) ? 0 : CACHE_DURATIONS.REGULAR_CONTENT,
    hasMovies,
    hasShows
  };
}

/**
 * Set appropriate cache headers based on list type
 * @param {Object} res - Response object
 * @param {string} listId - List ID
 */
function setCacheHeaders(res, listId) {
  if (isWatchlist(listId)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', `max-age=${CACHE_DURATIONS.REGULAR_CONTENT}, public`);
  }
}

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
 * @param {string} rpdbApiKey - RPDB API key
 * @returns {string} Cache key
 */
function getMetadataCacheKey(listId, skip, type, rpdbApiKey) {
  // Include a prefix based on RPDB API key
  const keyPrefix = rpdbApiKey ? rpdbApiKey.substring(0, 8) : 'no_key';
  return `metadata_${keyPrefix}_${listId}_${skip}_${type}`;
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
  // Root endpoint is handled in index.js
  
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
      const manifestCacheKey = `manifest_${configHash}`;
      let manifest = null;
      
      // Check if we have the manifest cached with sufficient TTL (at least 5 minutes)
      const remainingTTL = metadataCache.getRemainingTTL(manifestCacheKey);
      if (remainingTTL > 300000) { // 5 minutes in milliseconds
        manifest = metadataCache.get(manifestCacheKey);
      }
      
      if (!manifest) {
        // If not cached or TTL too low, rebuild the addon interface
        const addonInterface = await rebuildAddonWithConfig(config);
        manifest = addonInterface.manifest;
        
        // Cache the manifest for 1 hour
        metadataCache.set(manifestCacheKey, manifest, 3600000); // 1 hour in milliseconds
      }

      // Set cache control headers
      res.setHeader('Cache-Control', 'max-age=3600, public'); // 1 hour

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

      // Parse and normalize list ID
      const { listId, listType } = parseListId(id);

      // Validate the list ID format
      if (!listId.match(/^[a-zA-Z0-9_-]+$/)) {
        return res.status(400).json({ error: 'Invalid catalog ID format' });
      }

      // Check if this list is hidden
      const hiddenLists = new Set((config.hiddenLists || []).map(String));
      const isHidden = hiddenLists.has(String(listId));

      // Get sort preferences for this list
      const sortPrefs = config.sortPreferences?.[listId] || { sort: 'imdbvotes', order: 'desc' };

      // Set cache headers
      setCacheHeaders(res, listId);

      // Create cache key
      const cacheKey = getMetadataCacheKey(listId, skip, type, config.rpdbApiKey);
      const fullCacheKey = sortPrefs 
        ? `${cacheKey}_${sortPrefs.sort}_${sortPrefs.order}` 
        : cacheKey;
        
      // Check cache for non-watchlist items
      const shouldUseCache = !isWatchlist(listId);
      if (shouldUseCache && metadataCache.has(fullCacheKey)) {
        return res.json(metadataCache.get(fullCacheKey));
      }

      // For external addons, fetch from their API
      const addonCatalog = Object.values(config.importedAddons || {}).find(addon => 
        addon.catalogs.some(cat => cat.id === listId || cat.originalId === listId)
      );

      if (addonCatalog) {
        const catalog = addonCatalog.catalogs.find(cat => cat.id === listId || cat.originalId === listId);
        
        // For MDBList imported URLs
        if (addonCatalog.id.startsWith('mdblist_') && catalog?.url) {
          // Update metadata if we have a listType
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

          // Update content type information
          const { hasMovies, hasShows } = checkContentTypes(items);
          if (!config.listsMetadata) config.listsMetadata = {};
          if (!config.listsMetadata[listId]) config.listsMetadata[listId] = {};
          config.listsMetadata[listId].hasMovies = hasMovies;
          config.listsMetadata[listId].hasShows = hasShows;
          
          // Save the updated config
          await compressConfig(config);

          // Convert and filter content
          const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, config.rpdbApiKey);
          const filteredMetas = filterMetasByType(allMetas, type);
          
          // Create response
          const result = createResponseObject(filteredMetas, items, listId);
          
          // Cache if needed
          if (shouldUseCache) {
            metadataCache.set(fullCacheKey, result);
          }
          
          return res.json(result);
        }

        // For other external addons
        const items = await fetchExternalAddonItems(listId, addonCatalog, skip, config.rpdbApiKey);
        const result = createResponseObject(items, { 
          hasMovies: items.some(i => i.type === 'movie'),
          hasShows: items.some(i => i.type === 'series')
        }, listId);
        
        if (shouldUseCache) {
          metadataCache.set(fullCacheKey, result);
        }
        
        return res.json(result);
      }

      // For regular lists
      if (listType) {
        if (!config.listsMetadata) config.listsMetadata = {};
        config.listsMetadata[listId] = {
          ...(config.listsMetadata[listId] || {}),
          listType
        };
      }

      const items = await fetchListContent(listId, config, config.importedAddons, skip, sortPrefs.sort, sortPrefs.order);
      if (!items) {
        return res.json({ metas: [] });
      }

      // Update content type information
      const { hasMovies, hasShows } = checkContentTypes(items);
      if (!config.listsMetadata) config.listsMetadata = {};
      if (!config.listsMetadata[listId]) config.listsMetadata[listId] = {};
      config.listsMetadata[listId].hasMovies = hasMovies;
      config.listsMetadata[listId].hasShows = hasShows;
      
      await compressConfig(config);

      // Convert and filter content
      const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, config.rpdbApiKey);
      const filteredMetas = filterMetasByType(allMetas, type);
      
      // Create response
      const result = createResponseObject(filteredMetas, items, listId);
      
      // Cache if needed
      if (shouldUseCache) {
        metadataCache.set(fullCacheKey, result);
      }
      
      return res.json(result);
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

      // Only clear the manifest cache since we're only adding Trakt lists
      const manifestCacheKey = `manifest_${newConfigHash}`;
      metadataCache.delete(manifestCacheKey);
      
      // Don't rebuild the entire addon, just fetch Trakt lists and add them
      const traktLists = await fetchTraktLists(updatedConfig);
      
      // Update lists cache if it exists
      const listsCacheKey = getListsCacheKey(configHash);
      const existingListsCache = listsCache.get(listsCacheKey);
      if (existingListsCache) {
        // Add Trakt lists to existing cached lists
        const updatedLists = {
          ...existingListsCache,
          lists: [...existingListsCache.lists, ...traktLists.map(list => ({
            id: list.id,
            name: list.name,
            customName: null,
            isHidden: false,
            isMovieList: true, // Trakt lists can contain both by default
            isShowList: true,
            isExternalList: false,
            listType: list.listType || 'T',
            isTraktList: true,
            isWatchlist: list.isWatchlist,
            tag: list.listType || 'T',
            hasMovies: true,
            hasShows: true,
            isMerged: true,
            sortPreferences: { sort: 'imdbvotes', order: 'desc' }
          }))]
        };
        listsCache.set(listsCacheKey, updatedLists);
      }
      
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

      const newConfigHash = await compressConfig(updatedConfig);

      // Only clear the manifest cache since we're only removing Trakt lists
      const manifestCacheKey = `manifest_${newConfigHash}`;
      metadataCache.delete(manifestCacheKey);
      
      // Update lists cache if it exists by removing Trakt lists
      const listsCacheKey = getListsCacheKey(configHash);
      const existingListsCache = listsCache.get(listsCacheKey);
      if (existingListsCache) {
        const updatedLists = {
          ...existingListsCache,
          lists: existingListsCache.lists.filter(list => !list.isTraktList)
        };
        listsCache.set(listsCacheKey, updatedLists);
      }
      
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
      
      const config = await decompressConfig(configHash);
      
      // Only clear caches if the keys have actually changed
      if (config.rpdbApiKey !== rpdbApiKey) {
        // Clear both poster and metadata caches when RPDB API key changes
        const { clearPosterCache } = require('../utils/posters');
        clearPosterCache();
        metadataCache.clear();
        console.log('Cleared poster and metadata caches due to RPDB API key change');
      }

      // Only clear list cache if MDBList API key changes
      if (config.apiKey !== apiKey) {
        listsCache.clear();
        console.log('Cleared lists cache due to MDBList API key change');
      }
      
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
        try {
          const mdbLists = await fetchAllLists(config.apiKey);
          allLists = [...allLists, ...mdbLists];
        } catch (error) {
          console.error('Error fetching MDBList lists:', error);
        }
      }
      
      // Fetch Trakt lists if token is provided
      if (config.traktAccessToken) {
        try {
          const traktLists = await fetchTraktLists(config);
          allLists = [...allLists, ...traktLists];
        } catch (error) {
          console.error('Error fetching Trakt lists:', error);
        }
      }
      
      // Convert removed lists to a Set for quicker lookup
      const removedLists = new Set(config.removedLists || []);
      
      // Filter out completely removed lists
      allLists = allLists.filter(list => !removedLists.has(String(list.id)));
      
      // Process lists with metadata
      const lists = allLists.map(list => {
        const listId = String(list.id);
        const metadata = config.listsMetadata?.[listId] || {};
        
        // For external lists, we can determine content types from the list type
        let hasMovies = false;
        let hasShows = false;
        
        if (list.isExternalList) {
          hasMovies = list.isMovieList || metadata.hasMovies === true;
          hasShows = list.isShowList || metadata.hasShows === true;
        } else {
          // For internal lists and watchlists, use the metadata if available
          hasMovies = metadata.hasMovies === true;
          hasShows = metadata.hasShows === true;
          
          // If no metadata and it's a watchlist, assume both types are possible
          if (list.isWatchlist && !metadata.hasOwnProperty('hasMovies')) {
            hasMovies = true;
            hasShows = true;
          }
        }
        
        return {
          id: listId,
          name: list.name,
          customName: config.customListNames?.[listId] || null,
          isHidden: (config.hiddenLists || []).includes(listId),
          isMovieList: list.isMovieList || hasMovies,
          isShowList: list.isShowList || hasShows,
          isExternalList: list.isExternalList,
          listType: list.listType || 'L',
          isTraktList: list.isTraktList,
          isWatchlist: list.isWatchlist,
          tag: list.listType || 'L',
          hasMovies,
          hasShows,
          isMerged: config.mergedLists?.[listId] !== false,
          sortPreferences: config.sortPreferences?.[listId] || { sort: 'imdbvotes', order: 'desc' }
        };
      });
      
      // Add imported addon lists (filtering out removed ones)
      if (config.importedAddons) {
        for (const addon of Object.values(config.importedAddons)) {
          const addonLists = addon.catalogs
            .filter(catalog => !removedLists.has(String(catalog.id)))
            .map(catalog => {
              const catalogId = String(catalog.id);
              const metadata = config.listsMetadata?.[catalogId] || {};
              
              // Determine content types based on catalog type
              const hasMovies = catalog.type === 'movie' || catalog.type === 'all' || metadata.hasMovies === true;
              const hasShows = catalog.type === 'series' || catalog.type === 'anime' || catalog.type === 'all' || metadata.hasShows === true;
              
              return {
                id: catalogId,
                name: catalog.name,
                customName: config.customListNames?.[catalogId] || null,
                isHidden: (config.hiddenLists || []).includes(catalogId),
                isMovieList: hasMovies,
                isShowList: hasShows,
                isExternalList: true,
                listType: 'A',
                addonId: addon.id,
                addonName: addon.name,
                addonLogo: addon.logo || null,
                tag: 'A',
                tagImage: addon.logo,
                hasMovies,
                hasShows,
                sortPreferences: config.sortPreferences?.[catalogId] || { sort: 'imdbvotes', order: 'desc' }
              };
            });
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
      
      // Clear the manifest cache since visibility affects the manifest
      const manifestCacheKey = `manifest_${newConfigHash}`;
      metadataCache.delete(manifestCacheKey);
      
      // Rebuild the addon to update the catalogs with new visibility settings
      await rebuildAddonWithConfig(updatedConfig);
      
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