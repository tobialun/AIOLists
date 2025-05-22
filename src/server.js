const express = require('express');
const cors = require('cors');
const path = require('path');
const { defaultConfig, PORT, IS_PRODUCTION } = require('./config');
const configureRoutes = require('./routes'); // Kommer från src/routes/index.js

async function initializeApp() {
  try {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Konfigurera rutter
    configureRoutes(app);
    
    app.listen(PORT, () => {
      if (!IS_PRODUCTION) {
        console.log(`AIOLists Stremio Addon körs på port ${PORT}`);
        console.log(`Konfigurationspanel: http://localhost:${PORT}/configure`);
      }
    });
    
    return app;
  } catch (err) {
    if (!IS_PRODUCTION) {
      console.error("Misslyckades med att initiera applikationen:", err);
    }
    throw err;
  }
}

if (require.main === module) {
  initializeApp().catch(err => {
    console.error('Applikationen kunde inte starta:', err);
    process.exit(1);
  });
} else {
  module.exports = { initializeApp };
}