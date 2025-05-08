const axios = require('axios');
const { parse: parseUrl } = require('url');

/**
 * Import an external addon from a manifest URL
 * @param {string} manifestUrl - URL to the addon manifest
 * @returns {Promise<Object>} Imported addon metadata
 */
async function importExternalAddon(manifestUrl) {
  try {
    if (!manifestUrl) {
      throw new Error('Manifest URL is required');
    }

    // Parse the URL to handle both regular URLs and stremio:// protocol
    let cleanUrl = manifestUrl;
    if (manifestUrl.startsWith('stremio://')) {
      cleanUrl = 'https://' + manifestUrl.substring(10);
    }

    // Fetch the manifest
    const response = await axios.get(cleanUrl);
    const manifest = response.data;

    if (!manifest || !manifest.catalogs) {
      throw new Error('Invalid manifest format - missing catalogs');
    }

    // Extract the base URL from the manifest URL
    const parsedUrl = parseUrl(cleanUrl);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    
    // Extract the path part which might contain configuration in URL format
    const pathParts = parsedUrl.pathname.split('/');
    const configPart = pathParts.length > 2 ? pathParts[1] : null;
    
    // Create addon metadata
    const addonId = manifest.id || `imported_${Date.now()}`;
    
    // Process catalogs based on addon type
    let catalogs = [];
    
    // Check if this is an anime catalogs addon
    const isAnimeCatalogs = manifest.name?.includes('Anime Catalogs') || 
                           configPart?.includes('myanimelist') || 
                           configPart?.includes('anilist') || 
                           configPart?.includes('anidb');
    
    if (isAnimeCatalogs) {
      // Parse configuration from URL if available
      let config = {};
      if (configPart && configPart.startsWith('%7B')) {
        try {
          config = JSON.parse(decodeURIComponent(configPart));
        } catch (e) {
          console.warn('Failed to parse anime catalog config:', e);
        }
      }
      
      // Process anime catalog format
      catalogs = processAnimeCatalogFormat(manifest, config);
    } else {
      // Process standard Stremio addon format
      catalogs = processStandardAddonFormat(manifest);
    }

    return {
      id: addonId,
      name: manifest.name || 'Unknown Addon',
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      logo: manifest.logo || null,
      url: cleanUrl,
      baseUrl,
      configPath: configPart ? `/${configPart}` : '',
      catalogs,
      resources: manifest.resources || [],
      types: manifest.types || [],
      isAnimeCatalogs
    };
  } catch (error) {
    console.error('Error importing addon:', error);
    throw error;
  }
}

/**
 * Process standard Stremio addon format
 * @param {Object} manifest - Addon manifest
 * @returns {Array} Processed catalogs
 */
function processStandardAddonFormat(manifest) {
  // Check for duplicate IDs and make them unique
  const idCounts = {};
  const processedCatalogs = [];
  
  manifest.catalogs.forEach(catalog => {
    const originalId = catalog.id;
    
    // Count occurrences of this ID
    idCounts[originalId] = (idCounts[originalId] || 0) + 1;
    
    // If this is a duplicate ID, add a suffix based on the type
    let uniqueId = originalId;
    if (idCounts[originalId] > 1 || catalog.type) {
      // Add type suffix to ensure unique IDs, especially for movie/series with the same ID
      uniqueId = `${originalId}_${catalog.type || 'unknown'}`;
      console.log(`Made ID unique: ${originalId} -> ${uniqueId} (type: ${catalog.type || 'unknown'})`);
    }
    
    processedCatalogs.push({
      id: uniqueId,  // Use the unique ID
      originalId: originalId,
      name: catalog.name,
      type: catalog.type || 'movie', // Default to movie if type is missing
      addonName: manifest.name,
      addonLogo: manifest.logo,
      extra: catalog.extra || []
    });
  });
  
  return processedCatalogs;
}

/**
 * Process anime catalog format
 * @param {Object} manifest - Addon manifest
 * @param {Object} config - Configuration object from URL
 * @returns {Array} Processed catalogs
 */
function processAnimeCatalogFormat(manifest, config) {
  const catalogs = [];
  
  // Add enabled catalogs from the config
  for (const [key, value] of Object.entries(config)) {
    if (value === 'on') {
      const nameParts = key.split('_');
      const source = nameParts[0] || 'unknown';
      const category = nameParts.slice(1).join(' ');
      
      const name = [
        source.charAt(0).toUpperCase() + source.slice(1),
        category.replace(/-/g, ' ')
      ]
        .filter(Boolean)
        .join(' - ')
        .replace(/myanimelist/i, 'MyAnimeList')
        .replace(/anidb/i, 'AniDB')
        .replace(/anilist/i, 'AniList');
      
      catalogs.push({
        id: key,  // Use the original key directly as the ID
        originalId: key,
        name: name,
        type: 'anime',
        addonName: manifest.name,
        addonLogo: manifest.logo
      });
    }
  }
  
  // If no config was parsed, add all catalogs from manifest
  if (catalogs.length === 0 && manifest.catalogs) {
    manifest.catalogs.forEach(catalog => {
      catalogs.push({
        id: catalog.id,
        originalId: catalog.id,
        name: catalog.name,
        type: catalog.type || 'anime',
        addonName: manifest.name,
        addonLogo: manifest.logo
      });
    });
  }
  
  return catalogs;
}

