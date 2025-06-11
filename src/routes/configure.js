// src/routes/configure.js
const path = require('path');

module.exports = function(router) {
  router.get('/', (req, res) => {
    res.redirect('/configure');
  });

  router.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  // Handle TMDB callback redirects at /{configHash}/configure
  router.get('/:configHash/configure', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  router.get('/import-shared/:shareableHash', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });
};