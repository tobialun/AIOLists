const axios = require('axios');
const { TRAKT_CLIENT_ID, TMDB_BEARER_TOKEN } = require('../config');

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TMDB_BASE_URL_V3 = 'https://api.themoviedb.org/3';
const TMDB_REQUEST_TIMEOUT = 15000;

/**
 * Search content across multiple sources
 * @param {Object} params - Search parameters
 * @param {string} params.query - Search query
 * @param {string} params.type - Content type ('movie', 'series', 'all')
 * @param {Array} params.sources - Search sources (['cinemeta', 'trakt', 'tmdb', 'multi'])
 * @param {number} params.limit - Maximum results
 * @param {Object} params.userConfig - User configuration
 * @returns {Promise<Object>} Search results
 */
async function searchContent({ query, type = 'all', sources = ['cinemeta'], limit = 50, userConfig = {} }) {
  if (!query || query.trim().length < 2) {
    return { results: [], totalResults: 0, sources: [] };
  }

  const searchPromises = [];
  const searchSources = [];

  // Individual source searches
  
  // Convert 'search' type to 'all' for individual search functions
  // The 'search' type is only used for catalog routing, not for actual searches
  const searchType = type === 'search' ? 'all' : type;

  // Cinemeta search (always available)
  if (sources.includes('cinemeta')) {
    searchPromises.push(searchCinemeta(query, searchType, limit));
    searchSources.push('cinemeta');
  }

  // Trakt search (if available)
  if (sources.includes('trakt')) {
    searchPromises.push(searchTrakt(query, searchType, limit, userConfig));
    searchSources.push('trakt');
  }

  // TMDB search (if available and configured)
  if (sources.includes('tmdb') && (userConfig.tmdbBearerToken || TMDB_BEARER_TOKEN)) {
    searchPromises.push(searchTMDB(query, searchType, limit, userConfig));
    searchSources.push('tmdb');
  }

  try {
    const searchResults = await Promise.allSettled(searchPromises);
    const allResults = [];
    const successfulSources = [];
    
    searchResults.forEach((result, index) => {
      const sourceName = searchSources[index];
      
      if (result.status === 'fulfilled' && result.value.results) {
        allResults.push(...result.value.results);
        successfulSources.push(sourceName);
      } else {
        console.error(`[Search] ${sourceName} failed:`, result.reason?.message || 'Unknown error');
      }
    });

    // Simple deduplication by IMDb ID - keep first occurrence (Cinemeta wins)
    const seen = new Set();
    const uniqueResults = [];
    
    for (const item of allResults) {
      const id = item.id || item.imdb_id;
      if (id && !seen.has(id)) {
        seen.add(id);
        uniqueResults.push(item);
      }
    }

    return {
      results: uniqueResults.slice(0, limit),
      totalResults: uniqueResults.length,
      sources: successfulSources
    };

  } catch (error) {
    console.error('[Search] Error in search aggregation:', error);
    return { results: [], totalResults: 0, sources: [] };
  }
}

/**
 * Multi search combining Trakt and TMDB for both movies and series
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} Combined search results
 */
async function searchMulti(query, limit, userConfig) {
  const searchPromises = [];
  const availableSources = [];

  // Always include Trakt multi search (no auth required)
  searchPromises.push(searchTraktMulti(query, limit, userConfig));
  availableSources.push('trakt-multi');

  // Include TMDB multi search if configured
  if (userConfig.tmdbBearerToken || TMDB_BEARER_TOKEN) {
    searchPromises.push(searchTMDBMulti(query, limit, userConfig));
    availableSources.push('tmdb-multi');
  }

  try {
    const searchResults = await Promise.allSettled(searchPromises);
    const allResults = [];
    const successfulSources = [];

    searchResults.forEach((result, index) => {
      const sourceName = availableSources[index];
      
      if (result.status === 'fulfilled' && result.value.results) {
        allResults.push(...result.value.results);
        successfulSources.push(sourceName);
      } else {
        console.error(`[Multi Search] ${sourceName} failed:`, result.reason?.message || 'Unknown error');
      }
    });

    // Deduplicate by IMDb ID
    const seen = new Set();
    const uniqueResults = [];
    
    for (const item of allResults) {
      const id = item.id || item.imdb_id;
      if (id && !seen.has(id)) {
        seen.add(id);
        uniqueResults.push(item);
      }
    }

    return {
      results: uniqueResults.slice(0, limit),
      source: 'multi',
      childSources: successfulSources
    };

  } catch (error) {
    console.error('[Multi Search] Error in multi search:', error);
    return { results: [], source: 'multi', error: error.message };
  }
}

