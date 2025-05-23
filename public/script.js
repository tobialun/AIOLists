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
      availableSortOptions: [...defaultConfig.availableSortOptions], // Clone
      traktSortOptions: [...defaultConfig.traktSortOptions] // Clone
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
    mdblistUrlInput: document.getElementById('mdblistUrl'),
    importMDBListBtn: document.getElementById('importMDBListBtn'),
    manifestUrlInput: document.getElementById('manifestUrl'),
    importAddonBtn: document.getElementById('importAddonBtn'),
    importedAddonsContainer: document.getElementById('importedAddons'),
    addonsList: document.getElementById('addonsList'),
    listContainer: document.getElementById('listContainer'),
    listItems: document.getElementById('listItems'),
    updateStremioBtn: document.getElementById('updateStremioBtn'),
    copyManifestBtn: document.getElementById('copyManifestBtn'),
    // Notifications
    apiKeysNotification: document.getElementById('apiKeysNotification'),
    connectionsNotification: document.getElementById('connectionsNotification'),
    importNotification: document.getElementById('importNotification'),
    listsNotification: document.getElementById('listsNotification'),
  };

  async function init() {
    setupEventListeners();
    applyGlobalStyles();

    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const onConfigurePage = pathParts.length > 0 && pathParts[pathParts.length -1] === 'configure';

    if (!onConfigurePage) { // Not on /hash/configure or root / (which implies should go to /hash/configure)
      try {
        const response = await fetch('/api/config/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await response.json();
        if (data.success && data.configHash) {
          state.configHash = data.configHash;
          updateURLAndLoadData();
        } else {
          throw new Error(data.error || 'Failed to create or retrieve config hash');
        }
      } catch (error) {
        console.error('Failed to initialize configuration:', error);
        showNotification('apiKeys', `Error: ${error.message}`, 'error');
      }
    } else { // Already on /hash/configure
      state.configHash = pathParts[0];
      updateURLAndLoadData();
    }
  }

  function updateURLAndLoadData() {
    updateURL();
    updateStremioButtonHref();
    loadConfiguration();
  }
  
  function updateURL() {
    if (!state.configHash) return;
    const url = new URL(window.location.href);
    url.pathname = `/${state.configHash}/configure`;
    url.searchParams.delete('config'); // Clean old params if any
    window.history.replaceState({}, '', url);
  }

  function setupEventListeners() {
    elements.apiKeyInput.addEventListener('input', () => handleApiKeyInput(elements.apiKeyInput, 'mdblist'));
    elements.rpdbApiKeyInput.addEventListener('input', () => handleApiKeyInput(elements.rpdbApiKeyInput, 'rpdb'));
    
    elements.traktLoginBtn?.addEventListener('click', () => { elements.traktPinContainer.style.display = 'flex'; });
    elements.submitTraktPin?.addEventListener('click', handleTraktPinSubmit);
    
    elements.importMDBListBtn?.addEventListener('click', handleMDBListUrlImport);
    elements.importAddonBtn?.addEventListener('click', handleAddonImport);
    elements.copyManifestBtn?.addEventListener('click', copyManifestUrlToClipboard);

    window.addEventListener('resize', () => {
        state.isMobile = window.matchMedia('(max-width: 600px)').matches;
        // Could re-render lists if layout changes drastically, or use CSS for responsiveness
    });
  }

  function applyGlobalStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
      .header img { height: 40px; width: auto; }
      .header h1 { color: #000; margin: 0; font-size: 24px; font-weight: 500; }
      /* Add other critical dynamic styles if necessary */
    `;
    document.head.appendChild(style);
    const favicon = document.createElement('link');
    favicon.rel = 'icon'; favicon.type = 'image/x-icon'; favicon.href = '/assets/logo.ico';
    document.head.appendChild(favicon);
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `<img src="/assets/image.png" alt="AIOLists Logo"><h1>AIOLists</h1>`;
    const oldTitle = document.body.querySelector('h1'); // Assuming one main H1 to replace
    if (oldTitle && oldTitle.parentElement === document.querySelector('.container')) { // Be more specific if needed
        oldTitle.remove();
    }
    document.body.insertBefore(header, document.body.firstChild);
  }

  async function loadConfiguration() {
    if (!state.configHash) return;
    try {
      const response = await fetch(`/${state.configHash}/config`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to load config data');
      
      state.userConfig = { ...state.userConfig, ...data.config }; // Merge with defaults
      state.userConfig.hiddenLists = new Set(state.userConfig.hiddenLists || []);
      state.userConfig.removedLists = new Set(state.userConfig.removedLists || []);

      updateApiKeyUI(elements.apiKeyInput, state.userConfig.apiKey, 'mdblist', state.userConfig.mdblistUsername);
      updateApiKeyUI(elements.rpdbApiKeyInput, state.userConfig.rpdbApiKey, 'rpdb');
      updateTraktUI(!!state.userConfig.traktAccessToken);
      
      await loadUserListsAndAddons();
    } catch (error) {
      console.error('Failed to load configuration:', error);
      showNotification('apiKeys', `Load Config Error: ${error.message}`, 'error');
    }
  }

  function handleApiKeyInput(inputElement, keyType) {
    const apiKey = inputElement.value.trim();
    inputElement.style.backgroundColor = ''; // Reset on input
    if (state.validationTimeout) clearTimeout(state.validationTimeout);
    if (apiKey) {
      state.validationTimeout = setTimeout(() => {
        validateAndSaveApiKeys(
          keyType === 'mdblist' ? apiKey : elements.apiKeyInput.value.trim(),
          keyType === 'rpdb' ? apiKey : elements.rpdbApiKeyInput.value.trim()
        );
      }, 700);
    } else { // If key is cleared, attempt to save empty state
        validateAndSaveApiKeys(
          elements.apiKeyInput.value.trim(),
          elements.rpdbApiKeyInput.value.trim()
        );
    }
  }

  async function validateAndSaveApiKeys(mdblistApiKey, rpdbApiKeyToValidate) {
    try {
      const res = await fetch('/api/validate-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: mdblistApiKey, rpdbApiKey: rpdbApiKeyToValidate })
      });
      const validationResults = await res.json();

      const mdblistValid = validationResults.mdblist && validationResults.mdblist.valid;
      const rpdbValid = validationResults.rpdb && validationResults.rpdb.valid;

      state.userConfig.mdblistUsername = mdblistValid ? validationResults.mdblist.username : null;
      updateApiKeyUI(elements.apiKeyInput, mdblistApiKey, 'mdblist', state.userConfig.mdblistUsername, mdblistValid);
      updateApiKeyUI(elements.rpdbApiKeyInput, rpdbApiKeyToValidate, 'rpdb', null, rpdbValid);

      // Save current state of keys
      const saveResponse = await fetch(`/${state.configHash}/apikey`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: mdblistApiKey, rpdbApiKey: rpdbApiKeyToValidate })
      });
      const saveData = await saveResponse.json();
      if (saveData.success) {
        state.configHash = saveData.configHash;
        state.userConfig.apiKey = mdblistApiKey;
        state.userConfig.rpdbApiKey = rpdbApiKeyToValidate;
        updateURL();
        updateStremioButtonHref();
        showNotification('apiKeys', 'API keys updated.', 'success');
        if (mdblistValid || state.userConfig.traktAccessToken) await loadUserListsAndAddons();
      } else {
        throw new Error(saveData.error || "Failed to save API keys");
      }
    } catch (error) {
      console.error('API Key validation/save error:', error);
      showNotification('apiKeys', `Key Error: ${error.message}`, 'error');
    }
  }
  
  function updateApiKeyUI(inputElement, key, keyType, username = null, isValid = null) {
    const connectedDiv = keyType === 'mdblist' ? elements.mdblistConnected : elements.rpdbConnected;
    const connectedText = keyType === 'mdblist' ? elements.mdblistConnectedText : elements.rpdbConnectedText;
  
    if (key && isValid === true) {
      inputElement.style.display = 'none';
      connectedDiv.style.display = 'flex';
      connectedText.textContent = keyType === 'mdblist' ? `Connected as ${username}` : 'RPDB Key Valid';
    } else {
      inputElement.style.display = 'block';
      connectedDiv.style.display = 'none';
      inputElement.value = key || '';
      if (key && isValid === false) {
        inputElement.style.backgroundColor = 'rgba(244, 67, 54, 0.1)'; // Invalid
      } else {
        inputElement.style.backgroundColor = ''; // Neutral
      }
    }
  }

  function updateTraktUI(isConnected) {
    elements.traktLoginBtn.style.display = isConnected ? 'none' : 'block';
    elements.traktConnectedState.style.display = isConnected ? 'flex' : 'none';
    elements.traktPinContainer.style.display = 'none'; // Always hide PIN input initially
    if (!isConnected) elements.traktPin.value = '';
  }

  async function handleTraktPinSubmit() {
    const pin = elements.traktPin.value.trim();
    if (!pin) return showNotification('connections', 'Please enter your Trakt PIN', 'error');
    try {
      const response = await fetch(`/${state.configHash}/trakt/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pin })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || data.details || 'Trakt auth failed');
      
      state.configHash = data.configHash;
      state.userConfig.traktAccessToken = data.accessToken; // Assuming server sends back tokens
      state.userConfig.traktRefreshToken = data.refreshToken;
      state.userConfig.traktExpiresAt = data.expiresAt;
      updateURL();
      updateStremioButtonHref();
      updateTraktUI(true);
      showNotification('connections', 'Successfully connected to Trakt!', 'success');
      await loadUserListsAndAddons();
    } catch (error) {
      showNotification('connections', `Trakt Error: ${error.message}`, 'error');
    }
  }
  
  async function handleMDBListUrlImport() {
    const url = elements.mdblistUrlInput.value.trim();
    if (!url) return showNotification('import', 'Please enter an MDBList URL.', 'error');
    try {
      const response = await fetch(`/${state.configHash}/import-mdblist-url`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || data.details || 'Failed to import MDBList URL');
      
      state.configHash = data.configHash;
      // state.userConfig.importedAddons will be updated on next full config load or list load
      updateURL();
      updateStremioButtonHref();
      elements.mdblistUrlInput.value = '';
      showNotification('import', data.message || `Imported list successfully.`, 'success');
      await loadUserListsAndAddons();
    } catch (error) {
      showNotification('import', `MDBList Import Error: ${error.message}`, 'error');
    }
  }

  async function handleAddonImport() {
    const manifestUrl = elements.manifestUrlInput.value.trim();
    if (!manifestUrl) return showNotification('import', 'Please enter a manifest URL.', 'error');
    try {
      const response = await fetch(`/${state.configHash}/import-addon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestUrl })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || data.details || 'Failed to import addon');

      state.configHash = data.configHash;
      // state.userConfig.importedAddons will be updated
      updateURL();
      updateStremioButtonHref();
      elements.manifestUrlInput.value = '';
      showNotification('import', data.message || `${data.addon.name} imported.`, 'success');
      await loadUserListsAndAddons();
    } catch (error) {
      showNotification('import', `Addon Import Error: ${error.message}`, 'error');
    }
  }
  
  async function loadUserListsAndAddons() {
    if (!state.configHash) return;
    showNotification('lists', 'Loading lists...', 'info', true);
    try {
      const response = await fetch(`/${state.configHash}/lists`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to load lists from server');
      
      state.currentLists = data.lists || [];
      state.userConfig.importedAddons = data.importedAddons || {};
      state.userConfig.availableSortOptions = data.availableSortOptions || defaultConfig.availableSortOptions;
      state.userConfig.traktSortOptions = data.traktSortOptions || defaultConfig.traktSortOptions; // Make sure this is loaded

      // ** HANDLE NEW CONFIG HASH IF METADATA WAS UPDATED **
      if (data.newConfigHash && data.newConfigHash !== state.configHash) {
        console.log("Received new config hash from /lists, updating state:", data.newConfigHash);
        state.configHash = data.newConfigHash;
        updateURL();
        updateStremioButtonHref();
      }

      renderLists();
      renderImportedAddons();
      elements.listContainer.classList.remove('hidden');
      showNotification('lists', 'Lists loaded.', 'success');
    } catch (error) {
      console.error('Error loading lists/addons:', error);
      showNotification('lists', `List Load Error: ${error.message}`, 'error');
    }
  }

  function renderLists() {
    elements.listItems.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.currentLists.forEach(list => {
      if (!state.userConfig.removedLists.has(String(list.id))) {
        fragment.appendChild(createListItemElement(list));
      }
    });
    elements.listItems.appendChild(fragment);
    if (window.Sortable && elements.listItems.children.length > 0) {
      if (elements.listItems._sortable) elements.listItems._sortable.destroy();
      elements.listItems._sortable = Sortable.create(elements.listItems, {
        animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost', dragClass: 'sortable-drag',
        onEnd: handleListReorder
      });
    }
  }
  
  function createListItemElement(list) {
    const li = document.createElement('li');
    li.className = `list-item ${state.userConfig.hiddenLists.has(String(list.id)) ? 'hidden' : ''}`;
    li.dataset.id = String(list.id);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'list-item-content';
    
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle'; dragHandle.innerHTML = '☰';
    contentWrapper.appendChild(dragHandle);

    const mainCol = document.createElement('div');
    mainCol.className = 'list-item-main';

    const tag = document.createElement('span');
    tag.className = `tag ${list.tag?.toLowerCase() || 'l'}`; // Default tag
    if (list.tagImage) {
        const img = document.createElement('img'); img.src = list.tagImage; img.alt = list.addonName || list.tag;
        tag.appendChild(img);
    } else {
        tag.textContent = list.tag || 'L';
    }

    const nameContainer = document.createElement('div');
    nameContainer.className = 'name-container';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'list-name'; nameSpan.textContent = list.customName || list.name;
    nameContainer.appendChild(nameSpan);

    const editBtn = createButton('✏️', 'edit-button', () => startNameEditing(li, list), 'Edit List Name');
    
    let sortControls = null;
    const isTraktUserListOrWatchlist = list.isTraktList || list.isTraktWatchlist;
    const isMDBListType = !list.id.startsWith('trakt_') && // Not any Trakt list
                          !list.addonId;                 // Not an external addon (unless mdblist URL import)
    const isMDBListUrlImport = list.addonId && list.addonId.startsWith('mdblisturl_');
    
    
    if (isTraktUserListOrWatchlist || isMDBListType || isMDBListUrlImport) {
        sortControls = document.createElement('div');
        sortControls.className = 'sort-controls';
        const sortSelect = document.createElement('select');
        sortSelect.className = 'sort-select';
        
        const currentSortOptions = isTraktUserListOrWatchlist ? 
            (state.userConfig.traktSortOptions || defaultConfig.traktSortOptions) : 
            (state.userConfig.availableSortOptions || defaultConfig.availableSortOptions);
    
        let currentSortPref = list.sortPreferences;
        if (!currentSortPref) {
            currentSortPref = { 
                sort: isTraktUserListOrWatchlist ? 'rank' : 'imdbvotes', 
                order: isTraktUserListOrWatchlist ? 'asc' : 'desc' 
            };
            list.sortPreferences = currentSortPref; // Ensure it's set on the list object for immediate use
        }
        
        currentSortOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt.value; optionEl.textContent = opt.label;
            if (opt.value === currentSortPref.sort) optionEl.selected = true;
            sortSelect.appendChild(optionEl);
        });
        
        const orderToggleBtn = createButton(
            currentSortPref.order === 'desc' ? 'Desc.' : 'Asc.',
            'order-toggle-btn merge-toggle', // Re-use class for styling
            null, // Click handler will be set below
            'Toggle sort order'
        );
        
        const updateSortAndOrder = async (newSort, newOrder) => {
            // Optimistic UI update for order button
            orderToggleBtn.textContent = newOrder === 'desc' ? 'Desc.' : 'Asc.';
            // Update local list object immediately for consistency if re-rendered
            list.sortPreferences = { sort: newSort, order: newOrder };
            await updateListPreference(String(list.id), 'sort', { sort: newSort, order: newOrder });
        };
    
        orderToggleBtn.onclick = () => {
            const newOrder = orderToggleBtn.textContent === 'Desc.' ? 'asc' : 'desc';
            updateSortAndOrder(sortSelect.value, newOrder);
        };
        
        sortSelect.addEventListener('change', (e) => {
            updateSortAndOrder(e.target.value, list.sortPreferences.order);
        });
    
        sortControls.append(sortSelect, orderToggleBtn);
    }
    
    let mergeToggle = null;
    if (list.hasMovies === true && list.hasShows === true) {
      const isMerged = state.userConfig.mergedLists?.[String(list.id)] !== false; // Default to true
      mergeToggle = createButton(
          isMerged ? 'Merged' : 'Split',
          `merge-toggle ${isMerged ? 'merged' : 'split'}`,
          async () => {
              const newMergedState = !isMerged;
              // Optimistically update UI
              mergeToggle.textContent = newMergedState ? 'Merged' : 'Split';
              mergeToggle.className = `merge-toggle ${newMergedState ? 'merged' : 'split'}`;
              mergeToggle.title = newMergedState ? 'Click to split' : 'Click to merge';
              if (state.userConfig.mergedLists) state.userConfig.mergedLists[String(list.id)] = newMergedState;
              await updateListPreference(String(list.id), 'merge', { merged: newMergedState });
          },
          isMerged ? 'Click to split this list into separate Movie and Series catalogs' : 'Click to merge this list into a single "All" catalog'
      );
  }
  
    const visibilityToggleBtn = createButton(
        `<span class="eye-icon ${state.userConfig.hiddenLists.has(String(list.id)) ? 'eye-closed' : 'eye-open'}"></span>`,
        'visibility-toggle', 
        () => toggleListVisibility(li, String(list.id)),
        state.userConfig.hiddenLists.has(String(list.id)) ? 'Show in Main View' : 'Hide from Main View'
    );
    const removeBtn = createButton('❌', 'remove-list-button', () => removeListItem(li, String(list.id)), 'Remove List');

    // Assemble based on mobile or desktop
    if (state.isMobile) {
        const topRow = document.createElement('div'); topRow.className = 'list-item-row list-item-row-top';
        topRow.append(tag, nameContainer, editBtn);
        const bottomRow = document.createElement('div'); bottomRow.className = 'list-item-row list-item-row-bottom';
        if (sortControls) bottomRow.appendChild(sortControls);
        if (mergeToggle) bottomRow.appendChild(mergeToggle);
        bottomRow.append(visibilityToggleBtn, removeBtn);
        mainCol.append(topRow, bottomRow);
    } else {
        const desktopRow = document.createElement('div'); desktopRow.className = 'list-item-row list-item-row-desktop';
        desktopRow.append(tag, nameContainer, editBtn);
        if (sortControls) desktopRow.appendChild(sortControls);
        if (mergeToggle) desktopRow.appendChild(mergeToggle);
        desktopRow.append(visibilityToggleBtn, removeBtn);
        mainCol.appendChild(desktopRow);
    }
    
    contentWrapper.appendChild(mainCol);
    li.appendChild(contentWrapper);
    return li;
  }

  function createButton(htmlOrText, className, onClick, title = '') {
    const btn = document.createElement('button');
    btn.type = 'button'; // Important for forms
    btn.className = className;
    btn.innerHTML = htmlOrText;
    if (title) btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }
  
  const debouncedSaveListOrder = debounce(async (order) => {
    await updateListPreference(null, 'order', { order });
  }, 1000);

  function handleListReorder(evt) {
    const items = Array.from(elements.listItems.querySelectorAll('.list-item'));
    const order = items.map(item => String(item.dataset.id).replace(/^aiolists-/, '').replace(/-[ELW]$/, '')); // Get original ID
    debouncedSaveListOrder(order);
  }

  function startNameEditing(listItemElement, list) {
    const nameSpan = listItemElement.querySelector('.list-name');
    const currentName = list.customName || list.name;
    const nameContainer = nameSpan.parentElement; // .name-container
    
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'edit-name-input'; input.value = currentName;
    
    const saveBtn = createButton('✓', 'save-name-btn', handleSave);
    const cancelBtn = createButton('✕', 'cancel-name-btn', handleCancel);
    const actionsDiv = document.createElement('div'); actionsDiv.className = 'actions';
    actionsDiv.append(saveBtn, cancelBtn);

    nameContainer.innerHTML = ''; // Clear current name
    nameContainer.append(input, actionsDiv);
    input.focus(); input.select();

    async function handleSave() {
        const newName = input.value.trim();
        await updateListPreference(String(list.id), 'name', { customName: newName });
        // Optimistically update or re-render item
        list.customName = newName; 
        const updatedLi = createListItemElement(list); // Re-create to restore structure
        listItemElement.replaceWith(updatedLi);
    }
    function handleCancel() {
        const originalLi = createListItemElement(list); // Re-create to restore structure
        listItemElement.replaceWith(originalLi);
    }
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
        else if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
    });
  }
  
  async function toggleListVisibility(listItemElement, listId) {
    const isHidden = state.userConfig.hiddenLists.has(listId);
    const newHiddenState = !isHidden;
    if (newHiddenState) state.userConfig.hiddenLists.add(listId);
    else state.userConfig.hiddenLists.delete(listId);
    
    listItemElement.classList.toggle('hidden', newHiddenState);
    const eyeIcon = listItemElement.querySelector('.eye-icon');
    if (eyeIcon) eyeIcon.className = `eye-icon ${newHiddenState ? 'eye-closed' : 'eye-open'}`;
    
    await updateListPreference(null, 'visibility', { hiddenLists: Array.from(state.userConfig.hiddenLists) });
  }

  async function removeListItem(listItemElement, listId) {
    if (!confirm(`Are you sure you want to remove the list "${listItemElement.querySelector('.list-name').textContent}"?`)) return;
    
    state.userConfig.removedLists.add(listId);
    listItemElement.style.opacity = '0';
    listItemElement.style.transform = 'scaleY(0)';
    listItemElement.style.height = '0';
    listItemElement.style.margin = '0';
    listItemElement.style.padding = '0';
    listItemElement.style.transition = 'all 0.3s ease-out';
    setTimeout(() => listItemElement.remove(), 300);
    
    await updateListPreference(null, 'remove', { listIds: [listId] });
  }

  async function updateListPreference(listId, type, payload) {
    const endpointMap = {
      name: `/${state.configHash}/lists/names`,
      visibility: `/${state.configHash}/lists/visibility`,
      remove: `/${state.configHash}/lists/remove`,
      order: `/${state.configHash}/lists/order`,
      sort: `/${state.configHash}/lists/sort`,
      merge: `/${state.configHash}/lists/merge`,
    };
    const endpoint = endpointMap[type];
    if (!endpoint) {
      console.error("Unknown preference type:", type);
      return;
    }

    let body = payload;
    if (listId && type !== 'order' && type !== 'visibility' && type !== 'remove') { // Single list specific updates often need listId in body
      body = { listId, ...payload };
    }
    
    showNotification('lists', 'Saving changes...', 'info', true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || `Failed to update ${type}`);
      
      state.configHash = data.configHash;
      updateURL();
      updateStremioButtonHref();
      showNotification('lists', `${type.charAt(0).toUpperCase() + type.slice(1)} updated.`, 'success');
      // Optionally, update local state more precisely if needed for immediate complex UI changes
      // For simple cases, a full list reload might be acceptable or createListItemElement handles it
    } catch (error) {
      console.error(`Error updating ${type}:`, error);
      showNotification('lists', `Update Error: ${error.message}`, 'error');
      // Potentially revert optimistic UI changes if any were made
    }
  }

  function renderImportedAddons() {
    const addons = state.userConfig.importedAddons;
    elements.addonsList.innerHTML = '';
    if (!addons || Object.keys(addons).length === 0) {
      elements.importedAddonsContainer.classList.add('hidden');
      return;
    }
    elements.importedAddonsContainer.classList.remove('hidden');
    Object.values(addons).forEach(addon => {
      const item = document.createElement('div');
      item.className = 'addon-item';
      item.innerHTML = `
        <div class="addon-info">
          ${addon.logo ? `<img src="${addon.logo}" alt="${addon.name}" class="addon-logo">` : ''}
          <div class="addon-details">
            <span class="addon-name">${addon.name.split(' - ')[1] || addon.name}</span>
            <span class="addon-version">${addon.version}</span>
            <span class="list-count">${addon.catalogs.length} list${addon.catalogs.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <button class="remove-addon" data-addon-id="${addon.id}">Remove</button>
      `;
      item.querySelector('.remove-addon').addEventListener('click', () => removeImportedAddon(addon.id));
      elements.addonsList.appendChild(item);
    });
  }

  async function removeImportedAddon(addonId) {
    if (!confirm("Are you sure you want to remove this imported addon?")) return;
    try {
      const response = await fetch(`/${state.configHash}/remove-addon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addonId })
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to remove addon');

      state.configHash = data.configHash;
      delete state.userConfig.importedAddons[addonId]; // Update local state
      updateURL();
      updateStremioButtonHref();
      renderImportedAddons(); // Re-render the addons list
      await loadUserListsAndAddons(); // Reload main lists as they might be affected
      showNotification('import', 'Addon removed.', 'success');
    } catch (error) {
      showNotification('import', `Remove Addon Error: ${error.message}`, 'error');
    }
  }
  
  function updateStremioButtonHref() {
    if (state.configHash && elements.updateStremioBtn) {
      const baseUrl = `stremio://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`;
      elements.updateStremioBtn.href = `${baseUrl}/${state.configHash}/manifest.json`;
    }
  }

  async function copyManifestUrlToClipboard() {
    if (!elements.updateStremioBtn || !elements.updateStremioBtn.href) return;
    try {
      await navigator.clipboard.writeText(elements.updateStremioBtn.href);
      const originalContent = elements.copyManifestBtn.innerHTML;
      elements.copyManifestBtn.innerHTML = '<span>Copied!</span>';
      elements.copyManifestBtn.disabled = true;
      setTimeout(() => {
        elements.copyManifestBtn.innerHTML = originalContent;
        elements.copyManifestBtn.disabled = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy manifest URL:', err);
      showNotification('apiKeys', 'Failed to copy URL.', 'error'); // Use a relevant notification area
    }
  }
  
  function showNotification(section, message, type = 'info', persistent = false) {
    const notificationElement = elements[`${section}Notification`];
    if (!notificationElement) return;
    notificationElement.textContent = message;
    notificationElement.className = `section-notification ${type}`; // Ensure CSS handles this
    notificationElement.style.display = 'block'; // Make visible
    if (!persistent) {
      setTimeout(() => { notificationElement.style.display = 'none'; }, 3000);
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => { clearTimeout(timeout); func(...args); };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Global disconnect functions
  window.disconnectMDBList = async function() {
    updateApiKeyUI(elements.apiKeyInput, '', 'mdblist'); // Optimistic UI update
    await validateAndSaveApiKeys('', elements.rpdbApiKeyInput.value.trim()); // Save empty key
    state.userConfig.apiKey = ''; // Ensure local state is also cleared
    await loadUserListsAndAddons(); // Reload lists
  };
  window.disconnectRPDB = async function() {
    updateApiKeyUI(elements.rpdbApiKeyInput, '', 'rpdb');
    await validateAndSaveApiKeys(elements.apiKeyInput.value.trim(), '');
    state.userConfig.rpdbApiKey = '';
  };
  window.disconnectTrakt = async function() {
    try {
        const response = await fetch(`/${state.configHash}/trakt/disconnect`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to disconnect Trakt');
        state.configHash = data.configHash;
        state.userConfig.traktAccessToken = null; state.userConfig.traktRefreshToken = null; state.userConfig.traktExpiresAt = null;
        updateURL(); updateStremioButtonHref();
        updateTraktUI(false);
        showNotification('connections', 'Disconnected from Trakt.', 'success');
        await loadUserListsAndAddons();
    } catch (error) {
        showNotification('connections', `Trakt Disconnect Error: ${error.message}`, 'error');
    }
  };

  init();
});