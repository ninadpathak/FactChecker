/**
 * Main App Coordinator
 * Orchestrates the entire fact-checking workflow
 */

const App = {
    currentMarkdown: null,
    currentLinks: [],

    /**
     * Initialize the application
     */
    init() {
        this.loadApiKeys();
        this.attachEventListeners();
        console.log('FactChecker 2.0 initialized');
    },

    /**
     * Attach event listeners to UI elements
     */
    attachEventListeners() {
        // API dropdown toggle
        const apiToggle = document.getElementById('api-toggle');
        const apiPanel = document.getElementById('api-panel');
        apiToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            apiPanel.classList.toggle('hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!apiPanel.contains(e.target) && !apiToggle.contains(e.target)) {
                apiPanel.classList.add('hidden');
            }
        });

        // Save API keys
        const saveKeysBtn = document.getElementById('save-keys-btn');
        saveKeysBtn.addEventListener('click', () => this.saveApiKeys(true));

        // Auto-save API keys on input change
        ['openai-key', 'perplexity-key'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.saveApiKeys(false));
        });

        // Sample text buttons
        const sampleButtons = document.querySelectorAll('.btn-sample');
        sampleButtons.forEach(btn => {
            btn.addEventListener('click', (e) => this.loadSampleText(e.target.dataset.sample));
        });

        // Text input paste handler
        const inputText = document.getElementById('input-text');
        inputText.addEventListener('paste', (e) => this.handlePaste(e));

        // Clear results when input is cleared
        inputText.addEventListener('input', (e) => {
            if (e.target.value.trim() === '') {
                this.clearResults();
            }
        });

        // Process button
        const processBtn = document.getElementById('process-btn');
        processBtn.addEventListener('click', () => this.processText());

        // Verify button
        const verifyBtn = document.getElementById('verify-btn');
        verifyBtn.addEventListener('click', () => this.startFactChecking());
    },

    /**
     * Load API keys from localStorage
     */
    loadApiKeys() {
        const keys = [
            { id: 'openai-key', storage: 'factchecker_openai_key' },
            { id: 'perplexity-key', storage: 'factchecker_perplexity_key' }
        ];

        keys.forEach(({ id, storage }) => {
            const value = localStorage.getItem(storage);
            if (value) document.getElementById(id).value = value;
        });
    },

    /**
     * Save API keys to localStorage
     * @param {boolean} showConfirmation - Whether to show alert
     */
    saveApiKeys(showConfirmation = false) {
        const keys = [
            { id: 'openai-key', storage: 'factchecker_openai_key' },
            { id: 'perplexity-key', storage: 'factchecker_perplexity_key' }
        ];

        keys.forEach(({ id, storage }) => {
            const value = document.getElementById(id).value.trim();
            if (value) localStorage.setItem(storage, value);
        });

        if (showConfirmation) {
            document.getElementById('api-panel').classList.add('hidden');
            alert('API keys saved successfully!');
        }
    },

    /**
     * Get API key from input
     * @param {string} keyType - 'openai' or 'perplexity'
     * @returns {string} API key value
     */
    getApiKey(keyType) {
        return document.getElementById(`${keyType}-key`).value.trim();
    },

    /**
     * Load sample text
     * @param {string} sampleNum - Sample number (1 or 2)
     */
    loadSampleText(sampleNum) {
        const samples = {
            '1': `According to a recent study published in Nature, [scientists have discovered](https://www.nature.com/articles/fake123) that drinking coffee can improve memory by 45%. The research was conducted at [Harvard University](https://www.harvard.edu) and involved over 10,000 participants.

The findings suggest that [caffeine molecules](https://www.ncbi.nlm.nih.gov/pmc/articles/fake456) interact directly with brain cells to enhance cognitive function. This groundbreaking discovery was [featured in major news outlets](https://www.bbc.com/news/fake789) worldwide.`,

            '2': `The [World Health Organization](https://www.who.int) recently announced that a new vaccine has been developed with 100% effectiveness. According to [Dr. Smith from Stanford](https://med.stanford.edu/profiles/fake), clinical trials showed no side effects.

This vaccine was approved by the [FDA](https://www.fda.gov) in record time and is now available in all countries. [Research papers](https://www.thelancet.com/journals/fake) confirm these remarkable results.`
        };

        const inputText = document.getElementById('input-text');
        inputText.value = samples[sampleNum] || '';

        // Trigger input event to update floating label
        inputText.dispatchEvent(new Event('input'));
    },

    /**
     * Clear all results
     */
    clearResults() {
        const linksSection = document.getElementById('links-section');
        const verifyBtn = document.getElementById('verify-btn');

        linksSection.classList.add('hidden');
        verifyBtn.classList.add('hidden');

        this.currentMarkdown = null;
        this.currentLinks = [];
    },

    /**
     * Handle paste event to convert to markdown immediately
     * @param {ClipboardEvent} event - Paste event
     */
    handlePaste(event) {
        event.preventDefault();

        // Convert clipboard content to markdown
        const markdown = MarkdownConverter.convertFromClipboard(event);

        // Set the converted markdown in the textarea
        const inputText = document.getElementById('input-text');
        inputText.value = markdown;

        console.log('Text converted to markdown on paste');
    },

    /**
     * Process the pasted text
     */
    async processText() {
        const inputText = document.getElementById('input-text');
        const text = inputText.value.trim();

        if (!text) {
            alert('Please paste some text first');
            return;
        }

        // Validate OpenAI API key
        const openaiKey = this.getApiKey('openai');
        if (!openaiKey) {
            alert('Please enter your OpenAI API key to classify links');
            return;
        }

        // Disable process button
        const processBtn = document.getElementById('process-btn');
        processBtn.disabled = true;
        processBtn.textContent = 'Classifying...';

        try {
            // Store the markdown
            this.currentMarkdown = text;

            // Extract links
            let links = LinkExtractor.extractUnique(this.currentMarkdown);

            // Classify links using GPT-4o-mini
            this.currentLinks = await LinkExtractor.classifyLinks(links, openaiKey);

            // Display links table with status columns
            UIRenderer.renderLinksTable(this.currentLinks);

            console.log(`Extracted and classified ${this.currentLinks.length} unique links`);
        } catch (error) {
            console.error('Error processing text:', error);
            alert(`Error: ${error.message}`);
        } finally {
            // Re-enable process button
            processBtn.disabled = false;
            processBtn.textContent = 'Extract Links';
        }
    },

    /**
     * Start fact checking process
     */
    async startFactChecking() {
        // Validate API keys
        const openaiKey = this.getApiKey('openai');
        const perplexityKey = this.getApiKey('perplexity');

        if (!openaiKey || !perplexityKey) {
            alert('Please enter both OpenAI and Perplexity API keys');
            return;
        }

        if (this.currentLinks.length === 0) {
            alert('No links to verify');
            return;
        }

        // Set API keys
        AgentManager.setApiKeys(openaiKey, perplexityKey);

        // Disable verify button
        const verifyBtn = document.getElementById('verify-btn');
        verifyBtn.disabled = true;

        try {
            // Start fact checking with real-time updates
            await AgentManager.factCheckLinks(
                this.currentLinks,
                (index, result) => {
                    // Update UI as each result comes in
                    UIRenderer.updateResult(index, result);
                }
            );

            console.log('Fact checking complete');
        } catch (error) {
            console.error('Fact checking error:', error);
            alert(`Error during fact checking: ${error.message}`);
        } finally {
            // Re-enable button
            verifyBtn.disabled = false;
        }
    }
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
} else {
    App.init();
}
