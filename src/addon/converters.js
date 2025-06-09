// src/addon/converters.js
const { batchFetchPosters } = require('../utils/posters');
const { enrichItemsWithMetadata } = require('../utils/metadataFetcher');

async function convertToStremioFormat(listContent, rpdbApiKey = null, metadataConfig = {}) {
  let metas = [];
  if (!listContent) return metas;

  const useRPDB = !!rpdbApiKey;
  
  let itemsToProcess = [];

  if (listContent.allItems && Array.isArray(listContent.allItems)) {
    itemsToProcess = listContent.allItems.map(item => {
        let imdbId = item.imdb_id || item.imdbid;
        if (imdbId && !imdbId.startsWith('tt')) imdbId = `tt${imdbId}`;
        if (!imdbId) return null;

        const baseMeta = {
            id: imdbId,
            type: item.type,
            name: item.name || item.title || `Untitled ${item.type}`,
            poster: item.poster,
            background: item.background || item.backdrop,
            description: item.description || item.overview,
            releaseInfo: item.releaseInfo || item.year || item.release_year || 
                         (item.release_date ? item.release_date.split('-')[0] : 
                         (item.first_air_date ? item.first_air_date.split('-')[0] : undefined)),
            imdbRating: item.imdbRating || (item.imdbrating ? (typeof item.imdbrating === 'number' ? item.imdbrating.toFixed(1) : item.imdbrating) : undefined),
            runtime: item.runtime ? `${item.runtime}`.includes(' min') ? item.runtime : `${item.runtime} min` : undefined,
            genres: item.genres || item.genre,
            cast: item.cast,
            director: item.director,
            writer: item.writer,
            awards: item.awards,
            country: item.country,
            trailers: item.trailers,
            trailerStreams: item.trailerStreams,
            dvdRelease: item.dvdRelease,
            links: item.links,
            popularity: item.popularity,
            slug: item.slug,
            behaviorHints: item.behaviorHints || { hasScheduledVideos: false },
        };
        if (item.type === 'series') {
            baseMeta.status = item.status;
        }
        return baseMeta;
    }).filter(item => item !== null);

  } else if (listContent.metas && Array.isArray(listContent.metas)) {
    itemsToProcess = listContent.metas;
  } else {
    const movies = listContent.movies || [];
    const shows = listContent.shows || [];

    movies.forEach(movie => {
      let imdbId = movie.imdb_id || movie.imdbid;
      if (imdbId && !imdbId.startsWith('tt')) imdbId = `tt${imdbId}`;
      if (!imdbId) return;

      itemsToProcess.push({
        id: imdbId,
        type: 'movie',
        name: movie.name || movie.title || 'Untitled Movie',
        poster: movie.poster,
        background: movie.background || movie.backdrop,
        description: movie.description || movie.overview,
        releaseInfo: movie.releaseInfo || movie.year || movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : undefined),
        imdbRating: movie.imdbRating || (movie.imdbrating ? (typeof movie.imdbrating === 'number' ? movie.imdbrating.toFixed(1) : movie.imdbrating) : undefined),
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
        name: show.name || show.title || 'Untitled Series',
        poster: show.poster,
        background: show.background || show.backdrop,
        description: show.description || show.overview,
        releaseInfo: show.releaseInfo || show.year || show.release_year || (show.first_air_date ? show.first_air_date.split('-')[0] : undefined),
        imdbRating: show.imdbRating || (show.imdbrating ? (typeof show.imdbrating === 'number' ? show.imdbrating.toFixed(1) : show.imdbrating) : undefined),
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
  
  itemsToProcess.forEach(meta => {
    Object.keys(meta).forEach(key => meta[key] === undefined && delete meta[key]);
    if (meta.genres && typeof meta.genres === 'string') {
      meta.genres = meta.genres.split(',').map(g => g.trim());
    }
  });

  if (useRPDB && itemsToProcess.length > 0) {
    const imdbIds = itemsToProcess.map(item => item.id).filter(id => id && id.startsWith('tt'));
    if (imdbIds.length > 0) {
      const posterMap = await batchFetchPosters(imdbIds, rpdbApiKey);
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

  return metas;
}

module.exports = { convertToStremioFormat };