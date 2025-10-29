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

            const prompt = `You are analyzing links to determine if they are CITATIONS (sources for data/claims/statistics) or REGULAR LINKS (general hyperlinks).

A link is a CITATION if:
- The context cites it as a source for data, statistics, research findings, or claims
- It contains phrases like "according to", "study found", "research shows", "survey by", "data from", "found that", etc.
- It's used to back up a factual claim with numbers, percentages, or research results
- The link is presented as evidence or proof for a statement

A link is a REGULAR LINK if:
- It's just a reference to related content
- It's a general hyperlink for further reading
- It's not being used as a source of evidence for a specific claim

EXAMPLES:
- "According to a [PwC survey](url), 79% of organizations..." → CITATION (citing survey data)
- "[McKinsey research](url) found that nearly 80%..." → CITATION (citing research findings)
- "Read more about [AI trends](url)" → REGULAR LINK (just a reference)
- "[Click here](url) for details" → REGULAR LINK (general link)

Analyze these ${links.length} links:

${linksData.map(l => `[${l.index}] Context: "${l.context}"
   Link Text: "${l.linkText}"
   URL: ${l.url}`).join('\n\n')}

Respond with a JSON object containing a "links" array:
{
  "links": [
    {"index": 0, "isCitation": true},
    {"index": 1, "isCitation": false},
    ...
  ]
}`;

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

            console.log(`Classified ${links.length} links using GPT-4o-mini`);
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
