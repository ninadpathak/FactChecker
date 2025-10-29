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
        const lines = markdown.split('\n');

        // Regex to match markdown links: [text](url)
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

        lines.forEach((line, lineIndex) => {
            let match;
            while ((match = linkRegex.exec(line)) !== null) {
                const linkText = match[1];
                const url = match[2];

                // Get context (the sentence or paragraph containing the link)
                const context = this.getContext(lines, lineIndex, match.index);

                links.push({
                    text: linkText,
                    url: url,
                    context: context,
                    isCitation: false, // Will be set during classification
                    status: 'pending' // pending, checking, verified, incorrect
                });
            }
        });

        return links;
    },

    /**
     * Get the context around a link (the sentence or paragraph)
     * @param {Array} lines - All lines of text
     * @param {number} lineIndex - The line containing the link
     * @param {number} charIndex - Character position of the link
     * @returns {string} The context text
     */
    getContext(lines, lineIndex, charIndex) {
        const currentLine = lines[lineIndex];

        // If line is short enough, return the whole line
        if (currentLine.length <= 150) {
            return currentLine.trim();
        }

        // Otherwise, try to find sentence boundaries
        const beforeLink = currentLine.substring(0, charIndex);
        const afterLink = currentLine.substring(charIndex);

        // Find sentence start (look for . ! ? or start of line)
        let sentenceStart = beforeLink.lastIndexOf('. ');
        if (sentenceStart === -1) sentenceStart = beforeLink.lastIndexOf('! ');
        if (sentenceStart === -1) sentenceStart = beforeLink.lastIndexOf('? ');
        if (sentenceStart === -1) sentenceStart = 0;
        else sentenceStart += 2; // Skip the punctuation and space

        // Find sentence end
        let sentenceEnd = afterLink.search(/[.!?]\s/);
        if (sentenceEnd === -1) sentenceEnd = afterLink.length;
        else sentenceEnd += 1; // Include the punctuation

        const context = (beforeLink.substring(sentenceStart) + afterLink.substring(0, sentenceEnd)).trim();

        // If still too long, truncate
        if (context.length > 200) {
            return context.substring(0, 200) + '...';
        }

        return context;
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
- CITATION: Used to support a specific fact/claim/statistic (e.g., "according to", "study found", "research shows", "survey by", numbers/percentages).
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
            const context = link.context.toLowerCase();
            const citationIndicators = [
                'according to', 'research shows', 'study found', 'survey',
                'data from', 'statistics', '%', 'percent', 'report'
            ];
            link.isCitation = citationIndicators.some(indicator => context.includes(indicator));
        });
        console.log('Using fallback classification');
        return links;
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
