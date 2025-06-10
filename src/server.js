// Load environment variables first
require('dotenv').config();

// Debug environment variable loading
console.log(`[DEBUG] Server startup - TMDB_BEARER_TOKEN env var exists: ${!!process.env.TMDB_BEARER_TOKEN}`);
console.log(`[DEBUG] Server startup - TMDB_BEARER_TOKEN length: ${process.env.TMDB_BEARER_TOKEN ? process.env.TMDB_BEARER_TOKEN.length : 'null/undefined'}`);

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT, IS_PRODUCTION, TMDB_BEARER_TOKEN } = require('./config');
const configureRoutes = require('./routes');

console.log(`[DEBUG] Server startup - Config TMDB_BEARER_TOKEN: ${TMDB_BEARER_TOKEN ? 'SET' : 'NULL/UNDEFINED'}`);
console.log(`[DEBUG] Server startup - Config TMDB_BEARER_TOKEN length: ${TMDB_BEARER_TOKEN ? TMDB_BEARER_TOKEN.length : 'null/undefined'}`);

async function initializeApp() {
  try {
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