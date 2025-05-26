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
    git clone https://github.com/YOUR_USERNAME/AIOLists.git # Replace YOUR_USERNAME if you forked
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

---

## Support

If you find this project useful, the best way to support me is to **star this repository** on GitHub!
Your stars help others discover the project and motivate further development. Thank you!

---

## License

MIT
