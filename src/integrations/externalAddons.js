const axios = require('axios');
// Assuming convertToStremioFormat might be used if external addons return non-Stremio items
// and enrichItemsWithCinemeta is available for consistent genre data.
// However, typically external addons should return Stremio meta items directly.
const { enrichItemsWithCinemeta } = require('../utils/metadataFetcher');


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

      // Process catalogs to make their IDs unique within AIOLists if necessary
      // and store original IDs for fetching.
      const idUsageMap = new Map(); // Tracks usage of originalId|originalType to ensure unique AIOLists IDs

      const processedCatalogs = this.manifest.catalogs.map(catalog => {
        if (!catalog.id || !catalog.type) {
            // console.warn('[AIOLists ExternalAddon] Skipping catalog without id or type in external addon:', catalog.name || 'Unnamed', 'Full catalog object:', catalog);
            return null; // Skip invalid catalog entries
        }

        const originalCatalogId = catalog.id;
        const originalCatalogType = catalog.type; // e.g., movie, series, tv, anime
        let stremioFinalCatalogType = originalCatalogType; // What AIOLists will use for this catalog type

        // Normalize types like 'tv' to 'series', or handle 'anime'
        if (originalCatalogType === 'tv') stremioFinalCatalogType = 'series';
        // If it's a type Stremio doesn't natively show in main sections (like 'anime' directly),
        // decide if you want to map it to 'series' or 'movie', or keep as 'all' / specific if your addon handles it.
        // For simplicity, if it's not movie/series, map to 'all' or the closest if possible.
        // Let's assume 'anime' might be treated as 'series' for broad compatibility or kept if 'all' type catalog.
        // For this example, if not movie/series, we might need to be careful.
        // Let's assume for now that if type is not movie/series, it might be problematic unless catalog.type='all'
        if (originalCatalogType !== 'movie' && originalCatalogType !== 'series' && originalCatalogType !== 'all') {
            // console.warn(`[AIOLists ExternalAddon] Unhandled originalType '${originalCatalogType}' from catalog '${originalCatalogId}'. Defaulting AIOLists catalog type to 'all'.`);
            stremioFinalCatalogType = 'all'; // Or map based on content if possible
        }


        // Create a unique key for tracking to handle cases where an addon might (incorrectly) reuse catalog IDs for different types
        const uniquenessTrackingKey = `${originalCatalogId}|${originalCatalogType}`;
        const instanceCount = (idUsageMap.get(uniquenessTrackingKey) || 0) + 1;
        idUsageMap.set(uniquenessTrackingKey, instanceCount);

        // Construct a unique ID for this catalog within AIOLists
        // Format: parentAddonId_originalCatalogId_originalCatalogType[_instanceIfDuplicate]
        let aiolistsUniqueCatalogId = `${this.manifest.id}_${originalCatalogId}_${originalCatalogType}`;
        if (instanceCount > 1) {
          aiolistsUniqueCatalogId += `_${instanceCount}`;
        }
        
        // Check for 'search' requirement which makes catalog unusable for Browse
        const hasSearchRequirement = (catalog.extra || []).some(e => e.name === 'search' && e.isRequired);
        if (hasSearchRequirement) {
            // console.log(`[AIOLists ExternalAddon] Skipping catalog '${catalog.name}' as it requires search.`);
            return null; // Skip catalogs that require search input
        }


        return {
          id: aiolistsUniqueCatalogId,        // Unique ID within AIOLists for this catalog
          originalId: originalCatalogId,      // ID from the source manifest
          originalType: originalCatalogType,  // Type from the source manifest
          name: catalog.name || 'Unnamed Catalog',
          type: stremioFinalCatalogType, // Stremio compatible type (movie, series, all)
          extraSupported: catalog.extraSupported || catalog.extra || [], // Preserve extra params
          extraRequired: catalog.extraRequired || (catalog.extra || []).filter(e => e.isRequired) // Preserve required extra
        };
      }).filter(catalog => catalog !== null); // Filter out skipped catalogs

      // Resolve logo and background URLs relative to the manifest's base URL if they are relative paths
      let resolvedLogo = this.manifest.logo;
      if (resolvedLogo && !resolvedLogo.startsWith('http://') && !resolvedLogo.startsWith('https://') && !resolvedLogo.startsWith('data:')) {
        try { resolvedLogo = new URL(resolvedLogo, this.apiBaseUrl).href; } catch (e) { /* keep original if bad relative path */ resolvedLogo = this.manifest.logo; }
      }
      let resolvedBackground = this.manifest.background;
       if (resolvedBackground && !resolvedBackground.startsWith('http://') && !resolvedBackground.startsWith('https://') && !resolvedBackground.startsWith('data:')) {
        try { resolvedBackground = new URL(resolvedBackground, this.apiBaseUrl).href; } catch (e) { resolvedBackground = this.manifest.background;}
      }


      return {
        id: this.manifest.id, // ID of the imported addon itself
        name: this.manifest.name || 'Unknown Addon',
        version: this.manifest.version || '0.0.0',
        description: this.manifest.description || '',
        logo: resolvedLogo,
        background: resolvedBackground,
        url: this.originalManifestUrl, // The original URL it was imported from
        apiBaseUrl: this.apiBaseUrl,   // Calculated base URL for its API calls
        catalogs: processedCatalogs,   // Array of processed catalog objects usable by AIOLists
        types: this.manifest.types || [], // Original types supported by the addon
        resources: this.manifest.resources || [], // Original resources
        isAnime: this.detectAnimeCatalogs() // Helper to flag anime-focused addons
      };
    } catch (error) {
      console.error(`[AIOLists ExternalAddon] Error importing addon from ${this.originalManifestUrl}:`, error.message, error.stack);
      let specificError = error.message;
      if (error.response) { // If error is from axios HTTP request
        specificError += ` (Status: ${error.response.status})`;
      }
      throw new Error(`Failed to import addon: ${specificError}`);
    }
  }

  detectAnimeCatalogs() {
    // Heuristic to detect if an addon is anime-focused
    const nameIncludesAnime = this.manifest?.name?.toLowerCase().includes('anime');
    const urlIncludesAnimeSource = ['myanimelist', 'anilist', 'anidb', 'kitsu', 'livechart', 'notify.moe'].some(src => this.originalManifestUrl.toLowerCase().includes(src));
    const hasAnimeTypeInManifestTypes = this.manifest?.types?.includes('anime'); // if manifest.types includes 'anime'
    const hasAnimeTypeCatalog = this.manifest?.catalogs?.some(cat => cat.type === 'anime'); // if any catalog is explicitly 'anime'
    return !!(nameIncludesAnime || urlIncludesAnimeSource || hasAnimeTypeInManifestTypes || hasAnimeTypeCatalog);
  }

  buildCatalogUrl(catalogOriginalId, catalogOriginalType, skip = 0, genre = null) {
    // Construct the URL path for fetching catalog items
    // Example: /catalog/movie/catalog_id.json or /catalog/series/another_id/skip=50&genre=Action.json
    let urlPath = `catalog/${catalogOriginalType}/${encodeURIComponent(catalogOriginalId)}`;
    
    const extraParams = [];
    if (skip > 0) extraParams.push(`skip=${skip}`);
    // If the external addon supports genre in its URL structure (some do, some don't)
    // This is a guess; many addons use query params instead of path segments for extras.
    // Stremio SDK typically passes extras like genre as query parameters (?genre=Action)
    // or as part of the 'extra' segment in the path if defined that way in manifest.
    // For simplicity here, we'll assume the external addon expects 'genre' as a query-like param in the path.
    // A more robust solution would parse the addon's manifest for how it handles 'genre'.
    if (genre) extraParams.push(`genre=${encodeURIComponent(genre)}`); 

    if (extraParams.length > 0) {
      urlPath += `/${extraParams.join('&')}`; // Format: /extraKey=extraValue&anotherKey=anotherValue
    }
    urlPath += '.json'; // Standard Stremio catalog format
    
    return this.apiBaseUrl + urlPath;
  }
}

