/**
 * Link Extractor Module
 * Extracts links from markdown text and their surrounding context
 */

const LinkExtractor = {
    /**
     * Extract all links from markdown text
     * @param {string} markdown - The markdown text
     * @returns {Array} Array of link objects with url, text, and context
     */
    extract(markdown) {
        const links = [];
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(markdown)) !== null) {
            const linkText = match[1];
            const url = match[2];
            const context = this.getContext(markdown, match.index, match[0].length);

            links.push({
                text: linkText,
                url: url,
                context: context,
                isCitation: false,
                status: 'pending'
            });
        }

        return links;
    },

    /**
     * Derive a contextual snippet (full sentence + neighbors) around a link
     * @param {string} markdown - Entire markdown text
     * @param {number} matchIndex - Start index of the link match
     * @param {number} matchLength - Length of the matched link markdown
     * @returns {string} Context string
     */
    getContext(markdown, matchIndex, matchLength) {
        if (!markdown) return '';

        const paragraph = this.getParagraph(markdown, matchIndex, matchLength);
        const relativeIndex = matchIndex - paragraph.start;
        const paragraphText = paragraph.text;

        if (!paragraphText) return '';

        const sentences = this.splitIntoSentences(paragraphText);
        if (sentences.length === 0) {
            return this.normalizeWhitespace(paragraphText).slice(0, 360);
        }

        // Locate the sentence containing the link
        let currentIdx = 0;
        let positionTracker = 0;
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const start = positionTracker;
            const end = positionTracker + sentence.length;
            if (relativeIndex >= start && relativeIndex <= end) {
                currentIdx = i;
                break;
            }
            positionTracker = end;
        }

        const selected = [];
        const currentSentence = this.normalizeWhitespace(sentences[currentIdx] || '');
        if (currentSentence) selected.push(currentSentence);

        const prepend = this.normalizeWhitespace(sentences[currentIdx - 1] || '');
        if (prepend && prepend.length < 180) {
            selected.unshift(prepend);
        }

        const append = this.normalizeWhitespace(sentences[currentIdx + 1] || '');
        if (append && append.length < 180 && (selected.join(' ').length + append.length) < 360) {
            selected.push(append);
        }

        const context = selected.join(' ').trim();
        return context.length > 360 ? context.slice(0, 360) + '…' : context;
    },

    /**
     * Find the paragraph surrounding the link
     */
    getParagraph(text, matchIndex, matchLength) {
        const before = text.lastIndexOf('\n\n', matchIndex);
        const start = before === -1 ? 0 : before + 2;
        const after = text.indexOf('\n\n', matchIndex + matchLength);
        const end = after === -1 ? text.length : after;
        return {
            start,
            end,
            text: text.slice(start, end)
        };
    },

    /**
     * Basic sentence splitter that keeps punctuation attached
     */
    splitIntoSentences(paragraph) {
        return paragraph.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
    },

    /**
     * Collapse whitespace and trim
     */
    normalizeWhitespace(text) {
        return text ? text.replace(/\s+/g, ' ').trim() : '';
    },

    /**
     * Classify links using GPT-5-nano (batch classification)
     * @param {Array} links - Array of link objects
     * @param {string} openaiApiKey - OpenAI API key
     * @returns {Promise<Array>} Links with isCitation property set
     */
    async classifyLinks(links, openaiApiKey) {
        if (!openaiApiKey || links.length === 0) {
            return links;
        }

        try {
            // Prepare batch classification prompt
            const linksData = links.map((link, index) => ({
                index: index,
                context: link.context,
                linkText: link.text,
                url: link.url
            }));

            const prompt = `Task: Classify each link as a CITATION (used as a source for a factual claim) or a REGULAR LINK (general reference).

Definitions
- CITATION: Used to support a specific fact/claim/statistic (e.g., "according to", "announced", "reported", "study found", "research shows", "survey by", numbers/percentages).
- REGULAR LINK: General reference/related reading; not presented as evidence for a specific claim.

Guidelines
- Decide using only the provided context around each link.
- If uncertain, prefer REGULAR LINK (isCitation = false).

Items (${links.length}):
${linksData.map(l => `[${l.index}] Context: "${l.context}"
Link Text: "${l.linkText}"
URL: ${l.url}`).join('\n\n')}

Output (JSON only):
{
  "links": [
    {"index": 0, "isCitation": true|false},
    ... one object for each index 0..${links.length - 1}
  ]
}
No prose, no extra fields.`;

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-5-nano',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a link classifier that determines if links are citations or regular links. Always respond with valid JSON.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.2
                })
            });

            if (!response.ok) {
                console.error('OpenAI classification failed, using fallback');
                return this.fallbackClassification(links);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;
            const result = JSON.parse(content);

            // Extract the links array from the response
            const classificationsArray = result.links || result.classifications || result.results || [];

            if (classificationsArray.length === 0) {
                console.warn('No classifications returned, using fallback');
                return this.fallbackClassification(links);
            }

            // Apply classifications
            classificationsArray.forEach(item => {
                if (links[item.index] !== undefined) {
                    links[item.index].isCitation = item.isCitation;
                }
            });

            // Safety net: refine with local heuristics to reduce false negatives
            this.refineWithHeuristics(links);

            console.log(`Classified ${links.length} links using gpt-5-nano`);
            return links;

        } catch (error) {
            console.error('Error classifying links:', error);
            return this.fallbackClassification(links);
        }
    },

    /**
     * Fallback classification using simple patterns
     * @param {Array} links - Array of link objects
     * @returns {Array} Links with isCitation property set
     */
    fallbackClassification(links) {
        links.forEach(link => {
            link.isCitation = this.strongCitationHeuristic(link.context, link.text);
        });
        console.log('Using fallback classification');
        return links;
    },

    /**
     * Strengthen classification with conservative local heuristics
     */
    refineWithHeuristics(links) {
        links.forEach(link => {
            if (!link.isCitation && this.strongCitationHeuristic(link.context, link.text)) {
                link.isCitation = true;
            }
        });
    },

    /**
     * Heuristic: treat as citation if context suggests a factual claim backed by a source
     */
    strongCitationHeuristic(context, linkText) {
        const c = (context || '').toLowerCase();
        const t = (linkText || '').toLowerCase();
        const hasNumber = /(\d{1,3}(?:\.\d+)?)/.test(c) || c.includes('%') || c.includes('percent');
        const verbs = [
            'according to', 'announced', 'reported', 'stated', 'says', 'said',
            'found that', 'finds', 'shows', 'study', 'research', 'survey',
            'trial', 'report', 'published', 'press release', 'revealed'
        ];
        const domainTerms = ['effectiveness', 'increase', 'decrease', 'adopted', 'usage', 'statistic', 'figure'];

        const hasVerb = verbs.some(v => c.includes(v));
        const hasDomainTerm = domainTerms.some(w => c.includes(w));

        // Treat as citation if:
        // - It uses citation verbs, or
        // - Numbers/% appear alongside domain terms or verbs
        if (hasVerb) return true;
        if (hasNumber && (hasDomainTerm || c.includes('according to') || c.includes('found'))) return true;

        // If the anchor text itself looks like an org/report/study, be more lenient
        const anchorHints = ['report', 'study', 'survey', 'research', 'press'];
        if (hasNumber && anchorHints.some(h => t.includes(h))) return true;

        return false;
    },

    /**
     * Filter out duplicate links
     * @param {Array} links - Array of link objects
     * @returns {Array} Deduplicated array
     */
    deduplicate(links) {
        const seen = new Set();
        return links.filter(link => {
            const key = link.url;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    },

    /**
     * Extract and deduplicate links from markdown
     * @param {string} markdown - The markdown text
     * @returns {Array} Array of unique link objects
     */
    extractUnique(markdown) {
        const allLinks = this.extract(markdown);
        return this.deduplicate(allLinks);
    }
};
