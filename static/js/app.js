// Application State
const state = {
    releaseNotes: [],
    selectedItems: new Set(),
    filterType: 'all',
    searchQuery: '',
    sortOrder: 'desc' // 'desc' (newest first) or 'asc' (oldest first)
};

// DOM Elements Cache
const DOM = {
    refreshBtn: document.getElementById('refresh-btn'),
    syncText: document.querySelector('.sync-text'),
    syncInfo: document.getElementById('sync-info'),
    
    // Stats
    statTotal: document.getElementById('stat-total'),
    statFeatures: document.getElementById('stat-features'),
    statChanges: document.getElementById('stat-changes'),
    statIssues: document.getElementById('stat-issues'),
    
    // Search & Filter
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    typeFilters: document.getElementById('type-filters'),
    sortSelect: document.getElementById('sort-select'),
    resetFiltersBtn: document.getElementById('reset-filters-btn'),
    
    // Grid & Empty State
    releaseGrid: document.getElementById('release-grid'),
    emptyState: document.getElementById('empty-state'),
    
    // Selection Floating Bar
    batchBar: document.getElementById('batch-actions-bar'),
    selectedCount: document.getElementById('selected-count'),
    batchTweetBtn: document.getElementById('batch-tweet-btn'),
    batchClearBtn: document.getElementById('batch-clear-btn'),
    
    // Modal
    tweetModal: document.getElementById('tweet-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    tweetTextarea: document.getElementById('tweet-textarea'),
    charCounter: document.getElementById('char-counter'),
    charProgress: document.getElementById('char-progress'),
    tweetPreviewText: document.getElementById('tweet-preview-text'),
    copyTweetBtn: document.getElementById('copy-tweet-btn'),
    sendIntentBtn: document.getElementById('send-intent-btn'),
    
    // Toasts
    toastContainer: document.getElementById('toast-container')
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    fetchReleaseNotes(false);
});

// Event Listeners Setup
function setupEventListeners() {
    // Refresh feed
    DOM.refreshBtn.addEventListener('click', () => fetchReleaseNotes(true));
    
    // Search Input
    DOM.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        toggleClearSearchButton();
        renderNotes();
    });
    
    DOM.searchClearBtn.addEventListener('click', () => {
        DOM.searchInput.value = '';
        state.searchQuery = '';
        toggleClearSearchButton();
        DOM.searchInput.focus();
        renderNotes();
    });
    
    // Filter Pills
    DOM.typeFilters.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        
        // Remove active class from all and add to clicked
        document.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
        pill.classList.add('active');
        
        state.filterType = pill.dataset.type;
        renderNotes();
    });
    
    // Sort Select
    DOM.sortSelect.addEventListener('change', (e) => {
        state.sortOrder = e.target.value;
        renderNotes();
    });
    
    // Reset Filters button (Empty State)
    DOM.resetFiltersBtn.addEventListener('click', resetFilters);
    
    // Batch Selection Operations
    DOM.batchClearBtn.addEventListener('click', clearSelection);
    DOM.batchTweetBtn.addEventListener('click', handleBatchTweet);
    
    // Modal Close
    DOM.closeModalBtn.addEventListener('click', closeTweetModal);
    DOM.tweetModal.addEventListener('click', (e) => {
        if (e.target === DOM.tweetModal) closeTweetModal();
    });
    
    // Modal Actions
    DOM.tweetTextarea.addEventListener('input', updateCharCount);
    DOM.copyTweetBtn.addEventListener('click', copyTweetToClipboard);
    DOM.sendIntentBtn.addEventListener('click', postToTwitter);
}

// Fetch Release Notes from Flask API
async function fetchReleaseNotes(forceRefresh = false) {
    showLoadingState();
    
    try {
        const url = `/api/release-notes${forceRefresh ? '?refresh=true' : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Server returned status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.message);
        }
        
        state.releaseNotes = data.items || [];
        
        // Update synchronization time
        updateSyncTime(data.last_fetched, data.fallback);
        
        // Update stats
        updateStats(state.releaseNotes);
        
        // Render notes
        renderNotes();
        
        if (forceRefresh) {
            showToast('Release notes feed refreshed successfully!', 'success');
        }
    } catch (error) {
        console.error('Failed to load release notes:', error);
        showToast(`Error fetching release notes: ${error.message}`, 'error');
        
        // Hide skeleton
        DOM.releaseGrid.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="64" height="64"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                <h3>Unable to load release notes</h3>
                <p>${error.message}</p>
                <button onclick="fetchReleaseNotes(true)" class="btn btn-primary">Try Again</button>
            </div>
        `;
    } finally {
        hideLoadingState();
    }
}

