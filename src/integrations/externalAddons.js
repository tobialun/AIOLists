// src/integrations/externalAddons.js
const axios = require('axios');

class ExternalAddon {
  constructor(manifestUrl) {
    this.originalManifestUrl = this.normalizeUrl(manifestUrl);
    this.manifest = null;
    this.apiBaseUrl = '';
  }

  normalizeUrl(url) {
    if (url.startsWith('stremio://')) {
      return 'https://' + url.substring(10);
    }
    return url;
  }

  setApiBaseUrlFromManifestUrl() {
    const fullUrl = this.originalManifestUrl;
    const manifestJsonPathSegment = "/manifest.json";
    const manifestIndex = fullUrl.lastIndexOf(manifestJsonPathSegment);

    if (manifestIndex === -1) {
        this.apiBaseUrl = fullUrl.endsWith('/') ? fullUrl : fullUrl + '/';
    } else {
        this.apiBaseUrl = fullUrl.substring(0, manifestIndex + 1); 
    }
  }

  async import() {
    try {
      const response = await axios.get(this.originalManifestUrl);
      this.manifest = response.data;

      if (!this.manifest || !this.manifest.id || !this.manifest.catalogs) {
        throw new Error('Invalid external manifest format: missing id or catalogs');
      }
      
      this.setApiBaseUrlFromManifestUrl();
      const idUsageMap = new Map();

      const processedCatalogs = this.manifest.catalogs.map(catalog => {
        if (!catalog.id || !catalog.type) {
            console.warn('[AIOLists ExternalAddon] Skipping catalog without id or type in external addon:', catalog.name || 'Unnamed', 'Full catalog object:', catalog);
            return null; 
        }

        const originalCatalogId = catalog.id;
        const originalCatalogType = catalog.type; // e.g., "anime", "trakt", "movie", "series"
        let stremioFinalCatalogType = originalCatalogType; // Default to original

      if (originalCatalogType !== 'movie' && originalCatalogType !== 'series' && originalCatalogType !== 'all') {
            console.warn(`[AIOLists ExternalAddon] Unhandled originalType '${originalCatalogType}' from catalog '${originalCatalogId}'. Defaulting AIOLists catalog type to 'all'.`);
            stremioFinalCatalogType = 'all';
      }

        const uniquenessTrackingKey = `${originalCatalogId}|${originalCatalogType}`;
        const instanceCount = (idUsageMap.get(uniquenessTrackingKey) || 0) + 1;
        idUsageMap.set(uniquenessTrackingKey, instanceCount);

        let aiolistsUniqueCatalogId = `${this.manifest.id}_${originalCatalogId}_${originalCatalogType}`;
        if (instanceCount > 1) {
          aiolistsUniqueCatalogId += `_${instanceCount}`;
        }
        
        const hasSearchRequirement = (catalog.extra || []).some(e => e.name === 'search' && e.isRequired);
        if (hasSearchRequirement) {
            return null; 
        }

        return {
          id: aiolistsUniqueCatalogId,        
          originalId: originalCatalogId,      
          originalType: originalCatalogType,  
          name: catalog.name || 'Unnamed Catalog',
          type: stremioFinalCatalogType, // This is the crucial type for AIOLists' manifest
          extraSupported: catalog.extraSupported || catalog.extra || [],
          extraRequired: catalog.extraRequired || (catalog.extra || []).filter(e => e.isRequired)
        };
      }).filter(catalog => catalog !== null);

      let resolvedLogo = this.manifest.logo;
      if (resolvedLogo && !resolvedLogo.startsWith('http://') && !resolvedLogo.startsWith('https://') && !resolvedLogo.startsWith('data:')) {
        try { resolvedLogo = new URL(resolvedLogo, this.apiBaseUrl).href; } catch (e) { resolvedLogo = this.manifest.logo; }
      }
      let resolvedBackground = this.manifest.background;
       if (resolvedBackground && !resolvedBackground.startsWith('http://') && !resolvedBackground.startsWith('https://') && !resolvedBackground.startsWith('data:')) {
        try { resolvedBackground = new URL(resolvedBackground, this.apiBaseUrl).href; } catch (e) { resolvedBackground = this.manifest.background;}
      }

      return {
        id: this.manifest.id, 
        name: this.manifest.name || 'Unknown Addon',
        version: this.manifest.version || '0.0.0',
        description: this.manifest.description || '',
        logo: resolvedLogo,
        background: resolvedBackground,
        url: this.originalManifestUrl, 
        apiBaseUrl: this.apiBaseUrl,   
        catalogs: processedCatalogs,   
        types: this.manifest.types || [], 
        resources: this.manifest.resources || [],
        isAnime: this.detectAnimeCatalogs() // Retaining this flag as it was already there.
      };
    } catch (error) {
      console.error(`[AIOLists ExternalAddon] Error importing addon from ${this.originalManifestUrl}:`, error.message, error.stack);
      let specificError = error.message;
      if (error.response) {
        specificError += ` (Status: ${error.response.status})`;
      }
      throw new Error(`Failed to import addon: ${specificError}`);
    }
  }