async function importExternalAddon(manifestUrl) {
  const addon = new ExternalAddon(manifestUrl);
  return await addon.import();
}

async function fetchExternalAddonItems(targetOriginalId, targetOriginalType, sourceAddonConfig, skip = 0, rpdbApiKey = null, genre = null) { // Added genre
  let attemptedUrl = "Unknown (URL could not be constructed before error)";
  try {
    if (!sourceAddonConfig || !sourceAddonConfig.apiBaseUrl || !sourceAddonConfig.catalogs) {
      console.error('[AIOLists ExternalAddon] Invalid source addon configuration for fetching items. Config:', sourceAddonConfig);
      return { metas: [] }; // Return empty structure
    }

    // Find the specific catalog entry from the processed list in sourceAddonConfig
    const catalogEntry = sourceAddonConfig.catalogs.find(
      c => c.originalId === targetOriginalId && c.originalType === targetOriginalType
    );

    if (!catalogEntry) {
      return { metas: [] };
    }
    
    // Use a temporary instance to build the URL, ensuring apiBaseUrl is correctly set from the stored config.
    const tempExternalAddon = new ExternalAddon(sourceAddonConfig.url); // Pass original manifest URL for context
    tempExternalAddon.apiBaseUrl = sourceAddonConfig.apiBaseUrl;       // Crucially, use the stored, resolved apiBaseUrl

    // Build catalog URL. Pass genre to buildCatalogUrl.
    // Note: External addons might not support genre filtering via URL.
    // If they don't, filtering will happen after fetching.
    attemptedUrl = tempExternalAddon.buildCatalogUrl(catalogEntry.originalId, catalogEntry.originalType, skip, genre);
    
    console.log(`[AIOLists Debug] Attempting to fetch external addon items from: ${attemptedUrl}`);
    
    const response = await axios.get(attemptedUrl, { timeout: 20000 }); // Increased timeout
    
    if (!response.data || !Array.isArray(response.data.metas)) {
      console.error(`[AIOLists ExternalAddon] Invalid metadata response from ${attemptedUrl}: Data or metas array missing. Response:`, response.data);
      return { metas: [] };
    }

    let metas = response.data.metas;

    // Post-fetch genre filtering if genre is specified AND the external addon didn't filter.
    // This is a fallback.
    if (genre && metas.length > 0) {
        // Enrich with Cinemeta to ensure 'genres' field is standardized, then filter
        // This assumes external addons might not always provide genres in a queryable way.
        const enrichedMetas = await enrichItemsWithCinemeta(metas);
        metas = enrichedMetas.filter(meta => meta.genres && meta.genres.includes(genre));
    }
    
    // Determine if the list had movies/shows originally based on what was returned
    const hasMovies = metas.some(m => m.type === 'movie');
    const hasShows = metas.some(m => m.type === 'series');

    return { metas, hasMovies, hasShows }; // Return metas and content type flags

  } catch (error) {
    console.error(`[AIOLists ExternalAddon] Error fetching items for external catalog ID '${targetOriginalId}' (type: '${targetOriginalType}', from addon '${sourceAddonConfig?.name}'). Attempted URL: ${attemptedUrl}. Error:`, error.message);
    if (error.response) {
        console.error("[AIOLists ExternalAddon] Error response status:", error.response.status);
        // Avoid logging potentially huge data responses unless necessary for deep debugging
        // console.error("[AIOLists ExternalAddon] Error response data from external addon:", JSON.stringify(error.response.data, null, 2)); 
    } else {
        console.error("[AIOLists ExternalAddon] Error stack:", error.stack);
    }
    return { metas: [] }; // Return empty on error
  }
}

module.exports = {
  importExternalAddon,
  fetchExternalAddonItems,
  ExternalAddon // Export class if it's to be used elsewhere, or keep internal
};