// Toggle display of search clear button
function toggleClearSearchButton() {
    if (state.searchQuery.length > 0) {
        DOM.searchClearBtn.classList.remove('hidden');
    } else {
        DOM.searchClearBtn.classList.add('hidden');
    }
}

// Show skeletons while fetching
function showLoadingState() {
    DOM.refreshBtn.classList.add('loading');
    DOM.refreshBtn.disabled = true;
    
    // Clear grid and display skeletons
    DOM.releaseGrid.innerHTML = `
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
        <div class="skeleton-card"></div>
    `;
    DOM.emptyState.classList.add('hidden');
}

function hideLoadingState() {
    DOM.refreshBtn.classList.remove('loading');
    DOM.refreshBtn.disabled = false;
}

// Update Sync Banner
function updateSyncTime(timeStr, isFallback) {
    if (!timeStr) {
        DOM.syncInfo.style.display = 'none';
        return;
    }
    DOM.syncInfo.style.display = 'flex';
    
    // Format timestamp
    const timeText = isFallback ? `Offline (Cache: ${timeStr})` : `Synced: ${timeStr}`;
    const pulseIndicator = DOM.syncInfo.querySelector('.pulse-indicator');
    
    if (isFallback) {
        pulseIndicator.style.backgroundColor = '#f87171'; // Red pulse for cached fallback
        DOM.syncText.textContent = `${timeText}`;
    } else {
        pulseIndicator.style.backgroundColor = '#10b981'; // Green pulse for healthy sync
        DOM.syncText.textContent = `Live: ${timeStr.split(' ')[1]}`; // just display time
    }
}

// Calculate Dashboard stats and filter badges
function updateStats(notes) {
    const counts = {
        total: notes.length,
        Feature: 0,
        Change: 0,
        Issue: 0
    };
    
    notes.forEach(note => {
        if (counts.hasOwnProperty(note.type)) {
            counts[note.type]++;
        }
    });
    
    // Update dashboard cards
    DOM.statTotal.textContent = counts.total;
    DOM.statFeatures.textContent = counts.Feature;
    DOM.statChanges.textContent = counts.Change;
    DOM.statIssues.textContent = counts.Issue;
    
    // Update filter badges
    document.querySelector('.count-all').textContent = counts.total;
    document.querySelector('.count-feature').textContent = counts.Feature;
    document.querySelector('.count-change').textContent = counts.Change;
    document.querySelector('.count-issue').textContent = counts.Issue;
}

// Reset Search & Filters
function resetFilters() {
    DOM.searchInput.value = '';
    state.searchQuery = '';
    toggleClearSearchButton();
    
    document.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.pill[data-type="all"]').classList.add('active');
    state.filterType = 'all';
    
    DOM.sortSelect.value = 'desc';
    state.sortOrder = 'desc';
    
    renderNotes();
}