  detectAnimeCatalogs() {
    const nameIncludesAnime = this.manifest?.name?.toLowerCase().includes('anime');
    const urlIncludesAnimeSource = ['myanimelist', 'anilist', 'anidb', 'kitsu', 'livechart', 'notify.moe'].some(src => this.originalManifestUrl.toLowerCase().includes(src));
    const hasAnimeTypeInManifestTypes = this.manifest?.types?.includes('anime');
    const hasAnimeTypeCatalog = this.manifest?.catalogs?.some(cat => cat.type === 'anime');
    return !!(nameIncludesAnime || urlIncludesAnimeSource || hasAnimeTypeInManifestTypes || hasAnimeTypeCatalog);
  }

  buildCatalogUrl(catalogOriginalId, catalogOriginalType, skip = 0, genre = null) {
    let urlPath = `catalog/${catalogOriginalType}/${encodeURIComponent(catalogOriginalId)}`;
    const extraParams = [];
    if (skip > 0) extraParams.push(`skip=${skip}`);
    if (genre) extraParams.push(`genre=${encodeURIComponent(genre)}`);
    if (extraParams.length > 0) urlPath += `/${extraParams.join('&')}`;
    urlPath += '.json';
    return this.apiBaseUrl + urlPath;
  }
}

async function importExternalAddon(manifestUrl) {
  const addon = new ExternalAddon(manifestUrl);
  return await addon.import();
}

async function fetchExternalAddonItems(externalCatalogIdToFetch, sourceAddonConfig, skip = 0, rpdbApiKey = null, genre = null) {
  let attemptedUrl = "Unknown (URL could not be constructed before error)";
  try {
    if (!sourceAddonConfig || !sourceAddonConfig.apiBaseUrl || !sourceAddonConfig.catalogs) {
      console.error('[AIOLists ExternalAddon] Invalid source addon configuration for fetching items. Config:', sourceAddonConfig);
      return { metas: [] };
    }

    const catalogEntry = sourceAddonConfig.catalogs.find(c => c.originalId === externalCatalogIdToFetch);
    if (!catalogEntry) {
      console.error(`[AIOLists ExternalAddon] Catalog with originalId '${externalCatalogIdToFetch}' not found in source addon '${sourceAddonConfig.name}'. Available originalIds from config: ${sourceAddonConfig.catalogs.map(c=>c.originalId).join(', ')}`);
      return { metas: [] };
    }
    
    const tempExternalAddon = new ExternalAddon(sourceAddonConfig.url); 
    tempExternalAddon.apiBaseUrl = sourceAddonConfig.apiBaseUrl;       

    attemptedUrl = tempExternalAddon.buildCatalogUrl(catalogEntry.originalId, catalogEntry.originalType, skip, genre);
    
    console.log(`[AIOLists Debug] Attempting to fetch external addon items from: ${attemptedUrl}`);
    
    const response = await axios.get(attemptedUrl, { timeout: 20000 }); 
    
    if (!response.data || !Array.isArray(response.data.metas)) {
      console.error(`[AIOLists ExternalAddon] Invalid metadata response from ${attemptedUrl}: Data or metas array missing. Response:`, response.data);
      return { metas: [] };
    }

    return { metas: response.data.metas };

  } catch (error) {
    console.error(`[AIOLists ExternalAddon] Error fetching items for external catalog ID '${externalCatalogIdToFetch}' (from addon '${sourceAddonConfig?.name}'). Attempted URL: ${attemptedUrl}. Error:`, error.message);
    if (error.response) {
        console.error("[AIOLists ExternalAddon] Error response status:", error.response.status);
        console.error("[AIOLists ExternalAddon] Error response data from external addon:", JSON.stringify(error.response.data, null, 2)); 
    } else {
        console.error("[AIOLists ExternalAddon] Error stack:", error.stack);
    }
    return { metas: [] }; 
  }
}

module.exports = {
  importExternalAddon,
  fetchExternalAddonItems,
  ExternalAddon 
};