const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT, IS_PRODUCTION } = require('./config');
const configureRoutes = require('./routes');

async function initializeApp() {
  try {
    console.log("Initializing Express app (Worker env:", process.env.FOR_WORKERS,")");
    const app = express();

    app.use(cors());
    app.use(express.json());
    if (process.env.FOR_WORKERS !== 'true') {
        app.use(express.static(path.join(__dirname, '..', 'public')));
    }

    const routers = configureRoutes(app);
    app.routes = routers; 

    if (process.env.FOR_WORKERS !== 'true') {
      app.listen(PORT, () => {
        if (!IS_PRODUCTION) {
          console.log(`AIOLists Stremio Addon running on port ${PORT}`);
          console.log(`Admin panel: http://localhost:${PORT}/configure`);
        }
      });
      }

    return app;
  } catch (err) {
    if (!IS_PRODUCTION) {
      console.error("Failed to initialize application:", err);
    }
    throw err;
  }
}

if (require.main === module && process.env.FOR_WORKERS !== 'true') {
  initializeApp().catch(err => {
    console.error('Applikationen failed to start:', err);
    process.exit(1);
  });
} else {
  module.exports = { initializeApp };
}