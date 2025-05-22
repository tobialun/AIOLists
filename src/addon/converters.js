// src/addon/converters.js
const { batchFetchPosters } = require('../utils/posters');
const { ITEMS_PER_PAGE } = require('../config'); // Importera om du fortfarande behöver den här

/**
 * Konverterar API-objekt till Stremio-format.
 * Denna funktion antar nu att 'items' är en redan paginerad lista med objekt.
 * @param {Object} listContent - Objekt som innehåller .movies och/eller .shows arrayer, eller en .metas array.
 * @param {string} rpdbApiKey - RPDB API-nyckel.
 * @returns {Promise<Array>} Array av Stremio meta-objekt.
 */
async function convertToStremioFormat(listContent, rpdbApiKey = null) {
  let metas = [];
  if (!listContent) return metas;

  const useRPDB = !!rpdbApiKey;
  
  let itemsToProcess = [];

  if (listContent.metas && Array.isArray(listContent.metas)) {
    // Om redan i Stremio-format (från externa tillägg)
    itemsToProcess = listContent.metas;
  } else {
    // Bygg upp itemsToProcess från .movies och .shows
    const movies = listContent.movies || [];
    const shows = listContent.shows || [];

    movies.forEach(movie => {
      let imdbId = movie.imdb_id || movie.imdbid;
      if (imdbId && !imdbId.startsWith('tt')) imdbId = `tt${imdbId}`;
      if (!imdbId) return;

      itemsToProcess.push({
        id: imdbId,
        type: 'movie',
        name: movie.title || movie.name || 'Untitled Movie',
        poster: movie.poster,
        background: movie.backdrop || movie.background,
        description: movie.overview || movie.description,
        releaseInfo: movie.year || movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : undefined),
        imdbRating: movie.imdbRating || (movie.imdbrating ? movie.imdbrating.toFixed(1) : undefined),
        runtime: movie.runtime ? `${movie.runtime}`.includes(' min') ? movie.runtime : `${movie.runtime} min` : undefined,
        genres: movie.genres || movie.genre,
        cast: movie.cast,
        director: movie.director,
        writer: movie.writer,
        awards: movie.awards,
        country: movie.country,
        trailers: movie.trailers,
        trailerStreams: movie.trailerStreams,
        dvdRelease: movie.dvdRelease,
        links: movie.links,
        popularity: movie.popularity,
        slug: movie.slug,
        behaviorHints: movie.behaviorHints || {
          hasScheduledVideos: false
        },
      });
    });

    shows.forEach(show => {
      let imdbId = show.imdb_id || show.imdbid;
      if (imdbId && !imdbId.startsWith('tt')) imdbId = `tt${imdbId}`;
      if (!imdbId) return;

      itemsToProcess.push({
        id: imdbId,
        type: 'series',
        name: show.title || show.name || 'Untitled Series',
        poster: show.poster,
        background: show.backdrop || show.background,
        description: show.overview || show.description,
        releaseInfo: show.year || show.release_year || (show.first_air_date ? show.first_air_date.split('-')[0] : undefined),
        imdbRating: show.imdbRating || (show.imdbrating ? show.imdbrating.toFixed(1) : undefined),
        runtime: show.runtime ? `${show.runtime}`.includes(' min') ? show.runtime : `${show.runtime} min` : undefined,
        genres: show.genres || show.genre,
        cast: show.cast,
        director: show.director,
        writer: show.writer,
        awards: show.awards,
        country: show.country,
        trailers: show.trailers,
        trailerStreams: show.trailerStreams,
        dvdRelease: show.dvdRelease,
        links: show.links,
        popularity: show.popularity,
        slug: show.slug,
        status: show.status,
        behaviorHints: show.behaviorHints || {
          hasScheduledVideos: false
        },
      });
    });
  }
  
  // Ta bort undefined nycklar
  itemsToProcess.forEach(meta => {
    Object.keys(meta).forEach(key => meta[key] === undefined && delete meta[key]);
    if (meta.genres && typeof meta.genres === 'string') {
      meta.genres = meta.genres.split(',').map(g => g.trim());
    }
  });

  if (useRPDB && itemsToProcess.length > 0) {
    console.log('[convertToStremioFormat] Items to process (BEFORE RPDB - first 2):', JSON.stringify(itemsToProcess.slice(0, 2)));
    const imdbIds = itemsToProcess.map(item => item.id).filter(id => id && id.startsWith('tt'));
    if (imdbIds.length > 0) {
      const posterMap = await batchFetchPosters(imdbIds, rpdbApiKey);
      console.log('[convertToStremioFormat] Poster map FROM RPDB (sample):', JSON.stringify(Object.fromEntries(Object.entries(posterMap).slice(0, 5)))); // Logga några exempel från posterMap
      metas = itemsToProcess.map(item => {
        if (item.id && posterMap[item.id]) {
          return { ...item, poster: posterMap[item.id] };
        }
        return item;
      });
    } else {
       metas = itemsToProcess;
    }
  } else {
    metas = itemsToProcess;
  }
  if (metas.length > 0) {
    console.log(`[convertToStremioFormat] Returnerar ${metas.length} meta-objekt. Första objektet:`, JSON.stringify(metas[0]));
  } else {
    console.log(`[convertToStremioFormat] Returnerar 0 meta-objekt.`);
  }

  return metas;
}

module.exports = { convertToStremioFormat };