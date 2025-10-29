# Cloudflare Pages Functions

This directory contains serverless functions that run on Cloudflare Pages.

## Deployment

These functions are automatically deployed when you push to your Cloudflare Pages project.

### Required Environment Variables

Set these in your Cloudflare Pages dashboard (Settings > Environment variables):

- `OPENROUTER_API_KEY` - Your OpenRouter API key for the fallback AI provider

## Functions

### `/api/openrouter`

Proxy for OpenRouter AI API calls when no OpenAI key is provided by the user.

- **Method**: POST
- **Body**: `{ model, messages, temperature? }`
- **Returns**: OpenRouter API response (DeepSeek v3.1 free model)

## Local Testing

To test locally, you need Wrangler:

```bash
npm install -g wrangler
wrangler pages dev . --compatibility-date=2024-01-01
```

Then visit `http://localhost:8788` and the functions will be available at `/api/*` routes.

## File Structure

```
functions/
  api/
    openrouter.js    # Creates route: /api/openrouter
```

File-based routing: `functions/api/openrouter.js` → `/api/openrouter`
