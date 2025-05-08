const { validateRPDBKey, testRPDBKey } = require('../utils/posters');
const { authenticateTrakt, getTraktAuthUrl, fetchTraktLists } = require('../integrations/trakt');
const { fetchAllLists } = require('../integrations/mdblist');
const { importExternalAddon } = require('../integrations/externalAddons');
const { saveConfig } = require('../config');
const { rebuildAddon } = require('../addon');

/**
 * Trigger a manual refresh of the manifest file and clear all related caches
 * @param {Object} addonInterface - The Stremio addon interface
 * @param {Object} userConfig - User configuration
 * @param {Object} cache - Cache instance
 * @returns {Promise<Object>} Updated addon interface
 */
async function refreshManifest(addonInterface, userConfig, cache) {
  try {
    console.log('Manually refreshing manifest');
    
    // Clear global rebuild timestamp to force immediate rebuild
    global.lastManifestRebuild = null;
    
    // Clear the cache
    cache.clear();
    
    // Rebuild the addon
    const newAddonInterface = await rebuildAddon(userConfig, cache);
    
    return newAddonInterface;
  } catch (error) {
    console.error('Error refreshing manifest:', error);
    return addonInterface; // Return original if refresh fails
  }
}

function setupApiRoutes(app, userConfig, cache, addonInterface) {
  // API key endpoints
  app.post('/api/config/apikey', async (req, res) => {
    try {
      const { apiKey, rpdbApiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
      }
    
      userConfig.apiKey = apiKey;
      if (rpdbApiKey !== undefined) {
        userConfig.rpdbApiKey = rpdbApiKey;
      }
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);
    
      // Rebuild addon with new API key
      addonInterface = await rebuildAddon(userConfig, cache);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving API key:", error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/config/apikey', (req, res) => {
    res.json({ apiKey: userConfig.apiKey || '' });
  });

  app.post('/api/config/rpdbkey', async (req, res) => {
    try {
      const { rpdbApiKey } = req.body;
      
      // Validate the RPDB API key if one was provided
      let isValid = true;
      if (rpdbApiKey) {
        isValid = await validateRPDBKey(rpdbApiKey);
        if (!isValid) {
          return res.status(400).json({ 
            error: 'Invalid RPDB API key',
            success: false
          });
        }
      }
      
      userConfig.rpdbApiKey = rpdbApiKey || '';
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);
      
      // Test the key
      if (rpdbApiKey) {
        testRPDBKey(rpdbApiKey);
      }
      
      // Clear cache
      cache.clear();
      
      res.json({ 
        success: true,
        valid: isValid 
      });
    } catch (error) {
      console.error("Error saving RPDB key:", error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/config/rpdbkey', (req, res) => {
    res.json({ rpdbApiKey: userConfig.rpdbApiKey || '' });
  });

  // Get all configuration
  app.get('/api/config/all', (req, res) => {
    // Return a sanitized version of the config (omit sensitive data)
    const safeConfig = {
      listOrder: userConfig.listOrder || [],
      hiddenLists: userConfig.hiddenLists || [],
      listsMetadata: userConfig.listsMetadata || {},
      lastUpdated: userConfig.lastUpdated,
      customListNames: userConfig.customListNames || {}
    };
    
    res.json(safeConfig);
  });

  // Lists endpoints
  app.get('/api/lists', async (req, res) => {
    try {
      const allLists = await fetchAllLists(userConfig.apiKey);
      
      // If Trakt is configured, fetch those lists as well
      let traktLists = [];
      if (userConfig.traktAccessToken) {
        traktLists = await fetchTraktLists(userConfig);
      }
      
      // Combine all lists
      const combinedLists = [...allLists, ...traktLists];
      
      // Get the normalized list order map for consistent sorting
      const orderMap = new Map();
      if (userConfig.listOrder && userConfig.listOrder.length > 0) {
        userConfig.listOrder.forEach((id, index) => {
          orderMap.set(String(id), index);
        });
      }
      
      // Process MDBList and Trakt lists
      const lists = combinedLists.map(list => {
        // Strip prefix for MDBList ID consistency
        const listId = String(list.id);
        
        // Check if this list has a position in the order
        const position = orderMap.has(listId) ? orderMap.get(listId) : Number.MAX_SAFE_INTEGER;
        
        return {
          id: listId,
          name: list.name,
          customName: userConfig.customListNames?.[listId] || null,
          isHidden: (userConfig.hiddenLists || []).map(String).includes(listId),
          isMovieList: list.isMovieList,
          isShowList: list.isShowList,
          isExternalList: list.isExternalList,
          listType: list.listType || 'L', // Default to 'L' for regular lists
          isTraktList: list.isTraktList,
          isWatchlist: list.isWatchlist,
          tag: list.listType || 'L',
          position: position
        };
      });

      // Add imported addon lists
      if (userConfig.importedAddons) {
        for (const addon of Object.values(userConfig.importedAddons)) {
          console.log(`Processing addon: ${addon.name} with ${addon.catalogs.length} catalogs`);
          
          const addonLists = addon.catalogs.map(catalog => {
            // Use the exact catalog.id as the ID to ensure consistent ID handling
            const catalogId = String(catalog.id);
            
            // Check if this list has a custom name
            const hasCustomName = userConfig.customListNames && catalogId in userConfig.customListNames;
            
            // Check if this list is hidden
            const isHidden = (userConfig.hiddenLists || []).map(String).includes(catalogId);
            
            // Get position from order map
            let position = Number.MAX_SAFE_INTEGER;
            // First try with the full ID
            if (orderMap.has(catalogId)) {
              position = orderMap.get(catalogId);
            } 
            // Then try with the base ID (without type suffix)
            else if (catalogId.includes('_')) {
              const baseId = catalogId.split('_')[0];
              if (orderMap.has(baseId)) {
                position = orderMap.get(baseId);
              }
            }
            
            console.log(`Catalog: ${catalog.name} (${catalogId}), Position: ${position}, Custom name: ${hasCustomName}, Hidden: ${isHidden}`);
            
            return {
              id: catalogId,
              originalId: catalog.originalId || catalog.id,
              name: catalog.name,
              customName: userConfig.customListNames?.[catalogId] || null,
              isHidden: isHidden,
              isMovieList: catalog.type === 'movie',
              isShowList: catalog.type === 'series' || catalog.type === 'anime',
              isExternalList: true,
              listType: 'A', // 'A' for External Addon
              addonId: addon.id,
              addonName: addon.name,
              addonLogo: addon.logo || null,
              tag: 'A',
              tagImage: addon.logo,
              position: position
            };
          });
          lists.push(...addonLists);
        }
      }

      // Apply list ordering
      lists.sort((a, b) => {
        // Use position field for sorting
        const posA = a.position !== undefined ? a.position : Number.MAX_SAFE_INTEGER;
        const posB = b.position !== undefined ? b.position : Number.MAX_SAFE_INTEGER;
        console.log(`Sorting lists: ${a.name} (${posA}) vs ${b.name} (${posB})`);
        return posA - posB;
      });

      res.json({
        success: true,
        lists: lists,
        importedAddons: userConfig.importedAddons || {}
      });
    } catch (error) {
      console.error('Error fetching lists:', error);
      res.status(500).json({ error: 'Failed to fetch lists' });
    }
  });

  // List order endpoint
  app.post('/api/lists/order', async (req, res) => {
    try {
      const { order } = req.body;
      
      if (!order || !Array.isArray(order)) {
        return res.status(400).json({ error: 'Order must be an array of list IDs' });
      }
      
      console.log(`Received order update: ${order.join(', ')}`);
      
      // Save the previous order for comparison
      const previousOrder = userConfig.listOrder || [];
      
      console.log(`Previous order: ${previousOrder.join(', ')}`);
      
      // Ensure all IDs are strings and strip prefix for consistent handling
      const normalizedOrder = order.map(id => {
        let normalizedId = String(id);
        // Strip aiolists- prefix if present for consistent storage
        if (normalizedId.startsWith('aiolists-')) {
          normalizedId = normalizedId.replace('aiolists-', '');
          console.log(`Normalized ID: ${id} -> ${normalizedId}`);
        }
        return normalizedId;
      });
      
      const normalizedPrevious = previousOrder.map(id => {
        let normalizedId = String(id);
        // Strip aiolists- prefix if present for consistent comparison
        if (normalizedId.startsWith('aiolists-')) {
          normalizedId = normalizedId.replace('aiolists-', '');
        }
        return normalizedId;
      });
      
      // Create maps for easier comparison
      const newOrderMap = new Map(normalizedOrder.map((id, idx) => [id, idx]));
      const prevOrderMap = new Map(normalizedPrevious.map((id, idx) => [id, idx]));
      
      // Check if there are actual changes by comparing maps
      let hasChanges = normalizedOrder.length !== normalizedPrevious.length;
      
      if (!hasChanges) {
        // Check if any ID's position changed
        for (const [id, pos] of newOrderMap.entries()) {
          if (!prevOrderMap.has(id) || prevOrderMap.get(id) !== pos) {
            hasChanges = true;
            console.log(`Change detected: ${id} moved from ${prevOrderMap.get(id) || 'N/A'} to ${pos}`);
            break;
          }
        }
      }
      
      if (!hasChanges) {
        return res.json({ 
          success: true, 
          message: "No changes to list order"
        });
      }
      
      // Update list order
      userConfig.listOrder = normalizedOrder;
      userConfig.lastUpdated = new Date().toISOString();
      
      console.log(`New order saved: ${userConfig.listOrder.join(', ')}`);
      
      saveConfig(userConfig);
      
      // Explicitly refresh the manifest
      addonInterface = await refreshManifest(addonInterface, userConfig, cache);
      
      // Send success response
      res.json({ 
        success: true, 
        message: "List order updated successfully",
        order: userConfig.listOrder // Return the saved order for confirmation
      });
    } catch (error) {
      console.error("Error updating list order:", error);
      res.status(500).json({ error: 'Failed to update list order' });
    }
  });

  // List visibility endpoint
  app.post('/api/lists/visibility', async (req, res) => {
    try {
      const { hiddenLists } = req.body;
      
      if (!Array.isArray(hiddenLists)) {
        return res.status(400).json({ error: 'Hidden lists must be an array of list IDs' });
      }
      
      console.log(`Received visibility update. Hidden lists: ${hiddenLists.join(', ')}`);
      
      // Convert arrays to Sets for efficient comparison
      const newHiddenSet = new Set(hiddenLists.map(String));
      const oldHiddenSet = new Set((userConfig.hiddenLists || []).map(String));
      
      console.log(`Old hidden lists: ${[...oldHiddenSet].join(', ')}`);
      console.log(`New hidden lists: ${[...newHiddenSet].join(', ')}`);
      
      // Check if there are actual changes
      const sizeMatch = newHiddenSet.size === oldHiddenSet.size;
      const contentMatch = [...newHiddenSet].every(id => oldHiddenSet.has(id));
      
      console.log(`Size match: ${sizeMatch}, Content match: ${contentMatch}`);
      
      if (sizeMatch && contentMatch) {
        return res.json({ 
          success: true, 
          message: "No changes to list visibility"
        });
      }
      
      // Update hidden lists in userConfig
      userConfig.hiddenLists = [...newHiddenSet];
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);
      
      // Explicitly refresh the manifest
      addonInterface = await refreshManifest(addonInterface, userConfig, cache);
      
      // Send success response
      res.json({ 
        success: true, 
        message: "List visibility updated successfully"
      });
    } catch (error) {
      console.error("Error updating list visibility:", error);
      res.status(500).json({ error: 'Failed to update list visibility' });
    }
  });

  // Add new endpoint for updating list names
  app.post('/api/lists/names', async (req, res) => {
    try {
      const { listId, customName } = req.body;
      
      if (!listId || typeof customName !== 'string') {
        return res.status(400).json({ error: 'List ID and custom name are required' });
      }
      
      console.log(`Updating list name for ${listId} to "${customName}"`);
      
      // Initialize customListNames if it doesn't exist
      if (!userConfig.customListNames) {
        userConfig.customListNames = {};
      }
      
      // Ensure list ID is stored as string
      const normalizedListId = String(listId);
      
      // Update or remove custom name
      if (customName.trim()) {
        userConfig.customListNames[normalizedListId] = customName.trim();
        console.log(`Set custom name for ${normalizedListId}: "${customName.trim()}"`);
      } else {
        // If empty name provided, remove custom name
        delete userConfig.customListNames[normalizedListId];
        console.log(`Removed custom name for ${normalizedListId}`);
      }
      
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);
      
      // Explicitly refresh the manifest
      addonInterface = await refreshManifest(addonInterface, userConfig, cache);
      
      res.json({ 
        success: true, 
        message: "List name updated successfully"
      });
    } catch (error) {
      console.error("Error updating list name:", error);
      res.status(500).json({ error: 'Failed to update list name' });
    }
  });

  // Trakt API endpoints
  app.get('/api/config/trakt', (req, res) => {
    const authUrl = getTraktAuthUrl() || `https://api.trakt.tv/oauth/authorize?response_type=code&client_id=490414ec03fe9a33b2d0c16d58261ebbbd9cf0eee23f213fa0e3eb1d6126d05c&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob`;
    
    const traktInfo = {
      hasAccessToken: !!userConfig.traktAccessToken,
      expiresAt: userConfig.traktExpiresAt || null,
      authUrl: authUrl
    };
    
    res.json(traktInfo);
  });

  // Add a simplified endpoint for direct Trakt login
  app.get('/api/trakt/login', (req, res) => {
    try {
      // Generate the auth URL
      const authUrl = getTraktAuthUrl();
      
      // Redirect the user to the Trakt authorization page
      res.redirect(authUrl);
    } catch (error) {
      console.error("Error in Trakt login:", error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/config/trakt/auth', async (req, res) => {
    try {
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({ error: 'Authorization code is required' });
      }
      
      // Exchange the code for access token
      const traktTokens = await authenticateTrakt(code);
      
      // Save the tokens
      userConfig.traktAccessToken = traktTokens.accessToken;
      userConfig.traktRefreshToken = traktTokens.refreshToken;
      userConfig.traktExpiresAt = traktTokens.expiresAt;
      
      // Save config
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);
      
      // Rebuild addon to include Trakt lists
      addonInterface = await rebuildAddon(userConfig, cache);
      
      res.json({
        success: true,
        message: 'Successfully authenticated with Trakt'
      });
    } catch (error) {
      console.error("Error authenticating with Trakt:", error.message);
      if (error.response) {
        console.error("Trakt API Error Response:", error.response.data);
      }
      res.status(500).json({ 
        error: 'Failed to authenticate with Trakt',
        details: error.response?.data?.error_description || error.message
      });
    }
  });

  // Import lists from external addon
  app.post('/api/import-addon', async (req, res) => {
    try {
      const { manifestUrl } = req.body;
      
      if (!manifestUrl) {
        return res.status(400).json({ error: 'Manifest URL is required' });
      }

      // Import the addon
      const addonInfo = await importExternalAddon(manifestUrl);

      // Initialize importedAddons if needed
      if (!userConfig.importedAddons) {
        userConfig.importedAddons = {};
      }
      
      // Store addon info
      userConfig.importedAddons[addonInfo.id] = addonInfo;
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);

      // Rebuild addon
      addonInterface = await rebuildAddon(userConfig, cache);

      res.json({
        success: true,
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

  // Add endpoint to remove imported addon
  app.post('/api/remove-addon', async (req, res) => {
    try {
      const { addonId } = req.body;
      
      if (!addonId || !userConfig.importedAddons?.[addonId]) {
        return res.status(400).json({ error: 'Invalid addon ID' });
      }

      // Remove addon info
      delete userConfig.importedAddons[addonId];

      // Save config and rebuild addon
      userConfig.lastUpdated = new Date().toISOString();
      saveConfig(userConfig);
      addonInterface = await rebuildAddon(userConfig, cache);

      res.json({
        success: true,
        message: 'Addon removed successfully'
      });
    } catch (error) {
      console.error('Error removing addon:', error);
      res.status(500).json({ error: 'Failed to remove addon' });
    }
  });

  // Force rebuild endpoint
  app.post('/api/rebuild-addon', async (req, res) => {
    try {
      // Clear all caches
      cache.clear();
      
      // Create fresh addon interface directly
      const freshAddonInterface = await rebuildAddon(userConfig, cache);
      
      // Update the global addonInterface
      addonInterface = freshAddonInterface;
      
      res.json({ 
        success: true, 
        message: "Addon rebuilt successfully"
      });
    } catch (error) {
      console.error("Error rebuilding addon:", error);
      res.status(500).json({ error: 'Failed to rebuild addon' });
    }
  });

  // Add endpoint to refresh manifest after changes
  app.post('/api/refresh-manifest', async (req, res) => {
    try {
      // Clear all caches
      cache.clear();
      
      // Rebuild the addon
      addonInterface = await rebuildAddon(userConfig, cache);
      
      res.json({ 
        success: true, 
        message: "Manifest refreshed successfully"
      });
    } catch (error) {
      console.error("Error refreshing manifest:", error);
      res.status(500).json({ error: 'Failed to refresh manifest' });
    }
  });

  return app;
}

module.exports = setupApiRoutes; 