/**
 * Fetch items from an external addon catalog
 * @param {string} catalogId - Catalog ID
 * @param {Object} addon - Addon metadata
 * @param {number} skip - Number of items to skip
 * @returns {Promise<Object>} Object with movies and shows
 */
async function fetchExternalAddonItems(catalogId, addon, skip = 0) {
  try {
    if (!addon) {
      console.log('No addon provided');
      return { movies: [], shows: [] };
    }
    
    // First try to find by direct ID match
    let catalog = addon.catalogs.find(c => c.id === catalogId);
    
    // If not found, try by original ID
    if (!catalog) {
      catalog = addon.catalogs.find(c => c.originalId === catalogId);
    }
    
    // If still not found, check if the catalogId has a prefix
    if (!catalog && catalogId.includes('_')) {
      const simpleCatalogId = catalogId.split('_').pop();
      catalog = addon.catalogs.find(c => c.id === simpleCatalogId || c.originalId === simpleCatalogId);
    }
    
    if (!catalog) {
      console.log(`Catalog ${catalogId} not found in addon ${addon.name}`);
      return { movies: [], shows: [] };
    }
    
    console.log(`Found catalog: ${catalog.name} (${catalog.id})`);
    
    let catalogUrl;
    const originalId = catalog.originalId || catalog.id;
    
    if (addon.isAnimeCatalogs || catalog.type === 'anime') {
      // For anime catalogs, format is /catalog/anime/{catalogId}.json
      catalogUrl = `${addon.baseUrl}${addon.configPath}/catalog/anime/${originalId}.json`;
    } else {
      // For standard catalogs, format is /catalog/{type}/{catalogId}/skip={skip}.json
      catalogUrl = `${addon.baseUrl}/catalog/${catalog.type}/${originalId}/skip=${skip}.json`;
    }
    
    console.log(`Fetching from external addon: ${catalogUrl}`);
    
    const response = await axios.get(catalogUrl);
    if (!response.data || !response.data.metas) {
      console.log('No metas found in response');
      return { movies: [], shows: [] };
    }
    
    return processMetasToInternalFormat(response.data.metas);
  } catch (error) {
    console.error(`Error fetching from external addon: ${error.message}`);
    if (error.response) {
      console.error('Addon API Error Response:', error.response.status);
    }
    return { movies: [], shows: [] };
  }
}

/**
 * Process metas from external addons to our internal format
 * @param {Array} metas - Metadata items from external addon
 * @returns {Object} Object with movies and shows
 */
function processMetasToInternalFormat(metas) {
  // Ensure metas is an array
  if (!Array.isArray(metas)) {
    return { movies: [], shows: [] };
  }
  
  const processedItems = {
    movies: [],
    shows: []
  };
  
  metas.forEach(item => {
    // Extract the ID - different addons might use different formats
    const imdbId = item.imdb_id || item.id || (item.ids ? item.ids.imdb : null);
    
    // Skip items without valid ID
    if (!imdbId) return;
    
    // Ensure the ID has the correct format
    const formattedId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
    
    // Common properties for all types
    const processedItem = {
      imdb_id: formattedId,
      title: item.name || item.title,
      year: item.year || (item.releaseInfo ? parseInt(item.releaseInfo) : null),
      type: item.type === 'series' ? 'show' : item.type,
      poster: item.poster,
      background: item.background,
      description: item.description || item.overview,
      runtime: item.runtime,
      genres: Array.isArray(item.genres) ? item.genres : 
              (typeof item.genres === 'string' ? item.genres.split(',').map(g => g.trim()) : []),
      imdbRating: item.imdbRating
    };
    
    // Add to appropriate array based on type
    if (item.type === 'movie') {
      processedItems.movies.push(processedItem);
    } else if (item.type === 'series') {
      processedItems.shows.push(processedItem);
    }
  });
  
  console.log(`Processed ${processedItems.movies.length} movies and ${processedItems.shows.length} shows`);
  return processedItems;
}

/**
 * List all catalogs from imported addons
 * @param {Object} importedAddons - Object with imported addons
 * @returns {Array} Array of all catalogs
 */
function listAllCatalogs(importedAddons) {
  if (!importedAddons) return [];
  
  const allCatalogs = [];
  
  for (const addon of Object.values(importedAddons)) {
    addon.catalogs.forEach(catalog => {
      allCatalogs.push({
        id: catalog.id,
        name: catalog.name,
        type: catalog.type,
        addonId: addon.id,
        addonName: addon.name,
        addonLogo: addon.logo
      });
    });
  }
  
  return allCatalogs;
}

module.exports = {
  importExternalAddon,
  fetchExternalAddonItems,
  listAllCatalogs
}; 