const path = require('path');
const fs = require('fs');
const { convertToStremioFormat } = require('../addon');
const { fetchTraktListItems } = require('../integrations/trakt');
const { fetchListItems } = require('../integrations/mdblist');
const { fetchExternalAddonItems } = require('../integrations/externalAddons');

function setupAddonRoutes(app, userConfig, cache, addonInterface) {
  // Home page and configuration
  app.get('/', (req, res) => {
    // Check if API key is configured
    if (!userConfig.apiKey) {
      // Redirect to configuration page with a setup parameter
      res.redirect('/configure?setup=true');
    } else {
      res.redirect('/configure');
    }
  });

  app.get('/configure', (req, res) => {
    // Pass setup parameter to the frontend if needed
    const setupMode = req.query.setup === 'true';
    
    // Add a small script to set a setup flag for the frontend
    if (setupMode) {
      const configPage = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
      const configPageWithSetup = configPage.replace(
        '</head>',
        '<script>window.isFirstTimeSetup = true;</script></head>'
      );
      res.send(configPageWithSetup);
    } else {
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
    }
  });

  return app;
}

module.exports = setupAddonRoutes; 