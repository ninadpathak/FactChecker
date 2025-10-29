/**
 * Agent Manager Module
 * Processes links sequentially with improved verification
 * First tries direct HTML fetch, falls back to Perplexity if needed
 */

const AgentManager = {
    openaiApiKey: null,
    perplexityApiKey: null,
    corsProxyUrl: 'https://api.allorigins.win/get?url=',

    /**
     * Set API keys
     * @param {string} openaiKey - OpenAI API key
     * @param {string} perplexityKey - Perplexity API key
     */
    setApiKeys(openaiKey, perplexityKey) {
        this.openaiApiKey = openaiKey;
        this.perplexityApiKey = perplexityKey;
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

        if (!data.pageContent) {
            const searchResults = await this.searchWithPerplexity(link);
            analysis = await this.analyzeWithOpenAI(link, searchResults, null);
        } else {
            analysis = await this.analyzeWithOpenAI(link, null, data.pageContent);
        }

        result.status = analysis.isCorrect ? 'verified' : 'inaccurate';
        result.analysis = analysis.reasoning;
        result.suggestedUrl = analysis.suggestedUrl;
        result.exactQuote = analysis.exactQuote || null;

        // If verified, prepend the exact quote to the analysis
        if (analysis.isCorrect && analysis.exactQuote) {
            result.analysis = `✓ Exact quote: "${analysis.exactQuote}"\n\n${analysis.reasoning}`;
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
        const prompt = `You are checking if a link's anchor text matches the content of the page it links to.

Anchor Text: ${link.text}
Link URL: ${link.url}

Page Content:
${pageContent.text}

Does the anchor text reasonably describe or relate to the page content?

Respond in JSON format:
{
    "isRelevant": true/false,
    "reasoning": "Brief explanation (1 sentence)"
}`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-5-nano',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a link relevance checker. Always respond with valid JSON.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            return { isRelevant: true, reasoning: 'Could not verify relevance' };
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

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

            prompt = `You are a fact-checking assistant. Analyze if the provided link accurately supports the cited claim.

Claim/Context: ${link.context}
Link Text: ${link.text}
Link URL: ${link.url}

Page Content:
${pageContent.text}

${secondarySourceWarning ? `\nIMPORTANT: This page appears to cite another source. Check if this is a secondary source.\n` : ''}

Links found on page:
${pageContent.links.slice(0, 10).map(l => `- [${l.text}](${l.url})`).join('\n')}

Verification Steps:
1. First, check if the KEY FACTS (numbers, statistics, quotes, specific claims) from the context appear on the page
2. Then, verify if the claim is reasonably supported by what's written on the page
3. Be lenient with paraphrasing - if the core facts match, the citation is correct
4. Only mark as INCORRECT if:
   - The specific statistic/fact is NOT found on the page
   - The page says something that contradicts the claim
   - The page is about a completely different topic
5. Check if this is a secondary source citing another source - if so, identify the primary source

IMPORTANT: If the key facts match (e.g., same percentage, same organization, same finding), the citation is CORRECT even if the wording differs slightly or the context is paraphrased.

CRITICAL: If the citation is CORRECT (verified), you MUST extract the EXACT sentence or sentences from the page content where the statistic/fact appears. Copy it word-for-word - do not paraphrase or hallucinate. If you cannot find the exact quote, mark as incorrect.

Respond in JSON format:
{
    "isCorrect": true/false,
    "reasoning": "Explanation (2-3 sentences). Start with whether the key facts were found. If this is a secondary source citing another link, mention: 'This page mentions the information but cites [source name/link] as the original source.'",
    "exactQuote": "The EXACT sentence(s) from the page where this fact appears. Only include if isCorrect is true. Must be verbatim from page content - no paraphrasing.",
    "suggestedUrl": "If this is a secondary source, provide the primary source URL here, otherwise null"
}`;
        } else if (searchResults) {
            // Use Perplexity search results
            prompt = `You are a fact-checking assistant. Analyze if the provided link is appropriate for the given context.

Context: ${link.context}
Link Text: ${link.text}
Link URL: ${link.url}

Factual Information from Search:
${searchResults}

Analyze if the link is likely accurate based on the search results.

Respond in JSON format:
{
    "isCorrect": true/false,
    "reasoning": "Brief explanation (1-2 sentences)",
    "suggestedUrl": null
}`;
        } else {
            // No content available
            return {
                isCorrect: false,
                reasoning: "Unable to fetch page content for verification.",
                suggestedUrl: null
            };
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-5-nano',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a fact-checking assistant. Always respond with valid JSON.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

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
     * Search for information using Perplexity Sonar API (fallback)
     * @param {Object} link - Link object
     * @returns {Promise<string>} Search results
     */
    async searchWithPerplexity(link) {
        const query = `Verify if this claim is accurate: ${link.context}. Check if ${link.url} is a credible source for this information.`;

        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.perplexityApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a fact-checking assistant. Provide concise, factual verification.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`Perplexity API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }
};
