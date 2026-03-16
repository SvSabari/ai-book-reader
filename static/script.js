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
        alert("Please choose a file");
        return;
    }

    let form = new FormData();
    form.append("file", file);

    fetch("/upload", {
        method: "POST",
        body: form
    })
    .then(res => {
        if (!res.ok) {
            throw new Error("Upload failed");
        }
        return res.text();
    })
    .then(data => {
        document.getElementById("file").value = ""; // Clear input
        let label = document.querySelector('.btn-upload-label');
        if (label) label.innerText = "Choose File"; // Clear visual label
        return loadBooks();
    })
    .catch(err => {
        console.error(err);
        alert("Upload failed");
    });
}

function loadBooks() {
    return fetch("/books")
    .then(res => res.json())
    .then(data => {
        let list = document.getElementById("booklist");
        list.innerHTML = "";

        data.forEach(book => {
            let tr = document.createElement("tr");

            tr.innerHTML = `
                <td style="width: 100%; max-width: 0; padding-right: 12px;">
                    <div style="font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.95rem;">${book[1]}</div>
                    <div style="font-size: 0.75rem; color: var(--text-light);">${book[2]}</div>
                </td>
                <td style="text-align: right; width: 65px;">
                    <button onclick="openBook(${book[0]})">Open</button>
                    <button onclick="deleteBook(${book[0]})">Delete</button>
                </td>
            `;

            list.appendChild(tr);
        });
        return data; // pass data down the chain
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
    .then(data => {
        hideLoader();
        if (data.error) {
            alert(data.error);
            return;
        }

        currentBookId = bookId;
        currentBookText = data.text || "";

        document.getElementById("booktitle").innerText = data.name;
        document.getElementById("reader").innerHTML = currentBookText;
        
        // Check for existing bookmark
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
                    setTimeout(() => scrollToIndex(currentAbsoluteCharIndex), 500);
                },
                () => {
                    currentAbsoluteCharIndex = 0;
                    localStorage.removeItem(`bookmark_${bookId}`);
                },
                () => {
                    // Cancel opening the book entirely
                    document.getElementById("reader").innerHTML = `<div class="empty-state" style="text-align: center; color: #94a3b8; font-style: italic; margin-top: 50px;">Select a book from the sidebar to start reading.</div>`;
                    document.getElementById("booktitle").innerText = "Select a book from your library";
                    currentBookId = null;
                }
            );
        } else {
            currentAbsoluteCharIndex = 0;
        }

        
        // Append Q&A block to the end of the book content

        
        // Scale down PyMuPDF rigid absolute positioning dimensions to fit viewport bounds
        document.querySelectorAll('#reader div[id^="page"]').forEach(page => {
            let w = parseFloat(page.style.width) || 800;
            let containerW = document.getElementById('reader').clientWidth - 30; // Account for padding
            if (w > containerW) {
                let scale = containerW / w;
                page.style.transform = `scale(${scale})`;
                page.style.transformOrigin = "top left";
                let h = parseFloat(page.style.height);
                if (h) {
                    page.style.height = (h * scale) + "px";
                }
            }
        });

        loadHighlights(bookId);
    })
    .catch(err => {
        console.error(err);
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
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    let toolbar = document.getElementById("selectionToolbar");

    if (!selectedText || !currentBookId) {
        if(toolbar) toolbar.style.display = "none";
        return;
    }
    let rangeData = getAbsoluteSelectionRange();
    if (!rangeData) return;
    
    fetch("/save_highlight", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            book_id: currentBookId,
            highlighted_text: JSON.stringify(rangeData)
        })
    })
    .then(res => res.json())
    .then(() => {
        if(toolbar) toolbar.style.display = "none";
        window.getSelection().removeAllRanges();
        
        // Inject highlight into current DOM without destroying innerHTML, 
        // protecting active text-to-speech instances from losing track.
        let reader = document.getElementById("reader");
        highlightAbsoluteRange(reader, rangeData, 'highlight');
    });
}

