document.addEventListener('DOMContentLoaded', function() {
  // ==================== STATE MANAGEMENT ====================
  const state = {
    configHash: null,
    userConfig: {
      listOrder: [],
      hiddenLists: new Set(),
      listsMetadata: {},
      lastUpdated: null
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
        
        // Convert hiddenLists to Set for easier lookup
        state.userConfig.hiddenLists = new Set(state.userConfig.hiddenLists || []);
        
        // Update list items
        elements.listItems.innerHTML = '';
        const fragment = document.createDocumentFragment();
        
        state.currentLists.forEach(list => {
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
    const listId = String(list.id);
    const isHidden = state.userConfig.hiddenLists.has(listId);
    
    const li = document.createElement('li');
    li.className = 'list-item';
    li.setAttribute('data-id', listId);
    if (isHidden) li.classList.add('hidden');
    
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '☰';
    
    const nameContainer = document.createElement('div');
    nameContainer.className = 'list-name';
    
    let listIdentifier;
    
    if (list.addonId?.startsWith('mdblist_')) {
      // For MDBList items
      listIdentifier = document.createElement('img');
      listIdentifier.className = 'list-logo';
      listIdentifier.src = 'https://mdblist.com/static/mdblist_logo.png';
      listIdentifier.alt = 'MDBList';
    } else if (list.addonLogo) {
      // For other addon items with logo
      listIdentifier = document.createElement('img');
      listIdentifier.className = 'list-logo';
      listIdentifier.src = list.addonLogo;
      listIdentifier.alt = list.addonName || 'Addon Logo';
    } else if (list.listType === 'T') {
      // For Trakt lists
      listIdentifier = document.createElement('img');
      listIdentifier.className = 'list-logo';
      listIdentifier.src = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
      listIdentifier.alt = 'Trakt.tv';
    } else {
      // For regular lists, use letter badges
      listIdentifier = document.createElement('div');
      listIdentifier.className = `list-type-badge list-type-${list.listType || 'L'}`;
      listIdentifier.textContent = list.listType || 'L';
    }
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = list.customName || list.name;
    
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-name-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit list name';
    editBtn.onclick = () => startEditingName(nameContainer, list);
    
    nameContainer.append(listIdentifier, nameSpan, editBtn);
    
    const visibilityToggle = document.createElement('button');
    visibilityToggle.className = 'visibility-toggle';
    visibilityToggle.setAttribute('data-id', listId);
    visibilityToggle.innerHTML = isHidden ? 
      '<span class="eye-icon eye-closed"></span>' : 
      '<span class="eye-icon eye-open"></span>';
    
    li.append(dragHandle, nameContainer, visibilityToggle);
    return li;
  }

  function initSortable() {
    if (window.Sortable) {
      Sortable.create(elements.listItems, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: async (evt) => {
          const items = elements.listItems.querySelectorAll('.list-item');
          const order = Array.from(items).map(item => item.dataset.id);
          await saveListOrder(order);
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

  async function startEditingName(container, list) {
    const currentName = list.customName || list.name;
    const originalContent = container.innerHTML;
    
    container.innerHTML = '';
    
    // Create and add the list identifier (logo or badge)
    let listIdentifier;
    if (list.addonId?.startsWith('mdblist_')) {
      listIdentifier = document.createElement('img');
      listIdentifier.className = 'list-logo';
      listIdentifier.src = 'https://mdblist.com/static/mdblist_logo.png';
      listIdentifier.alt = 'MDBList';
    } else if (list.addonLogo) {
      listIdentifier = document.createElement('img');
      listIdentifier.className = 'list-logo';
      listIdentifier.src = list.addonLogo;
      listIdentifier.alt = list.addonName || 'Addon Logo';
    } else if (list.listType === 'T') {
      listIdentifier = document.createElement('img');
      listIdentifier.className = 'list-logo';
      listIdentifier.src = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
      listIdentifier.alt = 'Trakt.tv';
    } else {
      listIdentifier = document.createElement('div');
      listIdentifier.className = `list-type-badge list-type-${list.listType || 'L'}`;
      listIdentifier.textContent = list.listType || 'L';
    }
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-name-input';
    input.value = currentName;
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-name-btn';
    saveBtn.textContent = '✓';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel-name-btn';
    cancelBtn.textContent = '✕';
    
    const handleSave = async () => {
      const newName = input.value.trim();
      const success = await updateListName(list.id, newName);
      if (success) {
        const nameSpan = document.createElement('span');
        nameSpan.textContent = newName || list.name;
        
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-name-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit list name';
        editBtn.onclick = () => startEditingName(container, { ...list, customName: newName });
        
        container.innerHTML = '';
        container.append(listIdentifier, nameSpan, editBtn);
      } else {
        container.innerHTML = originalContent;
      }
    };
    
    const handleCancel = () => {
      container.innerHTML = originalContent;
      const editBtn = container.querySelector('.edit-name-btn');
      if (editBtn) {
        editBtn.onclick = () => startEditingName(container, list);
      }
    };
    
    saveBtn.onclick = handleSave;
    cancelBtn.onclick = handleCancel;
    
    // Handle Enter and Escape keys
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    });
    
    container.append(listIdentifier, input, saveBtn, cancelBtn);
    input.focus();
    input.select();
  }

  async function toggleListVisibility(event) {
    const toggleEl = event.currentTarget;
    const listId = String(toggleEl.dataset.id);
    const listItem = document.querySelector(`.list-item[data-id="${listId}"]`);
    const eyeIcon = toggleEl.querySelector('.eye-icon');
    
    const isCurrentlyHidden = listItem.classList.contains('hidden');
    const newHiddenState = !isCurrentlyHidden;
    
    listItem.classList.toggle('hidden', newHiddenState);
    eyeIcon.className = `eye-icon ${newHiddenState ? 'eye-closed' : 'eye-open'}`;
    
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

  async function saveListOrder(order) {
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

  // Initialize the application
  init();
});