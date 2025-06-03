const axios = require('axios');
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');

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
    const manifestPathSegment = "/manifest.json";

    if (fullUrl.endsWith(manifestPathSegment)) {
      this.apiBaseUrl = fullUrl.substring(0, fullUrl.length - manifestPathSegment.length + 1);
    } else {
      this.apiBaseUrl = fullUrl.endsWith('/') ? fullUrl : fullUrl + '/';
    }
  }

  async import(userConfig) {
    try {
      const response = await axios.get(this.originalManifestUrl);
      this.manifest = response.data;

      if (!this.manifest || !this.manifest.id || !this.manifest.catalogs) {
        throw new Error('Invalid external manifest format: missing id or catalogs');
      }
      
      this.setApiBaseUrlFromManifestUrl();

      const letterboxdStaticPrefix = "github.megadrive.stremio.letterboxd";
      let isSourceManifestALetterboxdList = false; // Default to false

      if (typeof this.manifest.id === 'string') {
          // Trim the manifest ID before checking its prefix
          isSourceManifestALetterboxdList = this.manifest.id.trim().startsWith(letterboxdStaticPrefix + ":");
      }

      if (isSourceManifestALetterboxdList && userConfig && typeof userConfig.letterboxdImportCounter === 'undefined') {
          userConfig.letterboxdImportCounter = 0;
      }

      const idUsageMap = new Map();

      const processedCatalogs = this.manifest.catalogs.map(catalog => {
        if (!catalog.id || !catalog.type) {
            return null;
        }

        const originalCatalogIdFromSource = catalog.id;
        const originalCatalogType = catalog.type;
        let stremioFinalCatalogType = originalCatalogType;

        if (originalCatalogType === 'tv') stremioFinalCatalogType = 'series';
        if (originalCatalogType !== 'movie' && originalCatalogType !== 'series' && originalCatalogType !== 'all') {
            stremioFinalCatalogType = 'all';
        }
        
        const hasSearchRequirement = (catalog.extra || []).some(e => e.name === 'search' && e.isRequired);
        if (hasSearchRequirement) {
            return null;
        }

        let aiolistsUniqueCatalogId;
        if (isSourceManifestALetterboxdList && userConfig) {
            userConfig.letterboxdImportCounter++;
            aiolistsUniqueCatalogId = `${letterboxdStaticPrefix}:${userConfig.letterboxdImportCounter}`;
        } else {
            const uniquenessTrackingKey = `${originalCatalogIdFromSource}|${originalCatalogType}`;
            const instanceCount = (idUsageMap.get(uniquenessTrackingKey) || 0) + 1;
            idUsageMap.set(uniquenessTrackingKey, instanceCount);
            aiolistsUniqueCatalogId = `${this.manifest.id.trim()}_${originalCatalogIdFromSource}_${originalCatalogType}`; // Also trim this.manifest.id here for consistency
            if (instanceCount > 1) {
              aiolistsUniqueCatalogId += `_${instanceCount}`;
            }
        }
        
        let processedExtraSupported = [];
        const originalExtra = catalog.extraSupported || catalog.extra || [];
        originalExtra.forEach(extraItem => {
            if (extraItem.name === "genre") {
                processedExtraSupported.push({ name: "genre" });
            } else {
                processedExtraSupported.push(extraItem);
            }
        });

        return {
          id: aiolistsUniqueCatalogId,
          originalId: originalCatalogIdFromSource,
          originalManifestId: this.manifest.id.trim(), // Store the trimmed original manifest ID
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
        id: this.manifest.id.trim(), // Return the trimmed manifest ID
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

async function importExternalAddon(manifestUrl, userConfig) {
  const addon = new ExternalAddon(manifestUrl);
  return await addon.import(userConfig);
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
      const fallbackCatalogEntry = sourceAddonConfig.catalogs.find(c => c.id === targetOriginalId && c.originalType === targetOriginalType);
      if (!fallbackCatalogEntry) {
        console.warn(`[AIOLists ExternalAddon] Catalog not found for originalId: ${targetOriginalId}, type: ${targetOriginalType} in addon ${sourceAddonConfig.name}`);
        return { metas: [], hasMovies: false, hasShows: false };
      }
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

    if (sourceAddonConfig && typeof sourceAddonConfig.name === 'string' && sourceAddonConfig.name.toLowerCase().includes('trakt up next')) {
        metasFromExternal = metasFromExternal.map(meta => {
            if (meta && typeof meta.id === 'string' && meta.id.startsWith('tun_')) {
                const correctedId = meta.id.substring(4);
                if (/^tt\d+$/.test(correctedId)) {
                    return { ...meta, id: correctedId };
                }
            }
            return meta;
        });
    }
    
    let enrichedMetas = [];
    if (metasFromExternal.length > 0) {
        enrichedMetas = await enrichItemsWithCinemeta(metasFromExternal);
    }
    
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