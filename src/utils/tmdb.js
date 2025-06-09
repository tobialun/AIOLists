// src/utils/tmdb.js
// Re-export TMDB functions from the integrations module for backward compatibility
const { 
  validateTMDBKey,
  convertImdbToTmdbId,
  batchConvertImdbToTmdbIds,
  fetchTmdbMetadata,
  batchFetchTmdbMetadata,
  fetchTmdbGenres,
  clearTmdbCaches
} = require('../integrations/tmdb');

module.exports = {
  validateTMDBKey,
  convertImdbToTmdbId,
  batchConvertImdbToTmdbIds,
  fetchTmdbMetadata,
  batchFetchTmdbMetadata,
  fetchTmdbGenres,
  clearTmdbCaches
}; 