# Deploying to Railway

This guide explains how to deploy the Hustle Incognito server example to Railway.

## Quick Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/EmblemCompany/hustle-incognito)

## Manual Deployment

### Prerequisites

- A [Railway account](https://railway.app/)
- Your Hustle API key

### Steps

1. **Create a new project on Railway**
   - Go to [Railway Dashboard](https://railway.app/dashboard)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your fork of `hustle-incognito` or the main repository

2. **Configure Environment Variables**

   In your Railway project settings, add the following environment variables:

   **Required:**
   - `HUSTLE_API_KEY` - Your Hustle Incognito API key

   **Optional:**
   - `VAULT_ID` - Default vault ID (defaults to "default")
   - `HUSTLE_API_URL` - Custom API URL (defaults to https://agenthustle.ai)
   - `DEBUG` - Enable debug mode (set to "true" to enable)

3. **Deploy**

   Railway will automatically:
   - Install dependencies (`npm install`)
   - Build the SDK (`npm run build`)
   - Start the server (`npm run example:server`)

4. **Access Your Deployment**

   Once deployed, Railway will provide you with a public URL. The server UI will be available at:
   ```
   https://your-app-name.railway.app
   ```

## Configuration

The Railway deployment is configured via `railway.json`:

```json
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm install && npm run build"
  },
  "deploy": {
    "startCommand": "npm run example:server",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

## Environment Variables

Set these in your Railway project settings:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HUSTLE_API_KEY` | ✅ Yes | - | Your Hustle Incognito API key |
| `VAULT_ID` | ❌ No | `default` | Default vault ID for requests |
| `HUSTLE_API_URL` | ❌ No | `https://agenthustle.ai` | Custom API endpoint URL |
| `DEBUG` | ❌ No | `false` | Enable debug logging |
| `PORT` | ❌ No | `3000` | Server port (Railway sets this automatically) |

## Troubleshooting

### Build Fails

Make sure your `package.json` includes all required dependencies:
- `mcp-framework`
- `zod`
- `dotenv`

### Server Won't Start

Check that:
1. `HUSTLE_API_KEY` environment variable is set
2. Build completed successfully
3. The `dist` directory was created during build

### API Errors

Verify:
1. Your API key is valid
2. `HUSTLE_API_URL` is set correctly (if using custom endpoint)
3. Check Railway logs for detailed error messages

## Local Testing

Before deploying to Railway, test locally:

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Set environment variables
export HUSTLE_API_KEY=your-api-key-here
export VAULT_ID=your-vault-id
export PORT=3000

# Run the server
npm run example:server
```

Visit `http://localhost:3000` to test the UI.

## Railway CLI

You can also deploy using the Railway CLI:

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Set environment variables
railway variables set HUSTLE_API_KEY=your-api-key-here

# Deploy
railway up
```

## Additional Resources

- [Railway Documentation](https://docs.railway.app/)
- [Hustle Incognito SDK Documentation](./README.md)
- [Examples Documentation](./examples/README.md)
