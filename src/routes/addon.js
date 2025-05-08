const path = require('path');
const fs = require('fs');
const { convertToStremioFormat } = require('../addon');
const { fetchTraktListItems } = require('../integrations/trakt');
const { fetchListItems } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');

function setupAddonRoutes(app, userConfig, cache, addonInterface) {
  // Manifest endpoint
  app.get('/manifest.json', async (req, res) => {
    try {
      // Set cache control headers to prevent browsers from caching the manifest
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      console.log('Manifest.json requested');
      
      // Force rebuild of the addon interface to ensure it's up to date
      // This may be a bit inefficient, but it ensures the manifest is always fresh
      try {
        // Only rebuild if it's been more than 2 seconds since the last rebuild
        // This prevents excessive rebuilds when multiple clients request the manifest
        const now = Date.now();
        if (!global.lastManifestRebuild || (now - global.lastManifestRebuild) > 2000) {
          console.log('Rebuilding addon for fresh manifest');
          const { rebuildAddon } = require('../addon');
          addonInterface = await rebuildAddon(userConfig, cache);
          global.lastManifestRebuild = now;
        } else {
          console.log('Using cached addonInterface (rebuilt < 2s ago)');
        }
      } catch (rebuildError) {
        console.error('Error rebuilding addon for manifest:', rebuildError);
        // Continue with existing addonInterface
      }
      
      // Verify the addon interface was created
      if (!addonInterface || !addonInterface.manifest) {
        return res.status(500).json({ error: 'Invalid addon interface created' });
      }
      
      // Final safety check: ensure hidden lists are properly excluded
      // Convert all IDs to strings for consistent comparison
      const hiddenListsSet = new Set(Array.from(userConfig.hiddenLists || []).map(String));
      if (hiddenListsSet.size > 0) {
        addonInterface.manifest.catalogs = addonInterface.manifest.catalogs.filter(catalog => {
          // Extract the list ID from the catalog ID and ensure it's a string
          let listId = catalog.id;
          if (catalog.id.startsWith('aiolists-')) {
            listId = catalog.id.replace('aiolists-', '');
          }
          listId = String(listId);
          
          // Handle suffixed IDs (_movie, _series)
          if (listId.includes('_')) {
            const baseId = listId.split('_')[0];
            if (hiddenListsSet.has(baseId)) {
              return false;
            }
          }
          
          // Keep only catalogs that aren't in the hidden lists
          return !hiddenListsSet.has(listId);
        });
      }
      
      // Return a deep copy to avoid modification
      const manifestCopy = JSON.parse(JSON.stringify(addonInterface.manifest));
      
      // Add a unique timestamp to prevent caching
      manifestCopy.version = manifestCopy.version.split('-')[0] + '-' + Date.now();
      
      // Add the total number of catalogs for debugging
      console.log(`Sending manifest with ${manifestCopy.catalogs.length} catalogs`);
      
      res.json(manifestCopy);
    } catch (error) {
      console.error('Failed to serve manifest:', error);
      res.status(500).json({ error: 'Failed to serve manifest: ' + error.message });
    }
  });

  // Manual handler for catalog requests
  app.get('/catalog/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const { skip = 0 } = req.query;

    try {
      // Extract the list ID - handle both aiolists and trakt prefixes
      let listId = id;
      if (id.startsWith('aiolists_') || id.startsWith('aiolists-')) {
        listId = id.substring(9);
      }
    
      // Validate the list ID format
      if (!listId.match(/^[a-zA-Z0-9_-]+$/)) {
        return res.status(400).json({ error: 'Invalid catalog ID format' });
      }

      // Check if this list is hidden - use Set for efficient lookup
      const hiddenLists = new Set((userConfig.hiddenLists || []).map(String));
      if (hiddenLists.has(String(listId))) {
        return res.json({ metas: [] });
      }

      // Check cache first
      const cacheKey = `${id}_${type}_${skip}`;
      if (cache.has(cacheKey)) {
        const cachedResponse = cache.get(cacheKey);
        return res.json(cachedResponse);
      }

      // Fetch items based on list type
      let items;
      
      // Check if this is an imported addon catalog
      if (userConfig.importedAddons) {
        for (const addon of Object.values(userConfig.importedAddons)) {
          // Special case for anime catalogs
          if (type === 'anime' && addon.id === 'anime-catalogs') {
            const catalog = addon.catalogs.find(c => c.id === id);
            if (catalog) {
              items = await fetchExternalAddonItems(id, addon, parseInt(skip));
              break;
            }
          }
          
          // Check regular addon catalogs
          const catalog = addon.catalogs.find(c => c.id === listId);
          if (catalog) {
            items = await fetchExternalAddonItems(listId, addon);
            break;
          }
        }
      }
      
      // If not found in imported addons, check other sources
      if (!items) {
        if (listId.startsWith('trakt_')) {
          // Only check Trakt access token for Trakt lists
          if (!userConfig.traktAccessToken) {
            return res.status(500).json({ error: 'No Trakt access token configured' });
          }
          items = await fetchTraktListItems(listId, userConfig);
        } else {
          // For MDBList items, check API key
          if (!userConfig.apiKey) {
            return res.status(500).json({ error: 'No AIOLists API key configured' });
          }
          items = await fetchListItems(listId, userConfig.apiKey, userConfig.listsMetadata);
        }
      }
      
      if (!items) {
        return res.status(500).json({ error: 'Failed to fetch list items' });
      }

      // Convert to Stremio format with pagination
      const skipInt = parseInt(skip);
      const metas = await convertToStremioFormat(items, skipInt, 10, userConfig.rpdbApiKey);
      
      // Filter by type
      let filteredMetas = metas;
      if (type === 'movie') {
        filteredMetas = metas.filter(item => item.type === 'movie');
      } else if (type === 'series') {
        filteredMetas = metas.filter(item => item.type === 'series');
      }

      // Prepare response
      const response = {
        metas: filteredMetas,
        cacheMaxAge: 3600 * 24
      };
      
      // Set cache
      cache.set(cacheKey, response, 3600 * 24 * 1000); // Cache for 24 hours
      
      // Set cache headers
      res.setHeader('Cache-Control', `max-age=${3600 * 24}`);
      
      return res.json(response);
    } catch (error) {
      console.error(`Error processing catalog request: ${error}`);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Home page and configuration
  app.get('/', (req, res) => {
    // Check if API key is configured
    if (!userConfig.apiKey) {
      // Redirect to configuration page with a setup parameter
      res.redirect('/configure?setup=true');
    } else {
      res.redirect('/configure');
    }
  });

  app.get('/configure', (req, res) => {
    // Pass setup parameter to the frontend if needed
    const setupMode = req.query.setup === 'true';
    
    // Add a small script to set a setup flag for the frontend
    if (setupMode) {
      const configPage = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
      const configPageWithSetup = configPage.replace(
        '</head>',
        '<script>window.isFirstTimeSetup = true;</script></head>'
      );
      res.send(configPageWithSetup);
    } else {
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
    }
  });

  return app;
}

module.exports = setupAddonRoutes; 