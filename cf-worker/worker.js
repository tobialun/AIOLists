// ./cf-worker/worker.js
import { Router, ThrowableRouter, withParams } from 'itty-router';
import { initializeApp } from '../src/server'; // Adjusted path
import {
    handleApiRequest,
    handleConfigureRequest,
    handleManifestRequest,
    handleCatalogRequest,
    handleStaticConfigRequest,
    handleRootRedirect,
    handleImportSharedRequest
} from './requestHandlers'; // We'll create this helper

// Initialize itty-router
const router = ThrowableRouter({ base: '/' });

let app;
let isAppInitialized = false;

async function ensureAppInitialized() {
    if (!isAppInitialized) {
        try {
            process.env.FOR_WORKERS = 'true'; // Signal to server.js not to listen
            app = await initializeApp();
            isAppInitialized = true;
            console.log("Express app initialized for Cloudflare Worker.");
        } catch (err) {
            console.error("Failed to initialize Express app for Cloudflare Worker:", err);
            throw new Error("Application initialization failed."); // So the worker shows an error
        }
    }
    return app;
}

// Middleware to ensure app is initialized and to attach params
const appInitializer = async (request, env) => {
    request.app = await ensureAppInitialized();
    request.env = env; // Attach env to request for handlers
     // itty-router v4+ automatically parses query parameters into request.query
};

// Attach params to request for all routes
router.all('*', withParams);
router.all('*', appInitializer);


// --- API Routes (Handled by api.js logic) ---
// These need to be mapped carefully. `handleApiRequest` will be a new function.
router.all('/api/:configHash/shareable-hash', (request) => handleApiRequest(request, 'shareableHash'));
router.post('/api/:configHash/config/genre-filter', (request) => handleApiRequest(request, 'genreFilter'));
router.post('/api/:configHash/apikey', (request) => handleApiRequest(request, 'saveApiKeys'));
router.post('/api/:configHash/trakt/auth', (request) => handleApiRequest(request, 'traktAuth'));
router.post('/api/:configHash/trakt/disconnect', (request) => handleApiRequest(request, 'traktDisconnect'));
router.post('/api/:configHash/import-list-url', (request) => handleApiRequest(request, 'importListUrl'));
router.post('/api/:configHash/import-addon', (request) => handleApiRequest(request, 'importAddon'));
router.post('/api/:configHash/remove-addon', (request) => handleApiRequest(request, 'removeAddon'));
router.post('/api/:configHash/lists/order', (request) => handleApiRequest(request, 'updateListOrder'));
router.post('/api/:configHash/lists/names', (request) => handleApiRequest(request, 'updateListNames'));
router.post('/api/:configHash/lists/visibility', (request) => handleApiRequest(request, 'updateListVisibility'));
router.post('/api/:configHash/lists/remove', (request) => handleApiRequest(request, 'removeLists'));
router.post('/api/:configHash/lists/sort', (request) => handleApiRequest(request, 'updateListSort'));
router.post('/api/:configHash/lists/merge', (request) => handleApiRequest(request, 'updateListMerge'));
router.get('/api/:configHash/lists', (request) => handleApiRequest(request, 'getUserLists')); // From api.js, moved under /api for clarity
router.get('/api/trakt/login', (request) => handleApiRequest(request, 'traktLoginRedirect')); // From api.js
router.post('/api/config/create', (request) => handleApiRequest(request, 'createConfig'));
router.post('/api/validate-keys', (request) => handleApiRequest(request, 'validateKeys'));


// --- Stremio Routes & Configuration UI Routes ---
router.get('/:configHash/manifest.json', handleManifestRequest);
router.get('/:configHash/catalog/:type/:id/:extra?.json', handleCatalogRequest); // Matches with or without extra
router.get('/:configHash/catalog/:type/:id.json', handleCatalogRequest); // Matches without extra

// Configuration UI and related routes (from configure.js and api.js)
// These will be served by Workers Sites if `[site]` is configured in wrangler.toml for `./public`
// However, if they are dynamic or need the configHash, they might need specific handlers.
// For paths like /:configHash/configure, Workers Sites won't match directly if it's looking for /configure/index.html
// We assume Workers Sites serves index.html from public for /configure, /import-shared/*, and /
// The worker handles API and dynamic manifest/catalog.

// If Workers Sites is serving index.html for these, these specific routes might not be hit in the worker
// unless the path doesn't exist as a static file.
router.get('/', handleRootRedirect); // Redirects / to /configure
router.get('/configure', (request) => handleConfigureRequest(request)); // Serves public/index.html
router.get('/:configHash/configure', (request) => handleConfigureRequest(request, request.params.configHash)); // Serves public/index.html
router.get('/import-shared/:shareableHash', (request) => handleImportSharedRequest(request)); // Serves public/index.html


// Specific config endpoint that was under /:configHash/config
router.get('/:configHash/config', handleStaticConfigRequest); // Serves the JSON config

// Catch-all for unhandled routes by the worker (static assets should be served by Workers Sites)
router.all('*', () => new Response('Worker: Not Found.', { status: 404 }));

export default {
    async fetch(request, env, ctx) {
        try {
            return await router.handle(request, env, ctx);
        } catch (err) {
            console.error('Worker Fetch Error:', err, err.stack);
            const errorResponse = {
                success: false,
                error: err.message || 'An unexpected error occurred in the worker.',
                details: err.cause || (err.errors ? JSON.stringify(err.errors) : null)
            };
            return new Response(JSON.stringify(errorResponse), {
                status: err.status || 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    },
};