/**
 * Agent Manager Module
 * Processes links sequentially with improved verification
 * First tries direct HTML fetch, falls back to Perplexity if needed
 */

const AgentManager = {
    openaiApiKey: null,
    openrouterApiKey: null,
    corsProxyUrl: '/api/fetch-url?url=',

    /**
     * Set API keys
     * @param {string} openaiKey - OpenAI API key
     * @param {string} openrouterKey - OpenRouter API key (fallback)
     */
    setApiKeys(openaiKey, openrouterKey) {
        this.openaiApiKey = openaiKey;
        this.openrouterApiKey = openrouterKey;
    },

    /**
     * Fact check links with parallel fetching and parallel verification
     * @param {Array} links - Array of link objects
     * @param {Function} onUpdate - Callback for each result
     * @returns {Promise<Array>} Array of verification results
     */
    async factCheckLinks(links, onUpdate) {
        const results = new Array(links.length);
        const fetchBatchSize = 10;  // Fetch 10 in parallel
        const verifyBatchSize = 5;   // Verify 5 in parallel

        // Step 1: Fetch all links in batches of 10
        const allFetchedData = [];

        for (let i = 0; i < links.length; i += fetchBatchSize) {
            const batch = links.slice(i, i + fetchBatchSize);
            const batchIndices = Array.from({ length: batch.length }, (_, idx) => i + idx);

            // Show "fetching" status for current batch
            batchIndices.forEach(idx => {
                if (onUpdate) {
                    onUpdate(idx, {
                        originalUrl: links[idx].url,
                        status: 'fetching',
                        analysis: ''
                    });
                }
            });

            // Fetch all links in batch in parallel (10 at a time)
            const fetchPromises = batch.map((link, batchIdx) =>
                this.fetchLinkData(link, i + batchIdx, onUpdate)
            );

            const fetchedBatch = await Promise.all(fetchPromises);
            allFetchedData.push(...fetchedBatch);
        }

        // Step 2: Verify all links in batches of 5 in parallel
        for (let i = 0; i < links.length; i += verifyBatchSize) {
            const batch = links.slice(i, i + verifyBatchSize);
            const batchIndices = Array.from({ length: batch.length }, (_, idx) => i + idx);

            // Show "checking" status for current batch
            batchIndices.forEach(idx => {
                if (onUpdate) {
                    onUpdate(idx, {
                        originalUrl: links[idx].url,
                        status: 'checking',
                        analysis: ''
                    });
                }
            });

            // Verify 5 links in parallel with OpenAI
            const verifyPromises = batch.map((link, batchIdx) => {
                const globalIdx = i + batchIdx;
                const data = allFetchedData[globalIdx];
                return this.verifyLink(link, data, globalIdx, onUpdate);
            });

            const verifiedBatch = await Promise.all(verifyPromises);

            // Store results
            verifiedBatch.forEach((result, batchIdx) => {
                const globalIdx = i + batchIdx;
                results[globalIdx] = result;
            });
        }

        return results;
    },

    /**
     * Fetch link data (HTTP status + content) in parallel
     * @param {Object} link - Link object
     * @param {number} index - Index for tracking
     * @param {Function} onUpdate - Callback for updates
     * @returns {Promise<Object>} Fetched data
     */
    async fetchLinkData(link, index, onUpdate) {
        const data = {
            link: link,
            httpStatus: null,
            pageContent: null,
            error: null
        };

        try {
            // Check HTTP status
            data.httpStatus = await this.checkHttpStatus(link.url);

            if (!data.httpStatus.ok) {
                data.error = `${data.httpStatus.status}: ${data.httpStatus.statusText}`;
                return data;
            }

            // Fetch page content
            try {
                data.pageContent = await this.fetchPageContent(link.url);
            } catch (error) {
                console.warn(`Fetch failed for ${link.url}:`, error.message);
                data.error = 'Content unavailable';
            }

        } catch (error) {
            console.error(`Error fetching ${link.url}:`, error);
            data.error = error.message;
        }

        return data;
    },

    /**
     * Verify a link with OpenAI after fetching
     * @param {Object} link - Link object
     * @param {Object} data - Fetched data
     * @param {number} index - Index for UI updates
     * @param {Function} onUpdate - Callback for updates
     * @returns {Promise<Object>} Verification result
     */
    async verifyLink(link, data, index, onUpdate) {
        const result = {
            originalUrl: link.url,
            linkText: link.text,
            context: link.context,
            isCitation: link.isCitation,
            status: 'checking',
            analysis: '',
            suggestedUrl: null,
            redirectUrl: data.httpStatus?.redirectUrl || null
        };

        try {
            // Handle HTTP errors
            if (data.error && data.httpStatus && !data.httpStatus.ok) {
                result.status = 'invalid';
                result.analysis = `Link returns ${data.error}. The page does not exist or is not accessible.`;
            }
            // Verify regular link or citation
            else if (!link.isCitation) {
                await this.verifyRegularLink(link, data, result);
            } else {
                await this.verifyCitation(link, data, result);
            }
        } catch (error) {
            result.status = link.isCitation ? 'inaccurate' : 'verified';
            result.analysis = link.isCitation
                ? `Error during verification: ${error.message}`
                : `Link appears to be working but verification failed: ${error.message}`;
        }

        if (onUpdate) onUpdate(index, result);
        return result;
    },


    /**
     * Verify a regular link (non-citation)
     * @param {Object} link - Link object
     * @param {Object} data - Fetched data
     * @param {Object} result - Result object to update
     */
    async verifyRegularLink(link, data, result) {
        result.status = 'verified';

        if (!data.pageContent) {
            result.analysis = result.redirectUrl
                ? `Link is live. Redirects to: ${result.redirectUrl}`
                : 'Link is live and working.';
            return;
        }

        const relevanceCheck = await this.checkLinkRelevance(link, data.pageContent);
        let analysis = relevanceCheck.isRelevant
            ? 'Link is live and anchor text is relevant to the page.'
            : 'Link is live but anchor text may not match the page content well.';

        if (result.redirectUrl) {
            analysis += ` Redirects to: ${result.redirectUrl}`;
        }

        result.analysis = analysis;
    },

    /**
     * Verify a citation link
     * @param {Object} link - Link object
     * @param {Object} data - Fetched data
     * @param {Object} result - Result object to update
     */
    async verifyCitation(link, data, result) {
        let analysis;

        if (data.pageContent) {
            analysis = await this.analyzeWithOpenAI(link, null, data.pageContent);
        } else {
            // Without page content, we cannot verify the claim reliably
            result.status = 'inaccurate';
            result.analysis = 'Content unavailable for verification. Could not fetch page content to confirm the claim.';
            return;
        }

        result.status = analysis.isCorrect ? 'verified' : 'inaccurate';
        result.analysis = analysis.reasoning;
        result.suggestedUrl = analysis.suggestedUrl;
        result.exactQuote = analysis.exactQuote || null;

        // Harden verification when we have fetched content
        if (data.pageContent) {
            const pageText = (data.pageContent.text || '').toLowerCase();
            const exactQuote = (analysis.exactQuote || '').trim();
            const hasQuote = exactQuote.length > 0;
            const quoteInPage = hasQuote && this._includesSanitized(pageText, exactQuote);

            // If model says correct, require a verifiable exact quote present on the page
            if (analysis.isCorrect) {
                let gatingFailedReason = '';

                if (!hasQuote || !quoteInPage) {
                    gatingFailedReason = 'no verifiable exact quote found in fetched content';
                } else {
                    // If the context mentions figures (e.g., 79%, 80), ensure the quote contains one of them
                    const expectedFigures = this._extractFigures(link.context);
                    if (expectedFigures.length > 0) {
                        const quoteHasFigure = expectedFigures.some(fig => this._quoteHasFigure(exactQuote, fig));
                        if (!quoteHasFigure) {
                            gatingFailedReason = `expected figure not present in the on-page quote (${expectedFigures.join(', ')})`;
                        }
                    }
                }

                if (gatingFailedReason) {
                    result.status = 'inaccurate';
                    result.analysis = `Marked as Recheck: ${gatingFailedReason}. ${analysis.reasoning || ''}`.trim();
                }
            }
        }

        // If verified, prepend the exact quote to the analysis (only when quote exists)
        if (result.status === 'verified' && result.exactQuote) {
            result.analysis = `✓ Exact quote: "${result.exactQuote}"\n\n${result.analysis}`;
        }

        if (result.redirectUrl && data.pageContent) {
            result.analysis += ` Note: Link redirects to ${result.redirectUrl}`;
        }
    },


    /**
     * Check HTTP status of a URL and detect redirects
     * @param {string} url - URL to check
     * @returns {Promise<Object>} Status object with ok, status, statusText, redirectUrl
     */
    async checkHttpStatus(url) {
        try {
            const response = await fetch(this.corsProxyUrl + encodeURIComponent(url), {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            const data = await response.json();
            const httpCode = data.status.http_code;

            return {
                ok: httpCode >= 200 && httpCode < 400,
                status: httpCode,
                statusText: httpCode === 404 ? 'Not Found' : httpCode === 403 ? 'Forbidden' : httpCode === 500 ? 'Server Error' : 'Unknown',
                redirectUrl: data.status.url !== url ? data.status.url : null
            };
        } catch (error) {
            return { ok: true, status: 200, statusText: 'OK', redirectUrl: null };
        }
    },

    /**
     * Fetch and extract page content
     * @param {string} url - URL to fetch
     * @returns {Promise<Object>} Extracted text content and links
     */
    async fetchPageContent(url) {
        const response = await fetch(this.corsProxyUrl + encodeURIComponent(url));

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }

        const data = await response.json();

        // Prefer server-side extracted text to avoid transferring full HTML
        if (data && (typeof data.text === 'string')) {
            const textContent = data.text.substring(0, 3000);
            const links = Array.isArray(data.links) ? data.links.slice(0, 10) : [];
            return { text: textContent, links };
        }

        // Fallback: old behavior if server returned raw HTML (legacy)
        if (data && typeof data.contents === 'string') {
            let html = data.contents;

            html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                       .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                       .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
                       .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
                       .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
                       .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

            const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
            if (bodyMatch) html = bodyMatch[1];

            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
            const container = doc.body.firstChild;

            ['aside', 'svg', 'noscript'].forEach(tag => {
                container.querySelectorAll(tag).forEach(el => el.remove());
            });

            const mainContent = container.querySelector('article, main, [role="main"]') || container;
            const textContent = (mainContent.innerText || mainContent.textContent).substring(0, 3000);
            const links = Array.from(mainContent.querySelectorAll('a[href]'))
                .slice(0, 10)
                .map(a => ({ text: a.textContent.trim(), url: a.href }))
                .filter(l => l.text && l.url);

            return { text: textContent, links };
        }

        // If neither format is available
        return { text: '', links: [] };
    },

    /**
     * Check if anchor text is relevant to the linked page (for regular links)
     * @param {Object} link - Link object
     * @param {Object} pageContent - Fetched page content
     * @returns {Promise<Object>} Relevance check result
     */
    async checkLinkRelevance(link, pageContent) {
        const prompt = `Task: Decide if the anchor text reasonably describes or relates to the linked page's content.

Anchor Text: ${link.text}
Link URL: ${link.url}

Page Content (excerpt):
${pageContent.text}

Rules
- Use only the provided content excerpt.
- True if the anchor text closely matches the page's topic/claims; otherwise false.

Output (JSON only):
{
  "isRelevant": true|false,
  "reasoning": "1 short sentence (<=160 chars)"
}
No prose, no extra keys.`;

        const response = await this._chatCompletion({
            model: 'gpt-5-mini',
            messages: [
                { role: 'system', content: 'You are a concise link relevance checker. Always output strict JSON only.' },
                { role: 'user', content: prompt }
            ]
        });

        if (!response.ok) {
            let errorDetails = '';
            try {
                const errorData = await response.json();
                errorDetails = errorData.error?.message || '';
            } catch (e) {}

            const errorMsg = response.status === 404
                ? 'AI model not found'
                : response.status === 401
                ? 'Invalid API key'
                : `API error ${response.status}`;

            console.error('Link relevance check error:', response.status, errorDetails);
            return { isRelevant: true, reasoning: `Could not verify relevance (${errorMsg}).` };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        try {
            return JSON.parse(content);
        } catch (e) {
            return { isRelevant: true, reasoning: content || 'Unable to parse AI response' };
        }
    },

    /**
     * Analyze link with OpenAI using direct content or search results
     * @param {Object} link - Link object
     * @param {string|null} searchResults - Perplexity search results
     * @param {Object|null} pageContent - Fetched page content or null
     * @returns {Promise<Object>} Analysis result
     */
    async analyzeWithOpenAI(link, searchResults, pageContent) {
        let prompt;

        if (pageContent) {
            // Use direct page content
            const secondarySourceWarning = this.detectSecondarySource(pageContent, link.context);

            prompt = `Task: Determine if the link supports the claim in context using the provided page content.

Context: ${link.context}
Link Text: ${link.text}
Link URL: ${link.url}

Page Content (excerpt):
${pageContent.text}

Links on Page (sample):
${pageContent.links.slice(0, 10).map(l => `- ${l.text} -> ${l.url}`).join('\n')}

Decision Rules
1) Correct if key facts in the context (numbers, entities, quotes, findings) appear in the page content or close paraphrase without contradiction.
2) Incorrect if key facts are absent, contradicted, or the page is about a different topic.
3) ${secondarySourceWarning ? 'If this looks like a secondary source, prefer the primary source if visible among the links.' : 'If the page appears to cite another source, note it.'}
4) If you mark as correct, include the exact quote (verbatim) from the provided content; otherwise leave exactQuote null.

Output (JSON only):
{
  "isCorrect": true|false,
  "reasoning": "1-2 sentences (<=240 chars). Start with whether key facts were found.",
  "exactQuote": "Verbatim sentence(s) from the excerpt if isCorrect=true, else null",
  "suggestedUrl": "Primary source URL if clearly present in the listed links, else null"
}
No prose, no extra keys.`;
        } else {
            // No content available
            return {
                isCorrect: false,
                reasoning: "Unable to fetch page content for verification.",
                suggestedUrl: null
            };
        }

        const response = await this._chatCompletion({
            model: 'gpt-5-mini',
            messages: [
                { role: 'system', content: 'You are a concise fact-checking assistant. Always output strict JSON only.' },
                { role: 'user', content: prompt }
            ]
        });

        if (!response.ok) {
            let errorDetails = '';
            try {
                const errorData = await response.json();
                errorDetails = errorData.error?.message || JSON.stringify(errorData);
            } catch (e) {
                errorDetails = await response.text();
            }

            const errorMsg = response.status === 404
                ? 'AI model not found. Please check your API configuration.'
                : response.status === 401
                ? 'Invalid API key. Please update your OpenAI API key in settings.'
                : response.status === 429
                ? 'Rate limit exceeded. Please try again later.'
                : `AI API error: ${response.status}`;

            console.error('AI API error:', response.status, errorDetails);
            throw new Error(errorMsg);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        try {
            return JSON.parse(content);
        } catch (e) {
            return {
                isCorrect: false,
                reasoning: content || 'Unable to parse AI response',
                suggestedUrl: null
            };
        }
    },

    /**
     * Detect if page is a secondary source citing another source
     * @param {Object} pageContent - Page content object
     * @param {string} context - Original context
     * @returns {boolean} True if likely a secondary source
     */
    detectSecondarySource(pageContent, context) {
        const text = pageContent.text.toLowerCase();
        const secondaryIndicators = [
            'according to',
            'reported by',
            'study published in',
            'research from',
            'cited in',
            'source:',
            'via',
            'as reported',
            'originally published'
        ];

        return secondaryIndicators.some(indicator => text.includes(indicator));
    },

    /**
     * Extract numeric figures (e.g., 79, 80) from a text, including percentages.
     * @param {string} text
     * @returns {Array<string>} unique figures as strings (e.g., ["79", "80"]).
     */
    _extractFigures(text) {
        if (!text) return [];
        const matches = [...String(text).matchAll(/(\d{1,3}(?:\.\d+)?)/g)].map(m => m[1]);
        const unique = Array.from(new Set(matches));
        return unique;
    },

    /**
     * Check if a quote contains a figure (as digits) or a digit+percent variant.
     * @param {string} quote
     * @param {string} figure
     */
    _quoteHasFigure(quote, figure) {
        const q = String(quote);
        const re = new RegExp(`(?<![\n\r\d])${figure}(?:\s*%){0,1}(?![\d])`);
        return re.test(q);
    },

    /**
     * Case-insensitive inclusion with normalized whitespace.
     * @param {string} haystackLower - pre-lowered haystack
     * @param {string} needleRaw
     */
    _includesSanitized(haystackLower, needleRaw) {
        const collapse = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
        const needle = collapse(needleRaw);
        const hay = haystackLower.replace(/\s+/g, ' ').trim();
        return needle.length > 0 && hay.includes(needle);
    },

    // Perplexity fallback removed; direct content fetch is required for verification

    /**
     * Call OpenAI API for chat completion
     * @param {Object} opts
     * @param {string} opts.model - OpenAI model name
     * @param {Array} opts.messages - chat messages array
     * @param {number} [opts.temperature] - Temperature for the model
     * @returns {Promise<Response>} fetch response
     */
    async _chatCompletion({ model, messages, temperature }) {
        // Get OpenAI API key
        let apiKey = this.openaiApiKey;
        try {
            if (!apiKey) apiKey = localStorage.getItem('factchecker_openai_key') || '';
        } catch (_) {}

        if (!apiKey) {
            throw new Error('OpenAI API key required. Please add your API key in settings.');
        }

        const body = { model, messages, response_format: { type: 'json_object' } };
        if (temperature !== undefined) body.temperature = temperature;

        return fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
    }
};
