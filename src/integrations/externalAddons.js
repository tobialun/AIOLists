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

    // Create addon metadata - store minimal information needed for direct URL access
    const addonId = manifest.id || `imported_${Date.now()}`;
    
    // Check if this is an anime catalogs addon
    const isAnimeCatalogs = manifest.name?.includes('Anime Catalogs') || 
                           cleanUrl.includes('myanimelist') || 
                           cleanUrl.includes('anilist') || 
                           cleanUrl.includes('anidb');

    // Store only essential catalog information
    const catalogs = manifest.catalogs.map(catalog => ({
      id: catalog.id,
      name: catalog.name,
      type: isAnimeCatalogs ? 'anime' : (catalog.type || 'movie')
    }));

    return {
      id: addonId,
      name: manifest.name || 'Unknown Addon',
      version: manifest.version || '0.0.0',
      description: manifest.description || '',
      logo: manifest.logo || null,
      url: cleanUrl,  // Store the complete URL for direct access
      catalogs,
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

    // For external addons, we'll use their direct URL instead of proxying through our service
    const directUrl = addon.url;
    if (!directUrl) {
      console.log('No direct URL available for addon');
      return { movies: [], shows: [] };
    }

    // Parse the URL to get the base and config parts
    const urlParts = directUrl.split('/');
    const baseUrl = urlParts.slice(0, 3).join('/');
    const configPath = urlParts.length > 3 ? '/' + urlParts[3] : '';

    // Construct the catalog URL based on the original addon URL structure
    let catalogUrl;
    if (addon.isAnimeCatalogs) {
      // For anime catalogs, maintain the original URL structure
      catalogUrl = `${baseUrl}${configPath}/catalog/anime/${catalogId}.json`;
    } else {
      // For standard Stremio addons
      catalogUrl = `${baseUrl}/catalog/${addon.types[0] || 'movie'}/${catalogId}/skip=${skip}.json`;
    }

    console.log(`Fetching directly from external addon: ${catalogUrl}`);

    const response = await axios.get(catalogUrl);
    if (!response.data || !response.data.metas) {
      console.log('No metas found in response');
      return { movies: [], shows: [] };
    }

    // Return the metas directly without processing since we'll use them as-is
    return {
      movies: response.data.metas.filter(m => m.type === 'movie'),
      shows: response.data.metas.filter(m => m.type === 'series')
    };
  } catch (error) {
    console.error(`Error fetching from external addon: ${error.message}`);
    if (error.response) {
      console.error('Addon API Error Response:', error.response.status);
    }
    return { movies: [], shows: [] };
  }
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