function getAbsoluteSelectionRange() {
    let selection = window.getSelection();
    if (selection.rangeCount === 0) return null;
    let range = selection.getRangeAt(0);
    let reader = document.getElementById("reader");
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    
    let startChar = 0; let endChar = 0;
    let foundStart = false; let foundEnd = false;
    let currentLength = 0;
    
    let startNode = range.startContainer.nodeType === 3 ? range.startContainer : range.startContainer.childNodes[range.startOffset] || range.startContainer;
    let endNode = range.endContainer.nodeType === 3 ? range.endContainer : range.endContainer.childNodes[range.endOffset - 1] || range.endContainer;
    
    while(walker.nextNode()) {
        let node = walker.currentNode;
        
        if (!foundStart && (node === startNode || (startNode.contains && startNode.contains(node)))) {
            let offset = range.startContainer.nodeType === 3 ? range.startOffset : 0;
            startChar = currentLength + offset;
            foundStart = true;
        }
        if (!foundEnd && (node === endNode || (endNode.contains && endNode.contains(node)))) {
            let offset = range.endContainer.nodeType === 3 ? range.endOffset : node.nodeValue.length;
            endChar = currentLength + offset;
            foundEnd = true;
        }
        
        currentLength += node.nodeValue.length;
        if (foundStart && foundEnd) break;
    }
    
    if(!foundStart || !foundEnd) return null;
    return { startChar, endChar, text: selection.toString().trim() };
}

