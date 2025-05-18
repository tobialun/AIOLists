const ITEMS_PER_PAGE = 100;

// Default config structure
const defaultConfig = {
  apiKey: '',            // MDBList API key
  rpdbApiKey: '',        // RPDB API key for posters
  traktClientId: '',     // Trakt Client ID
  traktClientSecret: '', // Trakt Client Secret
  traktAccessToken: '',  // Trakt Access Token
  traktRefreshToken: '', // Trakt Refresh Token
  traktExpiresAt: null,  // Trakt token expiration date
  listOrder: [],
  lastUpdated: null,
  listsMetadata: {},
  hiddenLists: [],
  customListNames: {},   // Store custom names for lists
  importedAddons: {},    // Store imported addon configurations
  sortPreferences: {},   // Store sorting preferences for each list (e.g., { "list_id": { sort: "rank", order: "desc" } })
  availableSortOptions: [
    { value: 'rank', label: 'Rank' },
    { value: 'score', label: 'Score' },
    { value: 'score_average', label: 'Average Score' },
    { value: 'released', label: 'Release Date' },
    { value: 'releasedigital', label: 'Digital Release' },
    { value: 'imdbrating', label: 'IMDb Rating' },
    { value: 'imdbvotes', label: 'IMDb Votes' },
    { value: 'last_air_date', label: 'Last Air Date' },
    { value: 'imdbpopular', label: 'IMDb Popularity' },
    { value: 'tmdbpopular', label: 'TMDB Popularity' },
    { value: 'rogerebert', label: 'Roger Ebert Rating' },
    { value: 'rtomatoes', label: 'Rotten Tomatoes' },
    { value: 'rtaudience', label: 'RT Audience Score' },
    { value: 'metacritic', label: 'Metacritic' },
    { value: 'myanimelist', label: 'MyAnimeList' },
    { value: 'letterrating', label: 'Letterboxd Rating' },
    { value: 'lettervotes', label: 'Letterboxd Votes' },
    { value: 'budget', label: 'Budget' },
    { value: 'revenue', label: 'Revenue' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'title', label: 'Title' },
    { value: 'random', label: 'Random' }
  ]
};

/**
 * Store metadata for lists to be used later
 * @param {Array} lists - Lists with metadata
 * @param {Object} config - Current configuration
 * @returns {Object} Updated configuration
 */
function storeListsMetadata(lists, config) {
  if (!config.listsMetadata) {
    config.listsMetadata = {};
  }
  
  lists.forEach(list => {
    config.listsMetadata[list.id] = {
      isExternalList: !!list.isExternalList,
      isInternalList: !!list.isInternalList,
      isWatchlist: !!list.isWatchlist,
      name: list.name,
      listType: list.listType || (list.isExternalList ? 'E' : list.isInternalList ? 'L' : list.isWatchlist ? 'W' : null)
    };
  });
  
  return config;
}

module.exports = {
  defaultConfig,
  storeListsMetadata,
  ITEMS_PER_PAGE
}; 