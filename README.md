# MDBList Stremio Addon

A Stremio addon for MDBList integration that allows you to view your MDBList and Trakt lists directly in Stremio.

## Features

- Integrate your MDBList watchlists and custom lists directly in Stremio
- Optional Trakt integration for accessing your Trakt lists
- Custom list ordering and visibility control
- Admin panel for easy configuration

## Production Deployment

This addon can be deployed to a variety of hosting platforms. Below are instructions for common deployment options:

### 1. Deploying to Heroku

1. Create a Heroku account if you don't have one
2. Install the Heroku CLI
3. Clone this repository
4. Login to Heroku:
   ```
   heroku login
   ```
5. Create a new Heroku app:
   ```
   heroku create your-app-name
   ```
6. Deploy to Heroku:
   ```
   git push heroku main
   ```

### 2. Deploying to Vercel

1. Install Vercel CLI:
   ```
   npm i -g vercel
   ```
2. Login to Vercel:
   ```
   vercel login
   ```
3. Deploy:
   ```
   vercel --prod
   ```

### 3. Deploying to Railway

1. Create a Railway account
2. Connect your GitHub repository
3. Set environment variables if needed
4. Deploy the app

### 4. Running in Production Mode Locally

To run the addon in production mode locally:

```
npm run prod
```

### 5. Docker Deployment

You can also use Docker to deploy the addon:

1. Build the Docker image:
   ```
   docker build -t aiolists-addon .
   ```

2. Run the container:
   ```
   docker run -p 7000:7000 -e NODE_ENV=production aiolists-addon
   ```

## Configuration

After deployment, you need to configure the addon:

1. Access the admin panel at `http://your-deployment-url/configure`
2. Add your MDBList API key
3. Optionally add your RPDB API key for posters
4. Configure Trakt integration if needed

## Using the Addon in Stremio

1. Open Stremio
2. Go to the addons page
3. Paste your addon URL (e.g., `https://your-deployment-url/manifest.json`)
4. Click "Install"

## License

MIT