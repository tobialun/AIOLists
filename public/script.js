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
    isFirstTimeSetup: window.isFirstTimeSetup === true,
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
    manifestUrlInput: document.getElementById('manifestUrl'),
    importAddonBtn: document.getElementById('importAddon'),
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
        }
      } catch (error) {
        console.error('Failed to create configuration:', error);
      }
      return; // Exit early if at root URL
    }

    state.configHash = pathParts[0];

    if (state.isFirstTimeSetup) {
      showWelcomeMessage();
    }
  
    initStremioButton();
    initEventListeners();
    updateAddonStyles();
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
    elements.traktLoginBtn?.addEventListener('click', () => elements.traktPinContainer.style.display = 'block');
    elements.submitTraktPin?.addEventListener('click', handleTraktPinSubmission);
    elements.importAddonBtn?.addEventListener('click', handleAddonImport);
    elements.importMDBListBtn?.addEventListener('click', async function() {
      const mdblistUrl = elements.mdblistUrl.value.trim();
      if (!mdblistUrl) {
        showStatus('Please enter a MDBList URL', 'error');
        return;
      }
      
      try {
        showStatus('Importing MDBList...', 'info');
        
        // Import both movie and series catalogs
        const response = await fetch(`/api/config/${state.configHash}/import-mdblist-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            url: mdblistUrl,
            types: ['movie', 'series']
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
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = list.customName || list.name;
    
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-name-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit list name';
    editBtn.onclick = () => startEditingName(nameContainer, list);
    
    nameContainer.append(nameSpan, editBtn);
    
    const badge = document.createElement('span');
    badge.className = `badge badge-${list.listType || 'L'}`;
    badge.textContent = list.listType || 'L';
    
    const visibilityToggle = document.createElement('button');
    visibilityToggle.className = 'visibility-toggle';
    visibilityToggle.setAttribute('data-id', listId);
    visibilityToggle.innerHTML = isHidden ? 
      '<span class="eye-icon eye-closed"></span>' : 
      '<span class="eye-icon eye-open"></span>';
    
    li.append(dragHandle, nameContainer, badge, visibilityToggle);
    return li;
  }

  function initSortable() {
    if (window.Sortable) {
      Sortable.create(elements.listItems, {
        animation: 150,
        handle: '.drag-handle',
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
        container.append(nameSpan, editBtn);
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
    
    container.append(input, saveBtn, cancelBtn);
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

  async function removeAddon(addonId) {
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
        showSectionNotification('import', 'Addon removed successfully ✅');
        await loadLists();
      } else {
        throw new Error(data.error || 'Failed to remove addon');
      }
    } catch (error) {
      showStatus(`Failed to remove addon: ${error.message}`, 'error');
    }
  }

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

  function showWelcomeMessage() {
    const welcomeMessage = document.createElement('div');
    welcomeMessage.className = 'welcome-message';
    welcomeMessage.innerHTML = `
      <h2>Welcome to AIOLists! 🎉</h2>
      <p>To get started, you'll need to:</p>
      <ol>
        <li>Enter your MDBList API key</li>
        <li>Optionally add your RPDB API key for better poster support</li>
        <li>Connect your Trakt account if you want to include your Trakt lists</li>
      </ol>
      <button onclick="this.parentElement.remove()">Got it!</button>
    `;
    document.body.insertBefore(welcomeMessage, document.body.firstChild);
  }

  function updateAddonStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .addon-list { background: #2c3e50; }
      .addon-list .list-name { color: #ecf0f1; }
      .addon-tag { background: #34495e; color: #ecf0f1; }
    `;
    document.head.appendChild(style);
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
      
      const addonHtml = `
        <div class="addon-info">
          ${addon.logo ? `<img src="${addon.logo}" alt="${addon.name}" class="addon-logo">` : ''}
          <div>
            <span class="addon-name">${addon.name}</span>
            <span class="addon-version">${addon.version || ''}</span>
            <div>${addon.catalogs.length} list${addon.catalogs.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <button class="remove-addon" onclick="removeAddon('${addon.id}')">Remove</button>
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

  // Initialize the application
  init();
});