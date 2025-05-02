document.addEventListener('DOMContentLoaded', function() {
  // ==================== STATE MANAGEMENT ====================
  const state = {
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
  function init() {
    if (state.isFirstTimeSetup) {
      showWelcomeMessage();
    }
  
    initStremioButton();
    initEventListeners();
    updateAddonStyles();
    loadApiKeys();
  }

  function initStremioButton() {
    const updateButton = () => {
      const baseUrl = `stremio://${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`;
      elements.updateStremioBtn.href = `${baseUrl}/manifest.json?t=${Date.now()}`;
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

  // ==================== API KEYS MANAGEMENT ====================
  async function loadApiKeys() {
    try {
      const [apiKeyData, rpdbData, traktData, configData] = await Promise.all([
        fetch('/api/config/apikey').then(r => r.json()),
        fetch('/api/config/rpdbkey').then(r => r.json()),
        fetch('/api/config/trakt').then(r => r.json()),
        fetch('/api/config/all').then(r => r.json())
      ]);

      if (apiKeyData.apiKey) {
        elements.apiKeyInput.value = apiKeyData.apiKey;
        await loadLists();
      }

      if (rpdbData.rpdbApiKey) {
        elements.rpdbApiKeyInput.value = rpdbData.rpdbApiKey;
      }

      if (elements.traktLoginBtn) {
        elements.traktLoginBtn.href = traktData.authUrl || '/api/trakt/login';
      }

      updateTraktStatus(traktData);
      state.userConfig = configData;
      state.userConfig.hiddenLists = new Set(configData.hiddenLists || []);
    } catch (error) {
      showStatus('Failed to load configuration', 'error');
    }
  }

  async function saveApiKeys() {
    const apiKey = elements.apiKeyInput.value.trim();
    const rpdbApiKey = elements.rpdbApiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('Please enter your MDBList API key', 'error');
      return;
    }

    try {
      const [apiKeyResult, rpdbResult] = await Promise.all([
        fetch('/api/config/apikey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey })
        }).then(r => r.json()),
        rpdbApiKey ? fetch('/api/config/rpdbkey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rpdbApiKey })
        }).then(r => r.json()) : Promise.resolve({ success: true })
      ]);

      if (apiKeyResult.success && rpdbResult.success) {
        showSectionNotification('apiKeys', 'API keys saved successfully ✅');
        await loadLists();
        await refreshManifest();
      } else {
        showStatus('Failed to save one or more API keys', 'error');
      }
    } catch (error) {
      showStatus('Failed to save API keys', 'error');
    }
  }

  // ==================== LIST MANAGEMENT ====================
  async function loadLists() {
    elements.listContainer.classList.remove('hidden');
    elements.loading.classList.remove('hidden');
    elements.listItems.innerHTML = '';

    try {
      const [configData, listsData] = await Promise.all([
        fetch('/api/config/all').then(r => r.json()),
        fetch('/api/lists').then(r => r.json())
      ]);

      state.userConfig = configData;
      state.userConfig.hiddenLists = new Set(configData.hiddenLists || []);
      
      if (listsData.importedAddons) {
        state.addons = listsData.importedAddons;
      }

      if (listsData.lists?.length) {
        state.currentLists = listsData.lists;
        renderLists(listsData.lists);
        renderImportedAddons(listsData.importedAddons);
      } else {
        elements.listItems.innerHTML = '<p>No lists found. Make sure your API key is correct.</p>';
      }
    } catch (error) {
      elements.listItems.innerHTML = '<p>Failed to load lists</p>';
    } finally {
        elements.loading.classList.add('hidden');
    }
  }

  function renderLists(lists) {
    elements.listItems.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    lists.forEach(list => {
      const li = createListItem(list);
      fragment.appendChild(li);
    });

    elements.listItems.appendChild(fragment);

    initSortable();
    initVisibilityToggles();
  }

  function createListItem(list) {
    const listId = String(list.id);
    
    const li = document.createElement('li');
    li.className = 'list-item';
    li.setAttribute('data-id', listId);
    
    if (list.addonId) {
      li.setAttribute('data-addon-id', list.addonId);
      li.setAttribute('data-original-id', list.originalId || '');
    }

    const dragHandle = createDragHandle();
    const nameContainer = createNameContainer(list);
    const badge = createBadge(list);
    const visibilityToggle = createVisibilityToggle(listId);

    li.append(dragHandle, nameContainer, badge, visibilityToggle);

    if (state.userConfig.hiddenLists.has(listId)) {
      li.classList.add('hidden');
    }

    return li;
  }

  function createDragHandle() {
    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.innerHTML = '☰';
    return handle;
  }

  function createNameContainer(list) {
    const container = document.createElement('div');
    container.className = 'list-name';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = list.customName || list.name;
    
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-name-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit list name';
    editBtn.onclick = () => startEditingName(container, list);

    container.append(nameSpan, editBtn);
    return container;
  }

  function createBadge(list) {
    const badge = document.createElement('span');
    
    if (list.listType === 'A' && list.tagImage) {
      badge.className = 'badge';
      const img = document.createElement('img');
      img.src = list.tagImage;
      img.alt = list.addonName || 'Addon';
      img.width = 16;
      img.height = 16;
      img.onerror = () => {
        badge.textContent = 'A';
        badge.className = 'badge badge-A';
      };
      badge.appendChild(img);
    } else {
      badge.className = `badge badge-${list.listType}`;
      badge.textContent = list.listType || 'L';
    }
    
    return badge;
  }

  function createVisibilityToggle(listId) {
    const toggle = document.createElement('button');
    toggle.className = 'visibility-toggle';
    toggle.setAttribute('data-id', listId);
    toggle.innerHTML = state.userConfig.hiddenLists.has(listId) ? 
      '<span class="eye-icon eye-closed"></span>' : 
      '<span class="eye-icon eye-open"></span>';
    return toggle;
  }

  function initSortable() {
    Sortable.create(elements.listItems, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      onEnd: saveListOrder
    });
  }
    
  function initVisibilityToggles() {
    document.querySelectorAll('.visibility-toggle').forEach(toggle => {
      toggle.addEventListener('click', toggleListVisibility);
    });
  }

  // ==================== LIST OPERATIONS ====================
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
    
    saveBtn.onclick = async () => {
      const newName = input.value.trim();
      const success = await updateListName(list.id, newName);
      if (success) {
        const nameSpan = document.createElement('span');
        nameSpan.textContent = newName;
        
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-name-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit list name';
        editBtn.onclick = () => startEditingName(container, { ...list, customName: newName });
        
        container.innerHTML = '';
        container.append(nameSpan, editBtn);
        
        await loadLists();
      } else {
        container.innerHTML = originalContent;
      }
    };
    
    cancelBtn.onclick = () => {
      container.innerHTML = originalContent;
      const editBtn = container.querySelector('.edit-name-btn');
      if (editBtn) {
        editBtn.onclick = () => startEditingName(container, list);
      }
    };
    
    container.append(input, saveBtn, cancelBtn);
    input.focus();
    input.select();
  }

  async function updateListName(listId, newName) {
    try {
      const response = await fetch('/api/lists/names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          listId: String(listId), 
          customName: newName 
        })
      });
      
      if (!response.ok) throw new Error('Failed to update list name');
      
      showSectionNotification('lists', 'List name updated successfully ✅');
      
      const listIndex = state.currentLists.findIndex(list => String(list.id) === String(listId));
      if (listIndex !== -1) {
        state.currentLists[listIndex].customName = newName;
      }
      
      return true;
    } catch (error) {
      showStatus('Failed to update list name', 'error');
      return false;
    }
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
      const response = await fetch('/api/lists/visibility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenLists })
      });

      if (!response.ok) throw new Error('Failed to save visibility settings');
      
      const data = await response.json();
      if (data.success) {
        showSectionNotification('lists', 'Visibility Changes Saved ✅');
        
        state.currentLists.forEach(list => {
          const id = String(list.id);
          list.isHidden = state.userConfig.hiddenLists.has(id);
        });
        
        await refreshManifest();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      showStatus(`Failed to save visibility settings: ${error.message}`, 'error');
    }
  }

  async function saveListOrder() {
    const items = elements.listItems.querySelectorAll('.list-item');
    const order = Array.from(items).map(item => String(item.dataset.id));
    
    showSectionNotification('lists', 'Saving order changes...', true);
    
    try {
      const response = await fetch('/api/lists/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });

      if (!response.ok) throw new Error('Failed to save list order');
      
      const data = await response.json();
      if (data.success) {
        showSectionNotification('lists', 'Order Changes Saved ✅');
        
        const newOrder = {};
        order.forEach((id, index) => {
          newOrder[id] = index;
        });
        
        state.currentLists.sort((a, b) => {
          const aOrder = newOrder[String(a.id)] ?? Number.MAX_SAFE_INTEGER;
          const bOrder = newOrder[String(b.id)] ?? Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder;
        });
        
        // Re-render the lists with the new order
        renderLists(state.currentLists);
        
        // Refresh the manifest to apply changes
        await refreshManifest();
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      showStatus(`Failed to save list order: ${error.message}`, 'error');
    }
  }

  // ==================== ADDON MANAGEMENT ====================
  async function handleAddonImport() {
    const manifestUrl = elements.manifestUrlInput.value.trim();
    
    if (!manifestUrl) {
      showStatus('Please enter a manifest URL', 'error');
      return;
    }

    elements.importStatus.textContent = 'Importing addon...';
    elements.importStatus.className = 'status info';
    elements.importStatus.classList.remove('hidden');

    try {
      const response = await fetch('/api/import-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl })
      });

      const data = await response.json();
      if (response.ok) {
        showSectionNotification('import', data.message || 'Addon imported successfully ✅');
        elements.manifestUrlInput.value = '';
        await loadLists();
      } else {
        throw new Error(data.error || 'Failed to import addon');
      }
    } catch (error) {
      showStatus(error.message, 'error');
    } finally {
      elements.importStatus.classList.add('hidden');
    }
  }

  function renderImportedAddons(addons) {
    const addonsContainer = document.getElementById('importedAddons');
    const addonsList = document.getElementById('addonsList');
    
    if (!addons || Object.keys(addons).length === 0) {
      addonsContainer.classList.add('hidden');
      return;
    }

    addonsContainer.classList.remove('hidden');
    addonsList.innerHTML = '';

    Object.values(addons).forEach(addon => {
      const addonElement = createAddonElement(addon);
      addonsList.appendChild(addonElement);
    });

    initAddonRemoveButtons();
  }

  function createAddonElement(addon) {
    const element = document.createElement('div');
    element.className = 'addon-item';
    
    const logoUrl = addon.logo || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2Yzc1N2QiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTZWOGE0IDQgMCAwIDAtNC00SDdhNCA0IDAgMCAwLTQgNHY4YTQgNCAwIDAgMCA0IDRoMTBhNCA0IDAgMCAwIDQtNHoiPjwvcGF0aD48bGluZSB4MT0iMTIiIHkxPSI5IiB4Mj0iMTIiIHkyPSIxNSI+PC9saW5lPjxsaW5lIHgxPSI5IiB5MT0iMTIiIHgyPSIxNSIgeTI9IjEyIj48L2xpbmU+PC9zdmc+';
    
    element.innerHTML = `
      <img src="${logoUrl}" alt="${addon.name}" class="addon-logo" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM2Yzc1N2QiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjEgMTZWOGE0IDQgMCAwIDAtNC00SDdhNCA0IDAgMCAwLTQgNHY4YTQgNCAwIDAgMCA0IDRoMTBhNCA0IDAgMCAwIDQtNHoiPjwvcGF0aD48bGluZSB4MT0iMTIiIHkxPSI5IiB4Mj0iMTIiIHkyPSIxNSI+PC9saW5lPjxsaW5lIHgxPSI5IiB5MT0iMTIiIHgyPSIxNSIgeTI9IjEyIj48L2xpbmU+PC9zdmc+'" />
      <div class="addon-info">
        <div style="display: flex; align-items: center;">
          <span class="addon-name" style="font-weight: bold; margin-right: 8px;">
            ${addon.name}
          </span>
          <small style="color:#666; font-size:0.9em;">${addon.catalogs.length} catalog${addon.catalogs.length !== 1 ? 's' : ''}</small>
        </div>
      </div>
      <button class="remove-addon" data-addon-id="${addon.id}" style="background:#f44336; color:white; border:none; border-radius:4px; padding:4px 8px; cursor:pointer;">Remove</button>
    `;

    return element;
  }

  function initAddonRemoveButtons() {
    document.querySelectorAll('.remove-addon').forEach(button => {
      button.addEventListener('click', handleAddonRemoval);
    });
  }

  async function handleAddonRemoval(event) {
    const addonId = event.target.dataset.addonId;
    
    try {
      const response = await fetch('/api/remove-addon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addonId })
      });

      const data = await response.json();
      if (data.success) {
        showSectionNotification('import', 'Addon removed successfully ✅');
        await loadLists();
      } else {
        throw new Error(data.error || 'Failed to remove addon');
      }
    } catch (error) {
      showStatus(error.message, 'error');
    }
  }

  // ==================== TRAKT INTEGRATION ====================
  async function handleTraktPinSubmission() {
    const pin = elements.traktPin.value.trim();
    if (!pin) {
      showStatus('Please enter the Trakt PIN', 'error');
      return;
    }

    try {
      const response = await fetch('/api/config/trakt/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pin })
      });

      const data = await response.json();
      if (data.success) {
        showSectionNotification('connections', 'Successfully connected to Trakt! ✅');
        elements.traktPinContainer.style.display = 'none';
        
        // Immediately update UI with the connected button
        if (elements.traktLoginBtn) {
          const connectedBtn = document.createElement('span');
          connectedBtn.className = 'trakt-connected-btn';
          connectedBtn.textContent = 'Connected to Trakt.tv';
          elements.traktLoginBtn.parentNode.replaceChild(connectedBtn, elements.traktLoginBtn);
        }
        
        elements.traktStatus.innerHTML = '';
        await loadLists();
      } else {
        throw new Error(data.error || 'Failed to connect to Trakt');
      }
    } catch (error) {
      showStatus(error.message, 'error');
    }
  }

  function updateTraktStatus(traktData) {
    if (!elements.traktStatus) return;

    if (traktData.hasAccessToken) {
      // Replace the login button with a connected button
      if (elements.traktLoginBtn) {
        const connectedBtn = document.createElement('span');
        connectedBtn.className = 'trakt-connected-btn';
        connectedBtn.textContent = 'Connected to Trakt.tv';
        elements.traktLoginBtn.parentNode.replaceChild(connectedBtn, elements.traktLoginBtn);
      }
      
      // Hide the PIN container if visible
      if (elements.traktPinContainer) {
        elements.traktPinContainer.style.display = 'none';
      }
      
      // Show expiration info if available
      let expirationInfo = '';
      if (traktData.expiresAt) {
        const expiresDate = new Date(traktData.expiresAt);
        const today = new Date();
        const daysLeft = Math.round((expiresDate - today) / (1000 * 60 * 60 * 24));
        expirationInfo = `<small style="color:#666">Token expires in ${daysLeft} days</small>`;
      }

      elements.traktStatus.innerHTML = expirationInfo;
    }
  }

  // ==================== MANIFEST MANAGEMENT ====================
  async function refreshManifest() {
    try {
      await fetch('/api/rebuild-addon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
      });

      await fetch('/manifest.json?force=true&t=' + Date.now(), {
          headers: { 
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
      });
    } catch (error) {
      showStatus('Failed to refresh manifest', 'error');
    }
  }

  // ==================== UI HELPERS ====================
  function showWelcomeMessage() {
    const welcomeBanner = document.createElement('div');
    welcomeBanner.className = 'welcome-banner';
    welcomeBanner.innerHTML = `
      <h2>Welcome to AIOLists Stremio Addon!</h2>
      <p>This is your first time setting up the addon. To get started:</p>
      <ol>
        <li>Enter your <strong>MDBList API key</strong> above (required)</li>
        <li>Optionally add a <strong>RPDB API key</strong> for better posters</li>
        <li>Click "Login to Trakt.tv" to connect your Trakt account</li>
        <li>Click "Save API Keys" to configure your addon</li>
      </ol>
      <p>Once configured, you can:</p>
      <ul>
        <li>Drag and drop to reorder your lists</li>
        <li>Click the eye icon to show/hide lists</li>
        <li>Use the "Install in Stremio" button to add the addon to Stremio</li>
      </ul>
    `;
    
    const container = document.querySelector('.container');
    container.insertBefore(welcomeBanner, elements.statusDiv.nextSibling);
    
    elements.apiKeyInput.focus();
    elements.apiKeyInput.classList.add('highlight');
    setTimeout(() => elements.apiKeyInput.classList.remove('highlight'), 2000);
  }

  function showSectionNotification(section, message, isLoading = false) {
    let notificationElement;
    
    switch(section) {
      case 'apiKeys':
        notificationElement = elements.apiKeysNotification;
        break;
      case 'connections':
        notificationElement = elements.connectionsNotification;
        break;
      case 'import':
        notificationElement = elements.importNotification;
        break;
      case 'lists':
        notificationElement = elements.listsNotification;
        break;
      default:
        return; // No valid section
    }
    
    if (notificationElement) {
      notificationElement.textContent = message;
      notificationElement.classList.add('visible');
      
      if (section === 'lists') {
        if (isLoading) {
          notificationElement.classList.add('saving');
        } else {
          notificationElement.classList.remove('saving');
          setTimeout(() => notificationElement.classList.remove('visible'), 3000);
        }
      } else {
        setTimeout(() => notificationElement.classList.remove('visible'), 3000);
      }
    }
  }

  function showStatus(message, type) {
    elements.statusDiv.textContent = message;
    elements.statusDiv.className = `status ${type}`;
    elements.statusDiv.classList.remove('hidden');
    
    setTimeout(() => elements.statusDiv.classList.add('hidden'), 5000);
  }

  // Update styles for addon management
  function updateAddonStyles() {
    // Add or update CSS style
    let style = document.getElementById('addon-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'addon-styles';
      document.head.appendChild(style);
    }
    
    // Updated compact styling
    style.innerHTML = `
      .imported-addons {
        margin-top: 15px;
      }
      .imported-addons h3 {
        margin-bottom: 10px;
        font-size: 16px;
      }
      .addons-list {
        margin-top: 0;
      }
      .addon-item {
        padding: 10px 12px;
        margin-bottom: 8px;
        background: #f5f5f5;
        border-radius: 4px;
        display: flex;
        align-items: center;
      }
      .addon-logo {
        width: 32px;
        height: 32px;
        object-fit: contain;
      }
      .badge-A {
        background-color: #607D8B;
      }
      #traktPinContainer {
        display: none;
        align-items: center;
      }
    `;
  }

  // Start the application
  init();
});