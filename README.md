# FactChecker 2.0

An intelligent, client-side fact-checking tool that verifies citations and links in pasted text using AI.

## Features

- **🔗 Smart Link Classification**: Automatically distinguishes between citations (data sources) and regular links
- **📊 Citation Verification**: Fact-checks claims against actual source content
- **🔄 Link Health Check**: Verifies regular links are live and relevant
- **🚀 High-Speed Processing**: Fetches 10 links in parallel, verifies 5 simultaneously
- **🎯 Redirect Detection**: Identifies and reports URL redirects
- **✨ Automatic Markdown Conversion**: Converts pasted HTML/rich text to markdown
- **💾 Persistent API Keys**: Auto-saves keys to localStorage
- **🎨 Clean UI**: Intuitive table-based results with expandable explanations

## How It Works

### 1. Link Classification (GPT-5-nano)
When you process text, the tool uses AI to classify each link:
- **Citations**: Links used as sources for data, statistics, or research findings (e.g., "According to a PwC survey...")
- **Regular Links**: General hyperlinks for reference or further reading

### 2. Citation Verification
For **citations**, the tool performs rigorous fact-checking:
1. Fetches the actual page content
2. Verifies if the cited claim (e.g., "79% of organizations...") appears on the page
3. Checks if the data matches what's claimed
4. Marks as **Verified** ✅ if accurate, **Recheck** ⚠️ if questionable
5. Identifies secondary sources and suggests primary sources

### 3. Link Health Check
For **regular links**, the tool:
1. Verifies the link is live (not 404)
2. Checks if anchor text matches page content
3. Detects and reports redirects
4. Marks as **Verified** ✅ if working or **Invalid Page** ❌ if broken

## Setup

### Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- OpenAI API key
- Perplexity API key (for fallback when content can't be fetched)

### Get API Keys

- **OpenAI**: https://platform.openai.com/api-keys
- **Perplexity**: https://www.perplexity.ai/settings/api

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/ninadpathak/FactChecker.git
   cd FactChecker
   ```

2. Open `index.html` in your web browser

3. Click the key icon (🔑) and enter your API keys

4. Start fact-checking!

**Privacy**: API keys are stored in localStorage (never sent anywhere except official OpenAI/Perplexity APIs).

## Usage

### Basic Workflow

```
1. Click 🔑 icon → Enter API keys → Save
2. Paste text with links into the text area
3. Click "Extract Links" → AI classifies each link
4. Review the table showing Citations vs Regular Links
5. Click "Check Links" → AI verifies each link
6. Review results:
   ✅ Verified: Citation is accurate or link is working
   ⚠️ Recheck: Citation data doesn't match source
   ❌ Invalid Page: Link returns 404 or error
```

### Understanding Results

#### For Citations:
- **Verified** ✅: The cited claim is found on the page and matches
- **Recheck** ⚠️: The claim isn't supported by the source or data differs
- **Invalid Page** ❌: The link is broken (404, 403, etc.)

#### For Regular Links:
- **Verified** ✅: Link is live and anchor text is relevant
- **Invalid Page** ❌: Link is broken

#### Additional Info:
- Redirects are noted: "Redirects to: [new-url]"
- Secondary sources are identified with primary source suggestions

## Performance

- **10 parallel fetches**: Retrieves page content for 10 links at once
- **5 parallel verifications**: Runs 5 GPT-5-nano analyses simultaneously
- **Typical speed**: ~20 links verified in under 30 seconds

## Project Structure

```
FactChecker 2.0/
├── index.html              # Main interface
├── css/
│   └── styles.css          # All styling
├── js/
│   ├── app.js              # Main coordinator
│   ├── link-extractor.js   # Link extraction & AI classification
│   ├── agent-manager.js    # Parallel fetching & AI verification
│   ├── ui-renderer.js      # Table rendering & UI updates
│   └── markdown-converter.js # HTML to markdown conversion
├── .gitignore
└── README.md
```

## Technology Stack

- **Vanilla JavaScript**: Zero dependencies (except external libraries)
- **Turndown.js**: HTML to Markdown conversion
- **OpenAI GPT-5-nano**: Link classification & fact verification
- **Perplexity Sonar**: Fallback fact-checking when content unavailable
- **CORS Proxy**: AllOrigins for fetching page content

## API Usage & Cost

### GPT-5-nano Usage:
1. **Link Classification**: 1 batch call per extraction (all links at once)
2. **Citation Verification**: 1 call per citation
3. **Link Relevance Check**: 1 call per regular link

### Estimated Costs:
- GPT-5-nano: ~$0.15 per million tokens
- Typical cost per article (10 links): **< $0.02**

## Privacy & Security

✅ All processing happens in your browser
✅ API keys stored in localStorage (your device only)
✅ No data sent to third-party servers
✅ Direct API calls to OpenAI and Perplexity only
✅ Source code is fully transparent

## Browser Compatibility

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Limitations

- **CORS restrictions**: Some websites block content fetching (fallback to Perplexity used)
- **API rate limits**: Based on your OpenAI/Perplexity plan
- **Internet required**: All verification happens via APIs

## Example Use Cases

### ✅ Fact-Checking Articles
Verify that statistics and research citations are accurate:
- "According to a PwC survey, 79% of organizations..." → Checks if 79% is correct
- "McKinsey research found..." → Verifies the claim against McKinsey's actual research

### ✅ Content Quality Assurance
Ensure all links in your content are:
- Live and working (no 404s)
- Relevant to anchor text
- Properly attributed

### ✅ Due Diligence
Before publishing, verify:
- All data sources are legitimate
- Citations are accurate
- Links aren't broken or redirected

## Future Enhancements

- [ ] Export results to CSV/JSON
- [ ] Batch processing of multiple articles
- [ ] Custom verification prompts
- [ ] Link categories and filtering
- [ ] Citation style validation
- [ ] Historical link tracking

## Troubleshooting

### Links showing as "Content unavailable"
- Some websites block content fetching due to CORS
- Tool automatically falls back to Perplexity for verification

### All links marked as "Regular Link" instead of "Citation"
- Ensure API key is entered
- Check browser console for errors
- Try refreshing and re-entering API key

### Classification seems incorrect
- The AI learns from context - ensure full sentences are included
- You can manually review and trust your judgment

## Contributing

Contributions welcome! Areas for improvement:
- Better CORS proxy alternatives
- More robust error handling
- Additional verification methods
- UI/UX enhancements

## License

MIT License - Feel free to use and modify.

## Credits

Built with:
- [Turndown](https://github.com/mixmark-io/turndown) by Dom Christie
- [OpenAI GPT-5-nano](https://platform.openai.com/)
- [Perplexity API](https://docs.perplexity.ai/)
- [AllOrigins CORS Proxy](https://allorigins.win/)

---

**Made with ❤️ for better fact-checking and content verification**
