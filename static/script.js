let currentBookId = null;
let currentBookText = "";

async function searchMeaning() {
    let wordInput = document.getElementById("word");
    let meaningObj = document.getElementById("meaning");
    let word = wordInput.value.trim();
    
    if (!word) {
        meaningObj.innerText = "";
        return;
    }
    
    meaningObj.innerHTML = "<span style='color: var(--text-light);'>Searching...</span>";
    
    try {
        let res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        
        if (!res.ok) {
            meaningObj.innerText = "Meaning not found";
            return;
        }
        
        let data = await res.json();
        if (data && data.length > 0 && data[0].meanings && data[0].meanings.length > 0) {
            let definition = data[0].meanings[0].definitions[0].definition;
            // Capitalize first letter elegantly
            definition = definition.charAt(0).toUpperCase() + definition.slice(1);
            meaningObj.innerText = definition;
        } else {
            meaningObj.innerText = "Meaning not found";
        }
    } catch(err) {
        console.error("Dictionary error:", err);
        meaningObj.innerText = "Network Error";
    }
}

function upload() {
    let file = document.getElementById("file").files[0];

    if (!file) {
        showUploadToast("Please choose a file first.", "warn");
        return;
    }

    let form = new FormData();
    form.append("file", file);

    // Show uploading indicator
    showUploadToast("⏳ Uploading " + file.name + "...", "info");

    fetch("/upload", {
        method: "POST",
        body: form
    })
    .then(async res => {
        let data = await res.json().catch(() => ({ message: "Unknown error" }));
        if (res.status === 409) {
            // Duplicate book
            showUploadToast("📚 " + data.message, "warn");
            return;
        }
        if (!res.ok) {
            showUploadToast("❌ Upload failed: " + data.message, "error");
            return;
        }
        // Success
        document.getElementById("file").value = "";
        let label = document.querySelector('.btn-upload-label');
        if (label) label.innerText = "Choose File";
        showUploadToast("✅ Book uploaded successfully!", "success");
        loadBooks();
    })
    .catch(err => {
        console.error(err);
        showUploadToast("❌ Upload failed. Check your connection.", "error");
    });
}

function showUploadToast(msg, type) {
    let existing = document.getElementById("uploadToast");
    if (existing) existing.remove();

    let colors = {
        success: "#2d6a4f",
        warn:    "#b5451b",
        error:   "#7f1d1d",
        info:    "#1e3a5f"
    };
    let bg = colors[type] || colors.info;

    let toast = document.createElement("div");
    toast.id = "uploadToast";
    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: ${bg}; color: #fff; padding: 12px 24px; border-radius: 12px;
        font-size: 0.9rem; font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,0.35);
        z-index: 9999; animation: toastIn 0.3s ease; max-width: 380px; text-align: center;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);

    // Auto-dismiss after 4 seconds (info-type stays until replaced)
    if (type !== "info") {
        setTimeout(() => toast.remove(), 4000);
    }
}

let _processingPollTimer = null;

function loadBooks() {
    return fetch("/books")
    .then(res => res.json())
    .then(data => {
        let list = document.getElementById("booklist");
        list.innerHTML = "";

        let hasProcessing = false;

        data.forEach(book => {
            // book = [id, name, uploaded_at, status]
            let status = book[3] || "ready";
            if (status === "processing") hasProcessing = true;

            let tr = document.createElement("tr");

            let badge = "";
            if (status === "processing") {
                badge = `<span style="font-size:0.7rem;background:#1e3a5f;color:#7ec8f8;padding:2px 7px;border-radius:20px;margin-left:6px;">⏳ Processing…</span>`;
            } else if (status === "error") {
                badge = `<span style="font-size:0.7rem;background:#7f1d1d;color:#fca5a5;padding:2px 7px;border-radius:20px;margin-left:6px;">❌ Failed</span>`;
            }

            let openBtn = status === "ready"
                ? `<button onclick="openBook(${book[0]})">Open</button>`
                : `<button disabled style="opacity:0.4;cursor:not-allowed;">Open</button>`;

            tr.innerHTML = `
                <td style="width: 100%; max-width: 0; padding-right: 12px;">
                    <div style="font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.95rem;">${book[1]}${badge}</div>
                    <div style="font-size: 0.75rem; color: var(--text-light);">${book[2]}</div>
                </td>
                <td style="text-align: right; width: 65px;">
                    ${openBtn}
                    <button onclick="deleteBook(${book[0]})">Delete</button>
                </td>
            `;

            list.appendChild(tr);
        });

        // Auto-refresh every 3s while any book is still processing
        if (hasProcessing) {
            if (!_processingPollTimer) {
                _processingPollTimer = setInterval(() => {
                    loadBooks().then(d => {
                        let stillProcessing = (d || []).some(b => (b[3] || "ready") === "processing");
                        if (!stillProcessing) {
                            clearInterval(_processingPollTimer);
                            _processingPollTimer = null;
                            showUploadToast("✅ Book is ready to read!", "success");
                        }
                    });
                }, 3000);
            }
        } else if (_processingPollTimer) {
            clearInterval(_processingPollTimer);
            _processingPollTimer = null;
        }

        return data;
    })
    .catch(err => {
        console.error("Books load error:", err);
    });
}

function filterBooks() {
    let filter = document.getElementById("bookSearchInput").value.toLowerCase();
    let rows = document.querySelectorAll("#booklist tr");
    rows.forEach(tr => {
        let nameDiv = tr.querySelector("td div");
        if(nameDiv) {
            let bookName = nameDiv.innerText.toLowerCase();
            if(bookName.includes(filter)) {
                tr.style.display = "";
            } else {
                tr.style.display = "none";
            }
        }
    });
}
function showLoader(msg) {
    document.getElementById("loaderText").innerText = msg || "Loading book...";
    document.getElementById("bookLoader").style.display = "flex";
    document.getElementById("translationLoader").style.display = "none";
    document.getElementById("reader").classList.add('no-spine-shadow');
    document.getElementById("reader").style.opacity = "0.3"; 
}

function showTranslationLoader(msg) {
    document.getElementById("translationLoaderText").innerText = msg || "Translating language...";
    document.getElementById("bookLoader").style.display = "none";
    document.getElementById("translationLoader").style.display = "flex";
    document.getElementById("reader").classList.add('no-spine-shadow');
    document.getElementById("reader").style.opacity = "0.3"; 
}

function hideLoader() {
    document.getElementById("bookLoader").style.display = "none";
    document.getElementById("translationLoader").style.display = "none";
    document.getElementById("reader").classList.remove('no-spine-shadow');
    document.getElementById("reader").style.opacity = "1";
}

// Bookmark Helper
// Bookmark Helper
function showBookmarkModal(title, text, primaryText, secondaryText, tertiaryText, onPrimary, onSecondary, onTertiary) {
    const modal = document.getElementById("bookmarkModal");
    const titleEl = document.getElementById("bookmarkModalTitle");
    const textEl = document.getElementById("bookmarkModalText");
    const primaryBtn = document.getElementById("bookmarkPrimaryBtn");
    const secondaryBtn = document.getElementById("bookmarkSecondaryBtn");
    const tertiaryBtn = document.getElementById("bookmarkTertiaryBtn");

    if (!modal || !titleEl || !textEl || !primaryBtn || !secondaryBtn || !tertiaryBtn) return;

    titleEl.innerText = title;
    textEl.innerText = text;
    primaryBtn.innerText = primaryText;
    secondaryBtn.innerText = secondaryText;

    if (tertiaryText) {
        tertiaryBtn.innerText = tertiaryText;
        tertiaryBtn.style.display = "block";
    } else {
        tertiaryBtn.style.display = "none";
    }

    modal.style.display = "flex";

    primaryBtn.onclick = () => {
        modal.style.display = "none";
        if (onPrimary) onPrimary();
    };
    secondaryBtn.onclick = () => {
        modal.style.display = "none";
        if (onSecondary) onSecondary();
    };
    tertiaryBtn.onclick = () => {
        modal.style.display = "none";
        if (onTertiary) onTertiary();
    };
}

function openBook(bookId) {
    window.speechSynthesis.cancel();
    isReadingAloud = false;
    isPaused = false;
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";
    
    // If a book is already open and progress was made, ask to save bookmark
    if (currentBookId && currentBookId !== bookId && currentAbsoluteCharIndex > 0) {
        showBookmarkModal(
            "Save Progress?",
            "Would you like to save your current position before switching books?",
            "Save Bookmark",
            "Don't Save",
            "Cancel",
            () => {
                localStorage.setItem(`bookmark_${currentBookId}`, currentAbsoluteCharIndex);
                proceedToOpenBook(bookId);
            },
            () => proceedToOpenBook(bookId),
            () => { /* Just close modal, stay in current book */ }
        );
        return;
    }
    proceedToOpenBook(bookId);
}

