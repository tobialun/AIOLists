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
      const addonInterface = await rebuildAddonWithConfig(config);

      // Set cache control headers
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      // Add a timestamp to version to prevent caching
      const manifest = {
        ...addonInterface.manifest,
        version: `${addonInterface.manifest.version.split('-')[0]}-${Date.now()}`
      };

      res.json(manifest);
    } catch (error) {
      console.error('Error serving manifest:', error);
      res.status(500).json({ error: 'Failed to serve manifest' });
    }
  });

  // Serve catalog content
  app.get('/:configHash/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
      const { configHash, type, id, extra } = req.params;
      let { skip = 0 } = req.query;
      
      if (!configHash || !type || !id) {
        return res.status(400).json({ error: 'Config hash, type, and ID are required' });
      }

      const config = await decompressConfig(configHash);

      // Parse skip parameter from extra
      if (extra && extra.includes('skip=')) {
        const skipMatch = extra.match(/skip=(\d+)/);
        if (skipMatch && skipMatch[1]) {
          skip = parseInt(skipMatch[1]);
        }
      }

      // Extract the list ID
      let listId = id;
      if (id.startsWith('aiolists_') || id.startsWith('aiolists-')) {
        listId = id.substring(9);
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

      // Check if this list is hidden
      const hiddenLists = new Set((config.hiddenLists || []).map(String));
      if (hiddenLists.has(String(listId))) {
        return res.json({ metas: [] });
      }

      // Check if this is an external addon catalog
      const addonCatalog = Object.values(config.importedAddons || {}).find(addon => 
        addon.catalogs.some(cat => cat.id === listId)
      );

      if (addonCatalog) {
        // For MDBList imported URLs, fetch directly using our API
        const catalog = addonCatalog.catalogs.find(cat => cat.id === listId);
        if (addonCatalog.id.startsWith('mdblist_') && catalog?.url) {
          // Extract list ID from the URL and fetch using MDBList API
          const items = await fetchListItems(listId, config.apiKey, config.listsMetadata, skip);
          if (!items) {
            return res.json({ metas: [] });
          }

          // Convert to Stremio format
          const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, config.rpdbApiKey);

          // Filter by type
          let filteredMetas = allMetas;
          if (type === 'movie') {
            filteredMetas = allMetas.filter(item => item.type === 'movie');
          } else if (type === 'series') {
            filteredMetas = allMetas.filter(item => item.type === 'series');
          }

          // Set cache headers
          res.setHeader('Cache-Control', `max-age=${3600 * 24}`);

          return res.json({
            metas: filteredMetas,
            cacheMaxAge: 3600 * 24
          });
        }

        // For other external addons, fetch from their API
        const items = await fetchExternalAddonItems(listId, addonCatalog, skip, config.rpdbApiKey);
        
        // Set cache headers
        res.setHeader('Cache-Control', `max-age=${3600 * 24}`);
        
        // Return the metadata directly
        return res.json({
          metas: items,
          cacheMaxAge: 3600 * 24
        });
      }

      // For regular lists, fetch content normally
      const items = await fetchListContent(listId, config, config.importedAddons, skip);
      if (!items) {
        return res.json({ metas: [] });
      }

      // Convert to Stremio format with RPDB posters
      const allMetas = await convertToStremioFormat(items, 0, ITEMS_PER_PAGE, config.rpdbApiKey);

      // Filter by type
      let filteredMetas = allMetas;
      if (type === 'movie') {
        filteredMetas = allMetas.filter(item => item.type === 'movie');
      } else if (type === 'series') {
        filteredMetas = allMetas.filter(item => item.type === 'series');
      }

      // Set cache headers
      res.setHeader('Cache-Control', `max-age=${3600 * 24}`);

      // Return response
      res.json({
        metas: filteredMetas,
        cacheMaxAge: 3600 * 24
      });
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
      
      // Process lists
      const lists = allLists.map(list => ({
        id: String(list.id),
        name: list.name,
        customName: config.customListNames?.[String(list.id)] || null,
        isHidden: (config.hiddenLists || []).includes(String(list.id)),
        isMovieList: list.isMovieList,
        isShowList: list.isShowList,
        isExternalList: list.isExternalList,
        listType: list.listType || 'L',
        isTraktList: list.isTraktList,
        isWatchlist: list.isWatchlist,
        tag: list.listType || 'L'
      }));
      
      // Add imported addon lists
      if (config.importedAddons) {
        for (const addon of Object.values(config.importedAddons)) {
          const addonLists = addon.catalogs.map(catalog => ({
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
            tagImage: addon.logo
          }));
          lists.push(...addonLists);
        }
      }
      
      // Sort lists based on config.listOrder
      if (config.listOrder?.length > 0) {
        const orderMap = new Map(config.listOrder.map((id, index) => [String(id), index]));
        lists.sort((a, b) => {
          const posA = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
          const posB = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
          return posA - posB;
        });
      }
      
      const result = {
        success: true,
        lists,
        importedAddons: config.importedAddons || {}
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
      await rebuildAddonWithConfig(updatedConfig);
      
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
      await rebuildAddonWithConfig(updatedConfig);
      
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
      
      // Extract list ID, name and type from URL, passing the API key
      const { listId, listName } = await extractListFromUrl(url, config.apiKey);
      
      // Fetch the actual list content to determine what types it contains
      const listContent = await fetchListItems(listId, config.apiKey, config.listsMetadata);
      if (!listContent) {
        throw new Error('Could not fetch list content');
      }

      // Determine which types to include based on actual content
      const hasMovies = listContent.movies && listContent.movies.length > 0;
      const hasShows = listContent.shows && listContent.shows.length > 0;
      
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
          extra: [{ name: 'skip' }]
        });
        manifest.types.push('series');
      }

      // If no content was found, throw an error
      if (!hasMovies && !hasShows) {
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

  return app;
}

module.exports = setupApiRoutes; 