function highlightAbsoluteRange(reader, item, className) {
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    let currentLength = 0;
    let nodesToWrap = [];
    
    while(walker.nextNode()) {
        let node = walker.currentNode;
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
    
    for (let i = nodesToWrap.length - 1; i >= 0; i--) {
        let { node, sliceStart, sliceEnd } = nodesToWrap[i];
        if (node.parentNode && node.parentNode.className === className) continue;
        
        let nodeText = node.nodeValue;
        if (sliceStart === 0 && sliceEnd === nodeText.length) {
            let span = document.createElement("span");
            span.className = className; span.textContent = nodeText;
            node.parentNode.replaceChild(span, node);
        } else {
            let before = nodeText.slice(0, sliceStart);
            let mid = nodeText.slice(sliceStart, sliceEnd);
            let after = nodeText.slice(sliceEnd);
            
            let span = document.createElement("span");
            span.className = className; span.textContent = mid;
            let parent = node.parentNode;
            
            if (before.length > 0) {
               let bNode = document.createTextNode(before);
               parent.insertBefore(bNode, node);
            }
            parent.insertBefore(span, node);
            if (after.length > 0) {
               let aNode = document.createTextNode(after);
               parent.insertBefore(aNode, node);
            }
            parent.removeChild(node);
        }
    }
    
    if (globalTextNodes && globalTextNodes.length > 0) {
        let repWalker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
        globalTextNodes = [];
        while (repWalker.nextNode()) {
            globalTextNodes.push(repWalker.currentNode);
        }
    }
}

function loadHighlights(bookId) {
    document.getElementById("reader").innerHTML = currentBookText;
    return fetch("/highlights/" + bookId)
    .then(res => res.json())
    .then(highlights => {
        currentHighlights = highlights;
        let reader = document.getElementById("reader");
        highlights.forEach(itemStr => {
            if (itemStr) {
                try {
                    let item = JSON.parse(itemStr);
                    if (item.startChar !== undefined) {
                        highlightAbsoluteRange(reader, item, 'highlight');
                    } else {
                        highlightTextInNode(reader, itemStr, 'highlight');
                    }
                } catch(e) {
                    highlightTextInNode(reader, itemStr, 'highlight');
                }
            }
        });
        
        // Re-append the Q&A block after the highlights are drawn

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
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    globalTextNodes = [];
    while (walker.nextNode()) {
        globalTextNodes.push(walker.currentNode);
    }

    let text = "";
    // Preserve index if set by bookmark/resume
    if (typeof currentAbsoluteCharIndex === 'undefined') currentAbsoluteCharIndex = 0;

    let textParts = [];
    for (let i = 0; i < globalTextNodes.length; i++) {
        textParts.push(globalTextNodes[i].nodeValue);
    }
    text = textParts.join("");

    if (!text.trim()) {
        alert("No book text to read");
        return;
    }

    globalReadingText = text;
    stopReading();
    isReadingAloud = true;
    
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
    let chunkOffset = currentAbsoluteCharIndex;

    let testLang = getSelectedLanguage();
    let testShort = testLang ? testLang.split('-')[0].toLowerCase() : 'en';
    
    // Force backend gTTS for ALL non-English languages to bypass unreliable browser voice banks
    if (testShort !== 'en') {
        playFallbackAudioQueue(chunks, chunkOffset, testShort, false);
        return;
    }

    let testVoice = null;
    if (testLang) {
        let voices = window.speechSynthesis.getVoices();
        let langSelect = document.getElementById('langSelect');
        let langText = langSelect && langSelect.selectedIndex >= 0 ? langSelect.options[langSelect.selectedIndex].text.toLowerCase().split(' ')[0] : 'english';
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

        utterance.onstart = function() {
            removeReadingMarks();
        };

        utterance.onboundary = function(event) {
            if (event.name !== 'word' && event.name !== 'sentence') return;
            
            let charLength = event.charLength || event.currentTarget.text.substring(event.charIndex).split(/\s+/)[0].length;
            
            // Calculate absolute position in the global text string
            let absoluteWordPosition = thisChunkStartOffset + event.charIndex;
            currentAbsoluteCharIndex = absoluteWordPosition;

            // Iterate through DOM nodes accumulating character lengths until we hit our absolute position
            let runningLength = 0;
            let targetNodeIndex = -1;
            let offsetInNode = 0;
            
            for (let i = 0; i < globalTextNodes.length; i++) {
                let nodeLen = globalTextNodes[i].nodeValue.length;
                if (runningLength + nodeLen > absoluteWordPosition) {
                    targetNodeIndex = i;
                    offsetInNode = absoluteWordPosition - runningLength;
                    break;
                }
                runningLength += nodeLen;
            }

            if (targetNodeIndex !== -1) {
                highlightReadingWord(absoluteWordPosition, charLength);
            }
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
    while (walker.nextNode()) {
        globalTextNodes.push(walker.currentNode);
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

            let runningLength = 0;
            let targetNodeIndex = -1;
            let offsetInNode = 0;
            
            for (let i = 0; i < globalTextNodes.length; i++) {
                let nodeLen = globalTextNodes[i].nodeValue.length;
                if (runningLength + nodeLen > absoluteWordPosition) {
                    targetNodeIndex = i;
                    offsetInNode = absoluteWordPosition - runningLength;
                    break;
                }
                runningLength += nodeLen;
            }

            if (targetNodeIndex !== -1) {
                highlightReadingWord(absoluteWordPosition, charLength);
            }
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

async function searchMeaning() {
    let wordInput = document.getElementById("word");
    let meaningObj = document.getElementById("meaning");
    let word = wordInput.value.trim();
    
    if (!word) {
        meaningObj.innerText = "";
        return;
    }
    
    meaningObj.innerText = "Searching...";
    
    try {
        let res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
        
        if (!res.ok) {
            meaningObj.innerText = "Meaning not found";
            return;
        }
        
        let data = await res.json();
        if (data && data.length > 0 && data[0].meanings && data[0].meanings.length > 0) {
            let definition = data[0].meanings[0].definitions[0].definition;
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
    
    // Extract plain text from the HTML book view
    let tempDiv = document.createElement("div");
    tempDiv.innerHTML = currentBookText;
    let plainText = tempDiv.textContent || tempDiv.innerText || "";
    
    try {
        let res = await fetch("/ask", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
                question: question,
                text: plainText
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

document.addEventListener("selectionchange", function () {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    let toolbar = document.getElementById("selectionToolbar");
    let reader = document.getElementById("reader");

    if (!selectedText || selection.rangeCount === 0) {
        if(toolbar) toolbar.style.display = "none";
        return;
    }

    let range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();

    let node = range.commonAncestorContainer.nodeType === 3
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;

    if (!reader.contains(node)) {
        if(toolbar) toolbar.style.display = "none";
        return;
    }

    if(toolbar) {
        toolbar.style.display = "flex";
        toolbar.style.left = (rect.right + 8) + "px";
        toolbar.style.top = (rect.top - 5) + "px";
    }
});

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
            body: JSON.stringify({ text: selectedText })
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
    appendQABlock();
    
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
        currentMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    let currentOffset = startOffset;
    
    chunks.forEach(chunk => {
        if(chunk.trim() === "") return;
        
        // Slice chunks tightly for Google TTS max 200 char limits
        let subChunks = [];
        let words = chunk.split(' ');
        let temp = "";
        for(let w of words) {
            if((temp + " " + w).length > 180) {
                if(temp) subChunks.push(temp);
                temp = w;
            } else {
                temp = temp ? temp + " " + w : w;
            }
        }
        if(temp) subChunks.push(temp);
        
        subChunks.forEach(sc => {
            let url = `/tts?lang=${shortLang}&text=${encodeURIComponent(sc)}`;
            fallbackQueue.push({ url, text: sc, offset: currentOffset });
            currentOffset += sc.length + 1;
        });
    });

    if (startPaused) {
        isPaused = true;
    }
    
    playNextFallback(startPaused);
}

function removeReadingMarks() {
    document.querySelectorAll('.reading-mark').forEach(el => {
        let parent = el.parentNode;
        if (parent) {
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize();
        }
    });
    
    // Re-sync globalTextNodes
    let reader = document.getElementById("reader");
    if (reader) {
        let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
        globalTextNodes = [];
        while (walker.nextNode()) {
            globalTextNodes.push(walker.currentNode);
        }
    }
}

function highlightReadingWord(absoluteWordPosition, charLength) {
    let runningLength = 0;
    let targetNodeIndex = -1;
    let offsetInNode = 0;
    
    for (let i = 0; i < globalTextNodes.length; i++) {
        let nodeLen = globalTextNodes[i].nodeValue.length;
        if (runningLength + nodeLen > absoluteWordPosition) {
            targetNodeIndex = i;
            offsetInNode = absoluteWordPosition - runningLength;
            break;
        }
        runningLength += nodeLen;
    }

    if (targetNodeIndex !== -1) {
        removeReadingMarks();
        
        // Re-find targetNodeIndex because removeReadingMarks might have re-normalized the nodes
        runningLength = 0;
        targetNodeIndex = -1;
        offsetInNode = 0;
        for (let i = 0; i < globalTextNodes.length; i++) {
            let nodeLen = globalTextNodes[i].nodeValue.length;
            if (runningLength + nodeLen > absoluteWordPosition) {
                targetNodeIndex = i;
                offsetInNode = absoluteWordPosition - runningLength;
                break;
            }
            runningLength += nodeLen;
        }

        if (targetNodeIndex === -1) return;
        
        let nodeText = globalTextNodes[targetNodeIndex].nodeValue;
        let actualWordLen = Math.min(charLength, nodeText.length - offsetInNode);
        let exactWord = nodeText.substr(offsetInNode, actualWordLen);
        
        if (!exactWord.replace(/[^\w\u0080-\uFFFF]/g, '')) return;
        
        let before = nodeText.slice(0, offsetInNode);
        let after = nodeText.slice(offsetInNode + actualWordLen);
        
        let span = document.createElement("span");
        span.className = "reading-mark";
        span.textContent = exactWord;
        
        let beforeNode = document.createTextNode(before);
        let afterNode = document.createTextNode(after);
        
        let parent = globalTextNodes[targetNodeIndex].parentNode;
        parent.insertBefore(beforeNode, globalTextNodes[targetNodeIndex]);
        parent.insertBefore(span, globalTextNodes[targetNodeIndex]);
        parent.insertBefore(afterNode, globalTextNodes[targetNodeIndex]);
        parent.removeChild(globalTextNodes[targetNodeIndex]);
        
        globalTextNodes.splice(targetNodeIndex, 1, beforeNode, span.firstChild, afterNode);
        span.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        let progress = currentFallbackAudio.currentTime / currentFallbackAudio.duration;
        let wordIndex = Math.floor(progress * words.length);
        if (wordIndex >= words.length) wordIndex = words.length - 1;
        
        if (wordIndex !== lastWordIndex) {
            lastWordIndex = wordIndex;
            let currentWord = words[wordIndex];
            currentAbsoluteCharIndex = currentWord.startOffset;
            highlightReadingWord(currentWord.startOffset, currentWord.length);
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

window.onload = loadBooks;