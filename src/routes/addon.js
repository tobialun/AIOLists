const path = require('path');
const fs = require('fs');
const { convertToStremioFormat, fetchListContent } = require('../addon');
const { ITEMS_PER_PAGE } = require('../config');
const Cache = require('../cache');

// Create cache instance for addon data
const addonCache = new Cache({ defaultTTL: 60 * 60 * 1000 }); // 1 hour

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
 * Generate cache key for catalog content
 * @param {string} type - Content type
 * @param {string} id - Catalog ID
 * @param {number} skip - Skip value
 * @returns {string} Cache key
 */
function getCatalogCacheKey(type, id, skip) {
  return `catalog_${type}_${id}_${skip}`;
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
    res.setHeader('Cache-Control', 'max-age=86400, public');
  }
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
      
      // Set cache headers
      setCacheHeaders(res, id);
      
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
      
      const result = { 
        metas,
        cacheMaxAge: isWatchlist(id) ? 0 : 86400
      };
      
      // Cache the result, but don't cache watchlists
      if (!isWatchlist(id)) {
        addonCache.set(cacheKey, result);
      }
      
      res.json(result);
    } catch (error) {
      console.error('Error in catalog endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}

module.exports = setupAddonRoutes; 