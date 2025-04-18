/**
 * Applies stored CSS to a tab if rules exist for its domain.
 * @param {number} tabId - The ID of the tab.
 * @param {string} url - The URL of the tab.
 */
async function applySavedCssToTab(tabId, url) {
    if (!url || (!url.startsWith('http:') && !url.startsWith('https'))) {
        // Only apply to http/https pages
        return;
    }

    let domain;
    try {
        domain = new URL(url).hostname;
    } catch (e) {
        console.warn(`Invalid URL encountered in background: ${url}`, e);
        return; // Ignore invalid URLs
    }

    if (!domain) return;

    try {
        const data = await chrome.storage.sync.get(domain);
        const css = data[domain];

        if (css) {
            // Check if tab still exists before injecting
            try {
                await chrome.tabs.get(tabId); // Throws error if tab doesn't exist
                 await chrome.scripting.insertCSS({
                    target: { tabId: tabId },
                    css: css
                });
                console.log(`Background: Applied CSS to ${domain} (tab ${tabId})`);
            } catch (tabError) {
                 // Tab might have been closed between the event and this check
                 if (tabError.message.includes("No tab with id")) {
                    console.log(`Background: Tab ${tabId} closed before CSS could be applied.`);
                 } else {
                    console.warn(`Background: Error injecting CSS for ${domain} (tab ${tabId}):`, tabError);
                 }
            }
        } else {
            // console.log(`Background: No CSS found for ${domain}`);
            // No need to remove CSS here, as insertCSS adds rules.
            // If rules were removed via popup, storage will be empty,
            // and nothing will be inserted on next load.
        }
    } catch (error) {
        console.error(`Background: Error accessing storage or injecting CSS for ${domain}:`, error);
    }
}

// Listen for tab updates (e.g., navigation, page reload)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Apply CSS when the tab has finished loading
    // Also check if the URL has changed (for single-page apps that update URL)
    if (changeInfo.status === 'complete' && tab.url) {
         console.log(`Background: Tab ${tabId} updated to ${tab.url}, status: complete.`);
        applySavedCssToTab(tabId, tab.url);
    }
    // Handle cases where only the URL changes without a full 'complete' status firing (less common)
    // else if (changeInfo.url) {
    //     console.log(`Background: Tab ${tabId} URL changed to ${changeInfo.url}`);
    //     applySavedCssToTab(tabId, changeInfo.url);
    // }
});

// Optional: Listen for when a tab is replaced (e.g., prerendering)
// chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
//     chrome.tabs.get(addedTabId, (tab) => {
//         if (chrome.runtime.lastError) {
//             console.warn(chrome.runtime.lastError.message);
//             return;
//         }
//         if (tab.url && tab.status === 'complete') { // Ensure it's loaded
//              console.log(`Background: Tab ${removedTabId} replaced by ${addedTabId} at ${tab.url}`);
//             applySavedCssToTab(addedTabId, tab.url);
//         }
//     });
// });


// --- Initial Setup on Extension Load (Optional but good practice) ---
// This handles cases where Chrome starts with tabs already open.
// chrome.runtime.onStartup.addListener(async () => {
//     console.log("Extension startup: Checking existing tabs.");
//     try {
//         const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
//         for (const tab of tabs) {
//             if (tab.id && tab.url && tab.status === 'complete') { // Apply only to loaded tabs
//                 applySavedCssToTab(tab.id, tab.url);
//             }
//         }
//     } catch (error) {
//         console.error("Error checking tabs on startup:", error);
//     }
// });

console.log("Custom Domain CSS background script loaded.");
