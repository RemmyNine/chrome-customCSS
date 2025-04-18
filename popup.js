// Get references to the UI elements
const domainDisplay = document.getElementById('domainDisplay');
const cssInput = document.getElementById('cssInput');
const saveButton = document.getElementById('saveButton');
const clearButton = document.getElementById('clearButton');
const statusDiv = document.getElementById('status');

let currentTabId = null;
let currentDomain = null;

/**
 * Displays a status message to the user.
 * @param {string} message - The message to display.
 * @param {boolean} isError - Optional. True if the message is an error.
 */
function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.color = isError ? 'red' : 'green';
    // Clear the message after a few seconds
    setTimeout(() => {
        statusDiv.textContent = '';
    }, 3000);
}

/**
 * Gets the domain from a URL string.
 * @param {string} urlString - The URL to parse.
 * @returns {string|null} The hostname (domain) or null if invalid.
 */
function getDomainFromUrl(urlString) {
    try {
        const url = new URL(urlString);
        // Use hostname to exclude port number if present
        return url.hostname;
    } catch (e) {
        console.error("Invalid URL:", urlString, e);
        return null; // Handle invalid URLs
    }
}

/**
 * Loads CSS for the current domain from storage and updates the UI.
 */
async function loadCssForCurrentDomain() {
    if (!currentDomain) {
        domainDisplay.textContent = 'Cannot determine domain.';
        cssInput.disabled = true;
        saveButton.disabled = true;
        clearButton.disabled = true;
        return;
    }

    domainDisplay.textContent = currentDomain;
    cssInput.disabled = false;
    saveButton.disabled = false;
    clearButton.disabled = false;

    try {
        const data = await chrome.storage.sync.get(currentDomain);
        if (data[currentDomain]) {
            cssInput.value = data[currentDomain];
            console.log(`Loaded CSS for ${currentDomain}`);
        } else {
            cssInput.value = ''; // Clear textarea if no CSS is saved
            console.log(`No CSS found for ${currentDomain}`);
        }
    } catch (error) {
        console.error("Error loading CSS from storage:", error);
        showStatus('Error loading CSS.', true);
    }
}

/**
 * Saves the CSS entered in the textarea to storage for the current domain.
 */
async function saveCss() {
    if (!currentDomain || !currentTabId) return;

    const cssToSave = cssInput.value.trim();
    const storageObject = {};
    storageObject[currentDomain] = cssToSave;

    try {
        await chrome.storage.sync.set(storageObject);
        console.log(`Saved CSS for ${currentDomain}`);
        showStatus('CSS Saved!');

        // Immediately apply/update CSS on the current tab
        await applyCssToTab(currentTabId, cssToSave);

    } catch (error) {
        console.error("Error saving CSS to storage:", error);
        showStatus('Error saving CSS.', true);
    }
}

/**
 * Clears the saved CSS for the current domain from storage.
 */
async function clearCss() {
    if (!currentDomain || !currentTabId) return;

    try {
        await chrome.storage.sync.remove(currentDomain);
        cssInput.value = ''; // Clear the text area
        console.log(`Cleared CSS for ${currentDomain}`);
        showStatus('CSS Cleared!');

        // Immediately remove CSS from the current tab
        await removeCssFromTab(currentTabId);

    } catch (error) {
        console.error("Error clearing CSS from storage:", error);
        showStatus('Error clearing CSS.', true);
    }
}

/**
 * Applies CSS to a specific tab using chrome.scripting.
 * @param {number} tabId - The ID of the tab.
 * @param {string} css - The CSS code to inject.
 */
async function applyCssToTab(tabId, css) {
     // First, attempt to remove any existing CSS injected by this extension
    await removeCssFromTab(tabId);

    if (css) { // Only insert if there's actually CSS to apply
        try {
            await chrome.scripting.insertCSS({
                target: { tabId: tabId },
                css: css
            });
            console.log(`Applied CSS to tab ${tabId}`);
        } catch (error) {
             // Ignore errors if the tab context is invalidated (e.g., tab closed)
             // or if scripting is not allowed on the page (e.g., chrome:// pages)
            if (error.message.includes("No tab with id") ||
                error.message.includes("Cannot access") ||
                error.message.includes("Extension context invalidated")) {
                console.warn(`Could not apply CSS to tab ${tabId}: ${error.message}`);
            } else {
                console.error(`Error applying CSS to tab ${tabId}:`, error);
                showStatus('Error applying CSS to tab.', true);
            }
        }
    }
}

