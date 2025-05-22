// src/utils/common.js

/**
 * Kontrollerar om ett list-ID representerar en watchlist.
 * @param {string} listId - List-ID att kontrollera.
 * @returns {boolean}
 */
function isWatchlist(listId) {
    if (!listId) return false;
    return listId.endsWith('watchlist') || 
           listId.endsWith('watchlist-W') ||
           listId.includes('trakt_watchlist'); // Täcker både trakt_watchlist och aiolists-trakt_watchlist-T etc.
  }
  
  /**
   * Sätter lämpliga cache-rubriker.
   * Watchlists får ingen cache. Andra listor får en kort cache-tid
   * för att låta Stremio hantera den huvudsakliga cachningen.
   * @param {Object} res - Express response-objekt.
   * @param {string} listId - List-ID.
   */
  function setCacheHeaders(res, listId) {
    if (isWatchlist(listId)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      // Kort cache-tid (t.ex. 5 minuter) för att förlita sig på Stremio
      res.setHeader('Cache-Control', `public, max-age=${5 * 60}`); 
    }
  }
  
  module.exports = {
    isWatchlist,
    setCacheHeaders
  };