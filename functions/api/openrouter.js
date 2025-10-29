export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const messages = body?.messages;
    const model = body?.model || 'deepseek/deepseek-chat-v3.1:free';
    const temperature = body?.temperature;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing messages array' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const origin = new URL(request.url).origin;

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

    return new Response(text, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('OpenRouter proxy error:', err);
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// Optional: support preflight or accidental GET
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export const onRequestGet = () => new Response(JSON.stringify({ ok: true, route: '/api/openrouter' }), { headers: { 'Content-Type': 'application/json' } });

