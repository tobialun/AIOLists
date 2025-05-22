// src/integrations/externalAddons.js
const axios = require('axios');
const { batchFetchPosters } = require('../utils/posters'); // Assuming posters.js is in the same utils directory

// ... rest of your externalAddons.js file
class ExternalAddon {
  constructor(manifestUrl) {
    this.manifestUrl = this.normalizeUrl(manifestUrl);
    this.manifest = null;
    this.baseUrl = '';
    this.configPath = ''; // Stores the /<configHash> part if present in the original manifest URL
  }

  normalizeUrl(url) {
    if (url.startsWith('stremio://')) {
      return 'https://' + url.substring(10);
    }
    return url;
  }

  parseManifestUrl() {
    const url = new URL(this.manifestUrl);
    this.baseUrl = `${url.protocol}//${url.host}`;
    // Pathname might be /<config>/manifest.json or just /manifest.json
    // We want to capture the part between the host and /manifest.json
    const pathSegments = url.pathname.split('/');
    const manifestIndex = pathSegments.lastIndexOf('manifest.json');
    if (manifestIndex > 1) { // At least one segment before manifest.json (e.g., /configHash/manifest.json)
        this.configPath = '/' + pathSegments.slice(1, manifestIndex).join('/');
    } else {
        this.configPath = ''; // No extra path segments like a config hash
    }
  }

  async import() {
    try {
      const response = await axios.get(this.manifestUrl);
      this.manifest = response.data;
      
      this.parseManifestUrl(); // Call after fetching manifest to have the URL

      if (!this.manifest || !this.manifest.catalogs) {
        throw new Error('Invalid manifest format - missing catalogs');
      }

      const isAnime = this.detectAnimeCatalogs();

      const processedCatalogs = isAnime 
        ? this.processAnimeCatalogs() 
        : this.processStandardCatalogs();
      
      return {
        id: this.manifest.id || `addon_${Date.now()}`, // Fallback ID
        name: this.manifest.name || 'Unknown Addon',
        version: this.manifest.version || '0.0.0',
        description: this.manifest.description || '',
        logo: this.manifest.logo || null,
        url: this.manifestUrl, // Store the original manifest URL
        catalogs: processedCatalogs,
        types: this.manifest.types || [],
        resources: this.manifest.resources || [],
        isAnime // Store if it's primarily anime for content fetching logic
      };
    } catch (error) {
      console.error(`Error importing addon from ${this.manifestUrl}:`, error.message);
      throw new Error(`Failed to import addon: ${error.message}`);
    }
  }

  detectAnimeCatalogs() {
    // Heuristics to detect anime-focused addons
    const nameIncludesAnime = this.manifest.name?.toLowerCase().includes('anime');
    const urlIncludesAnimeSource = ['myanimelist', 'anilist', 'anidb'].some(src => this.manifestUrl.toLowerCase().includes(src));
    const hasAnimeTypeCatalog = this.manifest.catalogs.some(cat => cat.type === 'anime');
    return nameIncludesAnime || urlIncludesAnimeSource || hasAnimeTypeCatalog;
  }

  processStandardCatalogs() {
    // Ensure unique IDs if an addon reuses catalog IDs for different types
    const idCounts = {};
    return this.manifest.catalogs.map(catalog => {
      const baseId = catalog.id;
      const typeSuffix = catalog.type || 'unknown';
      idCounts[baseId] = (idCounts[baseId] || 0) + 1;
      
      // Create a more unique ID if the same base ID is used multiple times, otherwise keep original
      const uniqueId = idCounts[baseId] > 1 ? `${baseId}_${typeSuffix}_${idCounts[baseId]}` : baseId;

      return {
        id: uniqueId, // This will be used in our addon's manifest
        originalId: baseId, // The ID used by the external addon's API
        name: catalog.name,
        type: catalog.type || 'movie', // Default to movie if type is missing
        extra: catalog.extra || []
      };
    });
  }

  processAnimeCatalogs() {
    return this.manifest.catalogs.map(catalog => ({
      id: catalog.id, // Use the original ID from the anime addon
      originalId: catalog.id,
      name: catalog.name,
      type: 'series', // Standardize anime to 'series' for Stremio compatibility
      extra: catalog.extra || []
    }));
  }


  buildCatalogUrl(catalogOriginalId, catalogType, skip = 0) {
    let url = `${this.baseUrl}${this.configPath}/catalog/${catalogType}/${catalogOriginalId}`;
    if (skip > 0) {
      url += `/skip=${skip}`;
    }
    url += '.json';
    return url;
  }
}

async function importExternalAddon(manifestUrl) {
  const addon = new ExternalAddon(manifestUrl);
  return await addon.import();
}

async function fetchExternalAddonItems(catalogOriginalId, sourceAddonConfig, skip = 0, rpdbApiKey = null) {
  try {
    if (!sourceAddonConfig || !sourceAddonConfig.url) {
      console.error('Invalid source addon configuration for fetching items.');
      return { metas: [] }; // Return structure expected by convertToStremioFormat
    }

    const tempAddon = new ExternalAddon(sourceAddonConfig.url);
    await tempAddon.import(); // Re-import to correctly parse baseUrl and configPath from the stored URL

    const catalog = sourceAddonConfig.catalogs.find(c => c.originalId === catalogOriginalId || c.id === catalogOriginalId);
    if (!catalog) {
      console.error(`Catalog ${catalogOriginalId} not found in source addon ${sourceAddonConfig.name}`);
      return { metas: [] };
    }
    
    // Use the catalog's defined type, defaulting to 'movie'. Anime is handled as 'series'.
    const typeToFetch = catalog.type === 'anime' ? 'series' : (catalog.type || 'movie');
    const metadataUrl = tempAddon.buildCatalogUrl(catalog.originalId, typeToFetch, skip);
    
    const response = await axios.get(metadataUrl);
    
    if (!response.data || !Array.isArray(response.data.metas)) {
      console.error(`Invalid metadata response from ${metadataUrl}:`, response.data);
      return { metas: [] };
    }

    // Return the raw metas array; poster fetching will be handled by convertToStremioFormat
    return { metas: response.data.metas }; // Ensure this is an object with a .metas property

  } catch (error) {
    console.error(`Error fetching items for catalog ${catalogOriginalId} from ${sourceAddonConfig?.name}:`, error.message);
    return { metas: [] }; // Return structure expected by convertToStremioFormat
  }
}

module.exports = {
  importExternalAddon,
  fetchExternalAddonItems
};