# AIOLists Stremio Addon

A Stremio addon to manage all your lists in one place, with powerful import, customization, and integration features.

## Features

* **Import MDBList and Trakt lists through URL**: Easily add movie and TV show lists from MDBList.com and Trakt.tv by pasting a list's URL.
* **Trakt Integration**: Access your personal Trakt lists, watchlist, recommendations, and more directly in Stremio.
* **External Addon List Importing**: Supports importing catalogs from other Stremio addons. (Anime catalogs can benefit from RPDB integration if you add your RPDB key in AIOLists).
* **Advanced Sorting Options**: Customize the order of items within your MDBList and Trakt lists with various sorting criteria.
* **Reorder & Rename Lists**: Personalize your Stremio experience by rearranging and renaming any imported or integrated list.
* **Merge/Split Lists**: Combine lists that contain both movies and series into a single catalog, or split them into separate movie and TV show catalogs.
* **Share Your Setup**: Easily share your complete AIOLists configuration (list order, names, imported addons, etc.) with others via a simple hash. (API keys are never shared).
* **Instant Watchlist Updates**: Changes to your Trakt watchlist are reflected in Stremio almost immediately.

## Production Deployment

The easiest way to get started with AIOLists is to self-host it. This gives you full control over your configuration and ensures your API keys remain private.

### 1. Deploy with Docker (Recommended for most self-hosting)

This addon includes a `Dockerfile` for easy deployment on any platform that supports Docker.

**Steps:**

1.  **Clone your fork (or the original repository):**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/AIOLists.git](https://github.com/YOUR_USERNAME/AIOLists.git) # Replace YOUR_USERNAME if you forked
    cd AIOLists
    ```

2.  **Build the Docker image:**
    ```bash
    docker build -t aiolists-addon .
    ```

3.  **Run the container:**
    ```bash
    docker run -d -p 7000:7000 -e NODE_ENV=production --restart unless-stopped aiolists-addon
    ```
    Your addon will be available at `http://YOUR_SERVER_IP:7000`. You can then access the configuration panel at `http://YOUR_SERVER_IP:7000/configure`.

#### Deploying on Hugging Face Spaces

You can easily deploy AIOLists on Hugging Face Spaces using their Docker Space option:

1.  Create a new Space on Hugging Face.
2.  Choose "Docker" as the Space type.
3.  For the Docker template, select "FROM ghcr.io/..." or a similar option that lets you specify an existing image.
4.  Use the following as the basis for your Dockerfile in Hugging Face, or point directly to the image if allowed:
    ```dockerfile
    FROM ghcr.io/sebastianmorel/aiolists:latest
    ENV PORT=7860
    ```
    *(Note: The `:latest` tag assumes `docker-publish.yml` pushes a `latest` tag. If it only pushes versioned or branch tags like `dev`, you'll need to use one of those, e.g., `ghcr.io/sebastianmorel/aiolists:dev`)*
5.  Hugging Face will expose your application, typically on port `7860` (as configured by `ENV PORT=7860`). Access the `/configure` path on the URL provided by Hugging Face.

#### Deploying on Railway, Render, Fly.io, etc.

Most modern PaaS providers that support Docker can deploy AIOLists.
-   **Railway**: Connect your GitHub repository and let Railway build from the `Dockerfile`. Set the `PORT` environment variable if needed (Railway usually injects it).
-   **Render**: Create a new "Web Service", connect your repository, and choose Docker as the environment. Render will build and deploy from the `Dockerfile`. Set the `PORT` environment variable.
-   **Fly.io**: Use the `flyctl` CLI to launch a new app. It can often detect and use your `Dockerfile`.

### 2. Deploy on Your Own Node.js Server (Manual)

You can also run the addon directly with Node.js if you prefer not to use Docker.

1.  **Clone your fork:**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/AIOLists.git](https://github.com/YOUR_USERNAME/AIOLists.git)
    cd AIOLists
    ```
2.  **Install dependencies:**
    ```bash
    npm install --production
    ```
3.  **Start the server:**
    ```bash
    npm run prod
    ```
    The server will start on port 7000 by default. Access `/configure`.

### 3. Deploy on Cloudflare Workers (Advanced)

You can deploy AIOLists as a serverless function on Cloudflare Workers for a potentially free and highly available hosting solution. This method is more advanced and requires familiarity with Cloudflare and the `wrangler` CLI.

**Prerequisites:**

* A Cloudflare account.
* Node.js and npm installed.
* `wrangler` CLI installed: `npm install -g wrangler`
* Login to wrangler: `wrangler login`

**Steps:**

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/YOUR_USERNAME/AIOLists.git](https://github.com/YOUR_USERNAME/AIOLists.git)
    cd AIOLists
    ```

2.  **Create/Update `wrangler.toml`:**
    Ensure you have a `wrangler.toml` file in the root of your project:
    ```toml
    name = "aiolists-worker" # Choose a unique name for your worker
    main = "src/worker.js"  # Entry point for the worker
    compatibility_date = "2024-05-20" # Use a recent date
    # account_id = "YOUR_CLOUDFLARE_ACCOUNT_ID" # Usually inferred, but can be set

    # If serving static assets (like the /configure page) through Workers Sites:
    # [site]
    # bucket = "./public" # Path to your static assets (index.html, css, js)
    # entry-point = "src" # Or adjust if worker.js is elsewhere

    # If you need to store config hashes or other small data, consider KV:
    # [[kv_namespaces]]
    # binding = "AIO_CONFIGS"
    # id = "your_kv_namespace_id_for_configs" # Create this in the Cloudflare dashboard
    ```
    *You will need to ensure `src/worker.js` is correctly set up to handle requests and adapt the Express application, and that static assets from the `public` directory are served (e.g., using Workers Sites by uncommenting the `[site]` section or handling them in `worker.js` via KV).*

3.  **Adapt `src/server.js` and Create `src/worker.js`:**
    The Express application needs to be adapted to the Cloudflare Workers environment.
    * Modify `src/server.js` so that `initializeApp()` can return the `app` instance without calling `app.listen()` when a specific environment variable (e.g., `process.env.FOR_WORKERS`) is set.
    * Create a `src/worker.js` file. This file will import the adapted Express app and use an event listener for `Workspace` requests to route them to your application logic. This is a complex step that involves shimming Node.js request/response objects or using a compatibility layer. Refer to Cloudflare documentation and community examples for adapting Express apps.

4.  **Install Dependencies:**
    ```bash
    npm install
    ```

5.  **Deploy to Cloudflare Workers:**
    ```bash
    wrangler deploy
    ```
    After deployment, `wrangler` will provide you with the URL for your worker. Access `YOUR_WORKER_URL/configure`.

> **Tip:** No matter how you deploy, once it's running, head to `YOUR_APP_URL/configure` to set up your API keys and lists!

---

## Support

If you find this project useful, the best way to support me is to **star this repository** on GitHub!

---

## License

MIT