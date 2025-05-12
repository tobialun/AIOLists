const path = require('path');
const fs = require('fs');
const { convertToStremioFormat } = require('../addon');
const { fetchTraktListItems } = require('../integrations/trakt');
const { fetchListItems } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');
const { ITEMS_PER_PAGE } = require('../config');
const Cache = require('../cache');

// Create cache instance for addon data
const addonCache = new Cache({ defaultTTL: 60 * 60 * 1000 }); // 1 hour

/**
 * Generate cache key for catalog content
 * @param {string} type - Content type
 * @param {string} id - Catalog ID
 * @param {number} skip - Skip value
 * @returns {string} Cache key
 */
function getCatalogCacheKey(type, id, skip) {
  return `catalog_${type}_${id}_${skip}`;
}

function setupAddonRoutes(app, userConfig, cache, addonInterface) {
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

  app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
      const { type, id } = req.params;
      const extra = req.params.extra || '';
      
      // Parse skip parameter from extra
      const skipMatch = extra.match(/skip=(\d+)/);
      const skip = skipMatch ? parseInt(skipMatch[1]) : 0;
      
      // Check cache first
      const cacheKey = getCatalogCacheKey(type, id, skip);
      const cachedContent = addonCache.get(cacheKey);
      if (cachedContent) {
        return res.json(cachedContent);
      }
      
      // Fetch list content
      const listContent = await fetchListContent(id, userConfig, userConfig.importedAddons, skip);
      if (!listContent) {
        return res.json({ metas: [] });
      }
      
      // Convert to Stremio format
      const metas = await convertToStremioFormat(listContent, skip, ITEMS_PER_PAGE, userConfig.rpdbApiKey);
      
      // Sort metas based on catalogOrder if available
      if (listContent.catalogOrder !== undefined) {
        metas.sort((a, b) => {
          const orderA = a.catalogOrder || 0;
          const orderB = b.catalogOrder || 0;
          return orderA - orderB;
        });
      }
      
      const result = { metas };
      
      // Cache the result
      addonCache.set(cacheKey, result);
      
      res.json(result);
    } catch (error) {
      console.error('Error in catalog endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}

module.exports = setupAddonRoutes; 