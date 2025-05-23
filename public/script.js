// public/script.js
const APP_VERSION = "1.0.0"; // Define app version here

// Default configurations for sort options
const defaultConfig = {
  availableSortOptions: [
    { value: 'imdbvotes', label: 'IMDb Votes' }, { value: 'rank', label: 'Rank' },
    { value: 'score', label: 'Score' }, { value: 'score_average', label: 'Score Average' },
    { value: 'released', label: 'Released' }, { value: 'releasedigital', label: 'Digital Release' },
    { value: 'imdbrating', label: 'IMDb Rating' }, { value: 'last_air_date', label: 'Last Air Date' },
    { value: 'imdbpopular', label: 'IMDb Popular' }, { value: 'tmdbpopular', label: 'TMDB Popular' },
    { value: 'rogerebert', label: 'Roger Ebert' }, { value: 'rtomatoes', label: 'Rotten Tomatoes' },
    { value: 'rtaudience', label: 'RT Audience' }, { value: 'metacritic', label: 'Metacritic' },
    { value: 'myanimelist', label: 'MyAnimeList' }, { value: 'letterrating', label: 'Letterboxd Rating' },
    { value: 'lettervotes', label: 'Letterboxd Votes' }, { value: 'budget', label: 'Budget' },
    { value: 'revenue', label: 'Revenue' }, { value: 'runtime', label: 'Runtime' },
    { value: 'title', label: 'Title' }, { value: 'random', label: 'Random' }
  ],
  traktSortOptions: [
    { value: 'rank', label: 'Trakt Rank' }, { value: 'added', label: 'Date Added' },
    { value: 'title', label: 'Title' }, { value: 'released', label: 'Release Date' },
    { value: 'runtime', label: 'Runtime' }, { value: 'popularity', label: 'Trakt Popularity' },
    { value: 'votes', label: 'Trakt Votes' }, { value: 'my_rating', label: 'My Trakt Rating' }
  ]
};

