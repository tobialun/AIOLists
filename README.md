# AIOLists Stremio Addon

A Stremio addon to manage all your lists in one place, with powerful import, customization, and integration features.

## Key Features

- **Import lists from any addon**: Bring in catalogs from any Stremio addon.
- **Rename and rearrange all your lists**: Personalize your lists with custom names and drag-and-drop ordering.
- **Trakt integration**: Access your Trakt lists, watchlist, recommendations, and more directly in Stremio.
- **Import any MDBList through URL**: Add any MDBList by connecting your account or pasting a list's URL.
- **Full RPDB support**: RatingPosterDB (RPDB) support for all the lists.

## Production Deployment

The easiest way to use AIOLists is to **fork this repository** and deploy it to your own server or cloud platform. This gives you full control over your lists and configuration.

### 1. Deploy with Docker (Recommended)

This addon includes a ready-to-use `Dockerfile`. You can deploy it anywhere Docker is supported:

```bash
# Clone your fork of this repository
git clone https://github.com/YOUR_USERNAME/AIOLists.git
cd AIOLists

# Build the Docker image
docker build -t aiolists-addon .

# Run the container
docker run -p 7000:7000 -e NODE_ENV=production aiolists-addon
```

Your addon will be available at `http://localhost:7000/manifest.json`.

### 2. Deploy on Your Own Node.js Server

You can also run the addon directly with Node.js:

```bash
# Clone your fork of this repository
git clone https://github.com/YOUR_USERNAME/AIOLists.git
cd AIOLists

# Install dependencies
npm install --production

# Start the server
npm run prod
```

The server will start on port 7000 by default.

### 3. Deploy to Cloud Platforms

You can deploy to any platform that supports Node.js and Docker, such as:
- **Railway**
- **Render**
- **Fly.io**
- **Heroku** (with Docker support)
- **Vercel** (as a Node.js serverless function, with some adaptation)

> **Tip:** Fork the repo, configure your deployment, and set up your own admin panel at `/configure`.

---

## Support

If you find this project useful, the best way to support me is to **star this repository** on GitHub!  
Your stars help others discover the project and motivate further development. Thank you!

---

## License

MIT