# AIOLists Stremio Addon

A Stremio addon to manage all your lists in one place, with powerful import, customization, and integration features.

#✨ Features
- **Unified List Management:** Import and manage lists from various sources in one place.
- **MDBList & Trakt URL Imports:** Directly import lists by pasting URLs from MDBList.com and Trakt.tv.
- **Trakt Integration:** Connect your Trakt account to access personal lists, watchlist, recommendations, trending, and popular content.
- **External Addon Importing:** Import lists from other Stremio addons, should support most popular ones.
- **Sorting:** If the sorting option exists it's there.
- **List Customization:**
    - **Reorder:** Drag and drop to arrange lists as you like.
    - **Rename:** Give custom names to any list for better organization.
    - **Merge/Split:** If a list contains both movies and series you can merge it into a single Stremio row so it doesn't take up more space than it needs to.
- **Instant Watchlist Updates:** Fetches watchlist content on load.
- **RPDB Support:** Optional RatingPosterDB (RPDB) integration for enhanced poster images across all your lists (requires your own RPDB API key).
- **Configurable Genre Filtering:** If you add too many list you might hit the 8kb manifest size limit. By disabling genre filtering the manifest size should half so you can have more lists.
- **Discovery Lists:** Randomly selected MDBList from a set list of users, a new random list is delivered everytime you refresh the catalog.
- **Share Your Setup:** Generate a shareable hash of your AIOLists configuration (list order, names, imported addons) to share with others.

## Deployment

The easiest way to host this project for free is through hugging face.

**Steps:**
1. Create a huggingface account. https://huggingface.co/
2. Go to https://huggingface.co/new-space?sdk=docker
3. Fill in the Space name and Create Space
4. Scroll down to "Create your Dockerfile" and press "create the Dockerfile" at the bottom of the section.
5. Paste in
    ```bash
    FROM ghcr.io/sebastianmorel/aiolists:latest
    ENV PORT=7860
    ```
6. Press "Commit new file to main"
7. Wait for it to finish building and you should have your own instance.

#### Deploying on Railway, Render, Fly.io, etc.

Most modern PaaS providers that support Docker can deploy AIOLists.
-   **Railway**: Connect your GitHub repository and let Railway build from the `Dockerfile`. Set the `PORT` environment variable if needed (Railway usually injects it).
-   **Render**: Create a new "Web Service", connect your repository, and choose Docker as the environment. Render will build and deploy from the `Dockerfile`. Set the `PORT` environment variable.
-   **Fly.io**: Use the `flyctl` CLI to launch a new app. It can often detect and use your `Dockerfile`.

### Deploy with Docker

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

### Deploy on Your Own Node.js Server

You can also run the addon directly with Node.js if you prefer not to use Docker.

1.  **Clone your fork:**
    ```bash
    git clone https://github.com/YOUR_USERNAME/AIOLists.git
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

---

## License

MIT