function proceedToOpenBook(bookId) {
    showLoader();
    fetch("/book/" + bookId)
    .then(res => res.json())
    .then(async data => {
        if (data.error) {
            hideLoader();
            alert(data.error);
            return;
        }

        currentBookId = bookId;
        currentBookText = data.text || "";

        document.getElementById("booktitle").innerText = data.name;
        
        let reader = document.getElementById("reader");
        
        // Use a slight timeout to let the loader render
        await new Promise(r => setTimeout(r, 50));
        
        // Clear reader and prepare container
        reader.innerHTML = '<div class="book-content-container"></div>';
        let container = reader.querySelector('.book-content-container');
        hideLoader();

        // Efficiently split currentBookText into individual pages without expensive regex matching
        let pageChunks = [];
        if (currentBookText.includes('class="lazy-page-container"')) {
            // Split by the explicit marker we added in the backend
            let parts = currentBookText.split('<div id="pdf-page-');
            for (let i = 1; i < parts.length; i++) {
                // Restore the opening tag (split removed it)
                let pageHtml = '<div id="pdf-page-' + parts[i];
                // If it's not the last one, it still has the trailing junk before next page, but innerHTML will ignore it 
                // or we can be precise and trim it.
                // However, our backend wraps each page in its own div, so we just need to close it if it was cut off.
                pageChunks.push(pageHtml);
            }
        }
        
        if (pageChunks.length === 0 && currentBookText.trim()) {
            // Fallback for non-PDF or unexpected format
            container.innerHTML = currentBookText;
        }

        let containerW = reader.clientWidth - 20;
        let renderedCount = 0;

        async function renderBatch(startIndex) {
            const batchSize = startIndex === 0 ? 5 : 15; // Small first batch for instant view
            const endIndex = Math.min(startIndex + batchSize, pageChunks.length);
            
            for (let i = startIndex; i < endIndex; i++) {
                // Create a temporary element to hold the page chunk
                let temp = document.createElement('div');
                temp.innerHTML = pageChunks[i];
                let pageWrapper = temp.firstChild;
                container.appendChild(pageWrapper);

                // Apply scaling immediately to the new page
                let pdfPage = pageWrapper.querySelector('div[id^="page"]');
                if (pdfPage) {
                    // Optimized scaling logic
                    let w = parseFloat(pdfPage.style.width) || 800;
                    let h = parseFloat(pdfPage.style.height);
                    
                    pdfPage.setAttribute('data-original-width', w);
                    if (h) pdfPage.setAttribute('data-original-height', h);

                    let baseScale = Math.min(1.0, containerW / w);
                    let finalScale = baseScale * currentZoom;
                    
                    pdfPage.style.width = w + "px";
                    if (h) pdfPage.style.height = h + "px";
                    pdfPage.style.transform = `scale(${finalScale})`;
                    pdfPage.style.transformOrigin = "top left";
                    pdfPage.style.display = "block";
                    pdfPage.style.margin = "0";

                    // The wrapper (.lazy-page-container) needs to hold the scaled dimensions
                    let sW = w * finalScale;
                    let sH = h * finalScale;
                    pageWrapper.style.width = sW + "px";
                    pageWrapper.style.height = sH + "px";
                    pageWrapper.style.marginBottom = "30px";

                    if (sW < containerW) {
                        pageWrapper.style.marginLeft = "auto";
                        pageWrapper.style.marginRight = "auto";
                    } else {
                        pageWrapper.style.marginLeft = "0";
                        pageWrapper.style.marginRight = "0";
                    }
                }
            }

            renderedCount = endIndex;

            // Periodically refresh highlights as pages load (e.g., every 30 pages)
            // This ensures long books show highlights while rendering continues.
            if (currentBookId && renderedCount % 30 === 0) {
                applyExistingHighlights();
                rebuildReadingNodeMap(); 
            }

            if (renderedCount < pageChunks.length) {
                // Return to main thread to keep UI responsive
                await new Promise(r => setTimeout(r, 10));
                return renderBatch(renderedCount);
            } else {
                // Final pass once everything is rendered
                applyExistingHighlights();
            }
        }

        // Check for existing bookmark before starting batches
        const savedIndex = localStorage.getItem(`bookmark_${bookId}`);
        if (savedIndex) {
            showBookmarkModal(
                "Continue Reading?",
                "We found a bookmark. Would you like to resume from your last position?",
                "Resume",
                "Start Over",
                "Cancel",
                () => {
                    currentAbsoluteCharIndex = parseInt(savedIndex);
                    // Start rendering and scroll once ready
                    renderBatch(0).then(() => {
                        scrollToIndex(currentAbsoluteCharIndex);
                    });
                },
                () => {
                    currentAbsoluteCharIndex = 0;
                    localStorage.removeItem(`bookmark_${bookId}`);
                    renderBatch(0);
                },
                () => {
                    reader.innerHTML = `<div class="empty-state" style="text-align: center; color: var(--text-light); font-style: italic; margin-top: 50px;">Select a book from the sidebar to start reading.</div>`;
                    document.getElementById("booktitle").innerText = "Select a book from your library";
                    currentBookId = null;
                }
            );
        } else {
            currentAbsoluteCharIndex = 0;
            renderBatch(0);
        }

        // Apply a one-time normalization pass to clear soft-hyphens and messy characters
        // that cause offset drift between speech engine and DOM.
        setTimeout(() => normalizeBookDOM(reader), 1000);
        
        loadHighlights(bookId);
    })
    .catch(err => {
        console.error(err);
        hideLoader();
        alert("Could not open book");
    });
}

function deleteBook(bookId) {
    if (!confirm("Do you want to delete this book?")) {
        return;
    }

    window.speechSynthesis.cancel();
    isReadingAloud = false;
    isPaused = false;
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

    fetch("/delete_book/" + bookId, {
        method: "POST"
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message || data.error);
        document.getElementById("reader").innerHTML = "";
        document.getElementById("booktitle").innerText = "No book selected";
        loadBooks();
    });
}

function saveHighlight() {
    console.log("Save Highlight Initiated");
    let selection = window.getSelection();
    let text = selection.toString().trim();
    let toolbar = document.getElementById("selectionToolbar");

    if (!text || !currentBookId) {
        console.warn("SaveHighlight aborted: text or bookId missing", { text, currentBookId });
        if (toolbar) toolbar.style.display = "none";
        return;
    }

    // Identify the range before any DOM modifications
    let rangeData = getAbsoluteSelectionRange();
    if (!rangeData) {
        console.error("Failed to calculate absolute range for selection");
        return;
    }

    console.log("Applying highlight to range:", rangeData);
    
    // Apply visual highlight immediately
    let reader = document.getElementById("reader");
    highlightAbsoluteRange(reader, rangeData, 'highlight');

    // Persist locally so it stays across lazy-loads
    if (!currentHighlights.some(h => {
        let jh = typeof h === 'string' ? JSON.parse(h) : h;
        return jh.startChar === rangeData.startChar && jh.endChar === rangeData.endChar;
    })) {
        currentHighlights.push(JSON.stringify(rangeData));
    }

    // Save to server
    fetch("/save_highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            book_id: currentBookId,
            highlighted_text: JSON.stringify(rangeData)
        })
    }).then(res => {
        if (res.ok) console.log("Highlight saved to server");
    }).catch(err => console.error("Error saving highlight:", err));

    // Cleanup
    if (toolbar) toolbar.style.display = "none";
    selection.removeAllRanges();
}

function getAbsoluteSelectionRange() {
    let selection = window.getSelection();
    if (selection.rangeCount === 0) return null;
    let range = selection.getRangeAt(0);
    let reader = document.getElementById("reader");
    
    let { nodes, offsets } = getNodesAndText(reader);
    
    let startNode = range.startContainer;
    let startOffset = range.startOffset;
    let endNode = range.endContainer;
    let endOffset = range.endOffset;

    // Helper to find the first/last text node inside an element
    function firstText(el) {
        if (el.nodeType === 3) return el;
        let walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        return walker.nextNode();
    }
    function lastText(el) {
        if (el.nodeType === 3) return el;
        let walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        let last = null; let node;
        while(node = walker.nextNode()) last = node;
        return last;
    }

    // Resolve element containers to text nodes
    if (startNode.nodeType === 1) {
        let child = startNode.childNodes[startOffset];
        if (child) {
            startNode = firstText(child) || startNode;
            startOffset = 0;
        } else {
            // End of element
            startNode = lastText(startNode) || startNode;
            startOffset = (startNode.nodeType === 3) ? startNode.nodeValue.length : 0;
        }
    }
    if (endNode.nodeType === 1) {
        let child = endNode.childNodes[endOffset - 1] || endNode.childNodes[endOffset];
        if (child) {
            endNode = lastText(child) || endNode;
            endOffset = (endNode.nodeType === 3) ? endNode.nodeValue.length : 0;
        } else {
            endNode = lastText(endNode) || endNode;
            endOffset = (endNode.nodeType === 3) ? endNode.nodeValue.length : 0;
        }
    }

    let startIndex = -1;
    let endIndex = -1;
    
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i] === startNode) startIndex = offsets[i] + startOffset;
        if (nodes[i] === endNode) endIndex = offsets[i] + endOffset;
        if (startIndex !== -1 && endIndex !== -1) break;
    }
    
    // Fallback: If exact nodes not found, use character-based reconstruction (costly but accurate)
    if (startIndex === -1 || endIndex === -1) {
        console.warn("Exact nodes not found in map, using fallback calculation...");
        let preRange = range.cloneRange();
        preRange.selectNodeContents(reader);
        preRange.setEnd(range.startContainer, range.startOffset);
        startIndex = preRange.toString().length;
        endIndex = startIndex + range.toString().length;
    }
    
    return { 
        startChar: Math.min(startIndex, endIndex), 
        endChar: Math.max(startIndex, endIndex), 
        text: selection.toString().trim() 
    };
}

