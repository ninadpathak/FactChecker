/**
 * Markdown Converter Module
 * Converts pasted HTML/rich text to markdown format
 */

const MarkdownConverter = {
    turndownService: null,

    /**
     * Convert HTML/rich text to markdown
     * @param {string} html - The HTML content to convert
     * @returns {string} Markdown formatted text
     */
    convert(html) {
        if (!this.turndownService && typeof TurndownService !== 'undefined') {
            this.turndownService = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
                bulletListMarker: '-'
            });
            this.turndownService.keep(['a']);
        }

        try {
            return this.turndownService.turndown(html);
        } catch (error) {
            console.error('Markdown conversion error:', error);
            return html;
        }
    },

    /**
     * Convert clipboard data to markdown
     * Handles both HTML and plain text paste
     * @param {ClipboardEvent} event - The paste event
     * @returns {string} Markdown formatted text
     */
    convertFromClipboard(event) {
        const clipboardData = event.clipboardData || window.clipboardData;
        const htmlData = clipboardData.getData('text/html');
        let md = htmlData ? this.convert(htmlData) : clipboardData.getData('text/plain');
        return this._postProcess(md);
    },

    /**
     * Normalize markdown quirks from clipboard conversions.
     * - Remove stray standalone '**' lines at start/end
     * - If entire text is wrapped with exactly two '**' tokens, unwrap
     * - Trim excessive whitespace
     */
    _postProcess(md) {
        let s = String(md || '');
        // Normalize line endings and trim outer whitespace
        s = s.replace(/\r\n?/g, '\n').trim();

        // Remove leading/trailing lines that are just '**'
        s = s.replace(/^\s*\*\*\s*\n/, '');
        s = s.replace(/\n\s*\*\*\s*$/, '');

        // If the entire content is wrapped as ** ... ** and there are only two tokens, unwrap
        if (s.startsWith('**') && s.endsWith('**')) {
            const count = (s.match(/\*\*/g) || []).length;
            if (count === 2) {
                s = s.slice(2, -2).trim();
            }
        }

        return s;
    }
};