/**
 * TMDB multi search using /search/multi endpoint
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} TMDB multi search results
 */
async function searchTMDBMulti(query, limit, userConfig) {
  const results = [];
  const language = userConfig.tmdbLanguage || 'en-US';

  try {
    const response = await axios.get(`${TMDB_BASE_URL_V3}/search/multi`, {
      params: {
        query: query,
        language: language,
        page: 1
      },
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${userConfig.tmdbBearerToken || TMDB_BEARER_TOKEN}`
      },
      timeout: TMDB_REQUEST_TIMEOUT
    });

    if (response.data && response.data.results) {
      const items = response.data.results
        .filter(item => item.media_type === 'movie' || item.media_type === 'tv') // Filter out person results
        .slice(0, limit);
      
      for (const item of items) {
        try {
          // Get external IDs to find IMDb ID
          const externalIds = await getTMDBExternalIds(item.id, item.media_type, userConfig.tmdbBearerToken || TMDB_BEARER_TOKEN);
          
          results.push(convertTMDBItemToStremioFormat(item, item.media_type, externalIds.imdb_id));
        } catch (error) {
          console.error(`Error processing TMDB multi result:`, error.message);
        }
      }
    }

    return { results, source: 'tmdb-multi' };

  } catch (error) {
    console.error('TMDB multi search error:', error.message);
    return { results: [], source: 'tmdb-multi', error: error.message };
  }
}

/**
 * Trakt multi search using movie,show endpoint
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} Trakt multi search results
 */
async function searchTraktMulti(query, limit, userConfig) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID
    };

    // Add authorization if available (for personalized results)
    if (userConfig.traktAccessToken) {
      headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
    }

    // Use Trakt's multi search endpoint
    const response = await axios.get(`https://api.trakt.tv/search/movie,show`, {
      params: {
        query: query,
        limit: limit
      },
      headers,
      timeout: 10000
    });

    if (!response.data || !Array.isArray(response.data)) {
      return { results: [], source: 'trakt-multi' };
    }

    const results = [];
    for (const item of response.data) {
      let content = null;
      let stremioType = null;

      if (item.type === 'movie' && item.movie) {
        content = item.movie;
        stremioType = 'movie';
      } else if (item.type === 'show' && item.show) {
        content = item.show;
        stremioType = 'series';
      }

      if (content && content.ids && content.ids.imdb) {
        results.push({
          id: content.ids.imdb,
          imdb_id: content.ids.imdb,
          type: stremioType,
          name: content.title,
          description: content.overview,
          releaseInfo: content.year?.toString(),
          genres: content.genres,
          imdbRating: content.rating,
          score: item.score
        });
      }
    }

    return { results, source: 'trakt-multi' };

  } catch (error) {
    console.error('Trakt multi search error:', error.message);
    return { results: [], source: 'trakt-multi' };
  }
}

/**
 * Search Cinemeta - directly use their search API
 * @param {string} query - Search query
 * @param {string} type - 'movie', 'series', or 'all'
 * @param {number} limit - Maximum results
 * @returns {Promise<Object>} Cinemeta search results
 */
async function searchCinemeta(query, type, limit) {
  const results = [];
  const searchTypes = type === 'all' ? ['movie', 'series'] : [type];

  for (const searchType of searchTypes) {
    try {
      const url = `${CINEMETA_BASE}/catalog/${searchType}/top/search=${encodeURIComponent(query)}.json`;
      
      const response = await axios.get(url, {
        timeout: 15000
      });

      if (response.data && response.data.metas) {
        // Take the metas directly from Cinemeta - they're already in perfect format
        const metas = response.data.metas.slice(0, Math.ceil(limit / searchTypes.length));
        results.push(...metas);
      }
    } catch (error) {
      console.error(`Error searching Cinemeta for ${searchType}:`, error.message);
    }
  }

  return { results, source: 'cinemeta' };
}

/**
 * Search TMDB including cast and director searches
 * @param {string} query - Search query
 * @param {string} type - 'movie', 'series', or 'all'
 * @param {number} limit - Maximum results
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} TMDB search results
 */
