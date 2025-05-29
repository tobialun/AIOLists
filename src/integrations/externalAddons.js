// src/integrations/externalAddons.js
const axios = require('axios');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher'); // Ensure this path is correct

class ExternalAddon {
  constructor(manifestUrl) {
    this.originalManifestUrl = this.normalizeUrl(manifestUrl);
    this.manifest = null;
    this.apiBaseUrl = ''; // Base URL for API calls, derived from manifest URL
  }

  normalizeUrl(url) {
    if (url.startsWith('stremio://')) {
      // Convert stremio:// protocol to https:// for direct fetching
      return 'https://' + url.substring(10);
    }
    return url;
  }

  setApiBaseUrlFromManifestUrl() {
    const fullUrl = this.originalManifestUrl;
    const manifestPathSegment = "/manifest.json";

    if (fullUrl.endsWith(manifestPathSegment)) {
      // If URL ends with /manifest.json, remove it to get the base
      this.apiBaseUrl = fullUrl.substring(0, fullUrl.length - manifestPathSegment.length + 1); // Keep trailing slash
    } else {
      // If it doesn't end with /manifest.json, assume it's already a base or needs a slash
      this.apiBaseUrl = fullUrl.endsWith('/') ? fullUrl : fullUrl + '/';
    }
  }

  async import() {
    try {
      const response = await axios.get(this.originalManifestUrl);
      this.manifest = response.data;

      if (!this.manifest || !this.manifest.id || !this.manifest.catalogs) {
        throw new Error('Invalid external manifest format: missing id or catalogs');
      }
      
      this.setApiBaseUrlFromManifestUrl(); // Set the API base URL

      const idUsageMap = new Map(); // Tracks usage of originalId|originalType to ensure unique AIOLists IDs

      const processedCatalogs = this.manifest.catalogs.map(catalog => {
        if (!catalog.id || !catalog.type) {
            return null; // Skip invalid catalog entries
        }

        const originalCatalogId = catalog.id;
        const originalCatalogType = catalog.type;
        let stremioFinalCatalogType = originalCatalogType;

        if (originalCatalogType === 'tv') stremioFinalCatalogType = 'series';
        if (originalCatalogType !== 'movie' && originalCatalogType !== 'series' && originalCatalogType !== 'all') {
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

        let processedExtraSupported = [];
        const originalExtra = catalog.extraSupported || catalog.extra || [];
        originalExtra.forEach(extraItem => {
            if (extraItem.name === "genre") {
                processedExtraSupported.push({ name: "genre" }); // No options stored
            } else {
                processedExtraSupported.push(extraItem);
            }
        });

        return {
          id: aiolistsUniqueCatalogId,
          originalId: originalCatalogId,
          originalType: originalCatalogType,
          name: catalog.name || 'Unnamed Catalog',
          type: stremioFinalCatalogType,
          extraSupported: processedExtraSupported,
          extraRequired: catalog.extraRequired || (catalog.extra || []).filter(e => e.isRequired)
        };
      }).filter(catalog => catalog !== null);

      let resolvedLogo = this.manifest.logo;
      if (resolvedLogo && !resolvedLogo.startsWith('http://') && !resolvedLogo.startsWith('https://') && !resolvedLogo.startsWith('data:')) {
        try { resolvedLogo = new URL(resolvedLogo, this.apiBaseUrl).href; } catch (e) { resolvedLogo = this.manifest.logo; }
      }

      return {
        id: this.manifest.id,
        name: this.manifest.name || 'Unknown Addon',
        version: this.manifest.version || '0.0.0',
        logo: resolvedLogo,
        apiBaseUrl: this.apiBaseUrl,
        catalogs: processedCatalogs,
        types: this.manifest.types || [],
        resources: this.manifest.resources || [],
        isAnime: this.detectAnimeCatalogs()
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

    if (extraParams.length > 0) {
      urlPath += `/${extraParams.join('&')}`;
    }
    urlPath += '.json';
    
    return this.apiBaseUrl + urlPath;
  }
}

async function importExternalAddon(manifestUrl) {
  const addon = new ExternalAddon(manifestUrl);
  return await addon.import();
}

async function fetchExternalAddonItems(targetOriginalId, targetOriginalType, sourceAddonConfig, skip = 0, rpdbApiKey = null, genre = null) {
  let attemptedUrl = "Unknown (URL could not be constructed before error)";
  try {
    if (!sourceAddonConfig || !sourceAddonConfig.apiBaseUrl || !sourceAddonConfig.catalogs) {
      console.error('[AIOLists ExternalAddon] Invalid source addon configuration for fetching items. Config:', sourceAddonConfig);
      return { metas: [], hasMovies: false, hasShows: false };
    }

    const catalogEntry = sourceAddonConfig.catalogs.find(
      c => c.originalId === targetOriginalId && c.originalType === targetOriginalType
    );

    if (!catalogEntry) {
      return { metas: [], hasMovies: false, hasShows: false };
    }
    
    const tempExternalAddon = new ExternalAddon(sourceAddonConfig.apiBaseUrl); 
    tempExternalAddon.apiBaseUrl = sourceAddonConfig.apiBaseUrl;

    attemptedUrl = tempExternalAddon.buildCatalogUrl(catalogEntry.originalId, catalogEntry.originalType, skip, genre);
    
    const response = await axios.get(attemptedUrl, { timeout: 20000 });
    
    if (!response.data || !Array.isArray(response.data.metas)) {
      console.error(`[AIOLists ExternalAddon] Invalid metadata response from ${attemptedUrl}: Data or metas array missing. Response:`, response.data);
      return { metas: [], hasMovies: false, hasShows: false };
    }

    let metasFromExternal = response.data.metas;

    // MODIFICATION: Apply correction if the source addon's name includes "Trakt up next" (case-insensitive)
    if (sourceAddonConfig && typeof sourceAddonConfig.name === 'string' && sourceAddonConfig.name.toLowerCase().includes('trakt up next')) {
        metasFromExternal = metasFromExternal.map(meta => {
            if (meta && typeof meta.id === 'string' && meta.id.startsWith('tun_')) {
                const correctedId = meta.id.substring(4);
                // Ensure the corrected ID looks like an IMDb ID (e.g., tt1234567)
                if (/^tt\d+$/.test(correctedId)) {
                    // Return a new object with the corrected ID, spreading other properties
                    return { ...meta, id: correctedId };
                }
            }
            return meta; // Return original meta if no correction needed or applicable
        });
    }
    
    // Enrich items with Cinemeta data (using potentially corrected IDs)
    let enrichedMetas = [];
    if (metasFromExternal.length > 0) {
        enrichedMetas = await enrichItemsWithCinemeta(metasFromExternal);
    }
    
    // Apply genre filtering if a genre is specified, to the enriched metas
    let finalMetas = enrichedMetas;
    if (genre && finalMetas.length > 0) {
        finalMetas = finalMetas.filter(meta => 
            meta.genres && 
            Array.isArray(meta.genres) && 
            meta.genres.map(g => String(g).toLowerCase()).includes(String(genre).toLowerCase())
        );
    }
    
    const hasMovies = finalMetas.some(m => m.type === 'movie');
    const hasShows = finalMetas.some(m => m.type === 'series');

    return { metas: finalMetas, hasMovies, hasShows };

  } catch (error) {
    console.error(`[AIOLists ExternalAddon] Error fetching items for external catalog ID '${targetOriginalId}' (type: '${targetOriginalType}', from addon '${sourceAddonConfig?.name}'). Attempted URL: ${attemptedUrl}. Error:`, error.message);
    if (error.response) {
        console.error("[AIOLists ExternalAddon] Error response status:", error.response.status);
    } else {
        console.error("[AIOLists ExternalAddon] Error stack:", error.stack);
    }
    return { metas: [], hasMovies: false, hasShows: false };
  }
}

module.exports = {
  importExternalAddon,
  fetchExternalAddonItems,
  ExternalAddon 
};