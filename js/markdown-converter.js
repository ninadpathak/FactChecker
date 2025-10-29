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
        return htmlData ? this.convert(htmlData) : clipboardData.getData('text/plain');
    }
};
