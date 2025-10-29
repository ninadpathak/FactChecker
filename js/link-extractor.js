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

        // Get paragraph
        const before = markdown.lastIndexOf('\n\n', matchIndex);
        const start = before === -1 ? 0 : before + 2;
        const after = markdown.indexOf('\n\n', matchIndex + matchLength);
        const end = after === -1 ? markdown.length : after;
        const paragraphText = markdown.slice(start, end);

        if (!paragraphText) return '';

        // Split into sentences
        const sentences = paragraphText.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
        if (sentences.length === 0) {
            return paragraphText.replace(/\s+/g, ' ').trim().slice(0, 360);
        }

        // Find sentence containing the link
        const relativeIndex = matchIndex - start;
        let currentIdx = 0;
        let pos = 0;
        for (let i = 0; i < sentences.length; i++) {
            if (relativeIndex >= pos && relativeIndex <= pos + sentences[i].length) {
                currentIdx = i;
                break;
            }
            pos += sentences[i].length;
        }

        // Build context with current + neighboring sentences
        const normalize = (s) => s.replace(/\s+/g, ' ').trim();
        const selected = [normalize(sentences[currentIdx] || '')];

        const prev = normalize(sentences[currentIdx - 1] || '');
        if (prev && prev.length < 180) selected.unshift(prev);

        const next = normalize(sentences[currentIdx + 1] || '');
        if (next && next.length < 180 && (selected.join(' ').length + next.length) < 360) {
            selected.push(next);
        }

        const context = selected.join(' ');
        return context.length > 360 ? context.slice(0, 360) + '…' : context;
    },

    /**
     * Classify links using GPT-5-nano (batch classification)
     * @param {Array} links - Array of link objects
     * @param {string} openaiApiKey - OpenAI API key
     * @returns {Promise<Array>} Links with isCitation property set
     */
    async classifyLinks(links, openaiApiKey, openrouterApiKey) {
        if (links.length === 0) {
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

            // Use shared provider selection from AgentManager
            const response = await AgentManager._chatCompletion({
                modelOpenAI: 'gpt-5-nano',
                messages: [
                    { role: 'system', content: 'You are a link classifier that determines if links are citations or regular links. Always respond with valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.2
            });

            if (!response.ok) {
                return this.fallbackClassification(links);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            const result = JSON.parse(content);
            const classificationsArray = result.links || result.classifications || result.results || [];

            if (classificationsArray.length === 0) {
                return this.fallbackClassification(links);
            }

            // Apply classifications
            classificationsArray.forEach(item => {
                if (links[item.index] !== undefined) {
                    links[item.index].isCitation = item.isCitation;
                }
            });

            // Refine with local heuristics
            this.refineWithHeuristics(links);

            return links;
        } catch (error) {
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
            link.isCitation = this.isCitationHeuristic(link.context, link.text);
        });
        return links;
    },

    /**
     * Strengthen classification with conservative local heuristics
     */
    refineWithHeuristics(links) {
        links.forEach(link => {
            if (!link.isCitation && this.isCitationHeuristic(link.context, link.text)) {
                link.isCitation = true;
            }
        });
    },

    /**
     * Heuristic: treat as citation if context suggests a factual claim backed by a source
     */
    isCitationHeuristic(context, linkText) {
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
     * Extract and deduplicate links from markdown
     * @param {string} markdown - The markdown text
     * @returns {Array} Array of unique link objects
     */
    extractUnique(markdown) {
        const allLinks = this.extract(markdown);
        const seen = new Set();
        return allLinks.filter(link => {
            if (seen.has(link.url)) return false;
            seen.add(link.url);
            return true;
        });
    }
};
