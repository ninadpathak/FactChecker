// Main handler for all HTTP methods
export async function onRequest({ request, env }) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  // Handle GET for health check
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ ok: true, route: '/api/openrouter' }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Handle POST for actual API calls
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      const messages = body?.messages;
      const model = body?.model || 'deepseek/deepseek-chat-v3.1:free';
      const temperature = body?.temperature;

      if (!Array.isArray(messages) || messages.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing messages array' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Build request body - OpenRouter API format (matches curl example)
      const requestBody = { model, messages };
      if (temperature !== undefined) {
        requestBody.temperature = temperature;
      }

      const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      const text = await upstream.text();

      // If upstream failed, log the error for debugging
      if (!upstream.ok) {
        console.error('OpenRouter API error:', upstream.status, text);
      }

      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (err) {
      console.error('OpenRouter proxy error:', err);
      return new Response(JSON.stringify({ error: String(err && err.message || err) }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }

  // Method not allowed
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