async function searchTMDB(query, type, limit, userConfig) {
  const results = [];
  const language = userConfig.tmdbLanguage || 'en-US';

  try {
    // 1. Direct content search
    const contentResults = await searchTMDBContent(query, type, limit, userConfig.tmdbBearerToken || TMDB_BEARER_TOKEN, language);
    results.push(...contentResults);

    // 2. Cast/Director search
    const personResults = await searchTMDBByPerson(query, type, Math.ceil(limit / 2), userConfig.tmdbBearerToken || TMDB_BEARER_TOKEN, language);
    results.push(...personResults);

    // Remove duplicates and limit results
    const uniqueResults = results.filter((item, index, self) => 
      index === self.findIndex(t => t.id === item.id)
    ).slice(0, limit);

    return { results: uniqueResults, source: 'tmdb' };

  } catch (error) {
    console.error('TMDB search error:', error.message);
    return { results: [], source: 'tmdb', error: error.message };
  }
}

/**
 * Search TMDB content directly
 * @param {string} query - Search query
 * @param {string} type - Content type
 * @param {number} limit - Maximum results
 * @param {string} bearerToken - TMDB Bearer token
 * @param {string} language - Language code
 * @returns {Promise<Array>} Content search results
 */
async function searchTMDBContent(query, type, limit, bearerToken, language) {
  const results = [];
  const searchTypes = type === 'all' ? ['movie', 'tv'] : [type === 'series' ? 'tv' : type];

  for (const searchType of searchTypes) {
    try {
      const response = await axios.get(`${TMDB_BASE_URL_V3}/search/${searchType}`, {
        params: {
          query: query,
          language: language,
          page: 1
        },
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${bearerToken}`
        },
        timeout: TMDB_REQUEST_TIMEOUT
      });

      if (response.data && response.data.results) {
        const items = response.data.results.slice(0, Math.ceil(limit / searchTypes.length));
        
        for (const item of items) {
          // Get external IDs to find IMDb ID
          const externalIds = await getTMDBExternalIds(item.id, searchType, bearerToken);
          
          results.push(convertTMDBItemToStremioFormat(item, searchType, externalIds.imdb_id));
        }
      }
    } catch (error) {
      console.error(`Error searching TMDB ${searchType}:`, error.message);
    }
  }

  return results;
}

/**
 * Search TMDB by person (cast/director) and find their works
 * @param {string} query - Person name
 * @param {string} type - Content type to filter
 * @param {number} limit - Maximum results
 * @param {string} bearerToken - TMDB Bearer token
 * @param {string} language - Language code
 * @returns {Promise<Array>} Person's works
 */
async function searchTMDBByPerson(query, type, limit, bearerToken, language) {
  const results = [];

  try {
    // Search for people
    const personResponse = await axios.get(`${TMDB_BASE_URL_V3}/search/person`, {
      params: {
        query: query,
        language: language,
        page: 1
      },
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${bearerToken}`
      },
      timeout: TMDB_REQUEST_TIMEOUT
    });

    if (personResponse.data && personResponse.data.results && personResponse.data.results.length > 0) {
      // Get the first person match
      const person = personResponse.data.results[0];
      
      // Get their combined credits (movies and TV shows)
      const creditsResponse = await axios.get(`${TMDB_BASE_URL_V3}/person/${person.id}/combined_credits`, {
        params: {
          language: language
        },
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${bearerToken}`
        },
        timeout: TMDB_REQUEST_TIMEOUT
      });

      if (creditsResponse.data && creditsResponse.data.cast) {
        let credits = creditsResponse.data.cast;
        
        // Include crew credits (for directors, writers, etc.)
        if (creditsResponse.data.crew) {
          credits = credits.concat(creditsResponse.data.crew);
        }

        // Filter by type if specified
        if (type !== 'all') {
          const mediaType = type === 'series' ? 'tv' : 'movie';
          credits = credits.filter(credit => credit.media_type === mediaType);
        }

        // Sort by popularity and vote_average
        credits.sort((a, b) => {
          const aPopularity = a.popularity || 0;
          const bPopularity = b.popularity || 0;
          return bPopularity - aPopularity;
        });

        // Process top credits
        const topCredits = credits.slice(0, limit);
        
        for (const credit of topCredits) {
          try {
            // Get external IDs for each credit
            const externalIds = await getTMDBExternalIds(credit.id, credit.media_type, bearerToken);
            
            const convertedItem = convertTMDBItemToStremioFormat(credit, credit.media_type, externalIds.imdb_id);
            
            // Add person context
            convertedItem.foundVia = `${person.name} (${credit.job || 'Cast'})`;
            
            results.push(convertedItem);
          } catch (error) {
            console.error(`Error processing credit for ${credit.title || credit.name}:`, error.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error searching TMDB by person:', error.message);
  }

  return results;
}

/**
 * Get external IDs from TMDB
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} bearerToken - TMDB Bearer token
 * @returns {Promise<Object>} External IDs
 */
async function getTMDBExternalIds(tmdbId, mediaType, bearerToken) {
  try {
    const response = await axios.get(`${TMDB_BASE_URL_V3}/${mediaType}/${tmdbId}/external_ids`, {
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${bearerToken}`
      },
      timeout: TMDB_REQUEST_TIMEOUT
    });
    
    return response.data || {};
  } catch (error) {
    console.error(`Error fetching external IDs for ${mediaType} ${tmdbId}:`, error.message);
    return {};
  }
}