function highlightAbsoluteRange(reader, item, className) {
    if (!item || item.startChar === undefined || item.endChar === undefined) return;
    
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    let currentLength = 0;
    let nodesToWrap = [];
    
    while(walker.nextNode()) {
        let node = walker.currentNode;
        // Skip hidden/system nodes
        if (node.parentNode.classList.contains('empty-state') || node.parentNode.id === 'thankYouState' || node.parentNode.classList.contains('selection-toolbar')) continue;

        let nodeLen = node.nodeValue.length;
        let nodeStart = currentLength;
        let nodeEnd = currentLength + nodeLen;
        
        if (nodeEnd > item.startChar && nodeStart < item.endChar) {
            let sliceStart = Math.max(0, item.startChar - nodeStart);
            let sliceEnd = Math.min(nodeLen, item.endChar - nodeStart);
            nodesToWrap.push({ node, sliceStart, sliceEnd });
        }
        
        currentLength += nodeLen;
        if (currentLength >= item.endChar) break;
    }
    
    // Apply highlights from bottom-up to keep tree offsets valid during mutation
    for (let i = nodesToWrap.length - 1; i >= 0; i--) {
        let { node, sliceStart, sliceEnd } = nodesToWrap[i];
        let parent = node.parentNode;
        if (!parent) continue;
        
        // Prevent recursive wrapping of already highlighted elements
        if (parent.classList.contains(className)) continue;

        let nodeText = node.nodeValue;
        if (sliceStart === 0 && sliceEnd === nodeText.length) {
            let span = document.createElement("span");
            span.className = className;
            span.textContent = nodeText;
            try { parent.replaceChild(span, node); } catch(e) {}
        } else {
            let beforeText = nodeText.slice(0, sliceStart);
            let midText = nodeText.slice(sliceStart, sliceEnd);
            let afterText = nodeText.slice(sliceEnd);
            
            let span = document.createElement("span");
            span.className = className;
            span.textContent = midText;
            
            if (afterText) {
                try { parent.insertBefore(document.createTextNode(afterText), node.nextSibling); } catch(e) {}
            }
            try { parent.insertBefore(span, node.nextSibling); } catch(e) {}
            if (beforeText) {
                node.nodeValue = beforeText;
            } else {
                try { parent.removeChild(node); } catch(e) {}
            }
        }
    }
}

// Global cache for characters to nodes mapping to avoid repeated traversal
let textNodeCache = [];
let totalCharCount = 0;

function applyExistingHighlights() {
    if (!currentHighlights || currentHighlights.length === 0) return;
    
    let reader = document.getElementById("reader");
    let batch = [];

    currentHighlights.forEach(itemStr => {
        if (!itemStr) return;
        try {
            let item = typeof itemStr === 'string' ? JSON.parse(itemStr) : itemStr;
            if (item && item.startChar !== undefined) {
                batch.push(item);
            }
        } catch(e) {}
    });

    if (batch.length === 0) return;

    // Apply each highlight using the absolute offsets
    batch.forEach(item => {
        highlightAbsoluteRange(reader, item, 'highlight');
    });
}

function refreshNodeCache() {
    let reader = document.getElementById("reader");
    textNodeCache = [];
    totalCharCount = 0;
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    while(walker.nextNode()) {
        let node = walker.currentNode;
        let len = node.nodeValue.length;
        textNodeCache.push({
            node: node,
            start: totalCharCount,
            end: totalCharCount + len
        });
        totalCharCount += len;
    }
}

function loadHighlights(bookId) {
    // REMOVED: document.getElementById("reader").innerHTML = currentBookText; 
    // This was causing hangs on large books and breaking lazy loading.
    
    return fetch("/highlights/" + bookId)
    .then(res => res.json())
    .then(highlights => {
        currentHighlights = highlights;
        applyExistingHighlights();
        
        // Re-append the Q&A block after the highlights are drawn

    }).then(() => {
        // Apply OCR overlays on images (runs after highlights, non-blocking)
        setTimeout(applyImageOcrOverlays, 200);
    });
}

let searchMatchesFound = 0;
let currentSearchIndex = -1;
let currentHighlights = [];
let searchTimeout = null;
let currentAbsoluteCharIndex = 0;
let isReadingAloud = false;
let isPaused = false;
let globalReadingText = "";
let globalTextNodes = [];
let globalNodeOffsets = []; // Cached start offsets for each node in globalTextNodes
let activeReadingMarks = []; // Track current highlighted spans
let lastHighlightPos = -1; // Prevent backward jumping

function normalizeBookDOM(root) {
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
        let node = walker.currentNode;
        // Clean soft hyphens, zero-width spaces, and other "invisible" PDF artifacts
        // that break character-offset mapping during speech and highlighting.
        let val = node.nodeValue
            .replace(/\u00AD/g, '')     // soft hyphen
            .replace(/\u00A0/g, ' ')    // nbsp
            .replace(/\u200B/g, '')     // zero-width space
            .replace(/\r/g, '');        // CR
            
        if (val !== node.nodeValue) {
            node.nodeValue = val;
        }
    }
}

function getNodesAndText(root) {
    let nodes = [];
    let offsets = [];
    let text = "";
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
        let node = walker.currentNode;
        if (node.parentNode.classList.contains('empty-state') || node.parentNode.id === 'thankYouState') continue;
        
        // READ ONLY: We no longer mutate nodeValue here to prevent selection collapse
        let val = node.nodeValue;

        nodes.push(node);
        offsets.push(text.length);
        text += val;
    }
    return { nodes, offsets, text };
}

function highlightTextInNode(element, textToHighlight, className) {
    if (!textToHighlight) return;
    let regex = new RegExp("(" + textToHighlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ")", "gi");
    
    let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    let nodes = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }
    
    nodes.forEach(node => {
        if (node.parentNode && node.parentNode.className === className) return;
        let text = node.nodeValue;
        if (text.match(regex)) {
            let span = document.createElement("span");
            span.innerHTML = text.replace(regex, (match) => {
                let idAttr = className === 'find-highlight' ? ` id="search-match-${searchMatchesFound++}"` : '';
                return `<span class="${className}"${idAttr}>${match}</span>`;
            });
            node.parentNode.replaceChild(span, node);
        }
    });
}

function readAloud() {
    let reader = document.getElementById("reader");
    let { nodes, offsets, text } = getNodesAndText(reader);
    globalTextNodes = nodes;
    globalNodeOffsets = offsets;
    globalReadingText = text;


    if (!text.trim()) {
        alert("No book text to read");
        return;
    }

    stopReading();
    isReadingAloud = true;
    lastHighlightPos = -1; // Reset high-water mark for new run
    
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Pause ⏸";

    // removeReadingMarks now moved to global scope

    let remainingText = text.substring(currentAbsoluteCharIndex);
    let chunks = [];
    let lastSplit = 0;
    for (let i = 0; i < remainingText.length; i++) {
        let isBoundary = /[.!?\n]/.test(remainingText[i]);
        let nextChar = remainingText[i+1];
        if (isBoundary && (!nextChar || !/[.!?\n]/.test(nextChar))) {
            chunks.push(remainingText.substring(lastSplit, i + 1));
            lastSplit = i + 1;
        } else if (i - lastSplit > 200 && /\s/.test(remainingText[i])) {
            chunks.push(remainingText.substring(lastSplit, i + 1));
            lastSplit = i + 1;
        }
    }
    if (lastSplit < remainingText.length) {
        chunks.push(remainingText.substring(lastSplit));
    }
    let currentChunkAbsStart = currentAbsoluteCharIndex;

    let testLang = getSelectedLanguage();
    let testShort = testLang ? testLang.split('-')[0].toLowerCase() : 'en';
    if (testShort !== 'en') {
        playFallbackAudioQueue(chunks, currentChunkAbsStart, testShort, false);
        return;
    }

    chunks.forEach(chunk => {
        let trimmed = chunk.trimStart();
        if(!trimmed) {
            currentChunkAbsStart += chunk.length;
            return;
        }
        let leadingSpaces = chunk.length - trimmed.length;
        let actualStartOffset = currentChunkAbsStart + leadingSpaces;

        let utterance = new SpeechSynthesisUtterance(trimmed);
        let lang = getSelectedLanguage();
        if (lang) {
            utterance.lang = lang;
            let voices = window.speechSynthesis.getVoices();
            let shortLang = lang.split('-')[0].toLowerCase();
            let selector = document.getElementById('langSelect');
            let langText = selector && selector.selectedIndex >= 0 ? selector.options[selector.selectedIndex].text.toLowerCase().split(' ')[0] : 'english';
            
            let voice = voices.find(v => v.lang.toLowerCase().replace('_','-') === lang.toLowerCase()) || 
                        voices.find(v => v.lang.toLowerCase().startsWith(shortLang)) ||
                        voices.find(v => v.name.toLowerCase().includes(langText));
            if (voice) {
                utterance.voice = voice;
            }
        }
        utterance.rate = 0.9;
        
        currentChunkAbsStart += chunk.length;

        utterance.onstart = function() {
            removeReadingMarks();
        };

        utterance.onboundary = function(event) {
            if (event.name !== 'word' && event.name !== 'sentence') return;
            
            let wordText = event.currentTarget.text.substring(event.charIndex);
            let wordMatch = wordText.match(/^[\w\u0080-\uFFFF]+/);
            let charLength = event.charLength || (wordMatch ? wordMatch[0].length : 1);
            
            let absoluteWordPosition = actualStartOffset + event.charIndex;
            currentAbsoluteCharIndex = absoluteWordPosition;

            requestAnimationFrame(() => {
                highlightReadingWord(absoluteWordPosition, charLength);
            });
        };
        
        window.speechSynthesis.speak(utterance);
    });
}

