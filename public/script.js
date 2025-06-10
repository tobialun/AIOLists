// public/script.js

// Re-introduce defaultConfig for sort options, as server won't send them in /config or /lists responses
const defaultConfig = {
  availableSortOptions: [
    { value: 'default', label: 'Default' }, { value: 'rank', label: 'Rank' },
    { value: 'score', label: 'Score' }, { value: 'score_average', label: 'Average Score' },
    { value: 'released', label: 'Release Date' }, { value: 'releasedigital', label: 'Digital Release' },
    { value: 'imdbrating', label: 'IMDb Rating' }, { value: 'imdbvotes', label: 'IMDb Votes' },
    { value: 'last_air_date', label: 'Last Air Date' }, { value: 'imdbpopular', label: 'IMDb Popularity' },
    { value: 'tmdbpopular', label: 'TMDB Popularity' }, { value: 'rogerebert', label: 'Roger Ebert Rating' },
    { value: 'rtomatoes', label: 'Rotten Tomatoes' }, { value: 'rtaudience', label: 'RT Audience Score' },
    { value: 'metacritic', label: 'Metacritic' }, { value: 'myanimelist', label: 'MyAnimeList' },
    { value: 'letterrating', label: 'Letterboxd Rating' }, { value: 'lettervotes', label: 'Letterboxd Votes' },
    { value: 'budget', label: 'Budget' }, { value: 'revenue', label: 'Revenue' },
    { value: 'runtime', label: 'Runtime' }, { value: 'title', label: 'Title' }, { value: 'random', label: 'Random' }
  ],
  traktSortOptions: [
    { value: 'rank', label: 'Trakt Rank' },
    { value: 'added', label: 'Date Added' },
    { value: 'title', label: 'Title' },
    { value: 'released', label: 'Release Date' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'popularity', label: 'Trakt Popularity' },
    { value: 'random', label: 'Random' },
    { value: 'percentage', label: 'Percentage Watched' },
    { value: 'my_rating', label: 'My Trakt Rating' },
    { value: 'watched ', label: 'Watched' },
    { value: 'collected', label: 'Collected' },
  ],
  enableRandomListFeature: false,
  randomMDBListUsernames: ['showtime416', 'garycrawfordgc', 'linaspurinis', 'hdlists']
};

