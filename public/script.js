// Default configuration with sort options
const defaultConfig = {
  availableSortOptions: [
    { value: 'rank', label: 'Rank' },
    { value: 'score', label: 'Score' },
    { value: 'score_average', label: 'Score Average' },
    { value: 'released', label: 'Released' },
    { value: 'releasedigital', label: 'Digital Release' },
    { value: 'imdbrating', label: 'IMDb Rating' },
    { value: 'imdbvotes', label: 'IMDb Votes' },
    { value: 'last_air_date', label: 'Last Air Date' },
    { value: 'imdbpopular', label: 'IMDb Popular' },
    { value: 'tmdbpopular', label: 'TMDB Popular' },
    { value: 'rogerebert', label: 'Roger Ebert' },
    { value: 'rtomatoes', label: 'Rotten Tomatoes' },
    { value: 'rtaudience', label: 'RT Audience' },
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

document.addEventListener('DOMContentLoaded', function() {
  // ==================== STATE MANAGEMENT ====================
  const state = {
    configHash: null,
    userConfig: {
      listOrder: [],
      hiddenLists: new Set(),
      listsMetadata: {},
      lastUpdated: null,
      sortPreferences: {}, // Default sort preferences will be set when creating list items
      availableSortOptions: [
        { value: 'score', label: 'Score' },
        { value: 'score_average', label: 'Score Average' },
        { value: 'rank', label: 'Rank' },
        { value: 'released', label: 'Released' },
        { value: 'releasedigital', label: 'Digital Release' },
        { value: 'imdbrating', label: 'IMDb Rating' },
        { value: 'imdbvotes', label: 'IMDb Votes' },
        { value: 'last_air_date', label: 'Last Air Date' },
        { value: 'imdbpopular', label: 'IMDb Popular' },
        { value: 'tmdbpopular', label: 'TMDB Popular' },
        { value: 'rogerebert', label: 'Roger Ebert' },
        { value: 'rtomatoes', label: 'Rotten Tomatoes' },
        { value: 'rtaudience', label: 'RT Audience' },
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
    },
    addons: {},  // Store imported addons for reference
    currentLists: []  // Store current list data for immediate UI updates
  };

  // ==================== DOM ELEMENTS ====================
  const elements = {
    apiKeyInput: document.getElementById('apiKey'),
    rpdbApiKeyInput: document.getElementById('rpdbApiKey'),
    saveButton: document.getElementById('saveApiKeys'),
    statusDiv: document.getElementById('status'),
    listContainer: document.getElementById('listContainer'),
    listItems: document.getElementById('listItems'),
    loading: document.getElementById('loading'),
    savedIndicator: document.getElementById('savedIndicator'),
    updateStremioBtn: document.getElementById('updateStremioBtn'),
    traktLoginBtn: document.getElementById('traktLoginBtn'),
    traktStatus: document.getElementById('traktStatus'),
    traktConnectedState: document.getElementById('traktConnectedState'),
    manifestUrlInput: document.getElementById('manifestUrl'),
    importAddonBtn: document.getElementById('importAddonBtn'),
    importStatus: document.getElementById('importStatus'),
    traktPinContainer: document.getElementById('traktPinContainer'),
    traktPin: document.getElementById('traktPin'),
    submitTraktPin: document.getElementById('submitTraktPin'),
    importedAddons: document.getElementById('importedAddons'),
    addonsList: document.getElementById('addonsList'),
    
    // Section notifications
    apiKeysNotification: document.getElementById('apiKeysNotification'),
    connectionsNotification: document.getElementById('connectionsNotification'),
    importNotification: document.getElementById('importNotification'),
    listsNotification: document.getElementById('listsNotification'),
    mdblistConnected: document.getElementById('mdblistConnected'),
    mdblistConnectedText: document.getElementById('mdblistConnected').querySelector('.connected-text'),
    rpdbConnected: document.getElementById('rpdbConnected'),
    rpdbConnectedText: document.getElementById('rpdbConnected').querySelector('.connected-text'),
    importMDBListBtn: document.getElementById('importMDBListBtn'),
    mdblistUrl: document.getElementById('mdblistUrl')
  };

  // ==================== INITIALIZATION ====================
  async function init() {
    // Set up UI regardless of URL
    initEventListeners();
    updateAddonStyles();

    // Check if we have a config hash in the URL path
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    
    // Only proceed with config loading if we're not at the root URL
    if (pathParts.length === 0) {
      // Create new configuration if at root URL
      try {
        const response = await fetch('/api/config/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await response.json();
        if (data.success) {
          state.configHash = data.configHash;
          updateURL();
          await loadConfiguration(); // Load configuration after creating it
        }
      } catch (error) {
        console.error('Failed to create configuration:', error);
      }
      return;
    }

    state.configHash = pathParts[0];
  
    initStremioButton();
    await loadConfiguration();
  }

  function updateURL() {
    const url = new URL(window.location.href);
    // Remove any existing config from query params
    url.searchParams.delete('config');
    // Update the pathname to include the hash
    url.pathname = `/${state.configHash}/configure`;
    window.history.replaceState({}, '', url);
  }

  function initStremioButton() {
    const updateButton = () => {
      const baseUrl = `stremio://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`;
      elements.updateStremioBtn.href = `${baseUrl}/${state.configHash}/manifest.json`;
    };
    updateButton();
    setInterval(updateButton, 3000);
  }

  function initEventListeners() {
    elements.traktLoginBtn?.addEventListener('click', () => {
      elements.traktPinContainer.style.display = 'flex';
    });
    elements.submitTraktPin?.addEventListener('click', handleTraktPinSubmission);
    elements.importAddonBtn?.addEventListener('click', handleAddonImport);
    elements.importMDBListBtn?.addEventListener('click', async function() {
      const mdblistUrl = elements.mdblistUrl.value.trim();
      if (!mdblistUrl) {
        showStatus('Please enter a MDBList URL', 'error');
        return;
      }
      
      try {        
        // Get the current RPDB API key
        const rpdbApiKey = elements.rpdbApiKeyInput?.value?.trim() || state.userConfig.rpdbApiKey;
        
        // Import a single catalog - type will be determined by content
        const response = await fetch(`/api/config/${state.configHash}/import-mdblist-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url: mdblistUrl,
            rpdbApiKey
          })
        });
        
        const data = await response.json();
        if (data.success) {
          state.configHash = data.configHash;
          updateURL();
          showSectionNotification('import', data.message);
          elements.mdblistUrl.value = '';
          await loadLists();
        } else {
          throw new Error(data.error || data.details || 'Failed to import MDBList');
        }
      } catch (error) {
        console.error('Error importing MDBList:', error);
        showStatus(error.message, 'error');
      }
    });

    // Add event listener for copy manifest button
    const copyManifestBtn = document.getElementById('copyManifestBtn');
    if (copyManifestBtn) {
      copyManifestBtn.addEventListener('click', copyManifestUrl);
    }
  }

  // ==================== CONFIGURATION MANAGEMENT ====================
  async function loadConfiguration() {
    if (!state.configHash) return;

    try {
      const response = await fetch(`/${state.configHash}/config`);
      const data = await response.json();
      
      if (data.success) {
        state.userConfig = data.config;
        
        // Handle MDBList key
        if (state.userConfig.apiKey) {
          elements.apiKeyInput.value = state.userConfig.apiKey;
          await validateApiKeys(state.userConfig.apiKey, state.userConfig.rpdbApiKey);
        }
        
        // Handle RPDB key
        if (state.userConfig.rpdbApiKey) {
          elements.rpdbApiKeyInput.value = state.userConfig.rpdbApiKey;
          if (!state.userConfig.apiKey) {
            await validateApiKeys('', state.userConfig.rpdbApiKey);
          }
        }

        // Handle Trakt connection state
        if (state.userConfig.traktAccessToken) {
          elements.traktLoginBtn.style.display = 'none';
          elements.traktPinContainer.style.display = 'none';
          elements.traktConnectedState.style.display = 'flex';
        }
        
        if (state.userConfig.apiKey) {
          await loadLists();
        }
      }
    } catch (error) {
      console.error('Failed to load configuration:', error);
      showStatus('Failed to load configuration', 'error');
    }
  }

  // ==================== API KEYS MANAGEMENT ====================
  // Add validation state
  const validationState = {
    mdblist: false,
    rpdb: false,
    validating: false
  };

  // Add validation timeout
  let validationTimeout = null;

  // Add validation function
  async function validateApiKeys(apiKey, rpdbApiKey) {
    if (validationState.validating) return;
    validationState.validating = true;

    try {
      // First validate the keys
      const validationResponse = await fetch('/api/validate-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, rpdbApiKey })
      });

      const results = await validationResponse.json();
      
      // Handle MDBList validation
      if (results.mdblist) {
        validationState.mdblist = true;
        elements.apiKeyInput.style.display = 'none';
        elements.mdblistConnected.style.display = 'flex';
        elements.mdblistConnectedText.textContent = `Connected as ${results.mdblist.username}`;
        
        // Automatically save the valid API keys
        const saveResponse = await fetch(`/api/config/${state.configHash}/apikey`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, rpdbApiKey })
        });

        const saveData = await saveResponse.json();
        if (saveData.success) {
          state.configHash = saveData.configHash;
          updateURL();
          showSectionNotification('apiKeys', 'API keys saved successfully ✅');
          await loadLists();
        }
      } else if (apiKey) {
        validationState.mdblist = false;
        elements.apiKeyInput.style.display = 'block';
        elements.mdblistConnected.style.display = 'none';
        elements.apiKeyInput.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
      }

      // Handle RPDB validation
      if (results.rpdb && results.rpdb.valid) {
        validationState.rpdb = true;
        elements.rpdbApiKeyInput.style.display = 'none';
        elements.rpdbConnected.style.display = 'flex';
        elements.rpdbConnectedText.textContent = 'RPDB Key is Valid';
        
        // If MDBList is not connected, save just the RPDB key
        if (!validationState.mdblist && rpdbApiKey) {
          const saveResponse = await fetch(`/api/config/${state.configHash}/apikey`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: '', rpdbApiKey })
          });

          const saveData = await saveResponse.json();
          if (saveData.success) {
            state.configHash = saveData.configHash;
            updateURL();
            showSectionNotification('apiKeys', 'RPDB key saved successfully ✅');
          }
        }
      } else if (rpdbApiKey) {
        validationState.rpdb = false;
        elements.rpdbApiKeyInput.style.display = 'block';
        elements.rpdbConnected.style.display = 'none';
        elements.rpdbApiKeyInput.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
      }
    } catch (error) {
      console.error('Validation error:', error);
      showStatus('Failed to validate or save API keys', 'error');
    } finally {
      validationState.validating = false;
    }
  }

  // ==================== LISTS MANAGEMENT ====================
  async function loadLists() {
    try {
      showSectionNotification('lists', 'Loading lists...', true);
      
      const response = await fetch(`/${state.configHash}/lists`);
      const data = await response.json();
      
      if (data.success) {
        state.currentLists = data.lists;
        state.addons = data.importedAddons;
        
        // Convert hiddenLists and removedLists to Sets for easier lookup
        state.userConfig.hiddenLists = new Set(state.userConfig.hiddenLists || []);
        state.userConfig.removedLists = new Set(state.userConfig.removedLists || []);
        
        // Update list items
        elements.listItems.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        state.currentLists.forEach(list => {
          // Skip completely removed lists in the UI
          if (state.userConfig.removedLists.has(String(list.id))) {
            return;
          }
          
          const li = createListItem(list);
          fragment.appendChild(li);
        });
        
        elements.listItems.appendChild(fragment);
        elements.listContainer.classList.remove('hidden');
        
        // Update imported addons section
        updateImportedAddons(state.addons);
        
        // Initialize sortable and visibility toggles
        initSortable();
        initVisibilityToggles();
        
        showSectionNotification('lists', 'Lists loaded successfully ✅');
      } else {
        throw new Error(data.error || 'Failed to load lists');
      }
    } catch (error) {
      console.error('Error loading lists:', error);
      showSectionNotification('lists', 'Failed to load lists ❌', false, 'error');
    }
  }

  function createListItem(list) {
    const container = document.createElement('li');
    container.className = `list-item ${list.isHidden ? 'hidden' : ''}`;
    container.dataset.id = list.id;

    // Debug logging for content types
    console.log(`List ${list.name} (${list.id}): hasMovies=${!!list.hasMovies}, hasShows=${!!list.hasShows}, showing merge button=${Boolean(list.hasMovies) && Boolean(list.hasShows)}`);

    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '☰';
    container.appendChild(dragHandle);

    const tag = document.createElement('span');
    tag.className = `tag ${list.tag?.toLowerCase()}`;
    
    // Handle different types of lists
    if (list.id.startsWith('trakt_') || list.isTraktList || list.isTraktWatchlist || 
        list.isTraktRecommendations || list.isTraktTrending || list.isTraktPopular) {
        // Use Trakt logo for all Trakt lists
        const img = document.createElement('img');
        img.src = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
        img.alt = 'Trakt.tv';
        tag.appendChild(img);
    } else if (list.addonId?.startsWith('mdblist_')) {
        // For MDBList imported lists
        const img = document.createElement('img');
        img.src = 'https://mdblist.com/static/mdblist_logo.png';
        img.alt = 'MDBList';
        tag.appendChild(img);
    } else if (list.addonId) {
        // For other external addons
        if (list.tagImage) {
            const img = document.createElement('img');
            img.src = list.tagImage;
            img.alt = list.addonName || '';
            tag.appendChild(img);
        } else {
            tag.textContent = list.tag;
        }
    } else {
        // Regular MDBList lists
        tag.textContent = list.tag;
    }
    container.appendChild(tag);

    const nameContainer = document.createElement('div');
    nameContainer.className = 'name-container';
    
    const name = document.createElement('span');
    name.className = 'list-name';
    name.textContent = list.customName || list.name;
    nameContainer.appendChild(name);
    container.appendChild(nameContainer);

    // Add merge/split toggle button for lists that have both movies and shows
    if (Boolean(list.hasMovies) && Boolean(list.hasShows)) {
        // Check if we have a merge preference in state
        const mergePreference = state.userConfig.mergedLists ? state.userConfig.mergedLists[list.id] : true; // Default to merged
        
        const mergeToggle = document.createElement('button');
        mergeToggle.className = `merge-toggle ${mergePreference !== false ? 'merged' : 'split'}`;
        mergeToggle.textContent = mergePreference !== false ? 'Merged' : 'Split';
        mergeToggle.title = mergePreference !== false ? 
            'Click to split this list into separate Movie and Series catalogs' : 
            'Click to merge this list into a single "All" catalog';
        mergeToggle.dataset.listId = list.id;
        mergeToggle.addEventListener('click', toggleListMerge);
        
        container.appendChild(mergeToggle);
    }

    // Show sort controls only for MDBList items and MDBList imported lists
    const isMDBList = !list.id.startsWith('trakt_') && !list.isTraktList && !list.isTraktWatchlist && 
                     !list.isTraktRecommendations && !list.isTraktTrending && !list.isTraktPopular && 
                     (!list.addonId || list.addonId.startsWith('mdblist_'));
    
    if (isMDBList) {
        // Add sort controls container
        const sortControls = document.createElement('div');
        sortControls.className = 'sort-controls';

        // Add sort dropdown
        const sortSelect = document.createElement('select');
        sortSelect.className = 'sort-select';
        
        // Get sort options from config
        const sortOptions = state.userConfig.availableSortOptions || defaultConfig.availableSortOptions;

        // Set default sort preferences if none exist
        if (!list.sortPreferences) {
            list.sortPreferences = { sort: 'imdbvotes', order: 'desc' };
        }

        sortOptions.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            if (option.value === (list.sortPreferences?.sort || 'imdbvotes')) {
                optionElement.selected = true;
            }
            sortSelect.appendChild(optionElement);
        });

        // Add order toggle
        const orderToggle = document.createElement('div');
        orderToggle.className = 'order-toggle';
        orderToggle.innerHTML = `
            <label class="switch">
                <input type="checkbox" ${(list.sortPreferences?.order || 'desc') === 'desc' ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
            <span class="order-label">${(list.sortPreferences?.order || 'desc') === 'desc' ? 'Desc.' : 'Asc.'}</span>
        `;

        sortControls.appendChild(sortSelect);
        sortControls.appendChild(orderToggle);
        container.appendChild(sortControls);

        // Add event listeners for sort controls
        sortSelect.addEventListener('change', async (e) => {
            const newSort = e.target.value;
            const currentOrder = list.sortPreferences?.order || 'desc';
            await updateSortPreferences(list.id, newSort, currentOrder);
        });

        orderToggle.querySelector('input').addEventListener('change', async (e) => {
            const newOrder = e.target.checked ? 'desc' : 'asc';
            const currentSort = list.sortPreferences?.sort || 'imdbvotes';
            orderToggle.querySelector('.order-label').textContent = e.target.checked ? 'Desc.' : 'Asc.';
            await updateSortPreferences(list.id, currentSort, newOrder);
        });
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const editButton = document.createElement('button');
    editButton.className = 'edit-button';
    editButton.innerHTML = '✏️';
    editButton.title = 'Edit List Name';
    editButton.addEventListener('click', () => startEditingName(container, list));
    actions.appendChild(editButton);

    const visibilityToggle = document.createElement('button');
    visibilityToggle.className = 'visibility-toggle';
    visibilityToggle.innerHTML = '<span class="eye-icon ' + (list.isHidden ? 'eye-closed' : 'eye-open') + '"></span>';
    visibilityToggle.dataset.listId = list.id;
    visibilityToggle.title = list.isHidden ? 'Show in Main View (currently hidden, but still accessible in Discover)' : 'Hide from Main View (will still be accessible in Discover)';
    visibilityToggle.addEventListener('click', toggleListVisibility);
    actions.appendChild(visibilityToggle);
    
    // Add remove list button (red X)
    const removeButton = document.createElement('button');
    removeButton.className = 'remove-list-button';
    removeButton.innerHTML = '❌';
    removeButton.title = 'Remove List';
    removeButton.dataset.listId = list.id;
    removeButton.addEventListener('click', removeList);
    actions.appendChild(removeButton);

    container.appendChild(actions);
    return container;
  }

  // Add debounce function at the top with other utility functions
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Add debouncedSaveListOrder function
  const debouncedSaveListOrder = debounce(async (order) => {
    showSectionNotification('lists', 'Saving order changes...', true);
    
    try {
      const response = await fetch(`/api/config/${state.configHash}/lists/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        showSectionNotification('lists', 'Order Changes Saved ✅');
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      showStatus(`Failed to save order: ${error.message}`, 'error');
    }
  }, 1000); // 1 second delay

  function initSortable() {
    if (window.Sortable) {
      if (elements.listItems._sortable) {
        elements.listItems._sortable.destroy();
      }
      
      elements.listItems._sortable = Sortable.create(elements.listItems, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        forceFallback: false,
        removeCloneOnHide: true,
        sort: true,
        fallbackOnBody: true,
        onStart: (evt) => {
          document.body.style.cursor = 'grabbing';
        },
        onEnd: async (evt) => {
          document.body.style.cursor = '';
          if (evt.oldIndex !== evt.newIndex) {
            const items = elements.listItems.querySelectorAll('.list-item');
            const order = Array.from(items).map(item => {
              return item.dataset.id.replace(/^aiolists-/, '');
            });
            debouncedSaveListOrder(order);
          }
        }
      });
    }
  }
    
  function initVisibilityToggles() {
    document.querySelectorAll('.visibility-toggle').forEach(toggle => {
      toggle.addEventListener('click', toggleListVisibility);
    });
  }

  // ==================== LIST OPERATIONS ====================
  async function updateListName(listId, newName) {
    try {
      const response = await fetch(`/api/config/${state.configHash}/lists/names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId, customName: newName })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        
        // Update local state
        if (!state.userConfig.customListNames) {
          state.userConfig.customListNames = {};
        }
        
        if (newName?.trim()) {
          state.userConfig.customListNames[String(listId)] = newName.trim();
        } else {
          delete state.userConfig.customListNames[String(listId)];
        }
        
        showStatus('List name updated successfully', 'success');
        return true;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      showStatus(`Failed to update list name: ${error.message}`, 'error');
      return false;
    }
  }

  function handleCancel(container, list, originalContent) {
    container.innerHTML = originalContent;
    // Re-attach event listeners after restoring original content
    const editBtn = container.querySelector('.edit-button');
    if (editBtn) {
      editBtn.addEventListener('click', () => startEditingName(container, list));
    }
    const visibilityToggle = container.querySelector('.visibility-toggle');
    if (visibilityToggle) {
      visibilityToggle.addEventListener('click', toggleListVisibility);
    }
  }

  async function startEditingName(container, list) {
    const currentName = list.customName || list.name;
    const originalContent = container.innerHTML;
    
    container.innerHTML = '';
    
    // Recreate the drag handle
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '☰';
    container.appendChild(dragHandle);

    // Recreate the tag/badge
    const tag = document.createElement('span');
    tag.className = `tag ${list.tag?.toLowerCase()}`;
    
    // Handle different types of lists
    if (list.id.startsWith('trakt_') || list.isTraktList || list.isTraktWatchlist || 
        list.isTraktRecommendations || list.isTraktTrending || list.isTraktPopular) {
        const img = document.createElement('img');
        img.src = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
        img.alt = 'Trakt.tv';
        tag.appendChild(img);
    } else if (list.addonId?.startsWith('mdblist_')) {
        const img = document.createElement('img');
        img.src = 'https://mdblist.com/static/mdblist_logo.png';
        img.alt = 'MDBList';
        tag.appendChild(img);
    } else if (list.addonId) {
        if (list.tagImage) {
            const img = document.createElement('img');
            img.src = list.tagImage;
            img.alt = list.addonName || '';
            tag.appendChild(img);
        } else {
            tag.textContent = list.tag;
        }
    } else {
        tag.textContent = list.tag;
    }
    container.appendChild(tag);
    
    // Create name container with input
    const nameContainer = document.createElement('div');
    nameContainer.className = 'name-container';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-name-input';
    input.value = currentName;
    nameContainer.appendChild(input);
    container.appendChild(nameContainer);
    
    // Add sort controls if needed
    const isMDBList = !list.id.startsWith('trakt_') && !list.isTraktList && !list.isTraktWatchlist && 
                     !list.isTraktRecommendations && !list.isTraktTrending && !list.isTraktPopular && 
                     (!list.addonId || list.addonId.startsWith('mdblist_'));
    
    if (isMDBList) {
        const sortControls = document.createElement('div');
        sortControls.className = 'sort-controls';
        sortControls.innerHTML = originalContent.match(/<div class="sort-controls">(.*?)<\/div>/s)?.[1] || '';
        container.appendChild(sortControls);
    }
    
    // Create actions container
    const actions = document.createElement('div');
    actions.className = 'actions';
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-name-btn';
    saveBtn.textContent = '✓';
    actions.appendChild(saveBtn);
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-name-btn';
    cancelBtn.textContent = '✕';
    actions.appendChild(cancelBtn);
    
    container.appendChild(actions);
    
    const handleSave = async () => {
      const newName = input.value.trim();
      const success = await updateListName(list.id, newName);
      if (success) {
        // Recreate the entire list item to ensure correct layout
        const updatedList = { ...list, customName: newName };
        const newListItem = createListItem(updatedList);
        container.parentNode.replaceChild(newListItem, container);
      } else {
        handleCancel(container, list, originalContent);
      }
    };
    
    saveBtn.onclick = handleSave;
    cancelBtn.onclick = () => handleCancel(container, list, originalContent);
    
    // Handle Enter and Escape keys
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel(container, list, originalContent);
      }
    });
    
    input.focus();
    input.select();
  }

  async function toggleListVisibility(event) {
    const toggleEl = event.currentTarget;
    const listId = String(toggleEl.dataset.listId);
    const listItem = document.querySelector(`.list-item[data-id="${listId}"]`);
    const eyeIcon = toggleEl.querySelector('.eye-icon');
    
    const isCurrentlyHidden = listItem.classList.contains('hidden');
    const newHiddenState = !isCurrentlyHidden;
    
    listItem.classList.toggle('hidden', newHiddenState);
    eyeIcon.className = `eye-icon ${newHiddenState ? 'eye-closed' : 'eye-open'}`;
    toggleEl.title = newHiddenState ? 'Show in Main View (currently hidden, but still accessible in Discover)' : 'Hide from Main View (will still be accessible in Discover)';
    
    if (newHiddenState) {
      state.userConfig.hiddenLists.add(listId);
    } else {
      state.userConfig.hiddenLists.delete(listId);
    }
    
    await saveHiddenLists();
  }

  async function saveHiddenLists() {
    showSectionNotification('lists', 'Saving visibility changes...', true);
    
    try {
      const hiddenLists = Array.from(state.userConfig.hiddenLists).map(String);
      const response = await fetch(`/api/config/${state.configHash}/lists/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hiddenLists })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        showSectionNotification('lists', 'Visibility Changes Saved ✅');
        
        state.currentLists.forEach(list => {
          const id = String(list.id);
          list.isHidden = state.userConfig.hiddenLists.has(id);
        });
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      showStatus(`Failed to save visibility settings: ${error.message}`, 'error');
    }
  }

  // ==================== TRAKT INTEGRATION ====================
  async function handleTraktPinSubmission() {
    const pin = elements.traktPin.value.trim();
    if (!pin) {
      showStatus('Please enter your Trakt PIN', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/config/${state.configHash}/trakt/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pin })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        elements.traktPinContainer.style.display = 'none';
        elements.traktLoginBtn.style.display = 'none';
        elements.traktConnectedState.style.display = 'flex';
        showSectionNotification('connections', 'Successfully connected to Trakt ✅');
        await loadLists();
      } else {
        throw new Error(data.error || 'Failed to authenticate with Trakt');
      }
    } catch (error) {
      showStatus(`Failed to authenticate with Trakt: ${error.message}`, 'error');
    }
  }

  // ==================== ADDON MANAGEMENT ====================
  async function handleAddonImport() {
    const manifestUrl = elements.manifestUrlInput.value.trim();
    if (!manifestUrl) {
      showStatus('Please enter a manifest URL', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/config/${state.configHash}/import-addon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        elements.manifestUrlInput.value = '';
        showSectionNotification('import', `Successfully imported ${data.addon.name} ✅`);
        await loadLists();
      } else {
        throw new Error(data.error || 'Failed to import addon');
      }
    } catch (error) {
      showStatus(`Failed to import addon: ${error.message}`, 'error');
    }
  }

  window.removeAddon = async function(addonId) {
    try {
      const response = await fetch(`/api/config/${state.configHash}/remove-addon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonId })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        
        // Remove the addon from state
        if (state.addons[addonId]) {
          delete state.addons[addonId];
        }
        
        // Remove the addon element from UI
        const addonElement = document.querySelector(`.addon-item button[data-addon-id="${addonId}"]`)?.closest('.addon-item');
        if (addonElement) {
          addonElement.remove();
          
          // If no more addons, hide the container
          const addonsList = elements.addonsList;
          if (!addonsList.children.length) {
            elements.importedAddons.classList.add('hidden');
          }
        }
        
        showSectionNotification('import', 'Addon removed successfully ✅');
        await loadLists(); // Reload lists to update the UI
      } else {
        throw new Error(data.error || 'Failed to remove addon');
      }
    } catch (error) {
      console.error('Failed to remove addon:', error);
      showStatus('Failed to remove addon', 'error');
    }
  };

  // ==================== UI HELPERS ====================
  function showStatus(message, type = 'info') {
    elements.statusDiv.textContent = message;
    elements.statusDiv.className = `status ${type}`;
    elements.statusDiv.style.display = 'block';
    setTimeout(() => {
      elements.statusDiv.style.display = 'none';
    }, 3000);
  }

  function showSectionNotification(section, message, loading = false, type = 'info') {
    const element = elements[`${section}Notification`];
    if (element) {
      element.textContent = message;
      element.className = `notification ${type} ${loading ? 'loading' : ''}`;
      element.style.display = 'block';
      if (!loading) {
        setTimeout(() => {
          element.style.display = 'none';
        }, 3000);
      }
    }
  }

  function updateAddonStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }
      .header img {
        height: 40px;
        width: auto;
      }
      .header h1 {
        color: #000;
        margin: 0;
        font-size: 24px;
        font-weight: 500;
      }
      .addon-list { 
        background: #2c3e50; 
        padding: 8px 0;
      }
      .addon-list .list-name { color: #ecf0f1; }
      .addon-tag { background: #34495e; color: #ecf0f1; }
      .addon-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 3px 12px;
        border-bottom: 1px solid #eee;
        min-height: 36px;
        background: #fff;
      }
      .addon-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        flex-direction: row;
      }
      .addon-logo {
        width: 20px;
        height: 20px;
        object-fit: contain;
        flex-shrink: 0;
      }
      .addon-details {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }
      .addon-header {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #000;
      }
      .addon-name {
        font-weight: 500;
      }
      .addon-version {
        font-size: 0.8em;
        color: #666;
      }
      .list-count {
        font-size: 0.8em;
        color: #666;
      }
      .remove-addon {
        padding: 4px 8px;
        border-radius: 4px;
        background: #e74c3c;
        color: white;
        border: none;
        cursor: pointer;
        transition: background 0.2s;
        font-size: 0.9em;
      }
      .remove-addon:hover {
        background: #c0392b;
      }
      .badge-mdblist {
        display: flex;
        align-items: center;
        padding: 2px;
        margin-right: 3px;
        background: transparent;
      }

      .mdblist-logo {
        width: 16px;
        height: 16px;
        object-fit: contain;
      }
      #importedAddons {
        margin-top: 8px;
        background: #f5f5f5;
        border-radius: 4px;
        overflow: hidden;
      }
      #importedAddons h3 {
        color: #000;
        margin: 0;
        padding: 6px 12px;
        font-size: 1.1em;
        background: #e0e0e0;
        border-bottom: 1px solid #ddd;
      }
    `;
    document.head.appendChild(style);

    // Add favicon
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/x-icon';
    favicon.href = '/assets/logo.ico';
    document.head.appendChild(favicon);

    // Create header
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `
      <img src="/assets/image.png" alt="AIOLists Logo">
      <h1>AIOLists</h1>
    `;

    // Remove old title
    const oldTitle = document.querySelector('h1');
    if (oldTitle) {
      oldTitle.remove();
    }

    // Insert new header at the top
    document.body.insertBefore(header, document.body.firstChild);
  }

  // Function to update the imported addons section
  function updateImportedAddons(addons) {
    const addonsList = elements.addonsList;
    const importedAddonsContainer = elements.importedAddons;
    
    if (!addons || Object.keys(addons).length === 0) {
      importedAddonsContainer.classList.add('hidden');
      return;
    }
    
    addonsList.innerHTML = '';
    importedAddonsContainer.classList.remove('hidden');
    
    Object.values(addons).forEach(addon => {
      const addonElement = document.createElement('div');
      addonElement.className = 'addon-item';
      
      // Determine if this is a MDBList addon
      const isMDBList = addon.id.startsWith('mdblist_');
      
      const addonHtml = `
        <div class="addon-info">
          ${isMDBList ? 
            `<img src="https://mdblist.com/static/mdblist_logo.png" alt="MDBList" class="addon-logo">` : 
            (addon.logo ? `<img src="${addon.logo}" alt="${addon.name}" class="addon-logo">` : '')
          }
          <div class="addon-details">
            <span class="addon-name">${addon.name.split(' - ')[1] || addon.name}</span>
            <span class="addon-version">${addon.version}</span>
            <span class="list-count">${addon.catalogs.length} list${addon.catalogs.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <button class="remove-addon" data-addon-id="${addon.id}" onclick="removeAddon('${addon.id}')">Remove</button>
      `;
      
      addonElement.innerHTML = addonHtml;
      addonsList.appendChild(addonElement);
    });
  }

  // Add disconnect functions to window scope
  window.disconnectMDBList = async function() {
    try {
      // First clear the API key from config
      const response = await fetch(`/api/config/${state.configHash}/apikey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          apiKey: '', 
          rpdbApiKey: elements.rpdbApiKeyInput?.value?.trim() || '' 
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to disconnect');
      }

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        
        // Reset MDBList UI elements
        elements.apiKeyInput.value = '';
        elements.apiKeyInput.style.display = 'block';
        elements.apiKeyInput.style.backgroundColor = '';
        elements.mdblistConnected.style.display = 'none';
        validationState.mdblist = false;
        
        // Update state
        state.userConfig.apiKey = '';
        
        // Reload lists to show remaining ones (Trakt, imported addons, etc.)
        await loadLists();
        
        showSectionNotification('apiKeys', 'Disconnected from MDBList ✅');
      }
    } catch (error) {
      console.error('Failed to disconnect from MDBList:', error);
      showStatus('Failed to disconnect from MDBList', 'error');
    }
  };

  window.disconnectRPDB = async function() {
    try {
      const response = await fetch(`/api/config/${state.configHash}/apikey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          apiKey: elements.apiKeyInput.value.trim(), 
          rpdbApiKey: '' 
        })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        
        // Reset UI
        elements.rpdbApiKeyInput.value = '';
        elements.rpdbApiKeyInput.style.display = 'block';
        elements.rpdbApiKeyInput.style.backgroundColor = '';
        elements.rpdbConnected.style.display = 'none';
        validationState.rpdb = false;
        
        // Update state
        state.userConfig.rpdbApiKey = '';
        
        showSectionNotification('apiKeys', 'Disconnected from RPDB ✓');
      }
    } catch (error) {
      console.error('Failed to disconnect from RPDB:', error);
      showStatus('Failed to disconnect from RPDB', 'error');
    }
  };

  // Add input event listeners for validation
  elements.apiKeyInput.addEventListener('input', function() {
    const apiKey = this.value.trim();
    const rpdbApiKey = elements.rpdbApiKeyInput.value.trim();
    
    // Reset validation state
    this.style.backgroundColor = '';
    validationState.mdblist = false;

    // Clear previous timeout
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }

    // Set new timeout for validation
    if (apiKey) {
      validationTimeout = setTimeout(() => {
        validateApiKeys(apiKey, rpdbApiKey);
      }, 500);
    }
  });

  elements.rpdbApiKeyInput.addEventListener('input', function() {
    const rpdbApiKey = this.value.trim();
    const apiKey = elements.apiKeyInput.value.trim();
    
    // Reset validation state
    this.style.backgroundColor = '';
    validationState.rpdb = false;

    // Clear previous timeout
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }

    // Set new timeout for validation
    if (rpdbApiKey) {
      validationTimeout = setTimeout(() => {
        validateApiKeys(apiKey, rpdbApiKey);
      }, 500);
    }
  });

  // Add disconnect functions to window scope
  window.disconnectTrakt = async function() {
    try {
      const response = await fetch(`/api/config/${state.configHash}/trakt/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to disconnect');
      }

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        
        // Reset Trakt UI elements
        elements.traktLoginBtn.style.display = 'block';
        elements.traktConnectedState.style.display = 'none';
        elements.traktPinContainer.style.display = 'none';
        elements.traktPin.value = '';
        
        // Reload lists to show remaining ones
        await loadLists();
        
        showSectionNotification('connections', 'Disconnected from Trakt ✅');
      }
    } catch (error) {
      console.error('Failed to disconnect from Trakt:', error);
      showStatus('Failed to disconnect from Trakt', 'error');
    }
  };

  // Function to copy manifest URL to clipboard
  async function copyManifestUrl() {
    try {
      const manifestUrl = document.getElementById('updateStremioBtn').getAttribute('href');
      
      await navigator.clipboard.writeText(manifestUrl);
      
      // Show temporary feedback
      const copyBtn = document.getElementById('copyManifestBtn');
      const originalContent = copyBtn.innerHTML;
      copyBtn.innerHTML = '<span>Copied!</span>';
      copyBtn.disabled = true;
      
      setTimeout(() => {
        copyBtn.innerHTML = originalContent;
        copyBtn.disabled = false;
      }, 2000);      
    } catch (err) {
      console.error('Failed to copy manifest URL:', err);
      showStatus('Failed to copy URL. Please try again.', 'error');
    }
  }

  // Add the updateSortPreferences function
  async function updateSortPreferences(listId, sort, order) {
    try {
      const response = await fetch(`/api/config/${state.configHash}/lists/sort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId, sort, order })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        showSectionNotification('lists', 'Sort preferences updated ✅');
        // Update the list's sort preferences in state
        const list = state.currentLists.find(l => l.id === listId);
        if (list) {
          list.sortPreferences = { sort, order };
        }
      }
    } catch (error) {
      console.error('Error updating sort preferences:', error);
      showStatus('Failed to update sort preferences', 'error');
    }
  }

  // Add remove list function
  async function removeList(event) {
    const listId = event.currentTarget.dataset.listId;
    const listItem = document.querySelector(`.list-item[data-id="${listId}"]`);
    
    try {
      showSectionNotification('lists', 'Removing list...', true);
      
      const response = await fetch(`/api/config/${state.configHash}/lists/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listIds: [listId] })
      });
      
      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        
        // Remove from state 
        if (!state.userConfig.removedLists) {
          state.userConfig.removedLists = new Set();
        }
        state.userConfig.removedLists.add(listId);
        
        // Remove the list item from UI with animation
        listItem.style.opacity = '0';
        listItem.style.height = '0';
        listItem.style.marginBottom = '0';
        listItem.style.transition = 'opacity 0.3s, height 0.3s, margin 0.3s';
        
        setTimeout(() => {
          listItem.remove();
        }, 300);
        
        showSectionNotification('lists', 'List removed successfully ✅');
      } else {
        throw new Error(data.error || 'Failed to remove list');
      }
    } catch (error) {
      console.error('Error removing list:', error);
      showSectionNotification('lists', 'Failed to remove list ❌', false, 'error');
    }
  }

  // Toggle list between merged and split view
  async function toggleListMerge(event) {
    const button = event.currentTarget;
    const listId = button.dataset.listId;
    const isMerged = button.classList.contains('merged');
    
    try {
      // Show loading state
      const originalText = button.textContent;
      button.textContent = 'Saving...';
      button.disabled = true;
      
      // Update server config
      const response = await fetch(`/api/config/${state.configHash}/lists/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          listId: listId,
          merged: !isMerged // Toggle the state
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Update UI
        if (isMerged) {
          button.classList.remove('merged');
          button.classList.add('split');
          button.textContent = 'Split';
          button.title = 'Click to merge this list into a single "All" catalog';
        } else {
          button.classList.remove('split');
          button.classList.add('merged');
          button.textContent = 'Merged';
          button.title = 'Click to split this list into separate Movie and Series catalogs';
        }
        
        // Update state
        state.configHash = data.configHash;
        updateURL();
        
        // Update the mergedLists in user config
        if (!state.userConfig.mergedLists) {
          state.userConfig.mergedLists = {};
        }
        state.userConfig.mergedLists[listId] = !isMerged;
        
        showSectionNotification('lists', `List ${!isMerged ? 'merged' : 'split'} successfully ✅`);
      } else {
        throw new Error(data.error || 'Failed to update list merge state');
      }
    } catch (error) {
      console.error('Error toggling list merge state:', error);
      button.textContent = originalText;
      showSectionNotification('lists', 'Failed to update list ❌', false, 'error');
    } finally {
      button.disabled = false;
    }
  }

  // Initialize the application
  init();
});