function resumeReadingFromIndex(index, startPaused = false) {
    if (index >= globalReadingText.length) {
        stopReading();
        return;
    }
    
    stopReading();
    isReadingAloud = true;
    isPaused = startPaused;
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = startPaused ? "Resume ▶" : "Pause ⏸";
    
    let reader = document.getElementById("reader");
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    globalTextNodes = [];
    globalNodeOffsets = [];
    let currentPos = 0;
    while (walker.nextNode()) {
        let node = walker.currentNode;
        globalTextNodes.push(node);
        globalNodeOffsets.push(currentPos);
        currentPos += node.nodeValue.length;
    }
    
    let text = globalReadingText;
    currentAbsoluteCharIndex = index;
    if (!text.trim()) return;

    let remainingText = text.substring(index);
    let chunks = [];
    let lastSplit = 0;
    for (let i = 0; i < remainingText.length; i++) {
        let isBoundary = /[.!?\n]/.test(remainingText[i]);
        let nextChar = remainingText[i+1];
        if (isBoundary && (!nextChar || !/[.!?\n]/.test(nextChar))) {
            chunks.push(remainingText.substring(lastSplit, i + 1));
            lastSplit = i + 1;
        } else if (i - lastSplit > 200 && /\s/.test(remainingText[i])) {
            chunks.push(remainingText.substring(lastSplit, i + 1));
            lastSplit = i + 1;
        }
    }
    if (lastSplit < remainingText.length) {
        chunks.push(remainingText.substring(lastSplit));
    }
    let chunkOffset = index;

    // removeReadingMarks now moved to global scope

    let testLang = getSelectedLanguage();
    let testShort = testLang ? testLang.split('-')[0].toLowerCase() : 'en';

    if (testShort !== 'en') {
        playFallbackAudioQueue(chunks, chunkOffset, testShort, startPaused);
        return;
    }

    let testVoice = null;
    if (testLang) {
        let voices = window.speechSynthesis.getVoices();
        let langText = document.getElementById('langSelect').options[document.getElementById('langSelect').selectedIndex].text.toLowerCase().split(' ')[0];
        testVoice = voices.find(v => v.lang.toLowerCase().replace('_','-') === testLang.toLowerCase()) || 
                    voices.find(v => v.lang.toLowerCase().startsWith(testShort)) ||
                    voices.find(v => v.name.toLowerCase().includes(langText));
    }

    chunks.forEach(chunk => {
        if(chunk.trim() === "") return;
        let utterance = new SpeechSynthesisUtterance(chunk);
        let lang = getSelectedLanguage();
        if (lang) {
            utterance.lang = lang;
            let voices = window.speechSynthesis.getVoices();
            let shortLang = lang.split('-')[0].toLowerCase();
            let langText = document.getElementById('langSelect').options[document.getElementById('langSelect').selectedIndex].text.toLowerCase().split(' ')[0];
            let voice = voices.find(v => v.lang.toLowerCase().replace('_','-') === lang.toLowerCase()) || 
                        voices.find(v => v.lang.toLowerCase().startsWith(shortLang)) ||
                        voices.find(v => v.name.toLowerCase().includes(langText));
            if (voice) {
                utterance.voice = voice;
            }
        }
        utterance.rate = 0.9;
        let thisChunkStartOffset = chunkOffset;
        chunkOffset += chunk.length;
        
        utterance.onstart = function() { removeReadingMarks(); };
        
        utterance.onend = function() {
            if (chunks[chunks.length - 1] === chunk) {
                stopReading();
            }
        };

        utterance.onboundary = function(event) {
            if (event.name !== 'word' && event.name !== 'sentence') return;
            
            let charLength = event.charLength || event.currentTarget.text.substring(event.charIndex).split(/\s+/)[0].length;
            
            let absoluteWordPosition = thisChunkStartOffset + event.charIndex;
            currentAbsoluteCharIndex = absoluteWordPosition;

            requestAnimationFrame(() => {
                highlightReadingWord(absoluteWordPosition, charLength);
            });
        };
        
        window.speechSynthesis.speak(utterance);
    });
    
    if (startPaused) {
        window.speechSynthesis.pause();
    }
}

function stopReading() {
    window.speechSynthesis.resume(); // Prevent deadlocks where a paused engine ignores cancel
    window.speechSynthesis.cancel();
    if (currentFallbackAudio) {
        currentFallbackAudio.pause();
        currentFallbackAudio = null;
    }
    isReadingAloud = false;
    isPaused = false;
    lastHighlightPos = -1;
    removeReadingMarks();
    
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";
}

function togglePlayPause() {
    let playPauseBtn = document.getElementById("playPauseBtn");
    
    if (!isReadingAloud) {
        readAloud();
    } else {
        if (isPaused) {
            if (currentFallbackAudio) currentFallbackAudio.play();
            else window.speechSynthesis.resume();
            isPaused = false;
            if(playPauseBtn) playPauseBtn.innerText = "Pause ⏸";
        } else {
            if (currentFallbackAudio) currentFallbackAudio.pause();
            else window.speechSynthesis.pause();
            isPaused = true;
            if(playPauseBtn) playPauseBtn.innerText = "Resume ▶";
        }
    }
}

async function askBookQuestion() {
    let questionInput = document.getElementById("bookQuestionInput");
    let answerObj = document.getElementById("bookAnswer");
    let question = questionInput.value.trim();
    
    if (!question) {
        answerObj.innerText = "";
        return;
    }
    
    if (!currentBookText) {
        answerObj.innerText = "Please open a book first.";
        return;
    }
    
    answerObj.innerHTML = `<span style="color: var(--primary);">🤔 Thinking...</span>`;
    
    try {
        let res = await fetch("/ask", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
                question: question,
                book_id: currentBookId
            })
        });
        
        let data = await res.json();
        if (data.error) {
            answerObj.innerHTML = `<span style="color: #ef4444;">Error: ${data.error}</span>`;
        } else {
            answerObj.innerText = data.answer;
        }
    } catch(err) {
        console.error("Ask question error:", err);
        answerObj.innerHTML = `<span style="color: #ef4444;">Connection failed</span>`;
    }
}


document.addEventListener("click", function(e) {
    let toolbar = document.getElementById("selectionToolbar");
    if (toolbar && !toolbar.contains(e.target)) {
        setTimeout(() => {
            if (!window.getSelection().toString().trim()) {
                toolbar.style.display = "none";
            }
        }, 100);
    }
});

document.addEventListener("DOMContentLoaded", function() {
    let reader = document.getElementById("reader");
    if (reader) {
        reader.addEventListener("click", function(e) {
            if (!isReadingAloud || !globalReadingText) return;
            
            // Allow selecting text to stop propagation to the reader jump
            if (window.getSelection().toString().trim()) return;

            let range;
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (e.rangeParent) {
                range = document.createRange();
                range.setStart(e.rangeParent, e.rangeOffset);
            }
            
            if (!range || range.startContainer.nodeType !== 3) return;
            
            let targetNode = range.startContainer;
            let offset = range.startOffset;
            
            let walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT, null, false);
            let absoluteIndex = -1;
            let currentLength = 0;
            
            while(walker.nextNode()) {
                if (walker.currentNode === targetNode) {
                    absoluteIndex = currentLength + offset;
                    break;
                }
                currentLength += walker.currentNode.nodeValue.length;
            }
            
            if (absoluteIndex !== -1) {
                // Find beginning of clicked word
                while (absoluteIndex > 0 && /\S/.test(globalReadingText[absoluteIndex - 1])) {
                    absoluteIndex--;
                }
                
                // Jump the reading
                resumeReadingFromIndex(absoluteIndex, false);
            }
        });
    }
});