// Main Render Function
function renderNotes() {
    // 1. Filter items
    let filteredNotes = state.releaseNotes.filter(note => {
        // Category Filter
        if (state.filterType !== 'all' && note.type !== state.filterType) {
            return false;
        }
        
        // Text Search Filter
        if (state.searchQuery) {
            const inType = note.type.toLowerCase().includes(state.searchQuery);
            const inDate = note.date_str.toLowerCase().includes(state.searchQuery);
            const inText = note.text.toLowerCase().includes(state.searchQuery);
            return inType || inDate || inText;
        }
        
        return true;
    });
    
    // 2. Sort items
    filteredNotes.sort((a, b) => {
        const dateA = new Date(a.date_iso);
        const dateB = new Date(b.date_iso);
        return state.sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
    
    // 3. Render
    DOM.releaseGrid.innerHTML = '';
    
    if (filteredNotes.length === 0) {
        DOM.emptyState.classList.remove('hidden');
        return;
    }
    
    DOM.emptyState.classList.add('hidden');
    
    filteredNotes.forEach(note => {
        const card = createCardElement(note);
        DOM.releaseGrid.appendChild(card);
    });
}

// Create Card DOM Element
function createCardElement(note) {
    const isSelected = state.selectedItems.has(note.id);
    
    const card = document.createElement('article');
    // Map categories to css classes
    const catClass = `category-${note.type.toLowerCase().replace(/\s+/g, '-')}`;
    card.className = `release-card ${catClass} ${isSelected ? 'selected' : ''}`;
    card.dataset.id = note.id;
    
    // Bind selection toggle to card click (excluding buttons and links)
    card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-card-tweet') || e.target.closest('.card-link') || e.target.closest('a')) {
            return;
        }
        toggleSelectItem(note.id);
    });
    
    // Setup card content html
    card.innerHTML = `
        <div class="card-top">
            <span class="card-badge">${note.type}</span>
            <div class="card-selection-area">
                <span class="card-date">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    ${note.date_str}
                </span>
                <div class="card-checkbox">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
            </div>
        </div>
        <div class="card-body">
            ${note.html}
        </div>
        <div class="card-footer">
            <a href="${note.link}" target="_blank" class="card-link" title="Open Google Cloud Release Notes website">
                <span>View Details</span>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
            <button class="btn btn-card-tweet" title="Post this specific update to X/Twitter">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <span>Tweet</span>
            </button>
        </div>
    `;
    
    // Tweet Button Listener
    const tweetBtn = card.querySelector('.btn-card-tweet');
    tweetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTweetComposer([note]);
    });
    
    return card;
}

// Multi Select Logic
function toggleSelectItem(id) {
    if (state.selectedItems.has(id)) {
        state.selectedItems.delete(id);
    } else {
        state.selectedItems.add(id);
    }
    
    // Toggle class visually
    const card = document.querySelector(`.release-card[data-id="${id}"]`);
    if (card) {
        card.classList.toggle('selected');
    }
    
    updateBatchActionsBar();
}

function clearSelection() {
    state.selectedItems.clear();
    document.querySelectorAll('.release-card.selected').forEach(card => {
        card.classList.remove('selected');
    });
    updateBatchActionsBar();
}

function updateBatchActionsBar() {
    const size = state.selectedItems.size;
    
    if (size > 0) {
        DOM.selectedCount.textContent = size;
        DOM.batchBar.classList.remove('hidden');
    } else {
        DOM.batchBar.classList.add('hidden');
    }
}

// Handle Batch Tweet click
function handleBatchTweet() {
    // Get all selected notes from state
    const selectedNotes = state.releaseNotes.filter(note => state.selectedItems.has(note.id));
    if (selectedNotes.length === 0) return;
    
    openTweetComposer(selectedNotes);
}

// Formulate Tweet Templates
function generateTweetText(notes) {
    const headerEmoji = "📢";
    const tags = " #BigQuery #GoogleCloud #GCP";
    
    if (notes.length === 1) {
        const note = notes[0];
        const dateStr = note.date_str;
        const typeStr = note.type;
        
        // Clean double spaces and linebreaks
        const textClean = note.text.replace(/\s+/g, ' ').trim();
        
        // Calculate max allowed length for text snippet
        // Max: 280
        // Less: emoji, spaces, labels, link length, tag length
        const linkPlaceholder = note.link;
        const introText = `${headerEmoji} BigQuery ${typeStr} (${dateStr}): `;
        const outroText = `\n\nRead more: ${linkPlaceholder}${tags}`;
        
        const reservedLen = introText.length + outroText.length;
        const availableTextLen = 280 - reservedLen;
        
        let snippet = textClean;
        if (textClean.length > availableTextLen) {
            snippet = textClean.substring(0, availableTextLen - 3) + "...";
        }
        
        return `${introText}${snippet}${outroText}`;
    } else {
        // Multi-tweet summary
        const summaryHeader = `${headerEmoji} Combined BigQuery Updates:\n`;
        const link = "https://cloud.google.com/bigquery/docs/release-notes";
        const summaryFooter = `\nSource: ${link}${tags}`;
        
        const reservedLen = summaryHeader.length + summaryFooter.length;
        const availableLen = 280 - reservedLen;
        
        // Divide remaining length among items
        const itemLimit = Math.floor(availableLen / notes.length) - 8;
        const cleanLimit = Math.max(itemLimit, 30); // At least 30 chars per note
        
        const itemsList = notes.map((note, index) => {
            const typeStr = note.type;
            const textClean = note.text.replace(/\s+/g, ' ').trim();
            
            let text = textClean;
            if (textClean.length > cleanLimit) {
                text = textClean.substring(0, cleanLimit - 3) + "...";
            }
            return `${index + 1}. [${typeStr}] ${text}`;
        }).join('\n');
        
        return `${summaryHeader}${itemsList}${summaryFooter}`;
    }
}

