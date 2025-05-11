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
    
    // Section notifications
    apiKeysNotification: document.getElementById('apiKeysNotification'),
    connectionsNotification: document.getElementById('connectionsNotification'),
    importNotification: document.getElementById('importNotification'),
    listsNotification: document.getElementById('listsNotification')
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
    elements.saveButton.addEventListener('click', saveApiKeys);
    elements.traktLoginBtn?.addEventListener('click', () => elements.traktPinContainer.style.display = 'block');
    elements.submitTraktPin?.addEventListener('click', handleTraktPinSubmission);
    elements.importAddonBtn?.addEventListener('click', handleAddonImport);
  }

  // ==================== CONFIGURATION MANAGEMENT ====================
  async function loadConfiguration() {
    if (!state.configHash) return;

    try {
      const response = await fetch(`/${state.configHash}/config`);
      const data = await response.json();
      
      if (data.success) {
        state.userConfig = data.config;
        elements.apiKeyInput.value = state.userConfig.apiKey || '';
        elements.rpdbApiKeyInput.value = state.userConfig.rpdbApiKey || '';
        
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
  async function saveApiKeys() {
    const apiKey = elements.apiKeyInput.value.trim();
    const rpdbApiKey = elements.rpdbApiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('Please enter your MDBList API key', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/config/${state.configHash}/apikey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, rpdbApiKey })
      });

      const data = await response.json();
      if (data.success) {
        state.configHash = data.configHash;
        updateURL();
        showSectionNotification('apiKeys', 'API keys saved successfully ✅');
        await loadLists();
      } else {
        showStatus('Failed to save API keys', 'error');
      }
    } catch (error) {
      showStatus('Failed to save API keys', 'error');
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

  // Initialize the application
  init();
});