function readSelectedText() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    if (!selectedText) return;

    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    isReadingAloud = true;
    isPaused = false;
    
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Pause ⏸";
    
    let lang = getSelectedLanguage();
    let shortLang = lang ? lang.split('-')[0].toLowerCase() : 'en';
    
    if (shortLang !== 'en') {
        // Route to the reliable Python gTTS backend for accurate foreign translations
        playFallbackAudioQueue([selectedText], 0, shortLang, false);
        return;
    }
    
    let utterance = new SpeechSynthesisUtterance(selectedText);
    utterance.rate = 0.9;
    
    if (lang) {
        utterance.lang = lang;
        let voices = window.speechSynthesis.getVoices();
        let langSelect = document.getElementById('langSelect');
        let langText = langSelect && langSelect.selectedIndex >= 0 ? langSelect.options[langSelect.selectedIndex].text.toLowerCase().split(' ')[0] : 'english';
        let voice = voices.find(v => v.lang.toLowerCase().replace('_','-') === lang.toLowerCase()) || 
                    voices.find(v => v.lang.toLowerCase().startsWith(shortLang)) ||
                    voices.find(v => v.name.toLowerCase().includes(langText));
        if (voice) {
            utterance.voice = voice;
        }
    }
    
    utterance.onend = function() {
        stopReading();
    };

    window.speechSynthesis.speak(utterance);
    
    let toolbar = document.getElementById("selectionToolbar");
    if(toolbar) toolbar.style.display = "none";
}

async function summarizeSelectedText() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    if (!selectedText) return;
    
    let toolbar = document.getElementById("selectionToolbar");
    if(toolbar) toolbar.style.display = "none";
    
    // Create Summary Modal
    let modal = document.createElement("div");
    modal.id = "summaryModal";
    modal.style.position = "fixed";
    modal.style.top = "50%";
    modal.style.left = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.background = "var(--bg-panel)";
    modal.style.padding = "30px";
    modal.style.borderRadius = "var(--radius)";
    modal.style.boxShadow = "var(--shadow-lg)";
    modal.style.zIndex = "2000";
    modal.style.width = "90%";
    modal.style.maxWidth = "600px";
    modal.style.maxHeight = "80vh";
    modal.style.overflowY = "auto";
    modal.style.backdropFilter = "blur(10px)";
    modal.style.border = "1px solid var(--border)";
    
    modal.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 15px;">
            <h3 style="margin: 0; color: var(--text-main); font-size: 1.3rem; display: flex; align-items: center; gap: 8px;">
                ✨ AI Summary
            </h3>
            <button onclick="document.body.removeChild(this.parentElement.parentElement)" style="background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-light); transition: color 0.2s;">✕</button>
        </div>
        <div id="summaryContent" style="color: var(--text-main); font-size: 1.05rem; line-height: 1.6;">
            <div style="display: flex; align-items: center; gap: 10px; color: var(--text-light);">
                <div class="loader-spinner" style="width: 20px; height: 20px; border: 3px solid rgba(79, 70, 229, 0.2); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                Analyzing and summarizing content...
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    try {
        let res = await fetch("/summarize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
                text: selectedText,
                book_id: currentBookId
            })
        });
        
        let data = await res.json();
        let contentDiv = document.getElementById("summaryContent");
        
        if (data.error) {
            contentDiv.innerHTML = `<span style="color: #ef4444;">❌ Error: ${data.error}</span>`;
        } else {
            // Format bullet points beautifully
            let summaryHTML = data.summary.split('\n').map(line => {
                if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
                    return `<li style="margin-bottom: 8px; margin-left: 20px;">${line.substring(2)}</li>`;
                }
                if (line.trim() !== '') {
                    return `<p style="margin-bottom: 12px;">${line}</p>`;
                }
                return '';
            }).join('');
            
            contentDiv.innerHTML = summaryHTML || data.summary;
        }
    } catch(e) {
        document.getElementById("summaryContent").innerHTML = `<span style="color: #ef4444;">❌ Failed to connect to summarization engine.</span>`;
        console.error("Summary error:", e);
    }
}
async function lookupSelectedText() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    if (!selectedText) return;
    
    // Check if it's a single word or a phrase
    let words = selectedText.trim().split(/\s+/);
    let isPhrase = words.length > 1;
    let word = isPhrase ? selectedText.trim() : words[0].replace(/[^\w]/g, '');
    
    if (!word) return;

    let toolbar = document.getElementById("selectionToolbar");
    if(toolbar) toolbar.style.display = "none";

    let range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();

    // Create Tooltip
    let tooltip = document.createElement("div");
    tooltip.className = "definition-tooltip";
    tooltip.style.left = rect.left + "px";
    tooltip.style.top = (rect.bottom + window.scrollY + 10) + "px";
    
    tooltip.innerHTML = `
        <div class="tooltip-header">
            <strong>${word}</strong>
            <span class="tooltip-close" onclick="this.parentElement.parentElement.remove()">✕</span>
        </div>
        <div class="tooltip-body">Searching meaning...</div>
    `;
    
    document.body.appendChild(tooltip);

    try {
        let body = tooltip.querySelector(".tooltip-body");
        
        // If it's a phrase, skip the external dictionary and go straight to AI
        if (isPhrase) {
            body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
                <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
                ✨ AI searching book...
            </div>`;
            askAIDefinition(word, body);
            return;
        }

        let res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        
        if (!res.ok) {
            // Automated Fallback: Don't show button, just do it.
            body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
                <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
                ✨ AI searching book...
            </div>`;
            askAIDefinition(word, body);
            return;
        }
        
        let data = await res.json();
        if (data && data.length > 0 && data[0].meanings && data[0].meanings.length > 0) {
            let definition = data[0].meanings[0].definitions[0].definition;
            body.innerText = definition.charAt(0).toUpperCase() + definition.slice(1);
        } else {
            body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
                <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
                ✨ AI searching book...
            </div>`;
            askAIDefinition(word, body);
        }
    } catch(e) {
        let body = tooltip.querySelector(".tooltip-body");
        if(body) {
            body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
                <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
                ✨ AI searching book...
            </div>`;
            askAIDefinition(word, body);
        }
    }

    // Auto-dismiss on click elsewhere
    setTimeout(() => {
        const dismissHandler = (e) => {
            if (!tooltip.contains(e.target)) {
                tooltip.remove();
                document.removeEventListener("mousedown", dismissHandler);
            }
        };
        document.addEventListener("mousedown", dismissHandler);
    }, 10);
}

async function askAIDefinition(word, targetElement) {
    // If targetElement is a button, handle as before (unlikely now but safe fallback)
    let body = targetElement.tagName === "BUTTON" ? targetElement.parentElement : targetElement;
    
    try {
        let res = await fetch("/define", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word: word, book_id: currentBookId })
        });
        
        let data = await res.json();
        if (data.error) {
            body.innerText = "Error: " + data.error;
        } else {
            body.innerText = data.answer;
        }
    } catch(e) {
        body.innerText = "Connection failed.";
        console.error("AI Lookup error:", e);
    }
}

function findText(event) {
    let word = document.getElementById("findInput").value.trim();
    let reader = document.getElementById("reader");

    if (!currentBookText || !reader) {
        return;
    }

    if (event && event.key === 'Enter') {
        if (searchMatchesFound > 0) {
            currentSearchIndex = (currentSearchIndex + 1) % searchMatchesFound;
            scrollToSearchMatch();
        } else {
            // Force a search if they press enter
            executeSearch(word);
        }
        return;
    }

    // Debounce the search while typing
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    // Only search after they stop typing for 400ms
    searchTimeout = setTimeout(() => {
        executeSearch(word);
    }, 400);
}

function executeSearch(word) {
    if (word === "") {
        searchMatchesFound = 0;
        currentSearchIndex = -1;
        // Don't need to refetch, just re-apply cached highlights
        document.getElementById("reader").innerHTML = currentBookText;
        let reader = document.getElementById("reader");
        currentHighlights.forEach(item => {
            if (item) highlightTextInNode(reader, item, 'highlight');
        });

        return;
    }

    document.getElementById("reader").innerHTML = currentBookText;
    let currentReader = document.getElementById("reader");
    
    // Re-apply cached highlights immediately
    currentHighlights.forEach(item => {
        if (item) highlightTextInNode(currentReader, item, 'highlight');
    });
    
    searchMatchesFound = 0;
    highlightTextInNode(currentReader, word, 'find-highlight');
    
    if (searchMatchesFound > 0) {
        currentSearchIndex = 0;
        scrollToSearchMatch();
    } else {
        currentSearchIndex = -1;
    }
}

