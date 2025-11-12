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

        // Get the raw HTML
        const html = await response.text();

        // Extract readable text and a small sample of links server-side
        const { text, links } = extractTextAndLinks(html, response.url || targetUrl);

        // Return text-only payload with status metadata
        return new Response(JSON.stringify({
            text,
            links,
            status: {
                url: response.url || targetUrl,
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

/**
 * Very lightweight HTML -> text extractor suitable for Workers
 * - Strips scripts/styles/nav/header/footer/iframes
 * - Extracts body content if present
 * - Converts block tags to whitespace and collapses
 * - Attempts basic entity decoding for common entities
 * Also extracts a small sample of page links and resolves them absolute
 */
function extractTextAndLinks(rawHtml, baseUrl) {
    try {
        if (!rawHtml || typeof rawHtml !== 'string') {
            return { text: '', links: [] };
        }

        let html = rawHtml;

        // Remove comments first to avoid confusing other regexes
        html = html.replace(/<!--([\s\S]*?)-->/g, '');

        // Remove non-content blocks
        html = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
            .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
            .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
            .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
            .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');

        // Focus on body if present
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) html = bodyMatch[1];

        // Extract a small sample of on-page links (first 10)
        const links = [];
        const anchorRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        const stripTags = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        while ((m = anchorRegex.exec(html)) && links.length < 10) {
            try {
                const href = m[1];
                const text = stripTags(m[2]);
                if (!href || !text) continue;
                const abs = new URL(href, baseUrl).toString();
                links.push({ text, url: abs });
            } catch (_) { /* ignore bad URLs */ }
        }

        // Convert block-level tags to newlines to keep some structure
        html = html
            .replace(/<(\/?)(p|div|section|article|main|ul|ol|li|h\d|br|tr|table|thead|tbody|footer|header)[^>]*>/gi, '\n')
            // Remove any remaining tags
            .replace(/<[^>]+>/g, ' ');

        // Decode a handful of common entities
        const decodeEntities = (s) => s
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        // Collapse whitespace and trim; keep a generous excerpt
        let text = decodeEntities(html).replace(/\s+/g, ' ').trim();
        if (text.length > 5000) text = text.slice(0, 5000);

        return { text, links };
    } catch (e) {
        return { text: '', links: [] };
    }
}
