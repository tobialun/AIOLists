// src/routes/index.js
const express = require('express');
const setupApiRoutes = require('./api');
const setupConfigureRoutes = require('./configure');

module.exports = function(app) {
  const apiRouter = express.Router();
  const configureRouter = express.Router();

  setupApiRoutes(apiRouter); // api.js kommer att hantera sin egen logik för configHash
  setupConfigureRoutes(configureRouter);

  app.use('/api', apiRouter); // För /api/config/create, /api/validate-keys etc.
  app.use('/', configureRouter); // För /, /configure
  app.use('/', apiRouter); // För /:configHash/* rutter
};