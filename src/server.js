// src/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT, IS_PRODUCTION } = require('./config');
const configureRoutes = require('./routes');
const { setupDatabase } = require('./db');

async function initializeApp() {
  try {
    await setupDatabase();
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'public')));

    configureRoutes(app);
    
    app.listen(PORT, () => {
      if (!IS_PRODUCTION) {
        console.log(`AIOLists Stremio Addon running on port ${PORT}`);
        console.log(`Admin panel: http://localhost:7000/configure`);
      }
    });
    
    return app;
  } catch (err) {
    if (!IS_PRODUCTION) {
      console.error("Failed to initialize application:", err);
    }
    throw err;
  }
}

if (require.main === module) {
  initializeApp().catch(err => {
    console.error('Application failed to start:', err);
    process.exit(1);
  });
} else {
  module.exports = { initializeApp };
}