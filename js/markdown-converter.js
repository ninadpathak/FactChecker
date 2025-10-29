/**
 * Markdown Converter Module
 * Converts pasted HTML/rich text to markdown format
 */

const MarkdownConverter = {
    // Initialize Turndown converter with options
    turndownService: null,

    init() {
        // Create Turndown instance when needed
        if (typeof TurndownService !== 'undefined') {
            this.turndownService = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
                bulletListMarker: '-'
            });

            // Keep links intact
            this.turndownService.keep(['a']);
        }
    },

    /**
     * Convert HTML/rich text to markdown
     * @param {string} html - The HTML content to convert
     * @returns {string} Markdown formatted text
     */
    convert(html) {
        if (!this.turndownService) {
            this.init();
        }

        try {
            // Convert HTML to markdown
            const markdown = this.turndownService.turndown(html);
            return markdown;
        } catch (error) {
            console.error('Markdown conversion error:', error);
            // If conversion fails, return original text
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

        // Try to get HTML data first
        const htmlData = clipboardData.getData('text/html');
        if (htmlData) {
            return this.convert(htmlData);
        }

        // Fallback to plain text
        const plainText = clipboardData.getData('text/plain');
        return plainText;
    }
};

// Initialize on load
if (typeof TurndownService !== 'undefined') {
    MarkdownConverter.init();
}
