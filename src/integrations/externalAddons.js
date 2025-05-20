const axios = require('axios');
const { batchFetchPosters } = require('../utils/posters');

/**
 * Represents an external addon with its manifest and metadata endpoints
 */
class ExternalAddon {
  constructor(manifestUrl) {
    this.manifestUrl = this.normalizeUrl(manifestUrl);
    this.manifest = null;
    this.baseUrl = '';
    this.configPath = '';
  }

  /**
   * Normalize Stremio URLs to HTTPS
   */
  normalizeUrl(url) {
    if (url.startsWith('stremio://')) {
      return 'https://' + url.substring(10);
    }
    return url;
  }

  /**
   * Extract base URL and config path from manifest URL
   */
  parseManifestUrl() {
    const urlParts = this.manifestUrl.split('/manifest.json')[0].split('/');
    this.baseUrl = urlParts.slice(0, 3).join('/');
    this.configPath = urlParts.length > 3 ? '/' + urlParts.slice(3).join('/') : '';
  }

  /**
   * Import addon from manifest URL
   */
  async import() {
    try {
      const response = await axios.get(this.manifestUrl);
      this.manifest = response.data;
      
      this.parseManifestUrl();

      if (!this.manifest || !this.manifest.catalogs) {
        throw new Error('Invalid manifest format - missing catalogs');
      }

      // Determine addon type based on manifest content and URL
      const isAnimeCatalogs = this.detectAnimeCatalogs();

      // Process catalogs based on addon type
      const processedCatalogs = isAnimeCatalogs ? 
        this.processAnimeCatalogs() : 
        this.processStandardCatalogs();
      

      const addonData = {
        id: this.manifest.id || `addon_${Date.now()}`,
        name: this.manifest.name || 'Unknown Addon',
        version: this.manifest.version || '0.0.0',
        description: this.manifest.description || '',
        logo: this.manifest.logo || null,
        url: this.manifestUrl,
        catalogs: processedCatalogs,
        types: this.manifest.types || [],
        resources: this.manifest.resources || [],
        isAnimeCatalogs
      };

      return addonData;
    } catch (error) {
      console.error('Error importing addon:', error);
      throw error;
    }
  }

  /**
   * Detect if this is an anime catalogs addon
   */
  detectAnimeCatalogs() {
    return (
      this.manifest.name?.toLowerCase().includes('anime') ||
      this.manifestUrl.toLowerCase().includes('myanimelist') ||
      this.manifestUrl.toLowerCase().includes('anilist') ||
      this.manifestUrl.toLowerCase().includes('anidb') ||
      this.manifest.catalogs.some(cat => cat.type === 'anime')
    );
  }

  /**
   * Process standard Stremio addon catalogs
   */
  processStandardCatalogs() {
    const idCounts = {};
    return this.manifest.catalogs.map(catalog => {
      const id = catalog.id;
      idCounts[id] = (idCounts[id] || 0) + 1;
      
      const uniqueId = idCounts[id] > 1 ? 
        `${id}_${catalog.type || 'unknown'}_${idCounts[id]}` : 
        id;

      return {
        id: uniqueId,
        originalId: id,
        name: catalog.name,
        type: catalog.type || 'movie',
        extra: catalog.extra || []
      };
    });
  }