document.addEventListener('DOMContentLoaded', function() {
  const state = {
    configHash: null,
    userConfig: {
        apiKey: '',
        rpdbApiKey: '',
        metadataSource: 'cinemeta',
        tmdbLanguage: 'en-US',
        traktAccessToken: null,
        traktRefreshToken: null,
        traktExpiresAt: null,
        traktUuid: null,
        upstashUrl: '',
        upstashToken: '',
        enableRandomListFeature: defaultConfig.enableRandomListFeature,
        randomMDBListUsernames: [...defaultConfig.randomMDBListUsernames],
        availableSortOptions: [...defaultConfig.availableSortOptions],
        traktSortOptions: [...defaultConfig.traktSortOptions],
        hiddenLists: new Set(),
        removedLists: new Set(),
        importedAddons: {},
        listsMetadata: {},
        customListNames: {},
        customMediaTypeNames: {},
        mergedLists: {},
        sortPreferences: {},
        disableGenreFilter: false,
        listOrder: [],
        searchSources: ['cinemeta']
    },
    currentLists: [],
    validationTimeout: null,
    upstashSaveTimeout: null,
    universalImportTimeout: null,
    isMobile: window.matchMedia('(max-width: 600px)').matches,
    appVersion: "...",
    isPotentiallySharedConfig: false,
    isDbConnected: false,
    isLoadingFromUrl: false
  };

  // Loading state tracker
  const loadingState = new Map();

  const elements = {
    apiKeyInput: document.getElementById('apiKey'),
    rpdbApiKeyInput: document.getElementById('rpdbApiKey'),
    mdblistConnected: document.getElementById('mdblistConnected'),
    mdblistConnectedText: document.getElementById('mdblistConnected')?.querySelector('.connected-text'),
    rpdbConnected: document.getElementById('rpdbConnected'),
    rpdbConnectedText: document.getElementById('rpdbConnected')?.querySelector('.connected-text'),
    tmdbConnectedState: document.getElementById('tmdbConnectedState'),
    tmdbLoginBtn: document.getElementById('tmdbLoginBtn'),
    tmdbAuthContainer: document.getElementById('tmdbAuthContainer'),
    tmdbAuthLink: document.getElementById('tmdbAuthLink'),
    tmdbApproveBtn: document.getElementById('tmdbApproveBtn'),
    traktLoginBtn: document.getElementById('traktLoginBtn'),
    traktConnectedState: document.getElementById('traktConnectedState'),
    traktPinContainer: document.getElementById('traktPinContainer'),
    traktPin: document.getElementById('traktPin'),
    submitTraktPin: document.getElementById('submitTraktPin'),
    traktPersistenceContainer: document.getElementById('traktPersistenceContainer'),
    traktStatus: document.getElementById('traktStatus'),
    upstashContainer: document.getElementById('upstashContainer'),
    upstashUrlInput: document.getElementById('upstashUrl'),
    upstashTokenInput: document.getElementById('upstashToken'),
    upstashForm: document.getElementById('upstashForm'),
    closeUpstashBtn: document.getElementById('closeUpstashBtn'),
    universalImportInput: document.getElementById('universalImportInput'),
    importedAddonsContainer: document.getElementById('importedAddons'),
    addonsList: document.getElementById('addonsList'),
    listContainer: document.getElementById('listContainer'),
    listItems: document.getElementById('listItems'),
    listPlaceholder: document.getElementById('listPlaceholder'),
    placeholderSpinner: document.querySelector('#listPlaceholder .spinner'),
    placeholderText: document.querySelector('#listPlaceholder .placeholder-text'),
    updateStremioBtn: document.getElementById('updateStremioBtn'),
    copyManifestBtn: document.getElementById('copyManifestBtn'),
    apiKeysNotification: document.getElementById('apiKeysNotification'),
    connectionsNotification: document.getElementById('connectionsNotification'),
    importNotification: document.getElementById('importNotification'),
    settingsNotification: document.getElementById('settingsNotification'),
    toggleGenreFilterBtn: document.getElementById('toggleGenreFilterBtn'),
    genreFilterStatusInfo: document.getElementById('genreFilterStatusInfo'),
    toggleRandomListBtn: document.getElementById('toggleRandomListBtn'),
    randomListFeatureInfo: document.getElementById('randomListFeatureInfo'),
    randomListFeatureContainer: document.getElementById('randomListFeatureContainer'),
    listsNotification: document.getElementById('listsNotification'),
    copyConfigHashBtn: document.getElementById('copyConfigHashBtn'),
    copyBlankCharBtn: null,
    copyBlankCharContainer: null,
    copyConfigHashContainer: document.getElementById('copyConfigHashContainer'),
    settingsSection: document.querySelector('.settings-section'),
    settingsHeader: document.getElementById('settingsHeader'),
    settingsContent: document.getElementById('settingsContent'),
    settingsArrow: document.querySelector('.settings-section .collapsible-arrow'),
    editRandomUsersLink: null,
    randomUsersDropdown: null,
    randomUsersTagContainer: null,
    randomUserInput: null,
    appVersionSpan: document.getElementById('appVersion'),
    metadataSourceSelect: document.getElementById('metadataSourceSelect'),
    tmdbLanguageSelect: document.getElementById('tmdbLanguageSelect'),
    tmdbLanguageGroup: document.getElementById('tmdbLanguageGroup'),
    metadataInfo: document.getElementById('metadataInfo'),
    configHashDisplay: document.getElementById('configHashDisplay'),
    // Search provider elements
    searchCinemeta: document.getElementById('searchCinemeta'),
    searchTrakt: document.getElementById('searchTrakt'),
    searchTmdb: document.getElementById('searchTmdb'),
    searchMulti: document.getElementById('searchMulti'),
    searchNotification: document.getElementById('searchNotification')
  };

  async function init() {
    setupEventListeners();
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    let initialConfigHash = null;
    let action = null;

    // Check for TMDB callback (request_token parameter)
    const urlParams = new URLSearchParams(window.location.search);
    const requestToken = urlParams.get('request_token');
    const isApproved = urlParams.get('approved');
    
    // Check for Trakt callback (code and state parameters)
    const traktCode = urlParams.get('code');
    const traktState = urlParams.get('state');
    
    if (requestToken && pathParts.length >= 2 && pathParts[1] === 'configure') {
      // This is a TMDB callback - extract config hash from URL
      initialConfigHash = pathParts[0];
      action = 'tmdb-callback';
    } else if (traktCode && traktState && pathParts.length >= 2 && pathParts[1] === 'configure') {
      // This is a Trakt callback - extract config hash from state or URL
      initialConfigHash = traktState || pathParts[0];
      action = 'trakt-callback';
    } else if (pathParts.length === 0 || (pathParts.length === 1 && pathParts[0] === 'configure')) {
        // Fresh page, no config hash
    } else if (pathParts.length >= 1 && pathParts[0] === 'import-shared' && pathParts[1]) {
        action = 'import-shared';
        initialConfigHash = pathParts[1];
        state.isLoadingFromUrl = true;
    } else if (pathParts.length >= 1 && pathParts[0] !== 'api' && pathParts[0] !== 'configure') {
        initialConfigHash = pathParts[0];
        state.isLoadingFromUrl = true;
        if (pathParts.length === 1 || (pathParts.length > 1 && pathParts[1] !== 'configure')) {
            window.history.replaceState({}, '', `/${initialConfigHash}/configure`);
        }
    }

    if (action === 'tmdb-callback' && initialConfigHash && requestToken) {
      // Handle TMDB callback
      state.configHash = initialConfigHash;
      await handleTmdbCallback(requestToken, isApproved);
    } else if (action === 'trakt-callback' && initialConfigHash && traktCode) {
      // Handle Trakt callback
      state.configHash = initialConfigHash;
      await handleTraktCallback(traktCode, traktState);
    } else if (action === 'import-shared' && initialConfigHash) {
        try {
            const response = await fetch('/api/config/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sharedConfig: initialConfigHash })
            });
            const data = await response.json();
            if (data.success && data.configHash) {
                state.configHash = data.configHash;
                state.isPotentiallySharedConfig = true;
                window.history.replaceState({}, '', `/${state.configHash}/configure`);
            } else {
                throw new Error(data.error || 'Failed to create new config from shared hash');
            }
        } catch (error) {
            console.error('Init Error creating config from shared:', error);
            showNotification('apiKeys', `Error loading shared config: ${error.message}. Creating a new empty config.`, 'error', true);
            await createNewEmptyConfig();
        }
    } else if (initialConfigHash) {
        state.configHash = initialConfigHash;
    } else {
        await createNewEmptyConfig();
    }

    await fetchAppVersion();
    createRandomUsersEditor();
    updateURLAndLoadData();
    createCopyConfigHashButton();
    createCopyBlankCharButton();
    if(elements.settingsContent) elements.settingsContent.style.display = 'none';
    if(elements.settingsArrow) elements.settingsArrow.textContent = '▶';
    if(elements.settingsSection) elements.settingsSection.classList.remove('open');
  }

  function createCopyBlankCharButton() {
    if (elements.copyBlankCharBtn) return;

    elements.copyBlankCharContainer = document.createElement('div');
    elements.copyBlankCharContainer.className = 'setting-item';

    elements.copyBlankCharBtn = document.createElement('button');
    elements.copyBlankCharBtn.id = 'copyBlankCharBtn';
    elements.copyBlankCharBtn.textContent = 'Copy Blank';
    elements.copyBlankCharBtn.title = 'Copy invisible character';
    elements.copyBlankCharBtn.className = 'action-btn';

    const descriptionText = document.createElement('span');
    descriptionText.className = 'setting-info-text';
    descriptionText.textContent = 'Copy invisible character, paste it in name field to have nothing as your media type or movie name.';
    descriptionText.style.marginLeft = '10px';

    elements.copyBlankCharContainer.appendChild(elements.copyBlankCharBtn);
    elements.copyBlankCharContainer.appendChild(descriptionText);

    if (elements.settingsContent) {
        const copyHashContainer = document.getElementById('copyConfigHashContainer');
        if (copyHashContainer && copyHashContainer.parentNode === elements.settingsContent) {
            elements.settingsContent.insertBefore(elements.copyBlankCharContainer, copyHashContainer.nextSibling);
        } else {
            elements.settingsContent.appendChild(elements.copyBlankCharContainer);
        }
    }
    elements.copyBlankCharBtn.addEventListener('click', handleCopyBlankChar);
  }

  async function handleCopyBlankChar() {
    try {
        await navigator.clipboard.writeText("‎ ");
        const buttonInstance = elements.copyBlankCharBtn;
        const originalText = 'Copy Blank';
        buttonInstance.textContent = 'Blank Copied!';
        buttonInstance.disabled = true;
        setTimeout(() => {
            buttonInstance.textContent = originalText;
            buttonInstance.disabled = false;
        }, 2000);
        showNotification('settings', 'Blank character copied to clipboard!', 'success');
    } catch (err) {
        console.error('Copy blank char error:', err);
        showNotification('settings', 'Failed to copy blank character.', 'error', true);
    }
  }

  async function createNewEmptyConfig() {
    try {
        const response = await fetch('/api/config/create', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
        });
        const data = await response.json();
        if (data.success && data.configHash) {
            state.configHash = data.configHash;
            window.history.replaceState({}, '', `/${state.configHash}/configure`);
        } else { throw new Error(data.error || 'Failed to create new config hash'); }
    } catch (error) {
        console.error('Init Error creating new empty config:', error);
        showNotification('apiKeys', `Init Error: ${error.message}`, 'error', true);
    }
  }

  function createCopyConfigHashButton() {
    if (elements.copyConfigHashBtnInstance) return;

    elements.copyConfigHashBtnInstance = document.createElement('button');
    elements.copyConfigHashBtnInstance.id = 'copyConfigHashBtn';
    elements.copyConfigHashBtnInstance.textContent = 'Copy Setup Code';
    elements.copyConfigHashBtnInstance.title = 'Copy a shareable config code (API keys excluded)';
    elements.copyConfigHashBtnInstance.className = 'action-btn';

    const descriptionText = document.createElement('span');
    descriptionText.className = 'setting-info-text';
    descriptionText.textContent = 'Copy setup code to share your setup with others (API Keys excluded).';
    descriptionText.style.marginLeft = '10px';

    if (elements.copyConfigHashContainer) {
        elements.copyConfigHashContainer.appendChild(elements.copyConfigHashBtnInstance);
        elements.copyConfigHashContainer.appendChild(descriptionText);
        elements.copyConfigHashBtnInstance.addEventListener('click', handleCopyConfigHash);
    }
  }

  async function handleCopyConfigHash() {
    if (!state.configHash) {
      return showNotification('settings', 'Configuration not ready to share.', 'error');
    }
  
    try {
      const response = await fetch(`/${state.configHash}/shareable-hash`);
      const data = await response.json();
      if (!response.ok || !data.success || !data.shareableHash) {
        throw new Error(data.error || 'Failed to generate shareable hash.');
      }
  
      const textToCopy = data.shareableHash;
  
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
  
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
  
        try {
          document.execCommand('copy');
        } catch (err) {
          console.error('Fallback copy to clipboard failed:', err);
          showNotification('settings', 'Failed to copy.', 'error', true);
          return;
        }
        document.body.removeChild(textArea);
      }
  
      const buttonInstance = elements.copyConfigHashBtnInstance || document.getElementById('copyConfigHashBtn');
      const originalText = 'Copy Setup Code';
      buttonInstance.textContent = 'Shareable Code Copied!';
      buttonInstance.disabled = true;
  
      setTimeout(() => {
        buttonInstance.textContent = originalText;
        buttonInstance.disabled = false;
      }, 2500);
  
      showNotification('settings', 'Shareable config hash copied to clipboard!', 'success');
    } catch (err) {
      console.error('Share config error:', err);
      showNotification('settings', `Error: ${err.message}`, 'error', true);
    }
  }
  
  async function fetchAppVersion() {
    if (!state.configHash) {
      state.appVersion = "N/A";
    } else {
      try {
          const response = await fetch(`/${state.configHash}/manifest.json`);
          const manifest = await response.json();
          state.appVersion = (manifest && manifest.version) ? manifest.version.split('-')[0] : "1.0.0";
      } catch (error) {
          console.error('Error fetching manifest for version:', error);
          state.appVersion = "1.0.0";
      }
    }
    if (elements.appVersionSpan) {
        elements.appVersionSpan.textContent = state.appVersion;
    }
  }

  function updateURLAndLoadData() {
    if (!state.configHash) return;
    updateURL();
    updateStremioButtonHref();
    loadConfiguration();
  }

  function updateURL() {
    if (!state.configHash) return;
    const expectedPath = `/${state.configHash}/configure`;
    if (window.location.pathname !== expectedPath && !window.location.pathname.startsWith('/import-shared/')) {
        window.history.replaceState({}, '', expectedPath);
    }
  }

  function setupEventListeners() {
    elements.apiKeyInput.addEventListener('input', () => handleApiKeyInput(elements.apiKeyInput, 'mdblist'));
    elements.rpdbApiKeyInput.addEventListener('input', () => handleApiKeyInput(elements.rpdbApiKeyInput, 'rpdb'));
    elements.metadataSourceSelect.addEventListener('change', handleMetadataSourceChange);
    elements.tmdbLanguageSelect.addEventListener('change', handleTmdbLanguageChange);
    elements.upstashUrlInput.addEventListener('input', handleUpstashInput);
    elements.upstashTokenInput.addEventListener('input', handleUpstashInput);
    elements.closeUpstashBtn.addEventListener('click', () => {
        elements.upstashContainer.classList.add('hidden');
    });
    elements.submitTraktPin?.addEventListener('click', handleTraktPinSubmit);
    elements.traktPin?.addEventListener('keypress', function(e) { if (e.key === 'Enter') handleTraktPinSubmit(); });
    
    // Trakt login button click handler
    elements.traktLoginBtn?.addEventListener('click', async function(e) {
      e.preventDefault();
      try {
        if (!state.configHash) {
          showNotification('connections', 'Please wait for configuration to load', 'error');
          return;
        }
        
        // Try to get auth URL from the config-specific endpoint
        const response = await fetch(`/${state.configHash}/trakt/login`);
        const data = await response.json();
        
        if (data.success && data.authUrl) {
          if (data.requiresManualAuth) {
            // Manual PIN flow - open URL and show PIN input
            window.open(data.authUrl, '_blank');
            elements.traktLoginBtn.style.setProperty('display', 'none', 'important');
            elements.traktPinContainer.style.setProperty('display', 'flex', 'important');
            showNotification('connections', 'Please authorize the app and enter the PIN here.', 'info', true);
          } else {
            // Direct redirect flow
            window.location.href = data.authUrl;
          }
        } else {
          throw new Error(data.error || 'Failed to get Trakt auth URL');
        }
      } catch (error) {
        console.error('Trakt Login Error:', error);
        showNotification('connections', `Trakt Login Error: ${error.message}`, 'error');
      }
    });
    
    elements.universalImportInput.addEventListener('paste', handleUniversalPaste);
    elements.universalImportInput.addEventListener('input', handleUniversalInputChange);
    elements.copyManifestBtn?.addEventListener('click', copyManifestUrlToClipboard);
    elements.toggleGenreFilterBtn?.addEventListener('click', handleToggleGenreFilter);
    elements.toggleRandomListBtn?.addEventListener('click', handleToggleRandomListFeature);
    elements.settingsHeader?.addEventListener('click', toggleSettingsSection);
    
    // Search provider event listeners
    elements.searchCinemeta?.addEventListener('change', saveSearchPreferences);
    elements.searchTrakt?.addEventListener('change', saveSearchPreferences);
    elements.searchTmdb?.addEventListener('change', saveSearchPreferences);
    elements.searchMulti?.addEventListener('change', handleMultiSearchToggle);
    
    // TMDB OAuth event listeners (handled in showTmdbAuthContainer when needed)
    // elements.tmdbApproveBtn?.addEventListener('click', handleTmdbApproval) - set dynamically
    window.addEventListener('resize', () => {
        const oldMobileState = state.isMobile;
        state.isMobile = window.matchMedia('(max-width: 600px)').matches;
        if (oldMobileState !== state.isMobile && state.currentLists.length > 0) { renderLists(); }
    });
  }

  function toggleSettingsSection() {
    const isOpen = elements.settingsSection.classList.toggle('open');
    elements.settingsContent.style.display = isOpen ? 'block' : 'none';
    elements.settingsArrow.textContent = isOpen ? '▼' : '▶';
  }

  async function handleUniversalPaste(event) {
    event.preventDefault();
    const pastedText = (event.clipboardData || window.clipboardData).getData('text').trim();
    if (!pastedText) return;
    elements.universalImportInput.value = pastedText;
    showNotification('import', `Processing pasted input...`, 'info');
    await processUniversalImport(pastedText);
    elements.universalImportInput.value = '';
  }

  function handleUniversalInputChange() {
    if(state.universalImportTimeout) clearTimeout(state.universalImportTimeout);
    state.universalImportTimeout = setTimeout(async () => {
        const value = elements.universalImportInput.value.trim();
        if(!value) return;
        showNotification('import', `Processing input...`, 'info');
        await processUniversalImport(value);
        elements.universalImportInput.value = '';
    }, 1200);
  }

  async function processUniversalImport(value) {
    let MOCK_listUrlInput = {value: ''};
    let MOCK_manifestUrlInput = {value: ''};

    if ((value.includes('trakt.tv/users/') && value.includes('/lists/')) || value.includes('mdblist.com/lists/')) {
        MOCK_listUrlInput.value = value;
        await handleListUrlImport(MOCK_listUrlInput);
    } else if (value.endsWith('/manifest.json') || value.includes('/manifest.json?')) {
        MOCK_manifestUrlInput.value = value;
        await handleAddonImport(MOCK_manifestUrlInput);
    } else if (value.startsWith('H4sIAAAAAAA') && value.length > 200) {
        window.location.href = `/import-shared/${value}`;
    } else {
        showNotification('import', 'Cannot determine input type or invalid. Supported: Trakt/MDBList URLs, manifest URLs, AIOLists config hashes.', 'error', true);
    }
  }

  async function handleToggleGenreFilter() {
    const newDisableState = !state.userConfig.disableGenreFilter;
    try {
      const response = await fetch(`/${state.configHash}/config/genre-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disableGenreFilter: newDisableState }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update genre filter setting');
      }
      if (data.configHash && data.configHash !== state.configHash) {
        state.configHash = data.configHash;
        updateURL();
        updateStremioButtonHref();
      }
      state.userConfig.disableGenreFilter = newDisableState;
      updateGenreFilterButtonText();
      showNotification('settings', `Genre filter setting updated.`, 'success');
    } catch (error) {
      console.error('Error updating genre filter setting:', error);
      showNotification('settings', `Error: ${error.message}`, 'error', true);
      updateGenreFilterButtonText();
    }
  }

  async function handleToggleRandomListFeature() {
    if (!state.userConfig.apiKey) {
        showNotification('settings', 'MDBList API Key required to enable this feature.', 'error', true);
        return;
    }
    const newEnableState = !state.userConfig.enableRandomListFeature;

    try {
        const response = await fetch(`/${state.configHash}/config/random-list-feature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enable: newEnableState,
                randomMDBListUsernames: state.userConfig.randomMDBListUsernames
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to update Random List Feature setting.');
        }
        if (data.configHash && data.configHash !== state.configHash) {
            state.configHash = data.configHash;
            updateURL();
            updateStremioButtonHref();
        }
        state.userConfig.enableRandomListFeature = newEnableState;
        if (data.randomMDBListUsernames) {
            state.userConfig.randomMDBListUsernames = data.randomMDBListUsernames;
        }
        updateRandomListButtonState();
        showNotification('settings', `Random List Catalog ${newEnableState ? 'Enabled' : 'Disabled'}.`, 'success');
        await loadUserListsAndAddons();
    } catch (error) {
        console.error('Error toggling Random List Feature:', error);
        showNotification('settings', `Error: ${error.message}`, 'error', true);
        updateRandomListButtonState();
    }
  }

  function updateGenreFilterButtonText() {
    if (elements.toggleGenreFilterBtn) {
      if (state.userConfig.disableGenreFilter) {
        elements.toggleGenreFilterBtn.textContent = 'Enable Genre Filter';
        elements.toggleGenreFilterBtn.classList.remove('active-setting');
        elements.genreFilterStatusInfo.textContent = 'Genre filters are DISABLED. More list capacity.';
      } else {
        elements.toggleGenreFilterBtn.textContent = 'Disable Genre Filter';
        elements.toggleGenreFilterBtn.classList.add('active-setting');
        elements.genreFilterStatusInfo.textContent = 'Genre filters are ENABLED. Reduced list capacity.';
      }
    }
  }

  function createRandomUsersEditor() {
    if (!elements.randomListFeatureContainer || !elements.randomListFeatureInfo) return;

    elements.editRandomUsersLink = document.createElement('a');
    elements.editRandomUsersLink.href = '#';
    elements.editRandomUsersLink.textContent = 'Edit users';
    elements.editRandomUsersLink.className = 'edit-random-users-link';
    elements.editRandomUsersLink.style.marginLeft = '10px';
    elements.editRandomUsersLink.style.display = 'none';

    if (elements.randomListFeatureInfo.parentNode === elements.randomListFeatureContainer) {
        elements.randomListFeatureContainer.insertBefore(
            elements.editRandomUsersLink,
            elements.randomListFeatureInfo.nextSibling
        );
    } else {
        elements.randomListFeatureContainer.appendChild(elements.editRandomUsersLink);
    }

    elements.randomUsersDropdown = document.createElement('div');
    elements.randomUsersDropdown.className = 'random-users-dropdown';
    elements.randomUsersDropdown.style.display = 'none';
    elements.randomUsersDropdown.style.marginTop = '5px';

    elements.randomUsersTagContainer = document.createElement('div');
    elements.randomUsersTagContainer.className = 'random-users-tag-container';

    elements.randomUserInput = document.createElement('input');
    elements.randomUserInput.type = 'text';
    elements.randomUserInput.placeholder = 'Add MDBList username & Press Enter';
    elements.randomUserInput.className = 'random-user-input';

    elements.randomUsersDropdown.appendChild(elements.randomUsersTagContainer);
    elements.randomUsersDropdown.appendChild(elements.randomUserInput);

    if (elements.randomListFeatureContainer.parentNode) {
        elements.randomListFeatureContainer.parentNode.insertBefore(
            elements.randomUsersDropdown,
            elements.randomListFeatureContainer.nextSibling
        );
    }

    elements.editRandomUsersLink.addEventListener('click', (e) => {
        e.preventDefault();
        const isVisible = elements.randomUsersDropdown.style.display === 'block';
        elements.randomUsersDropdown.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            renderRandomUserTags();
            elements.randomUserInput.focus();
        }
    });

    elements.randomUserInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const username = elements.randomUserInput.value.trim();
            if (username) {
                if (!state.userConfig.randomMDBListUsernames.includes(username)) {
                    state.userConfig.randomMDBListUsernames.push(username);
                    renderRandomUserTags();
                    await saveRandomUsernamesConfig();
                }
                elements.randomUserInput.value = '';
            }
        }
    });
  }

  function renderRandomUserTags() {
    if (!elements.randomUsersTagContainer) return;
    elements.randomUsersTagContainer.innerHTML = '';
    (state.userConfig.randomMDBListUsernames || []).forEach(username => {
        const tag = document.createElement('span');
        tag.className = 'random-user-tag';
        tag.textContent = username;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'remove-user-tag';
        removeBtn.textContent = 'x';
        removeBtn.title = `Remove ${username}`;
        removeBtn.addEventListener('click', async () => {
            state.userConfig.randomMDBListUsernames = state.userConfig.randomMDBListUsernames.filter(u => u !== username);
            renderRandomUserTags();
            await saveRandomUsernamesConfig();
        });

        tag.appendChild(removeBtn);
        elements.randomUsersTagContainer.appendChild(tag);
    });
  }

  async function saveRandomUsernamesConfig() {
      try {
        const response = await fetch(`/${state.configHash}/config/random-list-feature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enable: state.userConfig.enableRandomListFeature,
                randomMDBListUsernames: state.userConfig.randomMDBListUsernames
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to save random usernames.');
        }
        if (data.configHash && data.configHash !== state.configHash) {
            state.configHash = data.configHash;
            updateURL();
            updateStremioButtonHref();
        }
        showNotification('settings', 'Random MDBList usernames updated.', 'success');
      } catch (error) {
          console.error('Error saving random usernames:', error);
          showNotification('settings', `Error: ${error.message}`, 'error', true);
      }
  }

  function updateRandomListButtonState() {
    if (elements.toggleRandomListBtn && elements.randomListFeatureInfo && elements.editRandomUsersLink) {
        if (!state.userConfig.apiKey) {
            elements.toggleRandomListBtn.disabled = true;
            elements.toggleRandomListBtn.textContent = 'Enable Random List';
            elements.toggleRandomListBtn.classList.remove('active-setting');
            elements.randomListFeatureInfo.textContent = 'Input MDBList API Key to activate.';
            elements.randomListFeatureInfo.style.color = '#757575';
            elements.editRandomUsersLink.style.display = 'none';
            elements.randomUsersDropdown.style.display = 'none';
        } else {
            elements.toggleRandomListBtn.disabled = false;
            elements.editRandomUsersLink.style.display = state.userConfig.enableRandomListFeature ? 'inline' : 'none';

            if (!state.userConfig.enableRandomListFeature) {
                 elements.randomUsersDropdown.style.display = 'none';
            }

            if (state.userConfig.enableRandomListFeature) {
                elements.toggleRandomListBtn.textContent = 'Disable Random List';
                elements.toggleRandomListBtn.classList.add('active-setting');
            } else {
                elements.toggleRandomListBtn.textContent = 'Enable Random List';
                elements.toggleRandomListBtn.classList.remove('active-setting');
            }
            elements.randomListFeatureInfo.textContent = 'Fetches random catalog from set list of users every refresh.';
            elements.randomListFeatureInfo.style.color = '#555';
            renderRandomUserTags();
        }
    }
  }

  async function loadConfiguration() {
    if (!state.configHash) return;
    try {
      const response = await fetch(`/${state.configHash}/config`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to load config data. Status: ${response.status}`);

      state.isDbConnected = data.isDbConnected;
      state.env = data.env || {};
      state.userConfig = {
        ...state.userConfig,
        ...data.config,
        hiddenLists: new Set(data.config.hiddenLists || []),
        removedLists: new Set(data.config.removedLists || []),
        customMediaTypeNames: data.config.customMediaTypeNames || {},
      };
      state.userConfig.randomMDBListUsernames = (data.config.randomMDBListUsernames && data.config.randomMDBListUsernames.length > 0)
                                                ? data.config.randomMDBListUsernames
                                                : [...defaultConfig.randomMDBListUsernames];

      state.isPotentiallySharedConfig = data.isPotentiallySharedConfig || false;
      
      elements.upstashUrlInput.value = state.userConfig.upstashUrl || '';
      elements.upstashTokenInput.value = state.userConfig.upstashToken || '';
      
      const mdblistApiKey = state.userConfig.apiKey;
      const rpdbApiKey = state.userConfig.rpdbApiKey;
      updateApiKeyUI(elements.apiKeyInput, mdblistApiKey, 'mdblist', state.userConfig.mdblistUsername);
      updateApiKeyUI(elements.rpdbApiKeyInput, rpdbApiKey, 'rpdb');
      
      // Handle TMDB Bearer Token input field
      const tmdbBearerTokenInput = document.getElementById('tmdbBearerToken');
      const tmdbBearerTokenGroup = document.getElementById('tmdbBearerTokenGroup');
      if (tmdbBearerTokenInput && tmdbBearerTokenGroup) {
        if (state.env.hasTmdbBearerToken) {
          // Environment variable is set, hide the input field
          tmdbBearerTokenGroup.style.display = 'none';
        } else {
          // Environment variable not set, show the input field and populate it if config has a value
          tmdbBearerTokenGroup.style.display = 'block';
          tmdbBearerTokenInput.value = state.userConfig.tmdbBearerToken || '';
        }
      }
      
      // Update metadata settings
      if (elements.metadataSourceSelect) {
        elements.metadataSourceSelect.value = state.userConfig.metadataSource || 'cinemeta';
      }
      if (elements.tmdbLanguageSelect) {
        elements.tmdbLanguageSelect.value = state.userConfig.tmdbLanguage || 'en-US';
      }
      updateMetadataSourceUI();
      updateGenreFilterButtonText();
      updateRandomListButtonState();
      updateSearchSourcesUI();

      if (mdblistApiKey || rpdbApiKey) {
        await validateAndSaveApiKeys(mdblistApiKey, rpdbApiKey, '', true);
      }
      
      const isTraktTokenExpired = state.userConfig.traktExpiresAt && new Date() >= new Date(state.userConfig.traktExpiresAt);

      if (isTraktTokenExpired && !state.userConfig.upstashUrl) {
          // If the token is expired and there's no Upstash for persistence/refresh, treat as disconnected
          state.userConfig.traktAccessToken = null;
          state.userConfig.traktRefreshToken = null;
          state.userConfig.traktExpiresAt = null;
          showNotification('connections', 'Trakt connection expired. Please reconnect.', 'error', true);
      }

      const isTraktConnected = !!(state.userConfig.traktAccessToken || (state.userConfig.upstashUrl && state.userConfig.traktUuid));
      updateTraktUI(isTraktConnected);
      
      const isTmdbConnected = !!state.userConfig.tmdbSessionId;
      updateTmdbConnectionUI(isTmdbConnected, state.userConfig.tmdbUsername);
      
      await loadUserListsAndAddons();
    } catch (error) { 
      console.error('Load Config Error:', error); 
      showNotification('apiKeys', `Load Config Error: ${error.message}`, 'error', true);
    }
  }

  function handleApiKeyInput(inputElement, keyType) {
    const apiKey = inputElement.value.trim();
    inputElement.classList.remove('valid', 'invalid');
    if (state.validationTimeout) clearTimeout(state.validationTimeout);
    state.validationTimeout = setTimeout(() => {
      validateAndSaveApiKeys(
        keyType === 'mdblist' ? apiKey : elements.apiKeyInput.value.trim(),
        keyType === 'rpdb' ? apiKey : elements.rpdbApiKeyInput.value.trim(),
        ''
      );
    }, 700);
  }

  function handleUpstashInput() {
    if (state.upstashSaveTimeout) clearTimeout(state.upstashSaveTimeout);
    state.upstashSaveTimeout = setTimeout(() => {
        saveUpstashCredentials();
    }, 1000);
  }

  async function saveUpstashCredentials() {
    const upstashUrl = elements.upstashUrlInput.value.trim();
    const upstashToken = elements.upstashTokenInput.value.trim();

    try {
        const response = await fetch(`/${state.configHash}/upstash`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upstashUrl, upstashToken })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || "Failed to save Upstash credentials");
        }
        if (data.configHash && data.configHash !== state.configHash) {
            state.configHash = data.configHash;
            updateURL();
            updateStremioButtonHref();
        }
        state.userConfig.upstashUrl = upstashUrl;
        state.userConfig.upstashToken = upstashToken;
        showNotification('connections', 'Upstash credentials saved.', 'success');
        
        await checkUpstashCredentials();
    } catch(error) {
        console.error('Upstash Save Error:', error);
        showNotification('connections', `Upstash Save Error: ${error.message}`, 'error', true);
    }
  }

  async function checkUpstashCredentials() {
    const upstashUrl = elements.upstashUrlInput.value.trim();
    const upstashToken = elements.upstashTokenInput.value.trim();

    if (!upstashUrl || !upstashToken) {
        updatePersistenceStatus(false);
        return;
    }
    
    // Simulate check for now, replace with actual backend call if needed
    // For simplicity, we assume if they are entered, they are potentially valid
    // and the backend will verify on use.
    state.userConfig.upstashUrl = upstashUrl;
    state.userConfig.upstashToken = upstashToken;
    updatePersistenceStatus(true);
    elements.upstashContainer.classList.add('hidden');
    elements.upstashForm.style.display = 'none';
  }
  
  async function validateAndSaveApiKeys(mdblistApiKeyToValidate, rpdbApiKeyToValidate, tmdbApiKeyToValidate = '', isInitialLoadOrSilentCheck = false) {
    try {
      if (isInitialLoadOrSilentCheck && !mdblistApiKeyToValidate && !rpdbApiKeyToValidate) {
          updateApiKeyUI(elements.apiKeyInput, '', 'mdblist', null, null);
          updateApiKeyUI(elements.rpdbApiKeyInput, '', 'rpdb', null, null);
          updateRandomListButtonState();
          return;
      }

      const res = await fetch('/api/validate-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: mdblistApiKeyToValidate, rpdbApiKey: rpdbApiKeyToValidate })
      });
      const validationResults = await res.json();
      if (!res.ok) throw new Error(validationResults.error || `Validation HTTP error! Status: ${res.status}`);

      const mdblistValid = validationResults.mdblist?.valid;
      const rpdbValid = validationResults.rpdb?.valid;
      const mdblistUsername = mdblistValid ? validationResults.mdblist.username : null;

      updateApiKeyUI(elements.apiKeyInput, mdblistApiKeyToValidate, 'mdblist', mdblistUsername, mdblistValid);
      updateApiKeyUI(elements.rpdbApiKeyInput, rpdbApiKeyToValidate, 'rpdb', null, rpdbValid);
      updateRandomListButtonState();

      if (mdblistApiKeyToValidate || rpdbApiKeyToValidate || state.userConfig.apiKey || state.userConfig.rpdbApiKey) {
          const saveResponse = await fetch(`/${state.configHash}/apikey`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: mdblistApiKeyToValidate, rpdbApiKey: rpdbApiKeyToValidate })
          });
          const saveData = await saveResponse.json();
          if (!saveResponse.ok || !saveData.success) throw new Error(saveData.error || "Failed to save API keys");

          if (saveData.configHash && saveData.configHash !== state.configHash) {
              state.configHash = saveData.configHash; updateURL(); updateStremioButtonHref();
          }
          state.userConfig.apiKey = mdblistApiKeyToValidate;
          state.userConfig.rpdbApiKey = rpdbApiKeyToValidate;
          if (mdblistValid) state.userConfig.mdblistUsername = mdblistUsername;
          else if (!mdblistApiKeyToValidate) {
            delete state.userConfig.mdblistUsername;
            state.userConfig.enableRandomListFeature = false;
            updateRandomListButtonState();
          }
      }

      if (!isInitialLoadOrSilentCheck) {
          showNotification('apiKeys', 'API keys updated.', 'success');
      }

      if (!isInitialLoadOrSilentCheck && ( (mdblistApiKeyToValidate && mdblistValid) || (rpdbApiKeyToValidate && rpdbValid) || state.userConfig.traktAccessToken) ) {
          await loadUserListsAndAddons();
      } else if (!isInitialLoadOrSilentCheck && !mdblistApiKeyToValidate && !state.userConfig.traktAccessToken) {
          state.currentLists = []; renderLists(); renderImportedAddons();
          state.userConfig.enableRandomListFeature = false;
          updateRandomListButtonState();
      }
    } catch (error) {
      console.error('Key Error:', error);
      if (!isInitialLoadOrSilentCheck || (mdblistApiKeyToValidate || rpdbApiKeyToValidate)) {
        showNotification('apiKeys', `Key Error: ${error.message}`, 'error', true);
      }
       updateRandomListButtonState();
    }
  }

  function updateApiKeyUI(inputElement, key, keyType, username = null, isValid = null) {
    const connectedDiv = keyType === 'mdblist' ? elements.mdblistConnected : elements.rpdbConnected;
    const connectedText = keyType === 'mdblist' ? elements.mdblistConnectedText : elements.rpdbConnectedText;
    inputElement.classList.remove('valid', 'invalid');

    if (key && isValid === true) {
      inputElement.style.display = 'none';
      connectedDiv.style.display = 'flex';
      if (keyType === 'mdblist') {
        connectedText.textContent = `Connected as ${username}`;
      } else if (keyType === 'rpdb') {
        connectedText.textContent = 'RPDB Key Valid';
      }
      if (inputElement.classList) inputElement.classList.add('valid');
    } else {
      inputElement.style.display = 'block';
      connectedDiv.style.display = 'none';
      inputElement.value = key || '';
      if (isValid === false) {
          if (inputElement.classList) inputElement.classList.add('invalid');
      }
    }
  }

  function updateTraktUI(isConnected) {
    if (isConnected) {
        // Connected state: hide connect button, show connected state
        elements.traktLoginBtn.style.setProperty('display', 'none', 'important');
        elements.traktConnectedState.style.setProperty('display', 'flex', 'important');
        elements.traktPersistenceContainer.style.setProperty('display', 'flex', 'important');
        elements.traktPinContainer.style.setProperty('display', 'none', 'important');
        
        // Update the connected state text
        const connectedText = elements.traktConnectedState.querySelector('b');
        if (connectedText) {
          connectedText.textContent = 'Connected to Trakt';
        }
        
        const isPersistent = !!(state.userConfig.upstashUrl && state.userConfig.upstashToken && state.userConfig.traktUuid);
        updatePersistenceStatus(isPersistent);
    } else {
        // Disconnected state: show connect button, hide connected state
        elements.traktLoginBtn.style.setProperty('display', 'inline-flex', 'important');
        elements.traktConnectedState.style.setProperty('display', 'none', 'important');
        elements.traktPersistenceContainer.style.setProperty('display', 'none', 'important');
        elements.traktPinContainer.style.setProperty('display', 'none', 'important');
        elements.traktPin.value = '';
        elements.upstashContainer.classList.add('hidden');
    }
    
    // Update search sources UI when Trakt connection changes
    updateSearchSourcesUI();
  }

  function updatePersistenceStatus(isPersistent) {
    elements.traktStatus.innerHTML = ''; // Clear previous state

    const statusIcon = document.createElement('span');
    statusIcon.className = 'status-icon';

    const statusText = document.createElement('span');
    statusText.className = 'status-text';

    const actionLink = document.createElement('a');
    actionLink.className = 'persistence-action-link';

    if (isPersistent) {
        statusIcon.textContent = '✔';
        statusIcon.classList.add('persistent');
        statusText.textContent = 'Trakt persistent';
        actionLink.textContent = 'Edit';
        actionLink.onclick = () => {
            elements.upstashForm.style.display = 'block';
            elements.upstashContainer.classList.remove('hidden');
        };
        elements.upstashContainer.classList.add('hidden');
        elements.upstashForm.style.display = 'none';
    } else {
        statusIcon.textContent = '✖';
        statusIcon.classList.add('not-persistent');
        statusText.textContent = 'Trakt not persistent';
        actionLink.textContent = 'Make persistent';
        actionLink.onclick = () => {
            elements.upstashContainer.classList.remove('hidden');
            elements.upstashForm.style.display = 'block';
        };
    }

    elements.traktStatus.appendChild(statusIcon);
    elements.traktStatus.appendChild(statusText);
    elements.traktStatus.appendChild(actionLink);
  }

  async function handleTraktPinSubmit() {
    const pin = elements.traktPin.value.trim();
    if (!pin) return showNotification('connections', 'Please enter your Trakt PIN', 'error');
    try {
      const response = await fetch(`/${state.configHash}/trakt/auth`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ code: pin }) 
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || data.details || 'Trakt auth failed');
      }

      if (data.configHash) {
          state.configHash = data.configHash;
          
          // Update Trakt connection state
          state.userConfig.traktAccessToken = 'connected'; // Don't store actual token
          state.userConfig.traktRefreshToken = 'connected';
          state.userConfig.traktExpiresAt = new Date(Date.now() + 86400000).toISOString(); // 24 hours from now
          if (data.uuid) state.userConfig.traktUuid = data.uuid;
          
          updateURL();
          updateStremioButtonHref();
          updateTraktUI(true); // Explicitly update UI before reloading
          
          showNotification('connections', 'Successfully connected to Trakt!', 'success');
          await loadConfiguration(); 
      } else {
          throw new Error("Received success from server but no new config hash.");
      }
      
    } catch (error) { 
      console.error('Trakt Error:', error); 
      showNotification('connections', `Trakt Error: ${error.message}`, 'error', true);
      // Hide PIN container on error, keep login button visible
      elements.traktPinContainer.style.setProperty('display', 'none', 'important');
      elements.traktPin.value = ''; // Clear the PIN field
    }
  }

  async function handleListUrlImport(mockListUrlInput) {
    const url = (mockListUrlInput || elements.listUrlInput).value.trim();
    if (!url) return showNotification('import', 'Please enter a MDBList or Trakt list URL.', 'error');
    try {
      const response = await fetch(`/${state.configHash}/import-list-url`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.details || `Failed to import URL`);

      state.configHash = data.configHash;
      updateURL(); updateStremioButtonHref();
      showNotification('import', data.message || `${data.addon.name} imported.`, 'success');
      await loadUserListsAndAddons();
    } catch (error) { console.error('Import Error:', error); showNotification('import', `Import Error: ${error.message}`, 'error', true); }
  }

  async function handleAddonImport(mockManifestUrlInput) {
    const manifestUrl = (mockManifestUrlInput || elements.manifestUrlInput).value.trim();
    if (!manifestUrl) return showNotification('import', 'Please enter a manifest URL.', 'error');
    try {
      const response = await fetch(`/${state.configHash}/import-addon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.details || 'Failed to import addon');

      state.configHash = data.configHash;
      updateURL(); updateStremioButtonHref();
      showNotification('import', data.message || `${data.addon.name} imported.`, 'success');
      await loadUserListsAndAddons();
    } catch (error) { console.error('Addon Import Error:', error); showNotification('import', `Addon Import Error: ${error.message}`, 'error', true); }
  }

  async function loadUserListsAndAddons() {
    if (!state.configHash) return;

    const isListCurrentlyEmpty = elements.listItems.children.length === 0;

    if (isListCurrentlyEmpty) {
        elements.listContainer.classList.remove('hidden');
        elements.listPlaceholder.classList.remove('hidden');
        elements.placeholderSpinner.style.display = 'block';
        elements.placeholderText.textContent = 'Loading Lists and Configs';
    } else {
        showNotification('lists', 'Loading lists...', 'info', true);
    }

    try {
      const response = await fetch(`/${state.configHash}/lists`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to load lists');

      state.currentLists = data.lists || [];
      state.userConfig.importedAddons = data.importedAddons || {};
      state.userConfig.listsMetadata = data.listsMetadata || state.userConfig.listsMetadata || {};
      state.userConfig.customMediaTypeNames = data.customMediaTypeNames || state.userConfig.customMediaTypeNames || {};
      state.userConfig.availableSortOptions = [...defaultConfig.availableSortOptions];
      state.userConfig.traktSortOptions = [...defaultConfig.traktSortOptions];
      state.isPotentiallySharedConfig = data.isPotentiallySharedConfig || false;
      const randomCatalogEntry = data.lists.find(list => list.id === 'random_mdblist_catalog');
      state.userConfig.enableRandomListFeature = !!(randomCatalogEntry && !randomCatalogEntry.isHidden);
      if (data.randomMDBListUsernames) {
        state.userConfig.randomMDBListUsernames = data.randomMDBListUsernames;
      }
      if (data.newConfigHash && data.newConfigHash !== state.configHash) {
        state.configHash = data.newConfigHash;
        updateURL();
        updateStremioButtonHref();
      }
      
      // Handle TMDB status notification
      if (data.tmdbStatus && data.tmdbStatus.isConnected && data.tmdbStatus.message) {
        showNotification('connections', data.tmdbStatus.message, 'success');
      }
      
      elements.listItems.innerHTML = '';

      if (state.currentLists.length > 0) {
        elements.listPlaceholder.classList.add('hidden');
        renderLists();
      } else {
        elements.listPlaceholder.classList.remove('hidden');
        elements.placeholderSpinner.style.display = 'none';
        elements.placeholderText.textContent = 'No lists added yet.';
      }

      renderImportedAddons();
      updateRandomListButtonState();
      showNotification('lists', 'Lists loaded.', 'success', false);
    } catch (error) {
      console.error('List Load Error:', error);
      showNotification('lists', `List Load Error: ${error.message}`, 'error', true);
      if (isListCurrentlyEmpty) {
          elements.listPlaceholder.classList.remove('hidden');
          elements.placeholderSpinner.style.display = 'none';
          elements.placeholderText.textContent = 'Failed to load lists.';
      }
    } finally {
        state.isLoadingFromUrl = false;
    }
  }

  function renderLists() {
    elements.listItems.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.currentLists.forEach(list => {
      if (list.id === 'random_mdblist_catalog') {
          if(state.userConfig.enableRandomListFeature && state.userConfig.apiKey) {
             fragment.appendChild(createListItemElement(list));
          }
      } else if (!state.userConfig.removedLists.has(String(list.id))) {
        fragment.appendChild(createListItemElement(list));
      }
    });
    elements.listItems.appendChild(fragment);
    if (window.Sortable && elements.listItems.children.length > 0) {
      if (elements.listItems._sortable) elements.listItems._sortable.destroy();
      elements.listItems._sortable = Sortable.create(elements.listItems, {
        animation: 150, handle: '.drag-handle, .mobile-drag-handle', ghostClass: 'sortable-ghost', dragClass: 'sortable-drag', onEnd: handleListReorder });
    }
  }

  function createListItemElement(list) {
    const li = document.createElement('li');
    li.className = `list-item`;
    li.dataset.id = String(list.id);
    li.dataset.originalId = String(list.originalId || list.id);

    let needsApiKey = false;
    let apiKeyType = null;
    let apiKeyMissing = false;

    if (list.source === 'mdblist' || list.source === 'mdblist_url' || list.source === 'random_mdblist') {
        needsApiKey = true; apiKeyType = 'MDBList';
        if (!state.userConfig.apiKey) apiKeyMissing = true;
    } else if (list.source === 'trakt' && (list.isTraktList || list.isTraktWatchlist) && !list.isTraktTrending && !list.isTraktPopular && !list.isTraktRecommendations) {
        needsApiKey = true; apiKeyType = 'Trakt';
        if (!state.userConfig.traktAccessToken && !state.userConfig.upstashUrl) apiKeyMissing = true;
    }

    if (apiKeyMissing && state.isPotentiallySharedConfig) {
        li.classList.add('requires-connection');
    }

    const mediaTypeDisplayElement = document.createElement('span');
    mediaTypeDisplayElement.className = 'media-type-display clickable-media-type';
    mediaTypeDisplayElement.textContent = `[${list.effectiveMediaTypeDisplay || 'All'}]`;
    mediaTypeDisplayElement.title = 'Click to change media type display name';
    mediaTypeDisplayElement.addEventListener('click', (e) => {
        e.stopPropagation();
        startMediaTypeEditing(li, list);
    });
    if (apiKeyMissing && state.isPotentiallySharedConfig) mediaTypeDisplayElement.style.display = 'none';
    if (list.id === 'random_mdblist_catalog' && apiKeyMissing && !state.userConfig.apiKey) {
        mediaTypeDisplayElement.style.display = 'none';
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'list-name clickable-list-name';
    let displayName = list.customName || list.name;
    const isEffectivelyUrlImported = list.source === 'mdblist_url' || list.source === 'trakt_public';
    if (isEffectivelyUrlImported || list.source === 'addon_manifest') {
        displayName = displayName.replace(/\s*\((Movies|Series)\)$/i, '').trim();
    }
    nameSpan.textContent = displayName;
    nameSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        startNameEditing(li, list);
    });

    const isRandomCatalog = list.id === 'random_mdblist_catalog';
    const isExternalAddonList = list.source === 'addon_manifest';

    const removeBtn = createButton('❌', 'remove-list-button action-icon', (e) => { e.stopPropagation(); removeListItem(li, String(list.id)); }, 'Remove List Permanently');
    if ((apiKeyMissing && state.isPotentiallySharedConfig) && !isRandomCatalog) {
        removeBtn.disabled = true; removeBtn.style.opacity = '0.5'; removeBtn.style.cursor = 'not-allowed';
    }
    if (isRandomCatalog && list.id === 'random_mdblist_catalog') removeBtn.style.display = 'none';

    const isHiddenInManifest = state.userConfig.hiddenLists.has(String(list.id));
    const visibilityToggleBtn = createButton(
        `<span class="eye-icon ${isHiddenInManifest ? 'eye-closed-svg' : 'eye-open-svg'}"></span>`,
        'visibility-toggle action-icon',
        (e) => { e.stopPropagation(); toggleListVisibility(li, String(list.id)); },
        isHiddenInManifest ? 'Click to Show in Stremio Manifest' : 'Click to Hide from Stremio Manifest'
    );
     if (apiKeyMissing && state.isPotentiallySharedConfig && isRandomCatalog && !state.userConfig.apiKey) {
        visibilityToggleBtn.style.display = 'none';
     } else if (apiKeyMissing && state.isPotentiallySharedConfig && !isRandomCatalog) {
        visibilityToggleBtn.style.display = 'none';
     }
    
    let mergeToggle = null;
    const canMerge = list.hasMovies && list.hasShows && !isRandomCatalog && !isExternalAddonList;
    if (canMerge) {
      const isListMerged = state.userConfig.mergedLists?.[String(list.id)] !== false;
      mergeToggle = createButton(
          isListMerged ? 'Merged' : 'Split',
          `merge-toggle ${isListMerged ? 'merged' : 'split'}`,
          async (e) => {
              e.stopPropagation();
              const currentIsMerged = state.userConfig.mergedLists?.[String(list.id)] !== false;
              const newMergedState = !currentIsMerged;
                  mergeToggle.textContent = newMergedState ? 'Merged' : 'Split';
              mergeToggle.className = `merge-toggle ${newMergedState ? 'merged' : 'split'}`;
              if (!state.userConfig.mergedLists) state.userConfig.mergedLists = {};
              state.userConfig.mergedLists[String(list.id)] = newMergedState;
              await updateListPreference(String(list.id), 'merge', { merged: newMergedState });
            },
            isListMerged ? 'Click to split into separate Movies/Series lists' : 'Click to merge into one list'
        );
        if (apiKeyMissing && state.isPotentiallySharedConfig) mergeToggle.style.display = 'none';
      }

    let sortControlsContainer = null;
    const isSpecialTraktNonSortable = list.isTraktTrending || list.isTraktPopular || list.isTraktRecommendations;
    const isSortableList = (list.source === 'mdblist' || list.source === 'mdblist_url' ||
                           (list.source === 'trakt' && (list.isTraktList || list.isTraktWatchlist)) ||
                           list.source === 'trakt_public' || list.id === 'random_mdblist_catalog')
                           && !isSpecialTraktNonSortable;

    if (isSortableList) {
        sortControlsContainer = document.createElement('div'); sortControlsContainer.className = 'sort-controls';
        const sortSelect = document.createElement('select'); sortSelect.className = 'sort-select';

        let currentSortOptions;
        if (list.source === 'trakt' || list.source === 'trakt_public') {
          currentSortOptions = state.userConfig.traktSortOptions || [];
      } else {
            currentSortOptions = state.userConfig.availableSortOptions || [];
        }

        const sortPrefKey = String(list.originalId || list.id);
        let currentSortPref = state.userConfig.sortPreferences?.[sortPrefKey] || list.sortPreferences;
        if (!currentSortPref || typeof currentSortPref.sort === 'undefined' || typeof currentSortPref.order === 'undefined') {
             currentSortPref = {
                sort: (list.source === 'trakt' || list.source === 'trakt_public') ? 'rank' : 'default',
                order: (list.source === 'trakt' || list.source === 'trakt_public') ? 'asc' : 'desc'
            };
        }

        (currentSortOptions || []).forEach(opt => {
            const optionEl = document.createElement('option'); optionEl.value = opt.value; optionEl.textContent = opt.label;
            if (opt.value === currentSortPref.sort) optionEl.selected = true;
            sortSelect.appendChild(optionEl);
        });
        const orderToggleBtn = createButton(currentSortPref.order === 'desc' ? 'Desc' : 'Asc', 'order-toggle-btn', null, 'Toggle sort order');
        const updateSortAndOrder = async (newSort, newOrder) => {
            orderToggleBtn.textContent = newOrder === 'desc' ? 'Desc' : 'Asc';
            if(!state.userConfig.sortPreferences) state.userConfig.sortPreferences = {};
            state.userConfig.sortPreferences[sortPrefKey] = { sort: newSort, order: newOrder };
            await updateListPreference(sortPrefKey, 'sort', { sort: newSort, order: newOrder });
        };
        orderToggleBtn.onclick = (e) => {
            e.stopPropagation();
            const cs = state.userConfig.sortPreferences?.[sortPrefKey] || currentSortPref;
            updateSortAndOrder(sortSelect.value, cs.order === 'desc' ? 'asc' : 'desc');
        };
        sortSelect.onchange = (e) => {
            e.stopPropagation();
            const cs = state.userConfig.sortPreferences?.[sortPrefKey] || currentSortPref;
            updateSortAndOrder(e.target.value, cs.order || 'desc');
        };
        sortControlsContainer.append(orderToggleBtn, sortSelect);
         if (apiKeyMissing && state.isPotentiallySharedConfig && !isRandomCatalog) sortControlsContainer.style.display = 'none';
         else if (apiKeyMissing && isRandomCatalog && !state.userConfig.apiKey) sortControlsContainer.style.display = 'none';
    }

    if (state.isMobile) {
        li.classList.add('mobile-list-item');
        const mobileLayoutContainer = document.createElement('div');
        mobileLayoutContainer.className = 'mobile-layout-container';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle mobile-drag-handle';
        dragHandle.innerHTML = '☰';
        if ((apiKeyMissing && state.isPotentiallySharedConfig && !state.userConfig.apiKey && isRandomCatalog) ||
            (apiKeyMissing && state.isPotentiallySharedConfig && !isRandomCatalog) ) {
          dragHandle.style.display = 'none';
        }

        const contentRowsContainer = document.createElement('div');
        contentRowsContainer.className = 'mobile-content-rows';

        const topRow = document.createElement('div');
        topRow.className = 'mobile-top-row';
        const nameContainer = document.createElement('div');
        nameContainer.className = 'name-container';
        const tag = document.createElement('span'); tag.className = `tag`;
        let tagTypeChar = list.tag; let tagImageSrc = list.tagImage;
        if (!tagTypeChar) {
            if (list.source === 'mdblist' || list.source === 'mdblist_url') { tagTypeChar = list.isWatchlist ? 'W' : (list.listType || 'L');}
            else if (list.source === 'trakt' || list.source === 'trakt_public') { tagTypeChar = 'T'; }
            else if (list.source === 'random_mdblist') { tagTypeChar = '🎲'; }
            else { tagTypeChar = 'A'; }
        }
        if ((list.source === 'trakt' || list.source === 'trakt_public') && !tagImageSrc) tagImageSrc = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
        else if (list.source === 'addon_manifest' && list.tagImage) tagImageSrc = list.tagImage;
        tag.classList.add(tagTypeChar.toLowerCase());
        if (tagImageSrc) {
            const img = document.createElement('img'); img.src = tagImageSrc; img.alt = list.source || 'icon'; tag.appendChild(img);
            tag.classList.add('tag-with-image');
            if (list.source === 'trakt' || list.source === 'trakt_public' || list.source === 'addon_manifest') {
                 tag.style.backgroundColor = 'transparent';
            }
        }
        else { tag.textContent = tagTypeChar; }
        if (tagTypeChar === '🎲') { tag.style.backgroundColor = '#FFC107'; tag.style.color = '#000';}

        nameContainer.appendChild(tag);
        nameContainer.appendChild(mediaTypeDisplayElement);
        nameContainer.appendChild(nameSpan);

        if (apiKeyMissing && state.isPotentiallySharedConfig) {
            const infoIcon = document.createElement('span'); infoIcon.className = 'info-icon'; infoIcon.innerHTML = '&#9432;'; infoIcon.title = `Connect to ${apiKeyType} to activate this list.`;
            nameContainer.appendChild(infoIcon);
        }
        topRow.appendChild(nameContainer);

        const bottomRow = document.createElement('div');
        bottomRow.className = 'mobile-bottom-row';
        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'list-actions-group mobile-actions-group';
        if (mergeToggle) actionsGroup.appendChild(mergeToggle);
        if (sortControlsContainer) actionsGroup.appendChild(sortControlsContainer);
        actionsGroup.appendChild(visibilityToggleBtn);
        actionsGroup.appendChild(removeBtn);
        bottomRow.appendChild(actionsGroup);

        contentRowsContainer.appendChild(topRow);
        contentRowsContainer.appendChild(bottomRow);
        mobileLayoutContainer.appendChild(dragHandle);
        mobileLayoutContainer.appendChild(contentRowsContainer);
        li.appendChild(mobileLayoutContainer);

    } else {
        const contentWrapper = document.createElement('div'); contentWrapper.className = 'list-item-content';
        const dragHandle = document.createElement('span'); dragHandle.className = 'drag-handle'; dragHandle.innerHTML = '☰';
        if ((apiKeyMissing && state.isPotentiallySharedConfig && !state.userConfig.apiKey && isRandomCatalog) ||
            (apiKeyMissing && state.isPotentiallySharedConfig && !isRandomCatalog)) {
            dragHandle.style.display = 'none';
        }

        const mainCol = document.createElement('div'); mainCol.className = 'list-item-main';
        const tag = document.createElement('span'); tag.className = `tag`;
        let tagTypeChar = list.tag; let tagImageSrc = list.tagImage;
        if (!tagTypeChar) {
            if (list.source === 'mdblist' || list.source === 'mdblist_url') { tagTypeChar = list.isWatchlist ? 'W' : (list.listType || 'L');}
            else if (list.source === 'trakt' || list.source === 'trakt_public') { tagTypeChar = 'T'; }
            else if (list.source === 'random_mdblist') { tagTypeChar = '🎲'; }
            else { tagTypeChar = 'A'; }
        }
        if ((list.source === 'trakt' || list.source === 'trakt_public') && !tagImageSrc) tagImageSrc = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico';
        else if (list.source === 'addon_manifest' && list.tagImage) tagImageSrc = list.tagImage;
        tag.classList.add(tagTypeChar.toLowerCase());
        if (tagImageSrc) { const img = document.createElement('img'); img.src = tagImageSrc; img.alt = list.source || 'icon'; tag.appendChild(img); if (list.source === 'trakt' || list.source === 'trakt_public' || list.source === 'addon_manifest') tag.style.backgroundColor = 'transparent'; }
        else { tag.textContent = tagTypeChar; }
        if (tagTypeChar === '🎲') { tag.style.backgroundColor = '#FFC107'; tag.style.color = '#000';}

        const nameContainer = document.createElement('div'); nameContainer.className = 'name-container';
        nameContainer.appendChild(mediaTypeDisplayElement);
        nameContainer.appendChild(nameSpan);

        if (apiKeyMissing && state.isPotentiallySharedConfig) {
            const infoIcon = document.createElement('span'); infoIcon.className = 'info-icon'; infoIcon.innerHTML = '&#9432;'; infoIcon.title = `Connect to ${apiKeyType} to activate this list.`;
            nameContainer.appendChild(infoIcon);
        }

        const actionsGroup = document.createElement('div'); actionsGroup.className = 'list-actions-group';
        if (mergeToggle) actionsGroup.appendChild(mergeToggle);
        if (sortControlsContainer) actionsGroup.appendChild(sortControlsContainer);
        actionsGroup.appendChild(visibilityToggleBtn);
        actionsGroup.appendChild(removeBtn);

        const desktopRow = document.createElement('div'); desktopRow.className = 'list-item-row list-item-row-desktop';
        desktopRow.append(tag, nameContainer); desktopRow.appendChild(actionsGroup);
        mainCol.appendChild(desktopRow);
        contentWrapper.appendChild(dragHandle);
        contentWrapper.appendChild(mainCol);
        li.appendChild(contentWrapper);
    }
    return li;
  }

  function createButton(htmlOrText, className, onClick, title = '') {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = className;
    btn.innerHTML = htmlOrText; if (title) btn.title = title;
    if (typeof onClick === 'function') { btn.addEventListener('click', onClick); }
    return btn;
  }

  const debouncedSaveListOrder = debounce(async (order) => {
    await updateListPreference(null, 'order', { order }); }, 1000);

  function handleListReorder(evt) {
    const items = Array.from(elements.listItems.querySelectorAll('.list-item'));
    const newOrder = items.map(item => String(item.dataset.id));
    state.userConfig.listOrder = newOrder;
    debouncedSaveListOrder(newOrder);
  }
  
  function startMediaTypeEditing(listItemElement, list) {
    if (listItemElement.querySelector('.edit-mediatype-input')) return;
    if (apiKeyMissingForList(list) && state.isPotentiallySharedConfig) return;
    if (list.id === 'random_mdblist_catalog' && apiKeyMissingForList(list)) return;

    const displayElement = listItemElement.querySelector('.media-type-display');
    if (!displayElement) return;

    const currentMediaType = list.effectiveMediaTypeDisplay || 'All';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-mediatype-input';
    input.value = currentMediaType;

    displayElement.replaceWith(input);
    input.focus();
    input.select();

    const saveAndRerender = async () => {
        if(input.disabled) return;
        input.disabled = true;
        const newMediaType = input.value.trim();
        const listInState = state.currentLists.find(l => l.id === list.id);
        if (listInState) listInState.effectiveMediaTypeDisplay = newMediaType || 'All';
        state.userConfig.customMediaTypeNames[list.id] = newMediaType;
        const newListItemElement = createListItemElement(listInState || list);
        listItemElement.replaceWith(newListItemElement);
        await updateListPreference(list.id, 'mediatype', { customMediaType: newMediaType });
    };

    const cancelEditing = () => {
        const listInState = state.currentLists.find(l => l.id === list.id);
        const newListItemElement = createListItemElement(listInState || list);
        listItemElement.replaceWith(newListItemElement);
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
    });

    input.addEventListener('blur', saveAndRerender);
}

function startNameEditing(listItemElement, list) {
    if (listItemElement.querySelector('.edit-name-input')) return;
    if (list.id === 'random_mdblist_catalog' || (apiKeyMissingForList(list) && state.isPotentiallySharedConfig)) return;

    const nameSpan = listItemElement.querySelector('.list-name');
    if (!nameSpan) return;

    nameSpan.style.display = 'none';

    let currentDisplayName = list.customName || list.name;
    const isEffectivelyUrlImported = list.source === 'mdblist_url' || list.source === 'trakt_public';
    if (isEffectivelyUrlImported || list.source === 'addon_manifest') {
        currentDisplayName = currentDisplayName.replace(/\s*\((Movies|Series)\)$/i, '').trim();
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-name-input';
    input.value = currentDisplayName;
    
    nameSpan.parentNode.insertBefore(input, nameSpan.nextSibling);
    input.focus();
    input.select();

    const saveAndRerender = async () => {
        if (input.disabled) return;
        input.disabled = true;
        const newName = input.value.trim();
        const listInState = state.currentLists.find(l => l.id === list.id);
        if (listInState) listInState.customName = newName;
        const newListItemElement = createListItemElement(listInState || list);
        listItemElement.replaceWith(newListItemElement);
        await updateListPreference(String(list.id), 'name', { customName: newName });
    };

    const cancelEditing = () => {
        const listInState = state.currentLists.find(l => l.id === list.id);
        const newListItemElement = createListItemElement(listInState || list);
        listItemElement.replaceWith(newListItemElement);
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
    });

    input.addEventListener('blur', saveAndRerender);
}
  
  function apiKeyMissingForList(list) {
    if ((list.source === 'mdblist' || list.source === 'mdblist_url' || list.source === 'random_mdblist' || list.id === 'random_mdblist_catalog') && !state.userConfig.apiKey) {
        return true;
    }
    if (list.source === 'trakt' && (list.isTraktList || list.isTraktWatchlist) && !list.isTraktTrending && !list.isTraktPopular && !list.isTraktRecommendations && !state.userConfig.traktAccessToken && !state.userConfig.upstashUrl) {
        return true;
    }
    return false;
  }

  async function toggleListVisibility(listItemElement, listId) {
    const listIdStr = String(listId);
    const isCurrentlyHidden = state.userConfig.hiddenLists.has(listIdStr);
    
    if (isCurrentlyHidden) {
      state.userConfig.hiddenLists.delete(listIdStr);
    } else {
      state.userConfig.hiddenLists.add(listIdStr);
    }
    
    const newHiddenState = !isCurrentlyHidden;
    const eyeIconSpan = listItemElement.querySelector('.visibility-toggle .eye-icon');
    if (eyeIconSpan) {
        eyeIconSpan.className = `eye-icon ${newHiddenState ? 'eye-closed-svg' : 'eye-open-svg'}`;
    }
    const visibilityButton = listItemElement.querySelector('.visibility-toggle');
    if (visibilityButton) {
        visibilityButton.title = newHiddenState ? 'Click to Show in Stremio Manifest' : 'Click to Hide from Stremio Manifest';
    }

    await updateListPreference(null, 'visibility', { hiddenLists: Array.from(state.userConfig.hiddenLists) });
  }

  async function removeListItem(listItemElement, listId) {
    const listToRemoveIdStr = String(listId);

    if (listToRemoveIdStr === 'random_mdblist_catalog') {
      console.warn("Attempted to remove 'random_mdblist_catalog' via general remove function. This should be handled by its feature toggle.");
      return;
    }
    listItemElement.remove();
    await updateListPreference(null, 'remove', { listIds: [listToRemoveIdStr] });
  }

  async function updateListPreference(listIdForPref, type, payload) {
    const endpointMap = {
        name: `/${state.configHash}/lists/names`,
        mediatype: `/${state.configHash}/lists/mediatype`,
        visibility: `/${state.configHash}/lists/visibility`,
        remove: `/${state.configHash}/lists/remove`,
        order: `/${state.configHash}/lists/order`,
        sort: `/${state.configHash}/lists/sort`,
        merge: `/${state.configHash}/lists/merge`,
    };
    const endpoint = endpointMap[type];
    if (!endpoint) {
        console.error("Unknown preference type for update:", type);
        return;
    }

    let body = { ...payload };
    if (listIdForPref && ['name', 'sort', 'merge', 'mediatype'].includes(type)) {
        body.listId = listIdForPref;
    }
    const notifSection = (['order', 'visibility', 'name', 'remove', 'sort', 'merge', 'random_feature_disable', 'mediatype'].includes(type)) ? 'lists' : 'settings';
    showNotification(notifSection, 'Saving...', 'info', true);
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || `Server error for ${type}. Status: ${response.status}`);
        }

        let needsManifestReload = false;
        if (data.configHash && data.configHash !== state.configHash) {
            state.configHash = data.configHash;
            updateURL();
            updateStremioButtonHref();
            needsManifestReload = true;
        }
        
        showNotification(notifSection, `${type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')} updated.`, 'success', false);
        
        const manifestAffectingChanges = ['visibility', 'remove', 'order', 'merge', 'mediatype'];
        if (needsManifestReload || manifestAffectingChanges.includes(type)) {
            await loadConfiguration();
        }

    } catch (error) {
        console.error(`Update Error for ${type}:`, error);
        showNotification(notifSection, `Error updating ${type}: ${error.message}`, 'error', true);
        await loadUserListsAndAddons();
    }
  }

  function renderImportedAddons() {
    elements.addonsList.innerHTML = '';
    const addonGroups = Object.values(state.userConfig.importedAddons || {})
                              .filter(addon => addon && !(addon.isMDBListUrlImport || addon.isTraktPublicList));
    if (addonGroups.length === 0) {
      elements.importedAddonsContainer.classList.add('hidden'); return;
    }
    elements.importedAddonsContainer.classList.remove('hidden');
    addonGroups.forEach(addon => {
      const item = document.createElement('div'); item.className = 'addon-item-group';
      const logoSrc = addon.logo || '/assets/logo.ico';
      const urlObject = new URL(addon.apiBaseUrl);
      const configureUrl = `${urlObject.origin}/configure`;
      item.innerHTML = `
        <img src="${logoSrc}" alt="${addon.name} logo" class="addon-group-logo">
        <div class="addon-group-details">
          <span class="addon-group-name">${addon.name}</span>
          <span class="addon-group-info">v${addon.version || 'N/A'} • ${addon.catalogs?.length || 0} list${addon.catalogs?.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="addon-group-actions">
          <a href="${configureUrl}" target="_blank" rel="noopener noreferrer" class="configure-addon-group action-icon" title="Configure Addon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
              <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
            </svg>
          </a>
          <button class="remove-addon-group action-icon" data-addon-id="${addon.id}" title="Remove Addon Group">❌</button>
        </div>
      `;
      item.querySelector('.remove-addon-group').addEventListener('click', (e) => { e.stopPropagation(); removeImportedAddonGroup(addon.id);});
      elements.addonsList.appendChild(item);
    });
  }

  async function removeImportedAddonGroup(addonGroupId) {
    try {
      const response = await fetch(`/${state.configHash}/remove-addon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addonId: addonGroupId }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Failed to remove addon group');

      state.configHash = data.configHash;
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
    const notificationElement = elements[`${sectionKey}Notification`];
    if (!notificationElement) {
        console.warn("Notification element not found for section:", sectionKey);
        return;
    }

    if (notificationElement._loadingIntervalId) {
        clearInterval(notificationElement._loadingIntervalId);
        notificationElement._loadingIntervalId = null;
    }
    if (notificationElement._timeoutId) {
        clearTimeout(notificationElement._timeoutId);
        notificationElement._timeoutId = null;
    }

    notificationElement.innerHTML = message;
    notificationElement.className = `section-notification ${type} visible`;

    if (sectionKey === 'lists' && message.includes('Loading lists') && type === 'info' && persistent) {
        notificationElement.innerHTML = `Loading lists <div class="inline-spinner"></div>`;
    } else {
        if (!persistent) {
            // Special case for TMDB warning - shorter timeout
            const timeout = message.includes('TMDB API Key required') ? 2500 : 3000;
            notificationElement._timeoutId = setTimeout(() => {
                notificationElement.classList.remove('visible');
            }, timeout);
        }
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
    await validateAndSaveApiKeys('', elements.rpdbApiKeyInput.value.trim(), '');
  };

  // Make connectToTmdb globally available
  window.connectToTmdb = connectToTmdb;
  


  // TMDB OAuth connection functions
  async function connectToTmdb() {
    try {
      // Get the TMDB Bearer Token from the input field or use environment variable
      const tmdbBearerTokenInput = document.getElementById('tmdbBearerToken');
      let tmdbBearerToken;
      
      if (state.env?.hasTmdbBearerToken) {
        // Environment variable is set, no need for user input
        tmdbBearerToken = null; // Backend will use environment variable
      } else {
        // Get token from input field
        tmdbBearerToken = tmdbBearerTokenInput?.value?.trim();
        if (!tmdbBearerToken) {
          showNotification('connections', 'Please enter your TMDB Bearer Token first.', 'error', true);
          tmdbBearerTokenInput?.focus();
          return;
        }
      }
      
      showNotification('connections', 'Validating TMDB Bearer Token...', 'info', true);
      
      // First validate the bearer token (null means use environment variable)
      const validateResponse = await fetch('/tmdb/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbBearerToken })
      });
      
      const validateData = await validateResponse.json();
      if (!validateResponse.ok || !validateData.success || !validateData.valid) {
        throw new Error('Invalid TMDB Bearer Token. Please check your token and try again.');
      }
      
      showNotification('connections', 'Getting TMDB authorization URL...', 'info', true);
      
      // Now get the auth URL using the validated bearer token
      const response = await fetch('/tmdb/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbBearerToken })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to get TMDB auth URL');
      }
      
      // Check if both environment variables are set for direct redirect
      if (state.env?.hasTmdbBearerToken && state.env?.hasTmdbRedirectUri && data.canDirectRedirect) {
        // Direct redirect flow - construct the redirect URL and go directly to TMDB
        const cleanRedirectUri = data.tmdbRedirectUri.replace(/\/+$/, ''); // Remove trailing slashes
        const redirectUrl = `${cleanRedirectUri}/${state.configHash}/configure`;
        const fullAuthUrl = `https://www.themoviedb.org/authenticate/${data.requestToken}?redirect_to=${encodeURIComponent(redirectUrl)}`;
        
        showNotification('connections', 'Redirecting to TMDB for authorization...', 'info', true);
        
        // Redirect to TMDB for authorization
        window.location.href = fullAuthUrl;
        return;
      }
      
      // Manual flow - store request token and show manual authorization steps
      state.tmdbRequestToken = data.requestToken;
      state.tmdbBearerToken = tmdbBearerToken; // This will be null if using env var
      
      // Show TMDB auth container
      showTmdbAuthContainer(data.authUrl);
      showNotification('connections', 'Please authorize the app and return here.', 'info', true);
    } catch (error) {
      console.error('TMDB Auth Error:', error);
      showNotification('connections', `TMDB Auth Error: ${error.message}`, 'error', true);
    }
  }

  function showTmdbAuthContainer(authUrl) {
    const tmdbLoginBtn = document.getElementById('tmdbLoginBtn');
    const tmdbAuthContainer = document.getElementById('tmdbAuthContainer');
    const tmdbAuthLink = document.getElementById('tmdbAuthLink');
    const tmdbApproveBtn = document.getElementById('tmdbApproveBtn');
    
    if (tmdbLoginBtn) tmdbLoginBtn.style.display = 'none';
    if (tmdbAuthContainer) tmdbAuthContainer.style.display = 'block';
    if (tmdbAuthLink) {
      tmdbAuthLink.href = authUrl;
    }
    
    // Set up approve button
    if (tmdbApproveBtn) {
      tmdbApproveBtn.onclick = handleTmdbApproval;
    }
  }

  async function handleTmdbApproval() {
    try {
      if (!state.tmdbRequestToken) {
        throw new Error('No request token available');
      }
      
      if (!state.tmdbBearerToken && !state.env?.hasTmdbBearerToken) {
        throw new Error('No TMDB Bearer Token available');
      }
      
      showNotification('connections', 'Completing TMDB authentication...', 'info', true);
      
      const response = await fetch(`/${state.configHash}/tmdb/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          requestToken: state.tmdbRequestToken,
          tmdbBearerToken: state.tmdbBearerToken // null if using env var
        })
      });
      
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to authenticate with TMDB');
      }
      
      state.configHash = data.configHash;
      // Don't override the backend values - let them persist from the backend response
      // Only set bearer token if user provided one (not using environment variable)
      if (state.tmdbBearerToken) {
        state.userConfig.tmdbBearerToken = state.tmdbBearerToken;
      }
      
      // Clean up
      delete state.tmdbRequestToken;
      delete state.tmdbBearerToken;
      
      updateURL();
      updateStremioButtonHref();
      
      // Reload configuration to get the actual session values from backend
      await loadConfig();
      
      updateTmdbConnectionUI(true, data.username);
      
      // Reset auth container to ensure clean state
      resetTmdbAuthContainer();
      
      showNotification('connections', `Successfully connected to TMDB as ${data.username || 'user'}!`, 'success');
      await loadUserListsAndAddons();
    } catch (error) {
      console.error('TMDB Authentication Error:', error);
      showNotification('connections', `TMDB Authentication Error: ${error.message}`, 'error', true);
      resetTmdbAuthContainer();
    }
  }

  function resetTmdbAuthContainer() {
    const tmdbLoginBtn = document.getElementById('tmdbLoginBtn');
    const tmdbAuthContainer = document.getElementById('tmdbAuthContainer');
    const tmdbConnectedState = document.getElementById('tmdbConnectedState');
    const tmdbBearerTokenGroup = document.getElementById('tmdbBearerTokenGroup');
    
    // Only show login button and bearer token input if not actually connected
    if (tmdbLoginBtn && !state.userConfig.tmdbSessionId) {
      tmdbLoginBtn.style.display = 'inline-flex';
    }
    if (tmdbBearerTokenGroup && !state.userConfig.tmdbSessionId && !state.env?.hasTmdbBearerToken) {
      tmdbBearerTokenGroup.style.display = 'block';
    }
    if (tmdbAuthContainer) {
      tmdbAuthContainer.style.display = 'none';
    }
    
    // Clear any pending approval state
    state.tmdbRequestToken = null;
    state.tmdbBearerToken = null;
  }

  function updateTmdbConnectionUI(isConnected, username = null) {
    const tmdbLoginBtn = document.getElementById('tmdbLoginBtn');
    const tmdbConnectedState = document.getElementById('tmdbConnectedState');
    const tmdbAuthContainer = document.getElementById('tmdbAuthContainer');
    const tmdbBearerTokenGroup = document.getElementById('tmdbBearerTokenGroup');
    
    if (isConnected) {
      // Connected state: hide connect button, bearer token input, and auth container, show connected state
      if (tmdbLoginBtn) tmdbLoginBtn.style.setProperty('display', 'none', 'important');
      if (tmdbBearerTokenGroup) tmdbBearerTokenGroup.style.setProperty('display', 'none', 'important');
      if (tmdbAuthContainer) tmdbAuthContainer.style.setProperty('display', 'none', 'important');
      if (tmdbConnectedState) {
        tmdbConnectedState.style.setProperty('display', 'flex', 'important');
        const connectedText = tmdbConnectedState.querySelector('b');
        if (connectedText) {
          connectedText.textContent = username ? `Connected to TMDB (${username})` : 'Connected to TMDB';
        }
      }
    } else {
      // Disconnected state: show connect button and conditionally show bearer token input, hide connected state and auth container
      if (tmdbLoginBtn) tmdbLoginBtn.style.setProperty('display', 'inline-flex', 'important');
      // Only show bearer token input if environment variable is not set
      if (tmdbBearerTokenGroup && !state.env?.hasTmdbBearerToken) {
        tmdbBearerTokenGroup.style.setProperty('display', 'block', 'important');
      }
      if (tmdbConnectedState) tmdbConnectedState.style.setProperty('display', 'none', 'important');
      if (tmdbAuthContainer) tmdbAuthContainer.style.setProperty('display', 'none', 'important');
    }
    
    // Update metadata source UI when TMDB connection changes
    updateMetadataSourceUI();
    
    // Update search sources UI when TMDB connection changes
    updateSearchSourcesUI();
  }

  window.disconnectTMDB = async function() {
    try {
      const response = await fetch(`/${state.configHash}/tmdb/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to disconnect TMDB');
      }
      
      state.configHash = data.configHash;
      state.userConfig.tmdbSessionId = null;
      state.userConfig.tmdbAccountId = null;
      state.userConfig.tmdbBearerToken = null;
      
      // Clear the Bearer Token input field
      const tmdbBearerTokenInput = document.getElementById('tmdbBearerToken');
      if (tmdbBearerTokenInput && !state.env?.hasTmdbBearerToken) {
        tmdbBearerTokenInput.value = '';
      }
      
      // Reset metadata source to Cinemeta if it was set to TMDB
      if (state.userConfig.metadataSource === 'tmdb') {
        state.userConfig.metadataSource = 'cinemeta';
        if (elements.metadataSourceSelect) {
          elements.metadataSourceSelect.value = 'cinemeta';
        }
      }
      
      updateURL();
      updateStremioButtonHref();
      updateTmdbConnectionUI(false);
      
      showNotification('connections', 'Disconnected from TMDB. Metadata source reset to Cinemeta.', 'success');
      await loadUserListsAndAddons();
    } catch (error) {
      console.error('TMDB Disconnect Error:', error);
      showNotification('connections', `TMDB Disconnect Error: ${error.message}`, 'error', true);
    }
  };



  window.disconnectRPDB = function() {
    const rpdbApiKeyInput = document.getElementById('rpdbApiKey');
    const rpdbConnected = document.getElementById('rpdbConnected');
    
    if (rpdbApiKeyInput) rpdbApiKeyInput.value = '';
    if (rpdbConnected) rpdbConnected.style.display = 'none';
    
    state.userConfig.rpdbApiKey = '';
    handleApiKeyInput(rpdbApiKeyInput, 'rpdb');
  };

  window.disconnectTrakt = async function() {
    try {
        const response = await fetch(`/${state.configHash}/trakt/disconnect`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Failed to disconnect Trakt');

        state.configHash = data.configHash;
        state.userConfig.traktAccessToken = null;
        state.userConfig.traktRefreshToken = null;
        state.userConfig.traktExpiresAt = null;
        state.userConfig.traktUuid = null;

        updateURL(); updateStremioButtonHref(); updateTraktUI(false);
        showNotification('connections', 'Disconnected from Trakt.', 'success');
        await loadUserListsAndAddons();
    } catch (error) { console.error('Trakt Disconnect Error:', error); showNotification('connections', `Trakt Disconnect Error: ${error.message}`, 'error', true); }
  };

  // Handle metadata source change
  async function handleMetadataSourceChange() {
    const newMetadataSource = elements.metadataSourceSelect.value;
    
    if (newMetadataSource === 'tmdb' && !state.userConfig.tmdbSessionId) {
      showNotification('settings', 'TMDB OAuth connection required to use TMDB as metadata source. Please connect to TMDB first.', 'error');
      elements.metadataSourceSelect.value = state.userConfig.metadataSource;
      return;
    }
    
    await updateMetadataSettings(newMetadataSource, null);
  }

  // Handle TMDB language change
  async function handleTmdbLanguageChange() {
    const newLanguage = elements.tmdbLanguageSelect.value;
    await updateMetadataSettings(null, newLanguage);
  }

  // Update metadata settings on server
  async function updateMetadataSettings(metadataSource = null, tmdbLanguage = null) {
    try {
      const payload = {};
      if (metadataSource) payload.metadataSource = metadataSource;
      if (tmdbLanguage) payload.tmdbLanguage = tmdbLanguage;
      
      const response = await fetch(`/${state.configHash}/config/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update metadata settings');
      }
      
      if (data.configHash && data.configHash !== state.configHash) {
        state.configHash = data.configHash;
        updateURL();
        updateStremioButtonHref();
      }
      
      if (metadataSource) state.userConfig.metadataSource = metadataSource;
      if (tmdbLanguage) state.userConfig.tmdbLanguage = tmdbLanguage;
      
      updateMetadataSourceUI();
      showNotification('search', 'Metadata settings updated.', 'success');
    } catch (error) {
      console.error('Error updating metadata settings:', error);
      showNotification('settings', `Error: ${error.message}`, 'error', true);
      // Revert UI changes on error
      if (elements.metadataSourceSelect) {
        elements.metadataSourceSelect.value = state.userConfig.metadataSource;
      }
      if (elements.tmdbLanguageSelect) {
        elements.tmdbLanguageSelect.value = state.userConfig.tmdbLanguage;
      }
      updateMetadataSourceUI();
    }
  }

  // Update metadata source UI
  function updateMetadataSourceUI() {
    if (elements.tmdbLanguageGroup) {
      const showLanguageSettings = state.userConfig.metadataSource === 'tmdb';
      elements.tmdbLanguageGroup.style.display = showLanguageSettings ? 'flex' : 'none';
    }
    
    // Enable/disable TMDB option based on OAuth connection
    if (elements.metadataSourceSelect) {
      const tmdbOption = elements.metadataSourceSelect.querySelector('option[value="tmdb"]');
      if (tmdbOption) {
        const isTmdbConnected = !!state.userConfig.tmdbSessionId;
        tmdbOption.disabled = !isTmdbConnected;
        tmdbOption.textContent = isTmdbConnected ? 'TMDB' : 'TMDB (Connect first)';
      }
    }
    
    if (elements.metadataInfo) {
      let currentSource = 'Cinemeta';
      if (state.userConfig.metadataSource === 'tmdb') {
        currentSource = 'TMDB';
      }
      const currentLang = state.userConfig.metadataSource === 'tmdb' ? ` (${state.userConfig.tmdbLanguage})` : '';
      elements.metadataInfo.textContent = `Currently using ${currentSource}${currentLang} for metadata.`;
    }
  }

  // Event handlers
  document.addEventListener('DOMContentLoaded', function() {
    // ... existing DOMContentLoaded code ...
    
    if (elements.metadataSourceSelect) {
      elements.metadataSourceSelect.addEventListener('change', handleMetadataSourceChange);
    }
    if (elements.tmdbLanguageSelect) {
      elements.tmdbLanguageSelect.addEventListener('change', handleTmdbLanguageChange);
    }

    // Search provider event listeners
    if (elements.searchTrakt) {
      elements.searchTrakt.addEventListener('change', saveSearchPreferences);
    }
    if (elements.searchTmdb) {
      elements.searchTmdb.addEventListener('change', saveSearchPreferences);
    }
  });

  // Search Functions
  async function performSearch() {
    if (!elements.searchQuery || !elements.searchQuery.value.trim()) {
      showNotification('search', 'Please enter a search query', 'error');
      return;
    }

    const query = elements.searchQuery.value.trim();
    const type = elements.searchType.value;
    const sources = [];

    if (elements.searchCinemeta.checked) sources.push('cinemeta');
    if (elements.searchTrakt.checked && !elements.searchTrakt.disabled) sources.push('trakt');
    if (elements.searchTmdb.checked && !elements.searchTmdb.disabled) sources.push('tmdb');

    if (sources.length === 0) {
      showNotification('search', 'Please select at least one search source', 'error');
      return;
    }

    // Disable search button during search
    elements.searchButton.disabled = true;
    elements.searchButton.textContent = 'Searching...';

    try {
      const response = await fetch(`/api/${state.configHash}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: query,
          type: type,
          sources: sources,
          limit: 20
        })
      });

      const data = await response.json();

      if (data.success) {
        displaySearchResults(data);
        showNotification('search', `Found ${data.totalResults} results for "${query}"`, 'success');
      } else {
        showNotification('search', data.error || 'Search failed', 'error');
        elements.searchResults.style.display = 'none';
      }
    } catch (error) {
      console.error('Search error:', error);
      showNotification('search', 'Search failed: ' + error.message, 'error');
      elements.searchResults.style.display = 'none';
    } finally {
      elements.searchButton.disabled = false;
      elements.searchButton.textContent = 'Search';
    }
  }

  function clearSearch() {
    if (elements.searchQuery) elements.searchQuery.value = '';
    if (elements.searchType) elements.searchType.value = 'all';
    if (elements.searchResults) elements.searchResults.style.display = 'none';
    if (elements.searchResultsContent) elements.searchResultsContent.innerHTML = '';
  }

  function handleMultiSearchToggle() {
    // Multi search is temporarily disabled
    if (elements.searchMulti) {
      elements.searchMulti.checked = false;
      showNotification('search', 'Multi search is temporarily disabled', 'info');
    }
  }

  function updateSearchSourcesUI() {
    // Load saved search preferences
    if (state.userConfig.searchSources) {
      // Remove any multi search from saved preferences (migration)
      if (state.userConfig.searchSources.includes('multi')) {
        state.userConfig.searchSources = state.userConfig.searchSources.filter(s => s !== 'multi');
        // If multi was the only option, default to cinemeta
        if (state.userConfig.searchSources.length === 0) {
          state.userConfig.searchSources = ['cinemeta'];
        }
      }
      
      // Set individual search sources
      if (elements.searchMulti) elements.searchMulti.checked = false;
      if (elements.searchCinemeta) {
        elements.searchCinemeta.checked = state.userConfig.searchSources.includes('cinemeta');
      }
      if (elements.searchTrakt) {
        elements.searchTrakt.checked = state.userConfig.searchSources.includes('trakt');
      }
      if (elements.searchTmdb) {
        elements.searchTmdb.checked = state.userConfig.searchSources.includes('tmdb');
      }
    } else {
      // Default to Cinemeta if no preferences saved
      if (elements.searchCinemeta) {
        elements.searchCinemeta.checked = true;
      }
      if (elements.searchMulti) elements.searchMulti.checked = false;
    }

    // Trakt search is always available (no connection required)
    if (elements.searchTrakt) {
      elements.searchTrakt.disabled = false;
      const label = elements.searchTrakt.parentElement;
      if (label) {
        label.title = '';
        label.style.opacity = '1';
      }
    }

    // Enable/disable TMDB search based on connection
    // Check for TMDB connection: either has sessionId and bearerToken in config, or has sessionId and env has bearerToken
    const hasTmdbConnection = state.userConfig.tmdbSessionId && 
                              (state.userConfig.tmdbBearerToken || state.env?.hasTmdbBearerToken);
    
    if (elements.searchTmdb) {
      if (!hasTmdbConnection) {
        elements.searchTmdb.disabled = true;
        elements.searchTmdb.checked = false;
        const label = elements.searchTmdb.parentElement;
        if (label) {
          label.title = 'Connect to TMDB first to enable TMDB search';
          label.style.opacity = '0.6';
        }
      } else {
        elements.searchTmdb.disabled = false;
        const label = elements.searchTmdb.parentElement;
        if (label) {
          label.title = '';
          label.style.opacity = '1';
        }
      }
    }

    // Disable Multi search (temporarily disabled)
    if (elements.searchMulti) {
      elements.searchMulti.disabled = true;
      elements.searchMulti.checked = false;
      const label = elements.searchMulti.parentElement;
      if (label) {
        label.title = 'Multi search is temporarily disabled';
        label.style.opacity = '0.6';
      }
    }
  }

  async function saveSearchPreferences() {
    if (!state.configHash) return;

    // If any individual search source is selected, disable multi search
    if ((elements.searchCinemeta && elements.searchCinemeta.checked) ||
        (elements.searchTrakt && elements.searchTrakt.checked) ||
        (elements.searchTmdb && elements.searchTmdb.checked)) {
      if (elements.searchMulti) elements.searchMulti.checked = false;
    }

    const searchSources = [];
    if (elements.searchCinemeta && elements.searchCinemeta.checked) searchSources.push('cinemeta');
    if (elements.searchTrakt && elements.searchTrakt.checked && !elements.searchTrakt.disabled) searchSources.push('trakt');
    if (elements.searchTmdb && elements.searchTmdb.checked && !elements.searchTmdb.disabled) searchSources.push('tmdb');
    // Multi search is temporarily disabled
    // if (elements.searchMulti && elements.searchMulti.checked) searchSources.push('multi');

    try {
      const response = await fetch(`/api/${state.configHash}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchSources: searchSources
        })
      });

      const data = await response.json();
      if (data.success && data.newConfigHash) {
        state.configHash = data.newConfigHash;
        state.userConfig.searchSources = searchSources; // Update local state
        updateURL();
        updateStremioButtonHref();
        showNotification('search', 'Search preferences saved.', 'success');
      }
    } catch (error) {
      console.error('Error saving search preferences:', error);
      showNotification('search', 'Error saving search preferences: ' + error.message, 'error');
    }
  }



  function displaySearchResults(data) {
    if (!elements.searchResults || !elements.searchResultsContent) return;

    elements.searchResults.style.display = 'block';
    elements.searchResultsContent.innerHTML = '';

    if (!data.results || data.results.length === 0) {
      elements.searchResultsContent.innerHTML = '<p class="no-results">No results found</p>';
      return;
    }

    const resultsGrid = document.createElement('div');
    resultsGrid.className = 'search-results-grid';

    data.results.forEach(item => {
      const resultCard = createSearchResultCard(item);
      resultsGrid.appendChild(resultCard);
    });

    elements.searchResultsContent.appendChild(resultsGrid);

    // Show source information
    if (data.sources && data.sources.length > 0) {
      const sourcesInfo = document.createElement('p');
      sourcesInfo.className = 'search-sources-info';
      sourcesInfo.textContent = `Sources: ${data.sources.join(', ')}`;
      elements.searchResultsContent.appendChild(sourcesInfo);
    }
  }

  function createSearchResultCard(item) {
    const card = document.createElement('div');
    card.className = 'search-result-card';

    const poster = item.poster || 'https://via.placeholder.com/300x450/333/fff?text=No+Poster';
    const title = item.name || 'Unknown Title';
    const year = item.releaseInfo ? ` (${item.releaseInfo})` : '';
    const type = item.type === 'series' ? 'TV Series' : 'Movie';
    const rating = item.imdbRating ? `⭐ ${item.imdbRating}` : '';
    const source = item.source ? item.source.toUpperCase() : '';
    const foundVia = item.foundVia ? ` • ${item.foundVia}` : '';

    card.innerHTML = `
      <div class="search-result-poster">
        <img src="${poster}" alt="${title}" onerror="this.src='https://via.placeholder.com/300x450/333/fff?text=No+Poster'">
        <div class="search-result-overlay">
          <span class="search-result-type">${type}</span>
          ${source ? `<span class="search-result-source">${source}</span>` : ''}
        </div>
      </div>
      <div class="search-result-info">
        <h4 class="search-result-title">${title}${year}</h4>
        ${rating ? `<div class="search-result-rating">${rating}</div>` : ''}
        ${foundVia ? `<div class="search-result-found-via">${foundVia}</div>` : ''}
        ${item.description ? `<p class="search-result-description">${item.description.substring(0, 150)}${item.description.length > 150 ? '...' : ''}</p>` : ''}
        ${item.genres && item.genres.length > 0 ? `<div class="search-result-genres">${item.genres.slice(0, 3).join(', ')}</div>` : ''}
      </div>
    `;

    // Add click handler to copy IMDB ID
    card.addEventListener('click', () => {
      if (item.id) {
        navigator.clipboard.writeText(item.id).then(() => {
          showNotification('search', `Copied ID: ${item.id}`, 'success');
        }).catch(() => {
          showNotification('search', `ID: ${item.id}`, 'info');
        });
      }
    });

    return card;
  }

  async function loadConfig() {
    try {
      loadingState.set('config', true);
      const response = await fetch(`/api/${state.configHash}/config`);
      const data = await response.json();
      
      if (data.success) {
        state.userConfig = data.config;
        updateAllUIFromConfig();
        updateConnectionStatusFromConfig();
        updateSearchSourcesUI(); // Add this line
        
        // Check for potential shared config
        if (data.isPotentiallySharedConfig) {
          showSharedConfigNotice();
        }
      } else {
        showNotification('config', 'Failed to load configuration', 'error');
      }
    } catch (error) {
      console.error('Error loading config:', error);
      showNotification('config', 'Failed to load configuration', 'error');
    } finally {
      loadingState.set('config', false);
    }
  }

  async function handleTmdbCallback(requestToken, isApproved) {
    try {
      // Clean up URL by removing TMDB parameters
      const url = new URL(window.location);
      url.searchParams.delete('request_token');
      url.searchParams.delete('approved');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
      
      if (isApproved === 'false') {
        showNotification('connections', 'TMDB authorization was denied.', 'error', true);
        return;
      }
      
      showNotification('connections', 'Completing TMDB authentication...', 'info', true);
      
      // Complete the authentication using the request token
      const response = await fetch(`/${state.configHash}/tmdb/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          requestToken: requestToken,
          tmdbBearerToken: null // Environment variable will be used
        })
      });
      
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to authenticate with TMDB');
      }
      
      // Update state
      state.configHash = data.configHash;
      // Don't override the backend values - let them persist from the backend response
      
      updateURL();
      updateStremioButtonHref();
      
      // Reload configuration to get the actual session values from backend
      await loadConfig();
      
      updateTmdbConnectionUI(true, data.username);
      
      showNotification('connections', `Successfully connected to TMDB as ${data.username || 'user'}!`, 'success');
      await loadUserListsAndAddons();
      
    } catch (error) {
      console.error('TMDB Callback Error:', error);
      showNotification('connections', `TMDB Authentication Error: ${error.message}`, 'error', true);
    }
  }

  async function handleTraktCallback(code, traktState) {
    try {
      // Clean up URL by removing Trakt parameters
      const url = new URL(window.location);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
      
      showNotification('connections', 'Completing Trakt authentication...', 'info', true);
      
      // Complete the authentication using the authorization code
      const response = await fetch(`/${state.configHash}/trakt/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: code
        })
      });
      
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to authenticate with Trakt');
      }
      
      // Update state
      state.configHash = data.configHash;
      
      // Update Trakt connection state
      state.userConfig.traktAccessToken = 'connected'; // Don't store actual token
      state.userConfig.traktRefreshToken = 'connected';
      state.userConfig.traktExpiresAt = new Date(Date.now() + 86400000).toISOString(); // 24 hours from now
      if (data.uuid) state.userConfig.traktUuid = data.uuid;
      
      updateURL();
      updateStremioButtonHref();
      
      // Reload configuration to get the actual session values from backend
      await loadConfig();
      
      updateTraktUI(true);
      
      showNotification('connections', 'Successfully connected to Trakt!', 'success');
      await loadUserListsAndAddons();
      
    } catch (error) {
      console.error('Trakt Callback Error:', error);
      showNotification('connections', `Trakt Authentication Error: ${error.message}`, 'error', true);
    }
  }

  init();
});