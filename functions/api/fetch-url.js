/**
 * Cloudflare Pages Function: CORS Proxy
 * Fetches URLs on behalf of the client to bypass CORS restrictions
 */

export async function onRequest(context) {
    // Handle CORS preflight
    if (context.request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    try {
        const url = new URL(context.request.url);
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
            return new Response(JSON.stringify({
                error: 'Missing url parameter'
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // Validate URL
        let parsedUrl;
        try {
            parsedUrl = new URL(targetUrl);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                throw new Error('Invalid protocol');
            }
        } catch (e) {
            return new Response(JSON.stringify({
                error: 'Invalid URL'
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        console.log(`[Fetch-URL] Fetching: ${targetUrl}`);

        // Fetch the target URL
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; FactChecker/2.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            // Timeout after 10 seconds
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            return new Response(JSON.stringify({
                error: `Failed to fetch: ${response.status} ${response.statusText}`,
                status: response.status
            }), {
                status: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // Get the content
        const contents = await response.text();

        // Return in the same format as AllOrigins for compatibility
        return new Response(JSON.stringify({
            contents: contents,
            status: {
                url: targetUrl,
                content_type: response.headers.get('content-type'),
                http_code: response.status
            }
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
            }
        });

    } catch (error) {
        console.error('[Fetch-URL] Error:', error);

        return new Response(JSON.stringify({
            error: error.message || 'Internal server error',
            details: error.toString()
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