// Tweet Composer Modal Management
function openTweetComposer(notes) {
    const tweetText = generateTweetText(notes);
    DOM.tweetTextarea.value = tweetText;
    
    updateCharCount();
    
    DOM.tweetModal.classList.remove('hidden');
    DOM.tweetTextarea.focus();
}

function closeTweetModal() {
    DOM.tweetModal.classList.add('hidden');
}

function updateCharCount() {
    const text = DOM.tweetTextarea.value;
    const len = text.length;
    const limit = 280;
    
    DOM.charCounter.textContent = `${len} / ${limit}`;
    DOM.tweetPreviewText.textContent = text || 'Compose something to see the live feed preview...';
    
    // Calculate progress bar width
    const percentage = Math.min((len / limit) * 100, 100);
    DOM.charProgress.style.width = `${percentage}%`;
    
    // Reset colors
    DOM.charProgress.className = 'char-progress';
    DOM.charCounter.className = '';
    DOM.sendIntentBtn.disabled = false;
    
    if (len > limit) {
        DOM.charProgress.classList.add('danger');
        DOM.charCounter.classList.add('danger');
        DOM.sendIntentBtn.disabled = true;
    } else if (len > limit - 20) {
        DOM.charProgress.classList.add('warning');
        DOM.charCounter.classList.add('warning');
    }
    
    if (len === 0) {
        DOM.sendIntentBtn.disabled = true;
    }
}

// Open Twitter Web Intent
function postToTwitter() {
    const text = DOM.tweetTextarea.value.trim();
    if (!text || text.length > 280) return;
    
    // Construct Web Intent URL
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    
    // Optional: Log it in our backend
    sendMockTweetLog(text);
    
    closeTweetModal();
    showToast('Redirected to X/Twitter Web Intent!', 'success');
}

// Copy Tweet text to Clipboard
async function copyTweetToClipboard() {
    const text = DOM.tweetTextarea.value.trim();
    if (!text) return;
    
    try {
        await navigator.clipboard.writeText(text);
        
        // Show checked feedback on button
        const originalContent = DOM.copyTweetBtn.innerHTML;
        DOM.copyTweetBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Copied!</span>
        `;
        DOM.copyTweetBtn.classList.remove('btn-secondary');
        DOM.copyTweetBtn.classList.add('btn-primary');
        DOM.copyTweetBtn.style.backgroundColor = '#10b981';
        DOM.copyTweetBtn.disabled = true;
        
        setTimeout(() => {
            DOM.copyTweetBtn.innerHTML = originalContent;
            DOM.copyTweetBtn.className = 'btn btn-secondary';
            DOM.copyTweetBtn.style.backgroundColor = '';
            DOM.copyTweetBtn.disabled = false;
        }, 2000);
        
        showToast('Tweet copied to clipboard!', 'success');
    } catch (err) {
        console.error('Could not copy text: ', err);
        showToast('Failed to copy to clipboard', 'error');
    }
}

// Log simulated tweet in backend
async function sendMockTweetLog(text) {
    try {
        await fetch('/api/tweet-mock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
    } catch (e) {
        console.warn('Backend mock tweet logger is offline or failed');
    }
}

// Toast Notifications System
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '';
    if (type === 'success') {
        icon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
        icon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
        icon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    
    toast.innerHTML = `
        ${icon}
        <span>${message}</span>
        <button class="toast-close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
    
    DOM.toastContainer.appendChild(toast);
    
    // Close listener
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.remove();
    });
    
    // Auto remove
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'toastSlideIn 0.3s ease reverse forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 4000);
}
