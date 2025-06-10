# Environment Variables Setup Guide

This guide explains how to configure AIOLists using environment variables for advanced setups.

## Quick Setup

Create a `.env` file in the root directory:

```bash
# TMDB Configuration  
TMDB_REDIRECT_URI=http://localhost:3000/tmdb/callback
TMDB_BEARER_TOKEN=your_tmdb_bearer_token_here
```

## Environment Variables Explained

### TMDB_REDIRECT_URI
- **Purpose**: Where users are redirected after TMDB authentication
- **Default**: None (manual process)
- **Required**: No
- **Example**: `http://localhost:3000/tmdb/callback`

### TMDB_BEARER_TOKEN
- **Purpose**: Your TMDB Read Access Token
- **Default**: None (enter it in the UI)
- **Required**: No
- **Example**: `eyJhbGciOiJIUzI1NiJ9...`

## Behavior Changes with Environment Variables

### When TMDB_BEARER_TOKEN is set:
- The TMDB Bearer Token field is hidden in the UI
- Users don't need to provide their own token
- TMDB features work automatically

### When redirect URIs are configured:
- "Connect to TMDB" button redirects directly to TMDB
- No manual code copying required

### When both TMDB_BEARER_TOKEN and redirect URIs are set:
- Fully automated OAuth flow
- Users get redirected back to your app after authentication

## Getting Your Tokens

### TMDB Bearer Token
1. Go to https://www.themoviedb.org/settings/api
2. Create an API key if you don't have one
3. Copy the "Read Access Token" (starts with `eyJ`)

## Production Deployment

For production deployments, set these environment variables in your hosting platform:

**Heroku:**
```bash
heroku config:set TMDB_BEARER_TOKEN=your_token_here
heroku config:set TMDB_REDIRECT_URI=https://yourapp.herokuapp.com/tmdb/callback
```

**Docker:**
```bash
docker run -e TMDB_BEARER_TOKEN=your_token_here -e TMDB_REDIRECT_URI=https://yourapp.com/tmdb/callback aiolists
```

**Railway/Render:**
Add environment variables in your platform's dashboard.

## Security Notes

- Never commit `.env` files to version control
- Use secure HTTPS URLs for redirect URIs in production
- Keep your bearer tokens private
- Rotate tokens periodically for security