/**
 * Convert TMDB item to Stremio format
 * @param {Object} item - TMDB item
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} imdbId - IMDb ID
 * @returns {Object} Stremio formatted item
 */
function convertTMDBItemToStremioFormat(item, mediaType, imdbId) {
  const isMovie = mediaType === 'movie';
  
  return {
    id: imdbId || `tmdb:${item.id}`,
    type: isMovie ? 'movie' : 'series',
    name: isMovie ? item.title : item.name,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : undefined,
    description: item.overview,
    releaseInfo: isMovie ? 
      (item.release_date ? item.release_date.split('-')[0] : undefined) :
      (item.first_air_date ? item.first_air_date.split('-')[0] : undefined),
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
    genres: item.genre_ids ? undefined : item.genres?.map(g => g.name), // genre_ids would need additional lookup
    tmdbId: item.id,
    tmdbRating: item.vote_average,
    popularity: item.popularity
  };
}

/**
 * Search Trakt API - directly use their search endpoint
 * @param {string} query - Search query
 * @param {string} type - 'movie', 'series', or 'all'
 * @param {number} limit - Maximum results
 * @param {Object} userConfig - User configuration
 * @returns {Promise<Object>} Trakt search results
 */
async function searchTrakt(query, type, limit, userConfig) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID
    };

    // Add authorization if available (for personalized results)
    if (userConfig.traktAccessToken) {
      headers['Authorization'] = `Bearer ${userConfig.traktAccessToken}`;
    }

    // Use Trakt's search endpoint - it supports comma-separated types
    let searchType = 'movie,show'; // Default to both
    if (type === 'movie') {
      searchType = 'movie';
    } else if (type === 'series') {
      searchType = 'show';
    }

    const response = await axios.get(`https://api.trakt.tv/search/${searchType}`, {
      params: {
        query: query,
        limit: limit
      },
      headers,
      timeout: 10000
    });

    if (!response.data || !Array.isArray(response.data)) {
      return { results: [], source: 'trakt' };
    }

    const results = [];
    for (const item of response.data) {
      let content = null;
      let stremioType = null;

      if (item.type === 'movie' && item.movie) {
        content = item.movie;
        stremioType = 'movie';
      } else if (item.type === 'show' && item.show) {
        content = item.show;
        stremioType = 'series';
      }

      if (content && content.ids && content.ids.imdb) {
        // Convert to Stremio meta format like Cinemeta
        results.push({
          id: content.ids.imdb,
          imdb_id: content.ids.imdb,
          type: stremioType,
          name: content.title,
          description: content.overview,
          releaseInfo: content.year?.toString(),
          genres: content.genres,
          imdbRating: content.rating,
          score: item.score
        });
      }
    }

    return { results, source: 'trakt' };

  } catch (error) {
    console.error('Trakt search error:', error.message);
    return { results: [], source: 'trakt' };
  }
}

module.exports = {
  searchContent,
  searchCinemeta,
  searchTMDB,
  searchTrakt,
  searchMulti,
  searchTMDBMulti,
  searchTraktMulti
}; 