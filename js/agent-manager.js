/**
 * Agent Manager Module
 * Processes links sequentially with improved verification
 * First tries direct HTML fetch, falls back to Perplexity if needed
 */

const AgentManager = {
    openaiApiKey: null,
    openrouterApiKey: null,
    corsProxyUrl: 'https://api.allorigins.win/get?url=',

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
        const result = this.createVerificationResult(link, data);

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
            this.handleVerificationError(link, result, error);
        }

        if (onUpdate) onUpdate(index, result);
        return result;
    },

    /**
     * Create initial verification result object
     * @param {Object} link - Link object
     * @param {Object} data - Fetched data
     * @returns {Object} Result object
     */
    createVerificationResult(link, data) {
        return {
            originalUrl: link.url,
            linkText: link.text,
            context: link.context,
            isCitation: link.isCitation,
            status: 'checking',
            analysis: '',
            suggestedUrl: null,
            redirectUrl: data.httpStatus?.redirectUrl || null
        };
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
     * Handle verification errors
     * @param {Object} link - Link object
     * @param {Object} result - Result object to update
     * @param {Error} error - The error that occurred
     */
    handleVerificationError(link, result, error) {
        console.error('Verification error:', error);
        result.status = link.isCitation ? 'inaccurate' : 'verified';
        result.analysis = link.isCitation
            ? `Error during verification: ${error.message}`
            : `Link appears to be working but verification failed: ${error.message}`;
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
            const statusTexts = { 404: 'Not Found', 403: 'Forbidden', 500: 'Server Error' };

            return {
                ok: httpCode >= 200 && httpCode < 400,
                status: httpCode,
                statusText: statusTexts[httpCode] || 'Unknown',
                redirectUrl: data.status.url !== url ? data.status.url : null
            };
        } catch (error) {
            return { ok: true, status: 200, statusText: 'OK', redirectUrl: null };
        }
    },

    /**
     * Fetch and extract page content
     * @param {string} url - URL to fetch
     * @returns {Promise<string>} Extracted text content
     */
    async fetchPageContent(url) {
        const response = await fetch(this.corsProxyUrl + encodeURIComponent(url));

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }

        const data = await response.json();
        const html = data.contents;

        // Extract text content from HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove script, style, and other non-content elements
        const unwantedTags = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe'];
        unwantedTags.forEach(tag => {
            const elements = doc.querySelectorAll(tag);
            elements.forEach(el => el.remove());
        });

        // Extract main content (prefer article, main, or body)
        const mainContent = doc.querySelector('article, main, [role="main"]') || doc.body;

        // Extract text and preserve links
        let textContent = mainContent.innerText || mainContent.textContent;

        // Find all links in the content
        const links = Array.from(mainContent.querySelectorAll('a[href]'))
            .map(a => ({ text: a.textContent.trim(), url: a.href }))
            .filter(l => l.text && l.url);

        return {
            text: textContent.substring(0, 3000), // Limit to 3000 chars
            links: links
        };
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
            modelOpenAI: 'gpt-5-mini',
            messages: [
                { role: 'system', content: 'You are a concise link relevance checker. Always output strict JSON only.' },
                { role: 'user', content: prompt }
            ]
        });

        if (!response.ok) {
            return { isRelevant: true, reasoning: 'Could not verify relevance' };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        try {
            return JSON.parse(content);
        } catch (e) {
            return { isRelevant: true, reasoning: content };
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
            modelOpenAI: 'gpt-5-mini',
            messages: [
                { role: 'system', content: 'You are a concise fact-checking assistant. Always output strict JSON only.' },
                { role: 'user', content: prompt }
            ]
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';

        try {
            return JSON.parse(content);
        } catch (e) {
            return {
                isCorrect: false,
                reasoning: content,
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
     * Provider-agnostic chat completion helper.
     * Uses OpenAI if configured, otherwise falls back to OpenRouter (DeepSeek v3.1 free).
     * @param {Object} opts
     * @param {string} opts.modelOpenAI - OpenAI model name when using OpenAI
     * @param {Array} opts.messages - chat messages array
     * @returns {Promise<Response>} fetch response
     */
    _chatCompletion({ modelOpenAI, messages }) {
        if (this.openaiApiKey) {
            return fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: modelOpenAI,
                    messages,
                    response_format: { type: 'json_object' }
                })
            });
        }

        if (this.openrouterApiKey) {
            const headers = {
                'Authorization': `Bearer ${this.openrouterApiKey}`,
                'Content-Type': 'application/json'
            };
            try {
                if (typeof window !== 'undefined') {
                    headers['HTTP-Referer'] = window.location.origin;
                    headers['X-Title'] = document.title || 'FactChecker 2.0';
                }
            } catch (_) {}

            return fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: 'deepseek/deepseek-chat-v3.1:free',
                    messages
                })
            });
        }

        // No provider available
        return Promise.reject(new Error('No chat provider configured'));
    }
};