/**
 * Removes previously injected CSS from a specific tab.
 * This relies on the background script potentially having injected CSS before.
 * Note: `removeCSS` requires the *exact* CSS that was inserted.
 * Since the background script and popup might inject independently,
 * this is tricky. A common approach is to wrap injected CSS in a known ID,
 * but `insertCSS` doesn't directly support adding IDs.
 * A simpler approach for now is to just try inserting, which often overrides
 * or adds styles. For explicit removal, more complex tracking or messaging
 * between background and popup would be needed.
 *
 * **Improvement:** Instead of removing, let's just insert. The browser handles
 * cascading styles. If the user clears, we save an empty string, and the
 * background script won't inject anything on next load. Immediate removal
 * is harder without more state management. Let's just rely on saving ""
 * and letting the background script handle it on next navigation/reload.
 *
 * **Update:** Let's try removing *all* CSS potentially inserted by the extension.
 * This might be overly broad if other extensions use `insertCSS`, but is the
 * simplest way to attempt cleanup without complex tracking. The `origin` property
 * in Manifest V3 might help target this better in the future, but for now,
 * we'll rely on the background script re-applying the correct CSS on load.
 *
 * **Revisiting `removeCSS`:** `removeCSS` takes the *same* parameters as `insertCSS`.
 * We don't know the exact CSS the background script might have injected.
 *
 * **Final Approach:** Let's stick to `insertCSS` from the popup for immediate effect.
 * If the user clears, we save empty CSS. The background script handles applying
 * the *correct* (potentially empty) CSS on subsequent loads/navigations.
 * We won't explicitly *remove* CSS from the popup, just overwrite/insert.
 * Let's refine `applyCssToTab` to handle empty CSS correctly (do nothing).
 * And add a separate `removeCssFromTab` for the 'Clear' button.
 *
 * To make `removeCSS` work reliably from the popup *after* the background
 * might have injected, we need to know the CSS the background injected.
 * Let's simplify: The popup ONLY applies the *current* text area content.
 * The background script ONLY applies the *saved* content on load.
 * When 'Clear' is pressed, we save "" and *attempt* to remove the *current*
 * text area content from the page (which might not match what's actually active).
 * This is imperfect but avoids complex state sharing.
 */
async function removeCssFromTab(tabId) {
    // Get the CSS that *was* potentially applied (based on current text area)
    // This is imperfect if the background script applied different CSS.
    const cssToRemove = cssInput.value.trim(); // Get current value before clearing

    if (cssToRemove) {
        try {
            // Attempt to remove the CSS currently shown in the textarea
            await chrome.scripting.removeCSS({
                target: { tabId: tabId },
                css: cssToRemove
            });
            console.log(`Attempted to remove CSS from tab ${tabId}`);
        } catch (error) {
             // Ignore errors gracefully (e.g., CSS wasn't there, tab closed, etc.)
            if (error.message.includes("No tab with id") ||
                error.message.includes("Cannot access") ||
                error.message.includes("Extension context invalidated") ||
                error.message.includes("css is invalid")) { // Ignore if CSS was empty/invalid
                console.warn(`Could not remove CSS from tab ${tabId}: ${error.message}`);
            } else {
                console.error(`Error removing CSS from tab ${tabId}:`, error);
                // Don't show error to user for remove, as it's best-effort
            }
        }
    }
     // If clearing, we also want to ensure *no* CSS is active,
     // even if removeCSS failed. Injecting empty CSS doesn't work.
     // Best approach is to rely on the user reloading or navigating
     // after clearing, where the background script won't inject anything.
}


// --- Initialization ---

// Add event listeners
saveButton.addEventListener('click', saveCss);
clearButton.addEventListener('click', clearCss);

// Get the current tab information when the popup opens
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
        console.error("No active tab found.");
        domainDisplay.textContent = 'Error: No active tab.';
        return;
    }
    const tab = tabs[0];
    currentTabId = tab.id;

    if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
        currentDomain = getDomainFromUrl(tab.url);
        loadCssForCurrentDomain(); // Load CSS once domain is known
    } else {
        domainDisplay.textContent = 'Not applicable on this page';
        cssInput.disabled = true;
        saveButton.disabled = true;
        clearButton.disabled = true;
         showStatus('Cannot apply CSS to this type of page.', true);
    }
});