document.addEventListener('DOMContentLoaded', function() {
  const state = {
    configHash: null,
    userConfig: {
      listOrder: [],
      hiddenLists: new Set(),
      removedLists: new Set(),
      customListNames: {},
      mergedLists: {},
      sortPreferences: {},
      apiKey: '',
      rpdbApiKey: '',
      traktAccessToken: null,
      traktRefreshToken: null,
      traktExpiresAt: null,
      importedAddons: {},
      listsMetadata: {},
      availableSortOptions: [...defaultConfig.availableSortOptions],
      traktSortOptions: [...defaultConfig.traktSortOptions]
    },
    currentLists: [],
    validationTimeout: null,
    isMobile: window.matchMedia('(max-width: 600px)').matches
  };

  const elements = {
    apiKeyInput: document.getElementById('apiKey'),
    rpdbApiKeyInput: document.getElementById('rpdbApiKey'),
    mdblistConnected: document.getElementById('mdblistConnected'),
    mdblistConnectedText: document.getElementById('mdblistConnected').querySelector('.connected-text'),
    rpdbConnected: document.getElementById('rpdbConnected'),
    rpdbConnectedText: document.getElementById('rpdbConnected').querySelector('.connected-text'),
    traktLoginBtn: document.getElementById('traktLoginBtn'),
    traktConnectedState: document.getElementById('traktConnectedState'),
    traktPinContainer: document.getElementById('traktPinContainer'),
    traktPin: document.getElementById('traktPin'),
    submitTraktPin: document.getElementById('submitTraktPin'),
    listUrlInput: document.getElementById('listUrlInput'),
    importListUrlBtn: document.getElementById('importListUrlBtn'),
    manifestUrlInput: document.getElementById('manifestUrl'),
    importAddonBtn: document.getElementById('importAddonBtn'),
    importedAddonsContainer: document.getElementById('importedAddons'),
    addonsList: document.getElementById('addonsList'),
    listContainer: document.getElementById('listContainer'),
    listItems: document.getElementById('listItems'),
    updateStremioBtn: document.getElementById('updateStremioBtn'),
    copyManifestBtn: document.getElementById('copyManifestBtn'),
    apiKeysNotification: document.getElementById('apiKeysNotification'),
    connectionsNotification: document.getElementById('connectionsNotification'),
    importNotification: document.getElementById('importNotification'),
    listsNotification: document.getElementById('listsNotification'),
  };

  async function init() {
    setupEventListeners();
    applyGlobalStyles();
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    let initialConfigHash = null;
    if (pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === 'configure')) { /* Needs new hash */ }
    else if (pathParts.length >= 1 && pathParts[0] !== 'api' && pathParts[0] !== 'configure') {
        initialConfigHash = pathParts[0];
        if (pathParts.length === 1 || pathParts[1] !== 'configure') {
            window.history.replaceState({}, '', `/${initialConfigHash}/configure`);
        }
    }
    if (initialConfigHash) {
        state.configHash = initialConfigHash;
        updateURLAndLoadData();
    } else {
        try {
            const response = await fetch('/api/config/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
            });
            const data = await response.json();
            if (data.success && data.configHash) {
                state.configHash = data.configHash;
                updateURLAndLoadData();
            } else { throw new Error(data.error || 'Failed to create config hash'); }
        } catch (error) { console.error('Init Error creating config:', error); showNotification('apiKeys', `Init Error: ${error.message}`, 'error', true); }
    }
  }

  function applyGlobalStyles() {
    const pageHeader = document.createElement('div');
    pageHeader.className = 'page-header';
    pageHeader.innerHTML = `
        <img src="/assets/image.png" alt="AIOLists Logo">
        <h1>AIOLists</h1>
        <span class="app-version">v${APP_VERSION}</span>
        <a href="https://github.com/SebastianMorel/AIOLists" target="_blank" rel="noopener noreferrer" class="github-link" title="View on GitHub">
            <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
            </svg>
        </a>`;
    const containerDiv = document.querySelector('.container');
    if (containerDiv && containerDiv.parentNode) { // Ensure container exists and has a parent
        containerDiv.parentNode.insertBefore(pageHeader, containerDiv);
    } else {
        document.body.insertBefore(pageHeader, document.body.firstChild);
    }
  }

  function updateURLAndLoadData() { if (!state.configHash) return; updateURL(); updateStremioButtonHref(); loadConfiguration(); }
  function updateURL() {
    if (!state.configHash) return;
    const expectedPath = `/${state.configHash}/configure`;
    if (window.location.pathname !== expectedPath) { window.history.replaceState({}, '', expectedPath); }
  }

  function setupEventListeners() {
    elements.apiKeyInput.addEventListener('input', () => handleApiKeyInput(elements.apiKeyInput, 'mdblist'));
    elements.rpdbApiKeyInput.addEventListener('input', () => handleApiKeyInput(elements.rpdbApiKeyInput, 'rpdb'));
    
    elements.traktLoginBtn?.addEventListener('click', (e) => {
      elements.traktPinContainer.style.display = 'flex';
    });

    elements.submitTraktPin?.addEventListener('click', handleTraktPinSubmit);
    elements.importListUrlBtn?.addEventListener('click', handleListUrlImport);
    elements.importAddonBtn?.addEventListener('click', handleAddonImport);
    elements.copyManifestBtn?.addEventListener('click', copyManifestUrlToClipboard);
    window.addEventListener('resize', () => {
        const oldMobileState = state.isMobile;
        state.isMobile = window.matchMedia('(max-width: 600px)').matches;
        if (oldMobileState !== state.isMobile && state.currentLists.length > 0) { renderLists(); }
    });
  }

  async function loadConfiguration() {
    if (!state.configHash) return;
    try {
      const response = await fetch(`/${state.configHash}/config`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to load config data');
      state.userConfig = { ...defaultConfig, ...data.config };
      state.userConfig.hiddenLists = new Set(state.userConfig.hiddenLists || []);
      state.userConfig.removedLists = new Set(state.userConfig.removedLists || []);
      state.userConfig.importedAddons = state.userConfig.importedAddons || {};
      state.userConfig.listsMetadata = state.userConfig.listsMetadata || {};
      state.userConfig.availableSortOptions = Array.isArray(state.userConfig.availableSortOptions) && state.userConfig.availableSortOptions.length > 0 ? state.userConfig.availableSortOptions : [...defaultConfig.availableSortOptions];
      state.userConfig.traktSortOptions = Array.isArray(state.userConfig.traktSortOptions) && state.userConfig.traktSortOptions.length > 0 ? state.userConfig.traktSortOptions : [...defaultConfig.traktSortOptions];
      updateApiKeyUI(elements.apiKeyInput, state.userConfig.apiKey, 'mdblist', state.userConfig.mdblistUsername);
      updateApiKeyUI(elements.rpdbApiKeyInput, state.userConfig.rpdbApiKey, 'rpdb');
      updateTraktUI(!!state.userConfig.traktAccessToken);
      await loadUserListsAndAddons();
    } catch (error) { console.error('Load Config Error:', error); showNotification('apiKeys', `Load Config Error: ${error.message}`, 'error', true); }
  }

  function handleApiKeyInput(inputElement, keyType) {
    const apiKey = inputElement.value.trim();
    inputElement.classList.remove('valid', 'invalid');
    if (state.validationTimeout) clearTimeout(state.validationTimeout);
    state.validationTimeout = setTimeout(() => {
      validateAndSaveApiKeys(
        keyType === 'mdblist' ? apiKey : elements.apiKeyInput.value.trim(),
        keyType === 'rpdb' ? apiKey : elements.rpdbApiKeyInput.value.trim()
      );
    }, 700);
  }

  async function validateAndSaveApiKeys(mdblistApiKeyToValidate, rpdbApiKeyToValidate) {
    try {
      const res = await fetch('/api/validate-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: mdblistApiKeyToValidate, rpdbApiKey: rpdbApiKeyToValidate })
      });
      const validationResults = await res.json();
      const mdblistValid = validationResults.mdblist?.valid;
      const rpdbValid = validationResults.rpdb?.valid;
      state.userConfig.mdblistUsername = mdblistValid ? validationResults.mdblist.username : null;
      updateApiKeyUI(elements.apiKeyInput, mdblistApiKeyToValidate, 'mdblist', state.userConfig.mdblistUsername, mdblistValid);
      updateApiKeyUI(elements.rpdbApiKeyInput, rpdbApiKeyToValidate, 'rpdb', null, rpdbValid);
      const saveResponse = await fetch(`/${state.configHash}/apikey`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: mdblistApiKeyToValidate, rpdbApiKey: rpdbApiKeyToValidate })
      });
      const saveData = await saveResponse.json();
      if (saveData.success) {
        if (saveData.configHash && saveData.configHash !== state.configHash) {
            state.configHash = saveData.configHash; updateURL(); updateStremioButtonHref();
        }
        state.userConfig.apiKey = mdblistApiKeyToValidate; state.userConfig.rpdbApiKey = rpdbApiKeyToValidate;
        showNotification('apiKeys', 'API keys updated.', 'success');
        if ((mdblistValid && mdblistApiKeyToValidate) || state.userConfig.traktAccessToken) {
            await loadUserListsAndAddons();
        } else if (!mdblistApiKeyToValidate && !state.userConfig.traktAccessToken) {
            state.currentLists = []; renderLists(); renderImportedAddons();
        }
      } else { throw new Error(saveData.error || "Failed to save API keys"); }
    } catch (error) { console.error('Key Error:', error); showNotification('apiKeys', `Key Error: ${error.message}`, 'error', true); }
  }

  function updateApiKeyUI(inputElement, key, keyType, username = null, isValid = null) {
    const connectedDiv = keyType === 'mdblist' ? elements.mdblistConnected : elements.rpdbConnected;
    const connectedText = keyType === 'mdblist' ? elements.mdblistConnectedText : elements.rpdbConnectedText;
    inputElement.classList.remove('valid', 'invalid');
    if (key && isValid === true) {
      inputElement.style.display = 'none'; connectedDiv.style.display = 'flex';
      connectedText.textContent = keyType === 'mdblist' ? `Connected as ${username}` : 'RPDB Key Valid';
      inputElement.classList.add('valid');
    } else {
      inputElement.style.display = 'block'; connectedDiv.style.display = 'none';
      inputElement.value = key || '';
      if (key && isValid === false) inputElement.classList.add('invalid');
    }
  }

  function updateTraktUI(isConnected) {
    elements.traktLoginBtn.style.display = isConnected ? 'none' : 'block';
    elements.traktConnectedState.style.display = isConnected ? 'flex' : 'none';
    elements.traktPinContainer.style.display = 'none';
    if (!isConnected) elements.traktPin.value = '';
  }

  async function handleTraktPinSubmit() {
    const pin = elements.traktPin.value.trim();
    if (!pin) return showNotification('connections', 'Please enter your Trakt PIN', 'error');
    try {
      const response = await fetch(`/${state.configHash}/trakt/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pin }) });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || data.details || 'Trakt auth failed');
      state.configHash = data.configHash;
      state.userConfig.traktAccessToken = data.accessToken; state.userConfig.traktRefreshToken = data.refreshToken; state.userConfig.traktExpiresAt = data.expiresAt;
      updateURL(); updateStremioButtonHref(); updateTraktUI(true);
      showNotification('connections', 'Successfully connected to Trakt!', 'success');
      await loadUserListsAndAddons();
    } catch (error) { console.error('Trakt Error:', error); showNotification('connections', `Trakt Error: ${error.message}`, 'error', true); }
  }

  async function handleListUrlImport() {
    const url = elements.listUrlInput.value.trim();
    if (!url) return showNotification('import', 'Please enter a MDBList or Trakt list URL.', 'error');
    let importType = '';
    if (url.includes('mdblist.com/lists/')) importType = 'MDBList';
    else if (url.includes('trakt.tv/users/') && url.includes('/lists/')) importType = 'Trakt Public List';
    else return showNotification('import', 'URL not recognized as MDBList or Trakt public list.', 'error');
    try {
      const response = await fetch(`/${state.configHash}/import-list-url`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || data.details || `Failed to import ${importType}`);
      state.configHash = data.configHash;
      updateURL(); updateStremioButtonHref(); elements.listUrlInput.value = '';
      showNotification('import', data.message || `${data.addon.name} imported.`, 'success');
      await loadUserListsAndAddons();
    } catch (error) { console.error('Import Error:', error); showNotification('import', `Import Error: ${error.message}`, 'error', true); }
  }

  async function handleAddonImport() {
    const manifestUrl = elements.manifestUrlInput.value.trim();
    if (!manifestUrl) return showNotification('import', 'Please enter a manifest URL.', 'error');
    try {
      const response = await fetch(`/${state.configHash}/import-addon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl }) });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || data.details || 'Failed to import addon');
      state.configHash = data.configHash;
      updateURL(); updateStremioButtonHref(); elements.manifestUrlInput.value = '';
      showNotification('import', data.message || `${data.addon.name} imported.`, 'success');
      await loadUserListsAndAddons();
    } catch (error) { console.error('Addon Import Error:', error); showNotification('import', `Addon Import Error: ${error.message}`, 'error', true); }
  }

  async function loadUserListsAndAddons() {
    if (!state.configHash) return;
    showNotification('lists', 'Loading lists...', 'info', true);
    try {
      const response = await fetch(`/${state.configHash}/lists`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to load lists');
      state.currentLists = data.lists || [];
      state.userConfig.importedAddons = data.importedAddons || {};
      state.userConfig.listsMetadata = data.listsMetadata || state.userConfig.listsMetadata || {};
      state.userConfig.availableSortOptions = data.availableSortOptions || defaultConfig.availableSortOptions;
      state.userConfig.traktSortOptions = data.traktSortOptions || defaultConfig.traktSortOptions;
      if (data.newConfigHash && data.newConfigHash !== state.configHash) {
        state.configHash = data.newConfigHash; updateURL(); updateStremioButtonHref();
      }
      renderLists(); renderImportedAddons();
      elements.listContainer.classList.remove('hidden');
      showNotification('lists', 'Lists loaded.', 'success');
    } catch (error) {
      console.error('List Load Error:', error);
      showNotification('lists', `List Load Error: ${error.message}`, 'error', true);
      elements.listContainer.classList.add('hidden');
    }
  }

  function renderLists() {
    elements.listItems.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.currentLists.forEach(list => fragment.appendChild(createListItemElement(list)));
    elements.listItems.appendChild(fragment);
    if (window.Sortable && elements.listItems.children.length > 0) {
      if (elements.listItems._sortable) elements.listItems._sortable.destroy();
      elements.listItems._sortable = Sortable.create(elements.listItems, {
        animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost', dragClass: 'sortable-drag', onEnd: handleListReorder });
    }
  }

  function createListItemElement(list) {
    const li = document.createElement('li');
    li.className = `list-item ${state.userConfig.hiddenLists.has(String(list.id)) ? 'hidden' : ''}`;
    li.dataset.id = String(list.id); 
    li.dataset.originalId = String(list.originalId || list.id);

    const contentWrapper = document.createElement('div'); contentWrapper.className = 'list-item-content';
    const dragHandle = document.createElement('span'); dragHandle.className = 'drag-handle'; dragHandle.innerHTML = '☰';
    const mainCol = document.createElement('div'); mainCol.className = 'list-item-main';
    
    const tag = document.createElement('span');
    tag.className = `tag`;
    let tagTypeChar = 'A'; 
    let tagImageSrc = list.tagImage;

    if (list.source === 'mdblist' || list.source === 'mdblist_url') {
        tagTypeChar = list.isWatchlist ? 'W' : (list.isExternalList ? 'E' : 'L');
        if(list.source === 'mdblist_url') tagTypeChar = 'L'; // Ensure MDBList URL imports are 'L' if not watchlist
    } else if (list.source === 'trakt' || list.source === 'trakt_public') {
        tagTypeChar = 'T';
        tagImageSrc = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
    } else if (list.source === 'addon_manifest'){ // For generic manifest imports
        tagTypeChar = 'A'; // Default 'A' for addon_manifest if no specific tag given
    }
    tag.classList.add(tagTypeChar.toLowerCase());

    if (tagImageSrc) {
        const img = document.createElement('img'); img.src = tagImageSrc; 
        img.alt = list.source || 'icon';
        tag.appendChild(img);
        if (list.source === 'trakt' || list.source === 'trakt_public') {
            tag.style.backgroundColor = 'transparent';
        }
    } else {
        tag.textContent = tagTypeChar;
    }

    const nameContainer = document.createElement('div'); nameContainer.className = 'name-container';
    const nameSpan = document.createElement('span'); nameSpan.className = 'list-name';
    let displayName = list.customName || list.name;
    if (list.source === 'mdblist_url' || list.source === 'trakt_public' || list.source === 'addon_manifest') {
        displayName = displayName.replace(/\s*\((Movies|Series)\)$/i, '').trim();
    }
    nameSpan.textContent = displayName;
    nameContainer.appendChild(nameSpan);

    // Event listeners now correctly call their respective functions
    const removeBtn = createButton('❌', 'remove-list-button action-icon', (e) => { e.stopPropagation(); removeListItem(li, String(list.id)); }, 'Remove List');
    const visibilityToggleBtn = createButton(
        `<span class="eye-icon ${state.userConfig.hiddenLists.has(String(list.id)) ? 'eye-closed-svg' : 'eye-open-svg'}"></span>`,
        'visibility-toggle action-icon', 
        (e) => { e.stopPropagation(); toggleListVisibility(li, String(list.id)); }, // Corrected
        state.userConfig.hiddenLists.has(String(list.id)) ? 'Show' : 'Hide');
    const editBtn = createButton('✏️', 'edit-button action-icon', (e) => { e.stopPropagation(); startNameEditing(li, list); }, 'Edit List Name');

    let mergeToggle = null;
    const canMerge = list.hasMovies && list.hasShows && 
                     !list.isTraktWatchlist && // Exclude Trakt Watchlist
                     !(list.isUrlImportedType || list.source === 'mdblist_url' || list.source === 'trakt_public' || list.source === 'addon_manifest');
    if (canMerge) {
      const isMerged = state.userConfig.mergedLists?.[String(list.id)] !== false;
      mergeToggle = createButton(isMerged ? 'Merged' : 'Split', `merge-toggle ${isMerged ? 'merged' : 'split'}`,
          async (e) => { 
              e.stopPropagation();
              const newMergedState = !(state.userConfig.mergedLists?.[String(list.id)] !== false);
              mergeToggle.textContent = newMergedState ? 'Merged' : 'Split';
              mergeToggle.className = `merge-toggle ${newMergedState ? 'merged' : 'split'}`;
              state.userConfig.mergedLists[String(list.id)] = newMergedState;
              await updateListPreference(String(list.id), 'merge', { merged: newMergedState });
          }, isMerged ? 'Click to split' : 'Click to merge');
    }

    let sortControlsContainer = null;
    const isSpecialTraktNonSortable = list.isTraktTrending || list.isTraktPopular || list.isTraktRecommendations;
    const isSortableList = (list.source === 'mdblist' || list.source === 'mdblist_url' || 
                           (list.source === 'trakt' && (list.isTraktList || list.isTraktWatchlist)) || 
                           list.source === 'trakt_public') 
                           && !isSpecialTraktNonSortable;

    if (isSortableList) {
        sortControlsContainer = document.createElement('div'); sortControlsContainer.className = 'sort-controls';
        const sortSelect = document.createElement('select'); sortSelect.className = 'sort-select';
        const currentSortOptions = (list.source === 'trakt' || list.source === 'trakt_public') ? 
            (state.userConfig.traktSortOptions) : (state.userConfig.availableSortOptions);
        const sortPrefKey = String(list.originalId);
        let currentSortPref = state.userConfig.sortPreferences?.[sortPrefKey] || list.sortPreferences;
        if (!currentSortPref) {
            currentSortPref = { sort: (list.source === 'trakt' || list.source === 'trakt_public') ? 'rank' : 'imdbvotes', 
                                order: (list.source === 'trakt' || list.source === 'trakt_public') ? 'asc' : 'desc' };
        }
        (currentSortOptions || []).forEach(opt => {
            const optionEl = document.createElement('option'); optionEl.value = opt.value; optionEl.textContent = opt.label;
            if (opt.value === currentSortPref.sort) optionEl.selected = true;
            sortSelect.appendChild(optionEl);
        });
        const orderToggleBtn = createButton(currentSortPref.order === 'desc' ? 'Desc' : 'Asc', 'order-toggle-btn', null, 'Toggle sort order');
        const updateSortAndOrder = async (newSort, newOrder) => {
            orderToggleBtn.textContent = newOrder === 'desc' ? 'Desc' : 'Asc';
            state.userConfig.sortPreferences[sortPrefKey] = { sort: newSort, order: newOrder };
            list.sortPreferences = { sort: newSort, order: newOrder };
            await updateListPreference(sortPrefKey, 'sort', { sort: newSort, order: newOrder });
        };
        orderToggleBtn.onclick = (e) => {
            e.stopPropagation();
            const currentOrderIsDesc = (state.userConfig.sortPreferences?.[sortPrefKey]?.order || list.sortPreferences?.order) === 'desc';
            updateSortAndOrder(sortSelect.value, currentOrderIsDesc ? 'asc' : 'desc');
        };
        sortSelect.onchange = (e) => {
            e.stopPropagation();
            const currentOrder = (state.userConfig.sortPreferences?.[sortPrefKey]?.order || list.sortPreferences?.order);
            updateSortAndOrder(e.target.value, currentOrder || 'desc');
        };
        sortControlsContainer.append(orderToggleBtn, sortSelect);
    }
    
    const actionsGroup = document.createElement('div'); actionsGroup.className = 'list-actions-group';
    if (mergeToggle) actionsGroup.appendChild(mergeToggle);
    if (sortControlsContainer) actionsGroup.appendChild(sortControlsContainer);
    actionsGroup.appendChild(editBtn); 
    actionsGroup.appendChild(visibilityToggleBtn); 
    actionsGroup.appendChild(removeBtn); 

    if (state.isMobile) {
        contentWrapper.appendChild(dragHandle); 
        const topRow = document.createElement('div'); topRow.className = 'list-item-row list-item-row-top';
        topRow.append(tag, nameContainer); 
        const bottomRow = document.createElement('div'); bottomRow.className = 'list-item-row list-item-row-bottom';
        bottomRow.appendChild(actionsGroup);
        mainCol.append(topRow, bottomRow);
    } else { 
        contentWrapper.appendChild(dragHandle);
        const desktopRow = document.createElement('div'); desktopRow.className = 'list-item-row list-item-row-desktop';
        desktopRow.append(tag, nameContainer); 
        desktopRow.appendChild(actionsGroup);
        mainCol.appendChild(desktopRow);
    }
    contentWrapper.appendChild(mainCol);
    li.appendChild(contentWrapper);
    return li;
  }

  function createButton(htmlOrText, className, onClick, title = '') {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = className;
    btn.innerHTML = htmlOrText; if (title) btn.title = title;
    // Ensure onClick is a function before adding listener
    if (typeof onClick === 'function') {
        btn.addEventListener('click', onClick);
    }
    return btn;
  }
  
  const debouncedSaveListOrder = debounce(async (order) => {
    await updateListPreference(null, 'order', { order }); }, 1000);

  function handleListReorder(evt) {
    const items = Array.from(elements.listItems.querySelectorAll('.list-item'));
    const order = items.map(item => String(item.dataset.id)); debouncedSaveListOrder(order);
  }

  function startNameEditing(listItemElement, list) {
    const nameSpan = listItemElement.querySelector('.list-name');
    let currentDisplayName = list.customName || list.name;
    if (list.isUrlImportedType || list.source === 'mdblist_url' || list.source === 'trakt_public') {
        currentDisplayName = currentDisplayName.replace(/\s*\((Movies|Series)\)$/i, '').trim();
    }
    const nameContainer = nameSpan.parentElement;
    const input = document.createElement('input'); input.type = 'text'; input.className = 'edit-name-input'; input.value = currentDisplayName;
    const saveBtn = createButton('✓', 'save-name-btn action-btn', (e) => handleSave(e)); // Pass event
    const cancelBtn = createButton('✕', 'cancel-name-btn action-btn', (e) => handleCancel(e)); // Pass event
    const editActionsDiv = document.createElement('div'); editActionsDiv.className = 'actions edit-actions';
    editActionsDiv.append(saveBtn, cancelBtn);
    const otherActionsGroup = listItemElement.querySelector('.list-actions-group');
    if(otherActionsGroup) otherActionsGroup.style.display = 'none';
    nameContainer.innerHTML = ''; nameContainer.append(input, editActionsDiv);
    input.focus(); input.select();
    async function handleSave(e) {
        if(e) e.stopPropagation();
        const newName = input.value.trim();
        await updateListPreference(String(list.id), 'name', { customName: newName });
        list.customName = newName; 
        finishEditing();
    }
    function handleCancel(e) { if(e) e.stopPropagation(); finishEditing(); }
    function finishEditing() {
        const updatedLi = createListItemElement(list); listItemElement.replaceWith(updatedLi);
    }
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleSave(e); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handleCancel(e); }
    });
  }
  
  async function toggleListVisibility(listItemElement, listId) {
    const isHidden = state.userConfig.hiddenLists.has(listId);
    const newHiddenState = !isHidden;
    if (newHiddenState) state.userConfig.hiddenLists.add(listId); else state.userConfig.hiddenLists.delete(listId);
    listItemElement.classList.toggle('hidden', newHiddenState);
    const eyeIconSpan = listItemElement.querySelector('.eye-icon');
    if (eyeIconSpan) eyeIconSpan.className = `eye-icon ${newHiddenState ? 'eye-closed-svg' : 'eye-open-svg'}`;
    await updateListPreference(null, 'visibility', { hiddenLists: Array.from(state.userConfig.hiddenLists) });
  }

  async function removeListItem(listItemElement, listId) {
    // Removed confirmation prompt as per request
    state.userConfig.removedLists.add(listId); 
    listItemElement.remove();
    state.currentLists = state.currentLists.filter(l => String(l.id) !== listId);
    await updateListPreference(null, 'remove', { listIds: [listId] });
  }

  async function updateListPreference(listIdForPref, type, payload) {
    const endpointMap = { name: `/${state.configHash}/lists/names`, visibility: `/${state.configHash}/lists/visibility`, remove: `/${state.configHash}/lists/remove`, order: `/${state.configHash}/lists/order`, sort: `/${state.configHash}/lists/sort`, merge: `/${state.configHash}/lists/merge`};
    const endpoint = endpointMap[type]; if (!endpoint) return;
    let body = payload;
    if (listIdForPref && ['name', 'sort', 'merge'].includes(type)) { body = { listId: listIdForPref, ...payload }; }
    showNotification('lists', 'Saving...', 'info', true);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || `Failed to update ${type}`);
      if(data.configHash && data.configHash !== state.configHash) { state.configHash = data.configHash; updateURL(); updateStremioButtonHref(); }
      showNotification('lists', `${type.charAt(0).toUpperCase() + type.slice(1)} updated.`, 'success');
      if (['merge', 'remove', 'order'].includes(type)) { await loadUserListsAndAddons(); }
      else if (type === 'name') {
         const changedList = state.currentLists.find(l => String(l.id) === String(listIdForPref));
         if(changedList && payload.customName !== undefined) {
            changedList.customName = payload.customName;
            const listItemNameSpan = document.querySelector(`.list-item[data-id="${listIdForPref}"] .list-name`);
            if (listItemNameSpan) {
                let displayName = payload.customName;
                 if (changedList.isUrlImportedType || changedList.source === 'mdblist_url' || changedList.source === 'trakt_public') {
                    displayName = displayName.replace(/\s*\((Movies|Series)\)$/i, '').trim();
                }
                listItemNameSpan.textContent = displayName;
            } else { renderLists(); }
         } else { renderLists(); }
      } else if (type === 'visibility'){ /* Visibility is handled by class toggle */ }
      else if (type === 'sort') {
          const changedList = state.currentLists.find(l => String(l.originalId) === String(listIdForPref) || String(l.id) === String(listIdForPref));
          if(changedList) {
              changedList.sortPreferences = {sort: payload.sort, order: payload.order};
              const listItemNode = document.querySelector(`.list-item[data-original-id="${listIdForPref}"]`) || document.querySelector(`.list-item[data-id="${listIdForPref}"]`);
              if (listItemNode) { const newListItem = createListItemElement(changedList); listItemNode.replaceWith(newListItem); }
              else { renderLists(); }
          } else { renderLists(); }
      }
    } catch (error) { console.error(`Update Error for ${type}:`, error); showNotification('lists', `Update Error: ${error.message}`, 'error', true); }
  }

  function renderImportedAddons() {
    elements.addonsList.innerHTML = '';
    const addonGroups = Object.values(state.userConfig.importedAddons || {})
                              .filter(addon => addon && addon.isUrlImported === false); 
    if (addonGroups.length === 0) {
      elements.importedAddonsContainer.classList.add('hidden'); return;
    }
    elements.importedAddonsContainer.classList.remove('hidden');
    addonGroups.forEach(addon => {
      const item = document.createElement('div'); item.className = 'addon-item-group';
      item.innerHTML = `
        ${addon.logo ? `<img src="${addon.logo}" alt="" class="addon-group-logo">` : '<span class="addon-group-logo-placeholder"></span>'}
        <div class="addon-group-details">
          <span class="addon-group-name">${addon.name}</span>
          <span class="addon-group-info">v${addon.version || 'N/A'} • ${addon.catalogs?.length || 0} list${addon.catalogs?.length !== 1 ? 's' : ''}</span>
        </div>
        <button class="remove-addon-group action-icon" data-addon-id="${addon.id}" title="Remove Addon Group">❌</button>
      `;
      item.querySelector('.remove-addon-group').addEventListener('click', (e) => { e.stopPropagation(); removeImportedAddonGroup(addon.id, addon.name);});
      elements.addonsList.appendChild(item);
    });
  }

  async function removeImportedAddonGroup(addonGroupId, addonName) {
    // Removed confirmation prompt
    try {
      const response = await fetch(`/${state.configHash}/remove-addon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addonId: addonGroupId }) });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to remove addon group');
      state.configHash = data.configHash; 
      delete state.userConfig.importedAddons[addonGroupId]; 
      updateURL(); updateStremioButtonHref();
      await loadUserListsAndAddons(); 
      showNotification('import', 'Addon group removed.', 'success');
    } catch (error) { console.error('Remove Addon Error:', error); showNotification('import', `Remove Addon Error: ${error.message}`, 'error', true); }
  }
  
  function updateStremioButtonHref() {
    if (state.configHash && elements.updateStremioBtn) {
      const baseUrl = `stremio://${window.location.host}`;
      elements.updateStremioBtn.href = `${baseUrl}/${state.configHash}/manifest.json`;
    }
  }

  async function copyManifestUrlToClipboard() {
    if (!elements.updateStremioBtn || !elements.updateStremioBtn.href || !elements.updateStremioBtn.href.includes('/manifest.json')) {
        return showNotification('lists', 'Manifest URL not ready.', 'error');
    }
    try {
      await navigator.clipboard.writeText(elements.updateStremioBtn.href);
      const originalContent = elements.copyManifestBtn.innerHTML;
      elements.copyManifestBtn.innerHTML = '<span>Copied!</span>'; elements.copyManifestBtn.disabled = true;
      setTimeout(() => { elements.copyManifestBtn.innerHTML = originalContent; elements.copyManifestBtn.disabled = false; }, 2000);
    } catch (err) { showNotification('lists', 'Failed to copy URL.', 'error'); }
  }
  
  function showNotification(sectionKey, message, type = 'info', persistent = false) {
    if (['apiKeys', 'connections', 'import'].includes(sectionKey)) {
        console.log(`Notification (${type}) for ${sectionKey}: ${message}`); return;
    }
    const notificationElement = elements[`${sectionKey}Notification`];
    if (!notificationElement) { console.warn("Notification element for section not found:", sectionKey); return; }
    notificationElement.textContent = message;
    notificationElement.className = `section-notification ${type} visible`; 
    if (notificationElement._timeout) clearTimeout(notificationElement._timeout);
    if (!persistent) {
      notificationElement._timeout = setTimeout(() => { notificationElement.classList.remove('visible'); }, 3000);
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => { clearTimeout(timeout); func(...args); };
      clearTimeout(timeout); timeout = setTimeout(later, wait); };
  }

  window.disconnectMDBList = async function() {
    updateApiKeyUI(elements.apiKeyInput, '', 'mdblist', null, false); 
    await validateAndSaveApiKeys('', elements.rpdbApiKeyInput.value.trim()); 
    state.userConfig.apiKey = ''; state.userConfig.mdblistUsername = null;
    await loadUserListsAndAddons(); 
  };
  window.disconnectRPDB = async function() {
    updateApiKeyUI(elements.rpdbApiKeyInput, '', 'rpdb', null, false);
    await validateAndSaveApiKeys(elements.apiKeyInput.value.trim(), '');
    state.userConfig.rpdbApiKey = '';
  };
  window.disconnectTrakt = async function() {
    try {
        const response = await fetch(`/${state.configHash}/trakt/disconnect`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to disconnect Trakt');
        state.configHash = data.configHash; 
        state.userConfig.traktAccessToken = null; state.userConfig.traktRefreshToken = null; state.userConfig.traktExpiresAt = null;
        updateURL(); updateStremioButtonHref(); updateTraktUI(false);
        showNotification('connections', 'Disconnected from Trakt.', 'success');
        await loadUserListsAndAddons();
    } catch (error) { console.error('Trakt Disconnect Error:', error); showNotification('connections', `Trakt Disconnect Error: ${error.message}`, 'error', true); }
  };
  
  init();
});