function scrollToSearchMatch() {
    let currentMatch = document.getElementById(`search-match-${currentSearchIndex}`);
    if (currentMatch) {
        document.querySelectorAll('.find-highlight').forEach(el => {
            el.style.backgroundColor = 'yellow';
        });
        currentMatch.style.backgroundColor = 'orange';
        
        // Vertical-only scroll for search matches
        let reader = document.getElementById('reader');
        let matchRect = currentMatch.getBoundingClientRect();
        let readerRect = reader.getBoundingClientRect();
        
        let matchRelativeTop = matchRect.top - readerRect.top + reader.scrollTop;
        let targetScrollTop = matchRelativeTop - (readerRect.height / 2) + (matchRect.height / 2);
        
        reader.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth'
        });
    }
}

function closeFindBox() {
    document.getElementById("findBox").style.display = "none";
    document.getElementById("findInput").value = "";

    searchMatchesFound = 0;
    currentSearchIndex = -1;

    if (currentBookId) {
        loadHighlights(currentBookId);
    } else {
        document.getElementById("reader").innerHTML = currentBookText;

    }
}
document.addEventListener("keydown", function(event) {
    if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById("findBox").style.display = "block";
        document.getElementById("findInput").focus();
    }
});

function getSelectedLanguage() {
    let select = document.getElementById('langSelect');
    let lang = select ? select.value : 'en';
    
    // Map standard codes to standard BCP-47 Speech Synthesis tags for the reader
    const langMap = {
        'hi': 'hi-IN',
        'bn': 'bn-IN',
        'te': 'te-IN',
        'mr': 'mr-IN',
        'ta': 'ta-IN',
        'ur': 'ur-IN',
        'gu': 'gu-IN',
        'kn': 'kn-IN',
        'ml': 'ml-IN',
        'pa': 'pa-IN',
        'or': 'or-IN',
        'ko': 'ko-KR',
        'th': 'th-TH',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW',
        'ja': 'ja-JP',
        'fr': 'fr-FR',
        'de': 'de-DE',
        'es': 'es-ES',
        'en': 'en-US'
    };
    
    return langMap[lang] || lang;
}

