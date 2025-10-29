/**
 * UI Renderer Module
 * Handles rendering of tables and results to the DOM
 */

const UIRenderer = {
    /**
     * Render links table with verification status
     * @param {Array} links - Array of link objects
     */
    renderLinksTable(links) {
        const section = document.getElementById('links-section');
        const output = document.getElementById('links-output');
        const verifyBtn = document.getElementById('verify-btn');

        if (links.length === 0) {
            output.innerHTML = '<p style="color: #718096; font-size: 0.875rem;">No links found in the text.</p>';
            section.classList.remove('hidden');
            section.classList.add('visible');
            verifyBtn.classList.add('hidden');
            return;
        }

        // Create verification table
        const table = document.createElement('table');
        table.id = 'verification-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>#</th>
                    <th>Link</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Explanation</th>
                </tr>
            </thead>
            <tbody id="verification-tbody">
                ${links.map((link, index) => `
                    <tr data-index="${index}">
                        <td>${index + 1}</td>
                        <td><a href="${this.escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${this.escapeHtml(link.url)}">${this.escapeHtml(link.url)}</a></td>
                        <td><span class="link-type ${link.isCitation ? 'citation' : 'regular'}">${link.isCitation ? 'Citation' : 'Link'}</span></td>
                        <td><span class="status pending">Ready</span></td>
                        <td>-</td>
                    </tr>
                `).join('')}
            </tbody>
        `;

        output.innerHTML = '';
        output.appendChild(table);
        section.classList.remove('hidden');
        section.classList.add('visible');
        verifyBtn.classList.remove('hidden');
    },

    /**
     * Update a single result in the table
     * @param {number} index - The index of the result
     * @param {Object} result - The result object
     */
    updateResult(index, result) {
        const tbody = document.getElementById('verification-tbody');
        if (!tbody) return;

        const row = tbody.querySelector(`tr[data-index="${index}"]`);
        if (!row) return;

        const statusCell = row.cells[3];  // Now status is column 4 (index 3)
        const explanationCell = row.cells[4];  // Explanation is column 5 (index 4)

        // Update status
        if (result.status === 'fetching') {
            statusCell.innerHTML = '<span class="status-spinner"></span><span class="status fetching">Fetching...</span>';
        } else if (result.status === 'checking') {
            statusCell.innerHTML = '<span class="status-spinner"></span><span class="status checking">Checking...</span>';
        } else {
            const showExplanation = (result.status === 'invalid' || result.status === 'inaccurate' || result.status === 'verified') && result.analysis;
            const explanation = showExplanation ? result.analysis : '-';
            const CHAR_LIMIT = 220;
            const needsExpansion = explanation !== '-' && explanation.length > CHAR_LIMIT;

            const statusTexts = {
                'pending': 'Ready',
                'fetching': 'Fetching...',
                'checking': 'Checking...',
                'verified': 'Verified',
                'invalid': 'Invalid Page',
                'inaccurate': 'Recheck'
            };
            statusCell.innerHTML = `<span class="status ${result.status}">${statusTexts[result.status] || result.status}</span>`;

            explanationCell.className = 'explanation-cell';
            explanationCell.setAttribute('data-row', index);

            // Prepare full and truncated HTML safely
            const fullHtml = explanation !== '-'
                ? this.escapeHtml(explanation).replace(/\n/g, '<br>')
                : '-';

            const truncatedHtml = explanation !== '-'
                ? this.escapeHtml(explanation.slice(0, CHAR_LIMIT)).replace(/\n/g, '<br>') + (explanation.length > CHAR_LIMIT ? '…' : '')
                : '-';

            // Persist both variants for toggling
            explanationCell._fullHtml = fullHtml;
            explanationCell._truncatedHtml = truncatedHtml;

            // Initial render uses truncated when long
            const initialHtml = needsExpansion ? truncatedHtml : fullHtml;
            const btnHtml = needsExpansion ? '<span class="expand-btn">Show more</span>' : '';

            explanationCell.innerHTML = `
                <span class="explanation-text">${initialHtml}</span>
                ${btnHtml}
            `;

            // Add click handler for expand button
            if (needsExpansion) {
                const expandBtn = explanationCell.querySelector('.expand-btn');
                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleExplanation(explanationCell, expandBtn);
                });
            }
        }
    },

    /**
     * Toggle explanation expansion
     * @param {HTMLElement} cell - The cell element
     * @param {HTMLElement} btn - The button element
     */
    toggleExplanation(cell, btn) {
        const isExpanded = cell.classList.contains('expanded');

        // Collapse all other expanded explanations and restore truncated content
        document.querySelectorAll('.explanation-cell.expanded').forEach(c => {
            if (c !== cell) {
                c.classList.remove('expanded');
                const otherBtn = c.querySelector('.expand-btn');
                const otherText = c.querySelector('.explanation-text');
                if (otherText && typeof c._truncatedHtml === 'string') {
                    otherText.innerHTML = c._truncatedHtml;
                }
                if (otherBtn) otherBtn.textContent = 'Show more';
            }
        });

        // Toggle current explanation content
        const textSpan = cell.querySelector('.explanation-text');
        if (!textSpan) return;

        if (isExpanded) {
            cell.classList.remove('expanded');
            if (typeof cell._truncatedHtml === 'string') textSpan.innerHTML = cell._truncatedHtml;
            btn.textContent = 'Show more';
        } else {
            cell.classList.add('expanded');
            if (typeof cell._fullHtml === 'string') textSpan.innerHTML = cell._fullHtml;
            btn.textContent = 'Show less';
        }
    },

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
