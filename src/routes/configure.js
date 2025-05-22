// src/routes/configure.js
const path = require('path');
const fs = require('fs');

module.exports = function(router) {
  router.get('/', (req, res) => {
    // Omdirigera alltid till /configure om ingen configHash finns,
    // frontend hanterar skapandet av ny config.
    res.redirect('/configure');
  });

  router.get('/configure', (req, res) => {
    // Servera huvudsakliga index.html för konfigurationssidan
    // Frontend (script.js) kommer att hantera logiken för att skapa/ladda configHash.
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });
};