  /**
   * Process anime catalogs
   */
  processAnimeCatalogs() {
    try {
      // Extract config from URL if present
      const configMatch = this.configPath.match(/%7B(.+?)%7D/);
      
      let config = {};
      if (configMatch) {
        const encodedJson = configMatch[1];
        
        const decodedJson = decodeURIComponent(encodedJson.replace(/\+/g, ' '));
        
        // The decoded JSON is missing the outer braces, so let's add them
        const jsonWithBraces = `{${decodedJson}}`;
        
        try {
          config = JSON.parse(jsonWithBraces);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          // If parsing fails, try to clean the string further
          const cleanedJson = jsonWithBraces
            .replace(/\\"/g, '"')  // Fix escaped quotes
            .replace(/\\\\/g, '\\') // Fix escaped backslashes
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .trim();
          config = JSON.parse(cleanedJson);
        }
      }

      if (Object.keys(config).length > 0) {
        // Process enabled catalogs from config
        const catalogs = Object.entries(config)
          .filter(([_, value]) => value === 'on')
          .map(([key]) => {
            const [source, ...categoryParts] = key.split('_');
            const category = categoryParts.join(' ');
            
            return {
              id: key,
              originalId: key,
              name: this.formatCatalogName(source, category),
              type: 'series',  // Changed from 'anime' to 'series' for better compatibility
              extra: []
            };
          });

        return catalogs;
      }

      // Fallback to manifest catalogs if no config
      const manifestCatalogs = this.manifest.catalogs.map(catalog => ({
        id: catalog.id,
        originalId: catalog.id,
        name: catalog.name,
        type: 'series',  // Changed from 'anime' to 'series' for better compatibility
        extra: catalog.extra || []
      }));

      return manifestCatalogs;
    } catch (error) {
      // If all parsing attempts fail, return empty array
      return [];
    }
  }

  /**
   * Format catalog name for better display
   */
  formatCatalogName(source, category) {
    const sourceName = source.charAt(0).toUpperCase() + source.slice(1)
      .replace(/myanimelist/i, 'MyAnimeList')
      .replace(/anidb/i, 'AniDB')
      .replace(/anilist/i, 'AniList');

    return category ? 
      `${sourceName} - ${category.replace(/-/g, ' ')}` : 
      sourceName;
  }

  /**
   * Build metadata URL for a catalog
   */
  buildMetadataUrl(catalogId, type, skip = 0) {
    // For anime catalogs, the URL structure is different
    if (this.detectAnimeCatalogs()) {
      return `${this.baseUrl}${this.configPath}/catalog/anime/${catalogId}.json`;
    }
    
    // For standard Stremio catalogs
    return `${this.baseUrl}${this.configPath}/catalog/${type}/${catalogId}.json`;
  }
}

/**
 * Import an external addon from a manifest URL
 * @param {string} manifestUrl - URL to the addon manifest
 * @returns {Promise<Object>} Imported addon metadata
 */
async function importExternalAddon(manifestUrl) {
  if (!manifestUrl) {
    throw new Error('Manifest URL is required');
  }

  const addon = new ExternalAddon(manifestUrl);
  return await addon.import();
}

/**
 * Fetch items from an external addon catalog
 */
async function fetchExternalAddonItems(catalogId, addon, skip = 0, rpdbApiKey = null) {
  try {
    if (!addon || !addon.url) {
      console.error('Invalid addon configuration');
      return [];
    }

    const catalog = addon.catalogs.find(c => c.id === catalogId);
    if (!catalog) {
      console.error(`Catalog ${catalogId} not found in addon ${addon.id}`);
      return [];
    }

    // For anime catalogs, we need to use the anime type
    const type = addon.isAnimeCatalogs ? 'anime' : (catalog.type || 'movie');
    
    const externalAddon = new ExternalAddon(addon.url);
    externalAddon.manifest = addon;
    externalAddon.parseManifestUrl();
    
    const metadataUrl = externalAddon.buildMetadataUrl(catalog.originalId || catalog.id, type, skip);
    
    const response = await axios.get(metadataUrl);
    
    if (!response.data || !response.data.metas) {
      console.error('Invalid metadata response:', response.data);
      return [];
    }

    // If we have RPDB API key, update posters
    if (rpdbApiKey) {
      const metas = response.data.metas;
      
      // Collect all IMDb IDs
      const imdbIds = metas
        .map(item => item.imdb_id || item.id)
        .filter(id => id && id.startsWith('tt'));
      
      // Batch fetch all posters
      const posterMap = await batchFetchPosters(imdbIds, rpdbApiKey);
      
      // Update items with fetched posters
      return metas.map(item => {
        const imdbId = item.imdb_id || item.id;
        if (imdbId && posterMap[imdbId]) {
          return { ...item, poster: posterMap[imdbId] };
        }
        return item;
      });
    }

    return response.data.metas;
  } catch (error) {
    console.error('Error fetching external addon items:', error);
    return [];
  }
}

/**
 * List all catalogs from imported addons
 * @param {Object} importedAddons - Object with imported addons
 * @returns {Array} Array of all catalogs
 */
function listAllCatalogs(importedAddons) {
  if (!importedAddons) return [];
  
  return Object.values(importedAddons).flatMap(addon => 
    addon.catalogs.map(catalog => ({
      id: catalog.id,
      name: catalog.name,
      type: catalog.type,
      addonId: addon.id,
      addonName: addon.name,
      addonLogo: addon.logo
    }))
  );
}

module.exports = {
  importExternalAddon,
  fetchExternalAddonItems,
  listAllCatalogs
}; 