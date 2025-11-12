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
            const sentence = this.getSentence(markdown, match.index, match[0].length);

            // Derive numeric statistic features for the sentence
            const sentenceForNums = sentence.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
            const numsInSentence = this._extractNumberTokens(sentenceForNums);

            // Numbers present in any anchor texts within the same sentence
            const anchorsInSentence = Array.from(sentence.matchAll(linkRegex)).map(m => m[1]);
            const numsInAnchorsAll = anchorsInSentence.flatMap(t => this._extractNumberTokens(t));
            const numsInThisAnchor = this._extractNumberTokens(linkText);

            const norm = (s) => s.replace(/,/g, '').replace(/%$/, '');
            const anchorSet = new Set(numsInAnchorsAll.map(norm));
            const unlinked = numsInSentence.filter(n => !anchorSet.has(norm(n)));

            links.push({
                text: linkText,
                url: url,
                context: context,
                sentence: sentence,
                features: {
                    anchorHasNumber: numsInThisAnchor.length > 0,
                    sentenceHasNumber: numsInSentence.length > 0,
                    unlinkedNumbers: unlinked,
                    numbersInAnchorsAll: numsInAnchorsAll,
                    anchorNumbers: numsInThisAnchor,
                    sentenceNumbers: numsInSentence
                },
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
     * Return only the sentence that contains the link
     */
    getSentence(markdown, matchIndex, matchLength) {
        if (!markdown) return '';

        const before = markdown.lastIndexOf('\n\n', matchIndex);
        const start = before === -1 ? 0 : before + 2;
        const after = markdown.indexOf('\n\n', matchIndex + matchLength);
        const end = after === -1 ? markdown.length : after;
        const paragraphText = markdown.slice(start, end);

        const sentences = paragraphText.match(/[^.!?]+(?:[.!?]+|$)/g) || [paragraphText];
        const relativeIndex = matchIndex - start;
        let pos = 0;
        for (let i = 0; i < sentences.length; i++) {
            const s = sentences[i];
            if (relativeIndex >= pos && relativeIndex <= pos + s.length) {
                return s.replace(/\s+/g, ' ').trim();
            }
            pos += s.length;
        }
        return paragraphText.replace(/\s+/g, ' ').trim();
    },

    /**
     * Extract numeric tokens (e.g., 81, 2,000, 12.5, 81%) from a string
     */
    _extractNumberTokens(str) {
        if (!str) return [];
        const re = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?%?|\d+(?:\.\d+)?%?)/g;
        return (str.match(re) || []).map(s => s.trim());
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
                index,
                sentence: link.sentence || link.context,
                context: link.context,
                linkText: link.text,
                url: link.url,
                features: link.features || {}
            }));

            const prompt = `You are classifying links as CITATION or REGULAR.

Definitions (strict)
- CITATION: The link is intended as the source for a specific factual claim or statistic in the same sentence.
- REGULAR: Navigation/definition/related reading; not the source of a concrete claim in that sentence.

Rules (deterministic)
1) If the anchor text itself contains a numeral/percent (e.g., "81%", "208% increase"), mark CITATION.
2) If the sentence contains any numeral/percent that is NOT part of any link's anchor text in that sentence, then a nearby link that plausibly points to a source (report/study/stats/news) should be CITATION.
3) If the sentence's numerals already appear inside some anchor text in that sentence, other generic anchors in that sentence are REGULAR.
4) Attribution phrases like "according to", "reported", "study", "research", "survey" strengthen CITATION when paired with (1) or (2).
5) When uncertain, prefer REGULAR.

Decide using only the provided sentence/context. No external knowledge.

Items (${links.length}):
${linksData.map(l => `[
${l.index}] Sentence: "${l.sentence}"
Anchor: "${l.linkText}"
URL: ${l.url}
NumbersInSentence: ${JSON.stringify(l.features.sentenceNumbers || [])}
NumbersInAnchorsThisSentence: ${JSON.stringify(l.features.numbersInAnchorsAll || [])}
NumbersInThisAnchor: ${JSON.stringify(l.features.anchorNumbers || [])}
UnlinkedNumbers: ${JSON.stringify(l.features.unlinkedNumbers || [])}`).join('\n\n')}

Output (JSON only):
{ "links": [ {"index": 0, "isCitation": true|false}, ... up to ${links.length - 1} ] }
No prose, no extra keys.`;

            // Use OpenAI for classification
            const response = await AgentManager._chatCompletion({
                model: 'gpt-5-nano',
                messages: [
                    { role: 'system', content: 'You are a deterministic link classifier. Output strict JSON only.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0
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
            link.isCitation = this.isCitationHeuristicLink(link);
        });
        return links;
    },

    /**
     * Strengthen classification with conservative local heuristics
     */
    refineWithHeuristics(links) {
        links.forEach(link => {
            const strong = this._strongCitationSignal(link.text, link.context, link.url) || (link.features && (link.features.anchorHasNumber || (link.features.unlinkedNumbers || []).length > 0));
            if (!link.isCitation && (strong || this.isCitationHeuristicLink(link))) {
                link.isCitation = true;
            }
            const generic = this._strongGenericSignal(link.text, link.context, link.url);
            if (link.isCitation && generic && !(link.features && link.features.anchorHasNumber)) {
                link.isCitation = false;
            }
        });
    },

    /**
     * Primary heuristic using link object and derived features
     */
    isCitationHeuristicLink(link) {
        const context = link.context || '';
        const text = link.text || '';
        const url = link.url || '';
        const f = link.features || {};

        // If the anchor itself has a number, treat as citation
        if (f.anchorHasNumber) return true;

        // If sentence has unlinked numbers, and link plausibly points to a source, treat as citation
        const hasUnlinked = (f.unlinkedNumbers || []).length > 0;
        if (hasUnlinked) {
            const plausible = this._plausibleSource(text, url);
            if (plausible) return true;
        }

        // Fall back to previous heuristic
        return this.isCitationHeuristic(context, text, url);
    },

    _plausibleSource(linkText, url) {
        const t = (linkText || '').toLowerCase();
        const u = (url || '').toLowerCase();
        const statWords = ['increase', 'decrease', 'percent', 'percentage', 'statistics', 'report', 'study', 'research', 'survey', 'data'];
        const urlHints = ['stats', 'statistics', '/research', '/study', '/report', 'whitepaper', '.pdf', '/press'];
        return statWords.some(w => t.includes(w)) || urlHints.some(h => u.includes(h));
    },

    /**
     * Heuristic: treat as citation if context suggests a factual claim backed by a source
     */
    isCitationHeuristic(context, linkText, url) {
        const c = (context || '').toLowerCase();
        const t = (linkText || '').toLowerCase();
        const u = (url || '').toLowerCase();

        const numRe = /(\d{1,3}(?:\.\d+)?)/;
        const hasNumberInContext = numRe.test(c) || c.includes('%') || c.includes(' percent');
        const hasNumberInText = numRe.test(t) || t.includes('%') || t.includes(' percent');

        const verbs = [
            'according to', 'announced', 'reported', 'stated', 'says', 'said',
            'found that', 'finds', 'shows', 'study', 'research', 'survey',
            'trial', 'report', 'published', 'press release', 'revealed'
        ];
        const statTerms = ['increase', 'decrease', 'percent', 'percentage', 'statistic', 'statistics', 'figure', 'data', 'estimates', 'estimate'];
        const urlHints = ['/stats', 'stats-', 'statistics', '/research', '/study', '/report', 'whitepaper', '.pdf', '/press'];

        const hasVerb = verbs.some(v => c.includes(v));
        const hasStatContext = statTerms.some(w => c.includes(w));
        const hasStatAnchor = statTerms.some(w => t.includes(w));
        const urlSuggestsStats = urlHints.some(h => u.includes(h));

        // Strong positive signals
        if (hasNumberInText) return true; // anchors like "81%", "208% increase"
        if (hasVerb && (hasNumberInContext || hasStatContext || hasStatAnchor)) return true;
        if ((hasNumberInContext || hasStatAnchor) && urlSuggestsStats) return true;

        // Weak signal
        return false;
    },

    /**
     * Strong positive signals for citation (override to true)
     */
    _strongCitationSignal(linkText, context, url) {
        const t = (linkText || '').toLowerCase();
        const u = (url || '').toLowerCase();
        const hasNumber = /(\d{1,3}(?:\.\d+)?)/.test(t) || t.includes('%');
        const hasStatWord = /(increase|decrease|percent|percentage|statistic|statistics|study|research|survey|report)/.test(t);
        const urlStat = /(stats|statistic|research|study|report|whitepaper|press|pdf)/.test(u);
        return hasNumber || (hasStatWord && urlStat);
    },

    /**
     * Strong negative signal for citation (override to false)
     */
    _strongGenericSignal(linkText, context, url) {
        const t = (linkText || '').toLowerCase().trim();
        const genericPhrases = [
            'homepage', 'home', 'learn more', 'click here', 'read more', 'about us', 'contact', 'abm strategies', 'what is', 'guide', 'overview'
        ];
        const hasNumber = /(\d{1,3}(?:\.\d+)?)/.test(t) || t.includes('%');
        if (hasNumber) return false; // never generic if numeric
        return genericPhrases.some(p => t.includes(p));
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