async function translateBook() {
    let targetLang = document.getElementById('langSelect').value;
    let reader = document.getElementById("reader");
    let titleEl = document.getElementById("booktitle");
    let originalTitle = titleEl.innerText;
    
    if (!reader || !currentBookText) return;
    
    if (targetLang === 'en') {
        titleEl.innerText = "Restoring original... Please wait...";
        showTranslationLoader("Restoring Language...");
        try {
            let res = await fetch("/book/" + currentBookId);
            let data = await res.json();
            if (data && data.text) {
                reader.innerHTML = data.text;
                currentBookText = data.text;
            }
            if (currentBookId) loadHighlights(currentBookId);
            stopReading();
            globalReadingText = "";
            let playPauseBtn = document.getElementById("playPauseBtn");
            if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";
            hideLoader();
        } catch (e) {
            console.error("Failed to restore English text", e);
            hideLoader();
        }
        titleEl.innerText = originalTitle;
        return;
    }
    
    titleEl.innerText = "Translating book... Please wait...";
    showTranslationLoader("Initializing AI Translation Engine...");
    
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    let nodes = [];
    while (walker.nextNode()) {
        let node = walker.currentNode;
        if (node.nodeValue.trim().length > 0 && !node.parentNode.classList.contains('empty-state')) {
            nodes.push(node);
        }
    }
    
    if (nodes.length === 0) {
        titleEl.innerText = originalTitle;
        hideLoader();
        return;
    }
    
    titleEl.innerText = "Translating...";
    showTranslationLoader("AI processing contents instantly...");
    
    let currentJob = Date.now();
    window.activeTranslationJob = currentJob;
    
    stopReading();
    globalReadingText = "";
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

    let BATCH_CHAR_LIMIT = 1500;
    let chunks = [];
    let currentChunk = [];
    let currentLen = 0;
    
    for (let i = 0; i < nodes.length; i++) {
        let textLen = nodes[i].nodeValue.length;
        if (currentLen + textLen > BATCH_CHAR_LIMIT && currentChunk.length > 0) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentLen = 0;
        }
        currentChunk.push(nodes[i]);
        currentLen += textLen + 7;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    let processedCount = 0;
    
    // Process first 3 chunks immediately
    let initialChunks = chunks.slice(0, 3);
    let backgroundChunks = chunks.slice(3);
    
    let translateRecursive = async (batchNodes) => {
        if (batchNodes.length === 0 || window.activeTranslationJob !== currentJob) return;
        
        let batchTexts = batchNodes.map(n => n.nodeValue);
        let joinedText = batchTexts.join(" ~|~ ");
        let translateApiLang = targetLang.split("-")[0];
        
        try {
            let url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${translateApiLang}&dt=t&q=${encodeURIComponent(joinedText)}`;
            let res = await fetch(url);

            if (res.ok && window.activeTranslationJob === currentJob) {
                let data = await res.json();
                let fullTranslation = "";
                if (data && data[0]) {
                    data[0].forEach(part => {
                        if (part[0]) fullTranslation += part[0];
                    });
                }
                
                let translatedTexts = fullTranslation.split(/\s*~\|~\s*/);
                
                if (translatedTexts.length === batchNodes.length) {
                    for (let j = 0; j < batchNodes.length; j++) {
                        let cleanText = translatedTexts[j].replace(/~\|~/g, "").trim();
                        if (batchNodes[j].nodeValue.match(/\s$/)) cleanText += " ";
                        batchNodes[j].nodeValue = cleanText;
                    }
                } else if (batchNodes.length > 1) {
                    // Exact parity lost. Binary split to find the exact DOM text nodes and fetch them cleanly!
                    let mid = Math.floor(batchNodes.length / 2);
                    await translateRecursive(batchNodes.slice(0, mid));
                    await translateRecursive(batchNodes.slice(mid));
                } else if (batchNodes.length === 1) {
                    batchNodes[0].nodeValue = fullTranslation.replace(/~\|~/g, "").trim() + (batchNodes[0].nodeValue.match(/\s$/) ? " " : "");
                }
            } else if (!res.ok && batchNodes.length > 1) {
                // If URI too big or rate limit, split and retry smaller
                let mid = Math.floor(batchNodes.length / 2);
                await translateRecursive(batchNodes.slice(0, mid));
                await translateRecursive(batchNodes.slice(mid));
            }
        } catch (e) {
            console.error("Batch Error:", e);
            if (batchNodes.length > 1) {
                let mid = Math.floor(batchNodes.length / 2);
                await translateRecursive(batchNodes.slice(0, mid));
                await translateRecursive(batchNodes.slice(mid));
            }
        }
    };

    let processChunk = async (batchNodes) => {
        if (window.activeTranslationJob !== currentJob) return;
        await translateRecursive(batchNodes);
        processedCount += batchNodes.length;
    };

    
    // Await ONLY the initial screen chunks
    await Promise.all(initialChunks.map(processChunk));
    
    // Instantly hide the loader so user can begin reading while background fulfills
    if (window.activeTranslationJob === currentJob) {
        currentBookText = reader.innerHTML;
        titleEl.innerText = originalTitle;
        hideLoader();
    }
    
    // Background parallelization cascade for heavy 500-page dumps without hanging browser
    (async () => {
        let runningPromises = [];
        for (let batch of backgroundChunks) {
            if (window.activeTranslationJob !== currentJob) break;
            let pr = processChunk(batch);
            runningPromises.push(pr);
            if (runningPromises.length >= 5) { // 5 simultaneous connections
                await Promise.race(runningPromises);
                runningPromises = runningPromises.filter(p => true); // In a real app we'd splice the completed, but race throttle is fine
                await new Promise(r => setTimeout(r, 20));
            }
        }
        await Promise.all(runningPromises);
        if (window.activeTranslationJob === currentJob) {
            currentBookText = reader.innerHTML;
        }
    })();
}

// Global Audio Fallback implementation for unsupported TTS languages 
let currentFallbackAudio = null;
let fallbackQueue = [];

function playFallbackAudioQueue(chunks, startOffset, shortLang, startPaused) {
    fallbackQueue = [];
    let currentAbsOffset = startOffset;
    
    chunks.forEach(chunk => {
        if (!chunk.trim()) {
            currentAbsOffset += chunk.length;
            return;
        }
        
        // Surgical slicing to stay under 200 chars for gTTS
        let start = 0;
        while (start < chunk.length) {
            let end = start + 180;
            if (end < chunk.length) {
                // Try to find a space or period to split cleanly
                let lastSpace = chunk.lastIndexOf(' ', end);
                if (lastSpace > start) end = lastSpace;
            } else {
                end = chunk.length;
            }
            
            let sc = chunk.substring(start, end);
            let url = `/tts?lang=${shortLang}&text=${encodeURIComponent(sc.trim())}`;
            fallbackQueue.push({ url, text: sc, offset: currentAbsOffset + start });
            start = end;
        }
        currentAbsOffset += chunk.length;
    });

    if (startPaused) {
        isPaused = true;
    }
    
    playNextFallback(startPaused);
}

// Global state to track the LAST touched node for fast hit-testing
let lastMarkedNodeIndex = 0;


function removeReadingMarks() {
    activeReadingMarks.forEach(span => {
        const parent = span.parentNode;
        if (parent) {
            const text = span.textContent;
            const textNode = document.createTextNode(text);
            parent.replaceChild(textNode, span);
            parent.normalize();
        }
    });
    activeReadingMarks = [];

    // Safety fallback for any missed marks
    let marks = document.querySelectorAll('.reading-mark');
    marks.forEach(el => {
        let parent = el.parentNode;
        if (parent) {
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
            parent.removeChild(el);
            parent.normalize();
        }
    });
}

function rebuildReadingNodeMap() {
    let reader = document.getElementById("reader");
    if (!reader) return;
    let { nodes, offsets, text } = getNodesAndText(reader);
    globalTextNodes = nodes;
    globalNodeOffsets = offsets;
    globalReadingText = text;
}

function highlightReadingWord(absoluteWordPosition, charLength) {
    if (absoluteWordPosition < lastHighlightPos) return;
    lastHighlightPos = absoluteWordPosition;

    // 1. Remove previous marks and rebuild map to ensure fresh offsets
    removeReadingMarks();
    rebuildReadingNodeMap();

    // 2. Identify all nodes that intersect with the word range [pos, pos + len]
    let startChar = absoluteWordPosition;
    let endChar = absoluteWordPosition + charLength;
    
    let nodesToWrap = [];
    for (let i = 0; i < globalTextNodes.length; i++) {
        let nodeStart = globalNodeOffsets[i];
        let nodeLen = globalTextNodes[i].nodeValue.length;
        let nodeEnd = nodeStart + nodeLen;

        if (nodeEnd > startChar && nodeStart < endChar) {
            let sliceStart = Math.max(0, startChar - nodeStart);
            let sliceEnd = Math.min(nodeLen, endChar - nodeStart);
            nodesToWrap.push({
                node: globalTextNodes[i],
                sliceStart: sliceStart,
                sliceEnd: sliceEnd
            });
        }
        if (nodeStart >= endChar) break;
    }

    if (nodesToWrap.length === 0) return;

    // 3. Apply the new marks
    nodesToWrap.forEach(item => {
        let { node, sliceStart, sliceEnd } = item;
        let nodeText = node.nodeValue;
        let parent = node.parentNode;
        if (!parent) return;

        let span = document.createElement("span");
        span.className = "reading-mark";
        
        if (sliceStart === 0 && sliceEnd === nodeText.length) {
            span.textContent = nodeText;
            parent.replaceChild(span, node);
        } else {
            let before = nodeText.slice(0, sliceStart);
            let mid = nodeText.slice(sliceStart, sliceEnd);
            let after = nodeText.slice(sliceEnd);
            
            span.textContent = mid;
            
            if (after) {
                parent.insertBefore(document.createTextNode(after), node.nextSibling);
            }
            parent.insertBefore(span, node.nextSibling);
            if (before) {
                node.nodeValue = before;
            } else {
                parent.removeChild(node);
            }
        }
        activeReadingMarks.push(span);
    });

    // 4. Smooth scroll to the first new mark
    let firstMark = activeReadingMarks[0];
    if (firstMark) {
        let reader = document.getElementById('reader');
        let spanRect = firstMark.getBoundingClientRect();
        let readerRect = reader.getBoundingClientRect();
        let threshold = 100;

        if (spanRect.top < readerRect.top + threshold || spanRect.bottom > readerRect.bottom - threshold) {
            let spanRelativeTop = spanRect.top - readerRect.top + reader.scrollTop;
            let targetScrollTop = spanRelativeTop - (readerRect.height / 2);
            reader.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
        }
    }
}

function playNextFallback(startPaused = false) {
    if(!isReadingAloud || fallbackQueue.length === 0) {
        stopReading();
        return;
    }
    
    let item = fallbackQueue.shift();
    currentAbsoluteCharIndex = item.offset;
    
    removeReadingMarks();
    
    currentFallbackAudio = new Audio(item.url);
    currentFallbackAudio.playbackRate = 0.9;
    
    let words = [];
    let regex = /\S+/g;
    let match;
    while ((match = regex.exec(item.text)) !== null) {
        words.push({
            startOffset: item.offset + match.index,
            length: match[0].length
        });
    }
    let lastWordIndex = -1;

    currentFallbackAudio.addEventListener('timeupdate', () => {
        if (!currentFallbackAudio.duration || words.length === 0) return;
        
        // Use cumulative character progress for better timing than simple floor division
        let currentTime = currentFallbackAudio.currentTime;
        let totalTime = currentFallbackAudio.duration;
        let progress = currentTime / totalTime;
        
        let wordIndex = Math.floor(progress * words.length);
        if (wordIndex >= words.length) wordIndex = words.length - 1;
        
        if (wordIndex !== lastWordIndex) {
            lastWordIndex = wordIndex;
            let currentWord = words[wordIndex];
            
            // Safety: Ensure we don't skip the last letter by slightly over-calculating if at end of word list
            let displayLength = currentWord.length;
            if (wordIndex === words.length - 1 && progress > 0.95) {
                // If it's the last word and we're nearly done, ensure full highlight
            }

            currentAbsoluteCharIndex = currentWord.startOffset;
            highlightReadingWord(currentWord.startOffset, displayLength);
        }
    });
    
    currentFallbackAudio.onended = () => {
        playNextFallback();
    };
    currentFallbackAudio.onerror = () => {
        console.warn("Fallback audio chunk failed, proceeding.");
        setTimeout(playNextFallback, 500);
    };
    
    if(!startPaused && !isPaused) {
        currentFallbackAudio.play().catch(e => {
            console.error("Audio playback blocked", e);
            setTimeout(playNextFallback, 500);
        });
    }
}

async function closeBookAction() {
    if (!currentBookId) return;

    // Ask for bookmark if progress made
    if (currentAbsoluteCharIndex > 0) {
        showBookmarkModal(
            "Save Bookmark?",
            "Would you like to save your reading progress before closing?",
            "Save",
            "No Thanks",
            "Cancel",
            () => {
                localStorage.setItem(`bookmark_${currentBookId}`, currentAbsoluteCharIndex);
                executeClosingSequence();
            },
            () => executeClosingSequence(),
            () => { /* Cancel close action */ }
        );
    } else {
        executeClosingSequence();
    }
}

async function executeClosingSequence() {
    window.speechSynthesis.cancel();
    isReadingAloud = false;
    isPaused = false;
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

    // Show the UNIQUE Closing animation
    const closingLoader = document.getElementById("closingLoader");
    if (closingLoader) {
        closingLoader.style.display = "flex";
        document.getElementById("reader").style.opacity = "0.3";
    }
    
    // Brief delay for the slam-shut animation to play (1.2s in CSS)
    await new Promise(r => setTimeout(r, 1600));
    
    if (closingLoader) closingLoader.style.display = "none";
    document.getElementById("reader").style.opacity = "1";
    
    // Set End State
    let reader = document.getElementById("reader");
    reader.innerHTML = "";
    
    let thankYou = document.getElementById("thankYouState");
    if (thankYou) {
        thankYou.style.display = "block";
        reader.appendChild(thankYou);
    }
    
    document.getElementById("booktitle").innerText = "No book selected";
    currentBookId = null;
    currentBookText = "";
}

function scrollToIndex(index) {
    let reader = document.getElementById("reader");
    if (!reader) return;
    
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    let currentLength = 0;
    
    while(walker.nextNode()){
        let node = walker.currentNode;
        if(currentLength + node.nodeValue.length > index) {
            // Scroll the parent element of the text node into view
            node.parentNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        }
        currentLength += node.nodeValue.length;
    }
}

async function applyImageOcrOverlays() {
    let reader = document.getElementById("reader");
    if (!reader) return;

    let imgs = Array.from(reader.querySelectorAll("img:not(.ocr-processed)"));
    if (imgs.length === 0) return;

    // Process images in small batches to keep UI responsive
    for (let i = 0; i < imgs.length; i++) {
        let img = imgs[i];
        
        // Yield every 5 images to keep the UI fluid
        if (i > 0 && i % 5 === 0) {
            await new Promise(r => setTimeout(r, 50));
        }

        // Mark it so we don't re-process on re-render
        img.classList.add("ocr-processed");

        // Convert img to base64 using a canvas
        if (!img.complete || img.naturalWidth === 0) {
            await new Promise(res => { img.onload = res; img.onerror = res; });
        }

        let b64 = null;
        try {
            let canvas = document.createElement("canvas");
            canvas.width  = img.naturalWidth  || img.width;
            canvas.height = img.naturalHeight || img.height;
            let ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            b64 = canvas.toDataURL("image/png");
        } catch(e) { continue; }

        if (!b64) continue;

        try {
            let res = await fetch("/ocr_image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image: b64 })
            });
            let data = await res.json();
            if (!data.words || data.words.length === 0) continue;

            let wrapper = document.createElement("div");
            wrapper.className = "img-ocr-wrapper";
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);

            let renderedW = img.offsetWidth  || img.naturalWidth;
            let renderedH = img.offsetHeight || img.naturalHeight;

            let layer = document.createElement("div");
            layer.className = "ocr-layer";

            data.words.forEach(w => {
                let span = document.createElement("span");
                span.className = "ocr-word";
                span.textContent = w.text;
                span.style.left   = Math.round(w.left   / 100 * renderedW) + "px";
                span.style.top    = Math.round(w.top    / 100 * renderedH) + "px";
                span.style.width  = Math.round(w.width  / 100 * renderedW) + "px";
                span.style.height = Math.round(w.height / 100 * renderedH) + "px";
                span.title = w.text;
                layer.appendChild(span);
            });

            wrapper.appendChild(layer);

            if (window.ResizeObserver) {
                let ro = new ResizeObserver(() => {
                    let newW = img.offsetWidth  || img.naturalWidth;
                    let newH = img.offsetHeight || img.naturalHeight;
                    if (newW === renderedW && newH === renderedH) return;
                    renderedW = newW;
                    renderedH = newH;
                    layer.querySelectorAll(".ocr-word").forEach((span, idx) => {
                        let w2 = data.words[idx];
                        if (!w2) return;
                        span.style.left   = Math.round(w2.left   / 100 * newW) + "px";
                        span.style.top    = Math.round(w2.top    / 100 * newH) + "px";
                        span.style.width  = Math.round(w2.width  / 100 * newW) + "px";
                        span.style.height = Math.round(w2.height / 100 * newH) + "px";
                    });
                });
                ro.observe(wrapper);
            }
        } catch(e) {
            console.warn("OCR overlay failed for image:", e);
        }
    }
}

// --- OCR Word Visual Selection Highlight ---
// Browser ::selection CSS is unreliable over transparent text.
// Track selectionchange and apply .ocr-selected class to hovered spans instead.
document.addEventListener("selectionchange", () => {
    // 1. Clear OCR highlights
    document.querySelectorAll(".ocr-word.ocr-selected").forEach(el => {
        el.classList.remove("ocr-selected");
    });

    let sel = window.getSelection();
    let toolbar = document.getElementById("selectionToolbar");
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (toolbar) toolbar.style.display = "none";
        return;
    }

    let range = sel.getRangeAt(0);
    
    // 2. Highlight intersections in OCR layers (PDF/Images)
    document.querySelectorAll(".ocr-word").forEach(span => {
        let spanRange = document.createRange();
        spanRange.selectNode(span);
        try {
            if (range.compareBoundaryPoints(Range.END_TO_START, spanRange) <= 0 &&
                range.compareBoundaryPoints(Range.START_TO_END, spanRange) >= 0) {
                span.classList.add("ocr-selected");
            }
        } catch(e) {}
    });

    // 3. Position and Show Floating Toolbar
    if (toolbar) {
        let rects = range.getClientRects();
        if (rects.length > 0) {
            let rect = rects[0];
            // Center toolbar above selection
            toolbar.style.display = "flex";
            toolbar.style.top = (rect.top - 55) + "px";
            toolbar.style.left = (rect.left + rect.width/2 - toolbar.offsetWidth/2) + "px";
            
            // Adjust if it goes off screen
            if (parseFloat(toolbar.style.top) < 10) {
                toolbar.style.top = (rect.bottom + 10) + "px";
            }
        } else {
            toolbar.style.display = "none";
        }
    }
});


let currentZoom = 1.0;

function changeZoom(delta) {
    currentZoom = Math.min(Math.max(0.5, currentZoom + delta), 2.0);
    applyZoom();
}

function applyZoom() {
    let reader = document.getElementById("reader");
    let zoomDisplay = document.getElementById("zoomLevel");
    
    if (zoomDisplay) {
        zoomDisplay.innerText = Math.round(currentZoom * 100) + "%";
    }

    // Apply to standard text/html content
    reader.style.fontSize = (1.1 * currentZoom) + "rem";

    // Apply to rigid PDF pages (PyMuPDF output)
    document.querySelectorAll('#reader div[id^="page"]').forEach(page => {
        // Find or create wrapper for this page
        let wrapper = page.parentElement;
        if (!wrapper.classList.contains('page-centered-wrapper')) {
            wrapper = document.createElement('div');
            wrapper.className = 'page-centered-wrapper';
            page.parentNode.insertBefore(wrapper, page);
            wrapper.appendChild(page);
        }

        let originalW = parseFloat(page.getAttribute('data-original-width')) || parseFloat(page.style.width) || 800;
        let originalH = parseFloat(page.getAttribute('data-original-height')) || parseFloat(page.style.height);
        
        if (!page.getAttribute('data-original-width')) {
            page.setAttribute('data-original-width', originalW);
            if (originalH) page.setAttribute('data-original-height', originalH);
        }

        let containerW = reader.clientWidth - 20; 
        let baseScale = Math.min(1.0, containerW / originalW);
        let finalScale = baseScale * currentZoom;

        // Inner page: fixed layout size, simple scale
        page.style.width = originalW + "px";
        if (originalH) page.style.height = originalH + "px";
        page.style.transform = `scale(${finalScale})`;
        page.style.transformOrigin = "top left";
        page.style.display = "block";
        page.style.margin = "0";

        // Outer wrapper: actual layout footprint for centering & scrollbars
        let scaledW = originalW * finalScale;
        let scaledH = originalH * finalScale;
        
        wrapper.style.width = scaledW + "px";
        wrapper.style.height = scaledH + "px";
        wrapper.style.marginBottom = "30px";
        
        // Horizontal centering
        if (scaledW < containerW) {
            wrapper.style.marginLeft = "auto";
            wrapper.style.marginRight = "auto";
        } else {
            wrapper.style.marginLeft = "0";
            wrapper.style.marginRight = "0";
        }
    });

    // Update pannable cursor state after zoom changes
    if (window.updateReaderPannableState) {
        setTimeout(window.updateReaderPannableState, 100);
    }
}

window.onload = () => {
    loadBooks();
    initDragging();
};

function initDragging() {
    let reader = document.getElementById("reader");
    let isDown = false;
    let startX;
    let startY;
    let scrollLeft;
    let scrollTop;
    let moved = false; // Track if mouse actually moved (to distinguish from clicks)

    function updatePannableState() {
        // We no longer add a grab cursor by default to preserve text selection.
        // We only use the grabbing state during active movement.
    }

    // Check pan state on resize
    window.addEventListener('resize', updatePannableState);
    // Expose for zoom changes to call
    window.updateReaderPannableState = updatePannableState;

    reader.addEventListener('mousedown', (e) => {
        // Only drag if content overflows
        if (reader.scrollWidth <= reader.clientWidth && reader.scrollHeight <= reader.clientHeight) return;

        // Don't drag if clicking buttons or links
        if (e.target.closest('button') || e.target.closest('a')) return;

        isDown = true;
        moved = false;
        startX = e.pageX - reader.offsetLeft;
        startY = e.pageY - reader.offsetTop;
        scrollLeft = reader.scrollLeft;
        scrollTop = reader.scrollTop;
    });

    reader.addEventListener('mouseleave', () => {
        isDown = false;
        moved = false;
        reader.classList.remove('grabbing');
    });

    reader.addEventListener('mouseup', () => {
        isDown = false;
        moved = false;
        reader.classList.remove('grabbing');
    });

    reader.addEventListener('mousemove', (e) => {
        if (!isDown) return;

        const x = e.pageX - reader.offsetLeft;
        const y = e.pageY - reader.offsetTop;
        const dx = x - startX;
        const dy = y - startY;

        // Only start dragging after moving at least 8px (to prioritize text selection)
        if (!moved && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;

        // If user is actually trying to select text, don't hijack it with a drag
        if (!moved && window.getSelection().toString().trim().length > 0) {
            isDown = false;
            return;
        }

        e.preventDefault();
        if (!moved) {
            // Cancel any accidental partial selection before entering drag mode
            window.getSelection().removeAllRanges();
        }
        
        moved = true;
        reader.classList.add('grabbing');

        const walkX = dx * 2.5;
        const walkY = dy * 2.5;
        reader.scrollLeft = scrollLeft - walkX;
        reader.scrollTop = scrollTop - walkY;
    });

    // Initial check after a short delay to let content load
    setTimeout(updatePannableState, 500);
}
