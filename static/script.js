let currentBookId = null;
let currentBookText = "";
let currentBookDetectedLangCode = "en";
let activeBooksList = []; 
let currentSpeed = 1.0; 

let isEmotionModeActive = true;
// REAL-TIME Narrator Control
let currentEmotionUtterance = null;
let lastEmotionItem = null;
let lastEmotionItemProgress = 0;

// --- Quiz Feature Logic ---
let currentQuizData = [];

async function generateQuiz() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    
    // UI Setup
    const modal = document.getElementById("quizModal");
    if (!modal) return;
    modal.style.display = "flex";
    document.getElementById("quizLoading").style.display = "block";
    document.getElementById("quizContent").style.display = "none";
    document.getElementById("quizResult").style.display = "none";
    document.getElementById("quizSubmitBtn").style.display = "block";

    try {
        let res = await fetch("/generate_quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: selectedText || "", // Focus on highlight if exists, otherwise full book
                book_id: currentBookId
            })
        });

        if (!res.ok) throw new Error("Quiz generation failed.");
        let data = await res.json();
        currentQuizData = data.questions;
        renderQuiz();
    } catch (e) {
        alert("Quiz Error: " + e.message);
        closeQuiz();
    }
}

function renderQuiz() {
    document.getElementById("quizLoading").style.display = "none";
    document.getElementById("quizContent").style.display = "block";
    
    let body = document.getElementById("quizBody");
    body.innerHTML = "";
    
    currentQuizData.forEach((q, i) => {
        let qDiv = document.createElement("div");
        qDiv.className = "quiz-question";
        qDiv.style.marginBottom = "24px";
        qDiv.innerHTML = `
            <p style="font-weight: 600; margin-bottom: 12px; color: var(--text-white); font-size: 1.1rem;">${i+1}. ${q.question}</p>
            <div class="quiz-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                ${q.options.map(opt => `
                    <label style="background: var(--glass); padding: 12px 18px; border-radius: 12px; cursor: pointer; border: 1px solid var(--glass-border); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; gap: 10px; font-weight: 500; color: var(--text-white);">
                        <input type="radio" name="q${i}" value="${opt}" style="accent-color: var(--primary); width: 18px; height: 18px;">
                        <span>${opt}</span>
                    </label>
                `).join('')}
            </div>
        `;

        body.appendChild(qDiv);
    });
    
    document.getElementById("quizProgressBar").style.width = "10%";
}

function submitQuiz() {
    let score = 0;
    let total = currentQuizData.length;
    
    currentQuizData.forEach((q, i) => {
        let selected = document.querySelector(`input[name="q${i}"]:checked`);
        let labels = document.querySelectorAll(`input[name="q${i}"]`);
        
        labels.forEach(input => {
            let label = input.parentElement;
            let span = label.querySelector('span');
            
            // Highlight Correct Answer
            if (input.value === q.answer) {
                label.style.borderColor = "#10b981"; // Emerald Green
                label.style.background = "rgba(16, 185, 129, 0.1)";
                label.style.color = "#10b981";
                if (!span.innerText.includes("✅")) {
                    span.innerHTML += ' <span style="font-weight: 800; margin-left: 10px;">✅ (Correct Answer)</span>';
                }
            } else if (selected && input === selected && selected.value !== q.answer) {
                // Highlight Wrong Choice
                label.style.borderColor = "#ef4444"; // Rose Red
                label.style.background = "rgba(239, 68, 68, 0.1)";
                label.style.color = "#ef4444";
                if (!span.innerText.includes("❌")) {
                    span.innerHTML += ' <span style="font-weight: 800; margin-left: 10px;">❌ (Your Choice)</span>';
                }
            }
        });

        if (selected && selected.value === q.answer) {
            score++;
        }
    });

    let result = document.getElementById("quizResult");
    let percentage = Math.round((score / total) * 100);
    result.innerHTML = `<span style="color: var(--primary)">Score: ${score}/${total}</span> <span style="font-size: 0.9rem; opacity: 0.6; margin-left: 10px;">(${percentage}%)</span>`;
    result.style.display = "block";
    document.getElementById("quizSubmitBtn").style.display = "none";
    document.getElementById("quizProgressBar").style.width = "100%";
    
    // Scroll to top of quiz to see score
    document.getElementById("quizScrollBody").scrollTo({ top: 0, behavior: 'smooth' });
}


function closeQuiz() {
    document.getElementById("quizModal").style.display = "none";
}


function changeSpeed(delta) {
    currentSpeed = Math.max(0.5, Math.min(2.5, parseFloat((currentSpeed + delta).toFixed(1))));
    
    // Update UI
    const display = document.getElementById("speedDisplay");
    if (display) display.innerText = currentSpeed + "x";
    
    // Apply to Active Audio (Streaming Mode)
    if (currentFallbackAudio) {
        currentFallbackAudio.playbackRate = currentSpeed;
    }
    
    // Apply to Web Speech (Native Mode)
    if (typeof utterance !== 'undefined' && utterance) {
        utterance.rate = currentSpeed;
        // Some browsers require a restart to change rate mid-speech
        if (window.speechSynthesis.speaking) {
            let resumeAt = currentAbsoluteCharIndex;
            window.speechSynthesis.cancel();
            setTimeout(() => resumeReadingFromIndex(resumeAt), 50);
        }
    }
}


// Theme Engine
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('reader-theme', newTheme);
    
    const icon = document.querySelector('.mode-icon');
    if (icon) icon.innerText = isDark ? '☀️' : '🌙';
}

// Apply Saved Theme
(function initTheme() {
    const saved = localStorage.getItem('reader-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('DOMContentLoaded', () => {
        const icon = document.querySelector('.mode-icon');
        if (icon) icon.innerText = saved === 'light' ? '☀️' : '🌙';
    });
})();

function toggleEmotionMode() {
    isEmotionModeActive = !isEmotionModeActive;
    const btn = document.getElementById('emotionModeBtn');
    if (!btn) return;
    
    if (isEmotionModeActive) {
        btn.classList.add('active');
        btn.innerHTML = "🎭 Emotion: ON";
        btn.style.background = "#b45309";
        showUploadToast("🎭 Emotion-based Reading Enabled", "info");
    } else {
        btn.classList.remove('active');
        btn.innerHTML = "🎭 Emotion: OFF";
        btn.style.background = "none";
        updateReaderMood('neutral'); // Reset
        showUploadToast("🎭 Emotion Mode Disabled", "info");
    }

    if (isReadingAloud) {
        restartNarrator();
    }
}

let isRestartingNarrator = false;

function getSafeResumeIndex(text, index) {
    if (!text || index <= 0) return 0;
    if (index >= text.length) return text.length;

    let i = index;

    // Move to the end of the current word
    while (i < text.length && /\S/.test(text[i])) i++;

    // Move past spaces
    while (i < text.length && /\s/.test(text[i])) i++;

    return i;
}

function restartNarrator() {
    if (!isReadingAloud || isRestartingNarrator) return;

    isRestartingNarrator = true;

    // Resume from the NEXT unread word, not the exact current spoken boundary
    let resumePos = getSafeResumeIndex(globalReadingText || "", currentAbsoluteCharIndex);

    // Kill all running jobs
    currentNarrationJobId++;
    utterancePool = [];

    try {
        window.speechSynthesis.cancel();
    } catch (e) {}

    if (currentFallbackAudio) {
        currentFallbackAudio.onended = null;
        currentFallbackAudio.pause();
        currentFallbackAudio = null;
    }

    currentEmotionUtterance = null;
    lastEmotionItem = null;
    lastEmotionItemProgress = 0;

    // Wait until browser speech queue is really cleared
    const restartWhenClear = () => {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            setTimeout(restartWhenClear, 80);
            return;
        }

        setTimeout(() => {
            resumeReadingFromIndex(resumePos, false);
            isRestartingNarrator = false;
        }, 120);
    };

    restartWhenClear();
}

let totalPages = 0;
let currentNarratorGender = "female"; 
const chosenVoiceCache = {};

function setNarratorGender(gender) {
    if (currentNarratorGender === gender) return;

    currentNarratorGender = gender;

    // Clear cached voice picks so a fresh voice is selected
    for (let key in chosenVoiceCache) delete chosenVoiceCache[key];

    const maleBtn = document.getElementById("maleVoiceBtn");
    const femaleBtn = document.getElementById("femaleVoiceBtn");

    if (maleBtn && femaleBtn) {
        if (gender === "male") {
            maleBtn.style.background = "#b45309";
            femaleBtn.style.background = "none";
        } else {
            femaleBtn.style.background = "#b45309";
            maleBtn.style.background = "none";
        }
    }

    // Only restart if already reading
    if (isReadingAloud && !isPaused) {
        if (window._restartTimeout) clearTimeout(window._restartTimeout);
        window._restartTimeout = setTimeout(() => {
            restartNarrator();
        }, 180);
    }
}

function getBestVoice(voices, lang, gender = currentNarratorGender) {
    if (!voices || voices.length === 0) return null;

    const cacheKey = `${lang}_${gender}`;
    if (chosenVoiceCache[cacheKey]) {
        const cached = voices.find(v => v.name === chosenVoiceCache[cacheKey]);
        if (cached) return cached;
    }

    const shortLang = (lang || "en-US").split("-")[0].toLowerCase();

    let langVoices = voices.filter(v =>
        (v.lang || "").toLowerCase().replace("_", "-").startsWith(shortLang)
    );

    if (langVoices.length === 0) return null;

    const malePriority = [
        "microsoft david",
        "microsoft mark",
        "google uk english male",
        "google us english male",
        "rishi",
        "prabhat",
        "david",
        "mark",
        "stefan",
        "george",
        "ravi",
        "male"
    ];

    const femalePriority = [
        "microsoft zira",
        "microsoft hazel",
        "google uk english female",
        "google us english",
        "ravina",
        "heera",
        "zira",
        "hazel",
        "susan",
        "female"
    ];

    const targetList = gender === "male" ? malePriority : femalePriority;

    let selected = null;

    // 1. Exact preferred names first
    for (const key of targetList) {
        selected = langVoices.find(v => v.name.toLowerCase().includes(key));
        if (selected) break;
    }

    // 2. Natural / neural voices next
    if (!selected) {
        selected = langVoices.find(v => {
            const n = v.name.toLowerCase();
            return (
                (n.includes("neural") || n.includes("natural") || n.includes("online")) &&
                targetList.some(k => n.includes(k))
            );
        });
    }

    // 3. Fallback by gender keyword
    if (!selected) {
        selected = langVoices.find(v => {
            const n = v.name.toLowerCase();
            return gender === "male" ? n.includes("male") : n.includes("female");
        });
    }

    // 4. Final fallback
    if (!selected) selected = langVoices[0];

    chosenVoiceCache[cacheKey] = selected.name;
    return selected;
}

function isVoiceActuallyMale(voice) {
    if (!voice) return false;
    const maleKeywords = ["male", "david", "mark", "stefan", "george", "ravi", "guy", "man", "boy", "stef", "henri", "paul", "peter", "rishi", "prabhat"];
    return maleKeywords.some(kw => voice.name.toLowerCase().includes(kw));
}


// High-Performance Audio Engine for Gender & Emotion
let audioCtx = null;
function getAudioContext() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// High-Performance Custom Highlight API (Zero DOM impact)
const readingHighlight = (typeof Highlight !== 'undefined') ? new Highlight() : null;
const sentenceHighlight = (typeof Highlight !== 'undefined') ? new Highlight() : null;

if (typeof CSS !== 'undefined' && CSS.highlights) {
    if (readingHighlight) CSS.highlights.set('reading-word', readingHighlight);
    if (sentenceHighlight) CSS.highlights.set('reading-sentence', sentenceHighlight);
}


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
    toast.innerHTML = msg;
    document.body.appendChild(toast);

    // Auto-remove after 3.5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = "toastOut 0.3s ease forwards";
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
        }
    }, 3500);
}

let _processingPollTimer = null;

function loadBooks() {
    return fetch("/books")
    .then(res => res.json())
    .then(data => {
        activeBooksList = data; // Store for voice matching: [id, name, uploaded_at, status]
        let list = document.getElementById("booklist");
        list.innerHTML = "";

        let hasProcessing = false;

        data.forEach(book => {
            // book = [id, name, uploaded_at, status]
            let status = book[3] || "ready";
            if (status === "processing") hasProcessing = true;

            let tr = document.createElement("tr");

            let badge = "";
            let btnClass = "";
            if (status === "processing") {
                badge = `<span class="processing-badge"><span class="spinner"></span> Processing…</span>`;
                btnClass = "processing-btn";
            } else if (status === "error") {
                badge = `<span class="processing-badge" style="background:#7f1d1d;color:#fca5a5;">❌ Failed</span>`;
            }

            let openBtn = status === "ready"
                ? `<button class="btn-open" onclick="openBook(${book[0]})">Open</button>`
                : `<button disabled class="btn-open processing-btn" style="opacity:0.6;cursor:not-allowed;">Open</button>`;

            let downloadBtn = status === "ready"
                ? `<button class="btn-download" onclick="downloadBook(${book[0]}, '${book[1].replace(/'/g, "\\'")}')">Download</button>`
                : `<button disabled class="btn-download" style="opacity:0.4;cursor:not-allowed;">Download</button>`;

            tr.innerHTML = `
                <td>
                    <div class="book-entry">
                        <div class="book-info">
                            <span class="book-name">${book[1]}${badge}</span>
                            <span class="book-meta">${book[2]}</span>
                        </div>
                        <div class="book-actions">
                            ${openBtn}
                            ${downloadBtn}
                            <button class="btn-delete" onclick="deleteBook(${book[0]})">Delete</button>
                        </div>
                    </div>
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
    const loader = document.getElementById("simpleLoader");
    const loaderText = document.getElementById("loaderText");
    if (loaderText) loaderText.innerText = msg || "Loading book...";
    if (loader) loader.style.display = "flex";
    
    document.getElementById("reader").classList.add('no-spine-shadow');
    document.getElementById("reader").style.opacity = "0"; 
}

function showTranslationLoader(msg) {
    showLoader(msg || "Translating language...");
}

function hideLoader() {
    const loader = document.getElementById("simpleLoader");
    if (loader) loader.style.display = "none";
    const reader = document.getElementById("reader");
    if (reader) {
        reader.classList.remove('no-spine-shadow');
        reader.style.opacity = "1";
    }
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
    let bookmarkIndex = currentAbsoluteCharIndex;
    let oldBookId = currentBookId;

    // If switching books and we have progress, ask to save bookmark
    if (oldBookId && oldBookId !== bookId && bookmarkIndex > 0) {
        showBookmarkModal(
            "Save Progress?",
            "Would you like to save your current position before switching books?",
            "Save Bookmark",
            "Don't Save",
            "Cancel",
            () => {
                localStorage.setItem(`bookmark_${oldBookId}`, bookmarkIndex);
                resetReadingSession();
                proceedToOpenBook(bookId);
            },
            () => {
                resetReadingSession();
                proceedToOpenBook(bookId);
            },
            () => { /* Cancel - do nothing */ }
        );
        return;
    }

    if (oldBookId !== bookId) {
        resetReadingSession();
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

        // Update Floating Badge and reveal it
        const bookTitleEl = document.getElementById("bookTitle");
        const bookBadgeEl = document.getElementById("bookBadge");
        if (bookTitleEl) bookTitleEl.innerText = data.name;
        if (bookBadgeEl) bookBadgeEl.classList.add('visible');
        
        // Clear progress on new book
        const progEl = document.getElementById("readingProgress");
        if (progEl) progEl.innerText = "| 0% Read";

        
        let reader = document.getElementById("reader");
        let detectedLang = "Original Language";
        
        let langSelectBtn = document.getElementById("langSelect");
        if(langSelectBtn) {
            langSelectBtn.value = "orig";
            
            // Dynamic Language Labeling
            // Take a safe sample for detection without blowing up memory on massive books
            let rawText = data.text || "";
            let sampleTextForLang = rawText.substring(0, 30000); 
            
            // Fast regex to strip data:image/... base64 blocks which can be massive and block detection
            sampleTextForLang = sampleTextForLang.replace(/src=["']data:image\/[^"']+["']/g, '');
            // Strip remaining tags and take a smaller sample for even faster processing
            let detectionSample = sampleTextForLang.replace(/<[^>]*>/g, ' ').substring(0, 1500).trim();
            
            const scriptCounts = {
                "Tamil": (detectionSample.match(/[\u0b80-\u0bff]/g) || []).length,
                "Hindi": (detectionSample.match(/[\u0900-\u097f]/g) || []).length,
                "Telugu": (detectionSample.match(/[\u0c00-\u0c7f]/g) || []).length,
                "Kannada": (detectionSample.match(/[\u0c80-\u0cff]/g) || []).length,
                "Malayalam": (detectionSample.match(/[\u0d00-\u0d7f]/g) || []).length,
                "Bengali": (detectionSample.match(/[\u0980-\u09ff]/g) || []).length,
                "Punjabi": (detectionSample.match(/[\u0a00-\u0a7f]/g) || []).length,
                "Gujarati": (detectionSample.match(/[\u0a80-\u0aff]/g) || []).length,
                "Odia": (detectionSample.match(/[\u0b00-\u0b7f]/g) || []).length,
                "Korean": (detectionSample.match(/[\uac00-\ud7af\u1100-\u11ff]/g) || []).length,
                "Japanese/Chinese": (detectionSample.match(/[\u3040-\u30ff\u4e00-\u9faf]/g) || []).length,
                "Latin": (detectionSample.match(/[a-zA-Z]/g) || []).length
            };

            // Find the most frequent script
            let maxCount = 0;
            let bestScript = "Latin"; 
            for (const script in scriptCounts) {
                if (scriptCounts[script] > maxCount) {
                    maxCount = scriptCounts[script];
                    bestScript = script;
                }
            }

            // Map best script to detection results
            const scriptLangMap = {
                "Tamil": { label: "Original (Tamil)", code: "ta" },
                "Hindi": { label: "Original (Hindi)", code: "hi" },
                "Telugu": { label: "Original (Telugu)", code: "te" },
                "Kannada": { label: "Original (Kannada)", code: "kn" },
                "Malayalam": { label: "Original (Malayalam)", code: "ml" },
                "Bengali": { label: "Original (Bengali)", code: "bn" },
                "Punjabi": { label: "Original (Punjabi)", code: "pa" },
                "Gujarati": { label: "Original (Gujarati)", code: "gu" },
                "Odia": { label: "Original (Odia)", code: "or" },
                "Korean": { label: "Original (Korean)", code: "ko" },
                "Japanese/Chinese": { label: "Original (Japanese/Chinese)", code: "zh-CN" },
                "Latin": { label: "Original (English)", code: "en" }
            };

            if (maxCount < 10 && !detectionSample.trim()) {
                currentBookDetectedLangCode = "en";
            } else {
                const result = scriptLangMap[bestScript];
                detectedLang = result.label;
                currentBookDetectedLangCode = result.code;
            }
            
            const origOption = langSelectBtn.querySelector('option[value="orig"]');
            if (origOption) {
                origOption.textContent = detectedLang;
                origOption.innerText = detectedLang; 
            }
            langSelectBtn.selectedIndex = 0;
            langSelectBtn.value = "orig";
        }
        
        reader = document.getElementById("reader");
        
        // Use a slight timeout to let the loader render
        await new Promise(r => setTimeout(r, 50));
        
        // Clear reader, reset scroll position immediately, and prepare container
        reader.innerHTML = '<div class="book-content-container"></div>';
        reader.scrollTop = 0;
        reader.scrollLeft = 0;
        let container = reader.querySelector('.book-content-container');

        // Efficiently split currentBookText into individual pages without massive memory duplication
        let pageChunks = [];
        
        // 1. Optimized splitting with index-based substring search
        // Check first 10k chars for the marker to avoid full-string search for detection
        const head = currentBookText.substring(0, 10000);
        let splitMarker = head.includes('id="pdf-page-') ? '<div id="pdf-page-' : (head.includes("id='pdf-page-") ? "<div id='pdf-page-" : null);

        if (splitMarker) {
            let markerIdx = currentBookText.indexOf(splitMarker);
            if (markerIdx !== -1) {
                // Skip adding the leading header (wrapper prefix) as a page chunk
                // This prevents an empty "Page 1" from appearing before the actual first page.
                
                while (markerIdx !== -1) {
                    let nextMarkerIdx = currentBookText.indexOf(splitMarker, markerIdx + 1);
                    if (nextMarkerIdx !== -1) {
                        pageChunks.push(currentBookText.substring(markerIdx, nextMarkerIdx));
                    } else {
                        pageChunks.push(currentBookText.substring(markerIdx));
                    }
                    markerIdx = nextMarkerIdx;

                    // Support 3,600+ page books without triggering "Page Unresponsive"
                    // Increase yielding frequency: every 150 chunks for 180MB books
                    if (pageChunks.length % 150 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }
        }
        
        // 2. Fallback for older PPT slides or other block-like structures that look like pages
        if (pageChunks.length === 0) {
            // Check for slide patterns in a small head sample to avoid long wait
            const headSample = currentBookText.substring(0, 50000);
            const hasSlidePattern = headSample.includes('Slide ') || headSample.includes('pptx-slide') || headSample.includes('aspect-ratio: 16/9') || headSample.includes('lazy-page-container') || headSample.includes('slide-');
            
            if (hasSlidePattern) {
                // Only parse if the string isn't absolutely massive (prevent hang on 200MB strings)
                if (currentBookText.length < 5000000) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = currentBookText;
                    // Look for common slide/page markers
                    const blocks = tempDiv.querySelectorAll('.lazy-page-container, .pptx-slide, div[style*="aspect-ratio: 16/9"], div[id*="page-"], div[class*="slide-"]');
                    if (blocks.length > 0) {
                        blocks.forEach((b, i) => {
                            b.id = `pdf-page-${i}`;
                            b.classList.add('lazy-page-container');
                            pageChunks.push(b.outerHTML);
                        });
                    }
                } else {
                    // Fallback for massive un-split books: don't parse as slides, just show as one giant block
                    // or we could split by regex manually here without DOM parsing
                }
            }
        }
        
        if (pageChunks.length === 0 && currentBookText.trim()) {
            if (container) container.innerHTML = currentBookText;
            hideLoader();
        }

        totalPages = pageChunks.length || (currentBookText.trim() ? 1 : 0);
        updatePagesList();

        let containerW = reader.clientWidth - 20;
        let renderedCount = 0;

        async function renderBatch(startIndex) {
            if (startIndex === 0) {
                if (reader) reader.scrollTop = 0; 
                // Enable CSS scaling for PDFs once on start
                if (pageChunks.length > 0 && reader) reader.classList.add('use-css-zoom');
                hideLoader();
            }
            
            // Dynamic Batch Size: Smaller batches for heavy books keep the browser responsive
            const isMassive = pageChunks.length > 1000;
            const batchSize = isMassive ? 8 : (startIndex === 0 ? 5 : 15);
            const endIndex = Math.min(startIndex + batchSize, pageChunks.length);
            
            for (let i = startIndex; i < endIndex; i++) {
                // Create a temporary element to hold the page chunk
                let temp = document.createElement('div');
                temp.innerHTML = pageChunks[i];
                let pageWrapper = temp.firstChild;
                container.appendChild(pageWrapper);

                // Apply scaling immediately to the new page
                // Match both ID formats: 'page-N' or 'pdf-page-N'
                let pdfPage = pageWrapper.querySelector('div[id*="page-"]') || (pageWrapper.id.includes('page-') ? pageWrapper : null);
                if (pdfPage) {
                    // Optimized scaling logic
                    let w = parseFloat(pdfPage.style.width) || 800;
                    let h = parseFloat(pdfPage.style.height);
                    
                    pdfPage.setAttribute('data-original-width', w);
                    if (h) pdfPage.setAttribute('data-original-height', h);

                    // Set CSS variables for high-performance scaling
                    pdfPage.style.setProperty('--ow', w);
                    if (h) pdfPage.style.setProperty('--oh', h);
                    
                    let baseScale = Math.min(1.0, containerW / w);
                    pdfPage.style.setProperty('--base-scale', baseScale);
                    
                    // Add modern zoom support
                    reader.classList.add('use-css-zoom');

                    let finalScale = baseScale * currentZoom;
                    
                    pdfPage.style.width = w + "px";
                    if (h) pdfPage.style.height = h + "px";
                    pdfPage.style.transform = `scale(${finalScale})`;
                    pdfPage.style.transformOrigin = "top left";
                    pdfPage.style.display = "block";
                    pdfPage.style.margin = "0";

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

            // applyExistingHighlights used to be here every 100 pages, but removed to prevent O(N^2) hangs.
            // Highlights are now applied once at the end or on-demand.


            if (renderedCount < pageChunks.length) {
                // Return to main thread to keep UI responsive. 
                // Yield longer for massive books to prevent GC pressure hang.
                const yieldTime = isMassive ? 35 : 12;
                await new Promise(r => setTimeout(r, yieldTime));
                return renderBatch(renderedCount);
            } else {
                // Final pass once everything is rendered
                applyExistingHighlights();
                
                // Pre-calculate the reading node map so 'Read Full' starts INSTANTLY
                // We do this AFTER normalization to ensure offsets are correct.
                // Re-calculating in the 1000ms block below.
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
        setTimeout(async () => {
            await normalizeBookDOM(reader);
            rebuildReadingNodeMap();
        }, 1000);
        
        loadHighlights(bookId);
    })
    .catch(err => {
        console.error(err);
        hideLoader();
        alert("Could not open book");
    });
}

function downloadBook(bookId, bookName) {
    const a = document.createElement("a");
    a.href = "/download/" + bookId;
    a.download = bookName; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function deleteBook(bookId) {
    showBookmarkModal(
        "Delete Book?",
        "Are you sure you want to permanently remove this book from your library? This action cannot be undone.",
        "Yes, Delete",
        "Keep Book",
        "Cancel",
        () => {
            // EXECUTE DELETE
            resetReadingSession();
            let playPauseBtn = document.getElementById("playPauseBtn");
            if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

            fetch("/delete_book/" + bookId, { method: "POST" })
            .then(res => res.json())
            .then(data => {
                showUploadToast(data.message || data.error, data.error ? "error" : "success");
                document.getElementById("reader").innerHTML = '<div class="empty-state">Select a book from the sidebar to start reading.</div>';
                document.getElementById("booktitle").innerText = "No book selected";
                loadBooks();
            });
        },
        () => { /* Stay - no action */ },
        () => { /* Cancel - no action */ }
    );
}

let lastActiveRange = null;

function saveHighlight() {
    console.log("Save Highlight Initiated");
    let selection = window.getSelection();
    
    // Use cached range if the live selection was lost due to DOM churn or toolbar movement
    let range = (selection && selection.rangeCount > 0) ? selection.getRangeAt(0) : lastActiveRange;
    if (!range) {
        console.warn("SaveHighlight aborted: No active or cached range found.");
        return;
    }

    let text = range.toString().trim();
    let toolbar = document.getElementById("selectionToolbar");

    if (!text || !currentBookId) {
        console.warn("SaveHighlight aborted: text or bookId missing", { text, currentBookId });
        if (toolbar) toolbar.style.display = "none";
        return;
    }

    // Identify the range before any DOM modifications
    let rangeData = getAbsoluteSelectionRange(range);
    if (!rangeData) {
        console.error("Failed to calculate absolute range for selection");
        return;
    }

    // TOGGLE LOGIC: Check if this range intersects with or matches an existing highlight
    let existingIndex = currentHighlights.findIndex(h => {
        let jh = typeof h === 'string' ? JSON.parse(h) : h;
        // Robust intersection check: If selection overlaps significantly with an existing highlight
        // or if the selection is entirely within an existing highlight.
        const isOverlap = (rangeData.startChar < jh.endChar && rangeData.endChar > jh.startChar);
        if (!isOverlap) return false;

        // Ensure we aren't accidentally toggling off a highlight just because we brushed past it
        // Check if the intersection is meaningful (e.g. either close proximity of offsets OR substantial overlap)
        const startDiff = Math.abs(jh.startChar - rangeData.startChar);
        const endDiff = Math.abs(jh.endChar - rangeData.endChar);
        
        // Match if offsets are very close OR if selection is clearly targeting this highlight
        return (startDiff < 8 && endDiff < 8) || (rangeData.startChar >= jh.startChar && rangeData.endChar <= jh.endChar);
    });

    if (existingIndex !== -1) {
        console.log("Toggle OFF: Removing highlight", rangeData);
        let itemToRemove = currentHighlights[existingIndex];
        currentHighlights.splice(existingIndex, 1);
        
        // Remove from server
        fetch("/delete_highlight", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                book_id: currentBookId,
                highlighted_text: itemToRemove
            })
        }).then(res => {
            if (res.ok) console.log("Highlight removed from server");
        });

        // Visually remove: Clear all and re-apply remaining
        clearManualHighlights();
        applyExistingHighlights();
        
        if (toolbar) toolbar.style.display = "none";
        selection.removeAllRanges();
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

function getAbsoluteSelectionRange(providedRange) {
    let selection = window.getSelection();
    let range = providedRange || (selection.rangeCount > 0 ? selection.getRangeAt(0) : lastActiveRange);
    if (!range) return null;
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
    
    // Use unified text mapping to ensure offsets match perfectly
    let { nodes, offsets } = getNodesAndText(reader);
    let nodesToWrap = [];
    
    for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        let nodeLen = node.nodeValue.length;
        let nodeStart = offsets[i];
        let nodeEnd = nodeStart + nodeLen;
        
        if (nodeEnd > item.startChar && nodeStart < item.endChar) {
            let sliceStart = Math.max(0, item.startChar - nodeStart);
            let sliceEnd = Math.min(nodeLen, item.endChar - nodeStart);
            nodesToWrap.push({ node, sliceStart, sliceEnd });
        }
        
        if (nodeStart >= item.endChar) break;
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

function clearManualHighlights() {
    let reader = document.getElementById("reader");
    if (!reader) return;
    
    let highlights = reader.querySelectorAll('.highlight');
    highlights.forEach(el => {
        let parent = el.parentNode;
        if (parent) {
            // Un-wrap: insert children back into parent and remove the span
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize();
        }
    });
}

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
let lastActiveSearchIndex = -1; // Optimized tracking to avoid full scans
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
let utterancePool = []; // CRITICAL for Chrome: prevent GC on utterances causing onend to skip
let watchdogTimer = null; // Detect hangs near the end of the text

async function normalizeBookDOM(root) {
    if (!root) return;
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let count = 0;
    let nodesToProcess = [];
    
    // 1. Gather nodes (avoid modifying while iterating)
    while (walker.nextNode()) {
        nodesToProcess.push(walker.currentNode);
    }

    // 2. Process
    for (let i = 0; i < nodesToProcess.length; i++) {
        let node = nodesToProcess[i];
        let val = node.nodeValue;
        
        // Clean artifacts
        if (val.includes('\u00AD') || val.includes('\u00A0') || val.includes('\u200B') || val.includes('\r')) {
            node.nodeValue = val
                .replace(/\u00AD/g, '')
                .replace(/\u00A0/g, ' ')
                .replace(/\u200B/g, '')
                .replace(/\r/g, '');
        }

        // Space Normalization: Ensure words aren't smashed together at DOM boundaries
        // This is critical for TTS to read word-by-word correctly
        if (i > 0) {
            let prevNode = nodesToProcess[i-1];
            let prevVal = prevNode.nodeValue;
            if (prevVal.length > 0 && !prevVal.endsWith(" ") && !prevVal.endsWith("\n") && !val.startsWith(" ") && !val.startsWith("\n")) {
                // Only insert if they are conceptually separate blocks or spans
                if (node.parentNode !== prevNode.parentNode || node.previousSibling === null) {
                    let space = document.createTextNode(" ");
                    node.parentNode.insertBefore(space, node);
                }
            }
        }
        
        if (++count % 500 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
}

function getNodesAndText(root) {
    let nodes = [];
    let offsets = [];
    let parts = [];
    let currentLen = 0;
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    
    let lastParent = null;

    while (walker.nextNode()) {
        let node = walker.currentNode;
        if (node.parentNode.classList.contains('empty-state') || node.parentNode.id === 'thankYouState') continue;
        if (node.parentNode.classList.contains('ocr-fallback-text')) continue;
        
        // SPACE INJECTION: Crucial for drift-free highlighting
        // If we jump between elements, the browser/narrator implies a space.
        // We must add this space to our character map to keep everything aligned.
        if (lastParent && node.parentNode !== lastParent && parts.length > 0) {
            let lastPart = parts[parts.length - 1];
            if (!lastPart.endsWith(" ") && !node.nodeValue.startsWith(" ")) {
                parts.push(" ");
                currentLen += 1;
            }
        }

        let val = node.nodeValue.replace(/\u00A0/g, ' '); // Map non-breaking spaces to standard spaces
        nodes.push(node);
        offsets.push(currentLen);
        parts.push(val);
        currentLen += val.length;
        lastParent = node.parentNode;
    }
    
    let text = parts.join("");
    return { nodes, offsets, text };
}

let currentSearchProcessId = 0;

function highlightTextInNode(element, textToHighlight, className) {
    if (!textToHighlight || textToHighlight.length < 1) return;
    
    // Assign a process ID to ensure only the latest search runs
    const processId = ++currentSearchProcessId;
    let regex = new RegExp("(" + textToHighlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ")", "gi");
    
    let target = element.querySelector('.book-content-container') || element;
    let walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null, false);
    
    // Batch processing configuration
    const batchSize = 300;
    
    function processBatch() {
        if (processId !== currentSearchProcessId) return; // Stale search
        
        let processedInThisBatch = 0;
        let node = walker.nextNode();

        while (node && processedInThisBatch < batchSize) {
            if (processId !== currentSearchProcessId) return;
            
            if (node.parentNode && node.parentNode.className !== className && !node.parentNode.classList.contains('find-highlight')) {
                let text = node.nodeValue;
                if (text && regex.test(text)) {
                    regex.lastIndex = 0; // Reset regex
                    let html = text.replace(regex, (match) => {
                        let idAttr = className === 'find-highlight' ? ` id="search-match-${searchMatchesFound++}"` : '';
                        return `<span class="${className}"${idAttr} style="background-color: #2ecc71 !important; color: white !important; border-radius: 2px; padding: 0 1px; display: inline;">${match}</span>`;
                    });
                    
                    if (html !== text) {
                        let span = document.createElement("span");
                        span.innerHTML = html;
                        let parent = node.parentNode;
                        if (parent) parent.replaceChild(span, node);
                    }
                }
            }
            node = walker.nextNode();
            processedInThisBatch++;
        }
        
        if (node) {
            // Schedule next batch, but yield to the browser for typing
            setTimeout(processBatch, 0);
        } else {
            // Search complete
        }

        // Update counter incrementally for better feedback
        let countEl = document.getElementById("searchCount");
        if (countEl && searchMatchesFound > 0 && className === 'find-highlight') {
            if (currentSearchIndex === -1) {
                currentSearchIndex = 0;
                scrollToSearchMatch();
            } else {
                countEl.innerText = `${currentSearchIndex + 1} of ${searchMatchesFound}`;
            }
        }
    }
    
    processBatch();
}

// Narration Control Variables
let isStartingReading = false;
let speechKeepAliveInterval = null;

function startSpeechKeepAlive() {
    if (speechKeepAliveInterval) clearInterval(speechKeepAliveInterval);
    speechKeepAliveInterval = setInterval(() => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
        }
    }, 10000);
}

function stopSpeechKeepAlive() {
    if (speechKeepAliveInterval) {
        clearInterval(speechKeepAliveInterval);
        speechKeepAliveInterval = null;
    }
}

async function resumeReadingFromIndex(index, startPaused = false) {
    // CRITICAL: Ensure node map is rebuilt after translation to capture new content
    if (!globalTextNodes || globalTextNodes.length === 0 || !globalReadingText || globalReadingText.length < 10) {
        rebuildReadingNodeMap();
    }
    
    if (!globalReadingText || !globalReadingText.trim()) {
        console.warn("No text found in reader. Rebuilding...");
        rebuildReadingNodeMap();
        if (!globalReadingText.trim()) {
            showUploadToast("📚 No readable text found in this book.", "error");
            return;
        }
    }

    // Resume from a safe word boundary to avoid repeated fragments
    index = getSafeResumeIndex(globalReadingText, index);

    if (index >= globalReadingText.length) {
        stopReading(true);
        return;
    }

    window.speechSynthesis.cancel();
    removeReadingMarks();

    isReadingAloud = true;
    isPaused = startPaused;
    currentAbsoluteCharIndex = index;

    let playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn) playPauseBtn.innerText = startPaused ? "Resume ▶" : "Pause ⏸";

    utterancePool = [];
    if (watchdogTimer) clearTimeout(watchdogTimer);
    startSpeechKeepAlive();

    let text = globalReadingText;
    // PERFORMANCE FIX: Only chunk the next 15,000 characters at a time.
    // This makes the 'start' time instant regardless of book length (Total book could be 1M+ chars)
    let processingLimit = 15000;
    let remainingText = text.substring(index, index + processingLimit);
    let chunks = [];
    let lastSplit = 0;
    
    // Fast boundary splitter
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

    let testLang = getSelectedLanguage();
    let testShort = testLang ? testLang.split('-')[0].toLowerCase() : 'en';

    if (testShort !== 'en' || isEmotionModeActive) {
        playFallbackAudioQueue(chunks, chunkOffset, testShort, startPaused);
        return;
    }

    let totalTasks = chunks.filter(c => c.trim().length > 0).length;
    if (totalTasks === 0) {
        stopReading(true);
        return;
    }

    let completedTasks = 0;
    let runningOffset = chunkOffset;

    chunks.forEach((chunk, chunkIdx) => {
        let trimmed = chunk.trimStart();
        if (!trimmed) {
            runningOffset += chunk.length;
            return;
        }
        let leadingSpaces = chunk.length - trimmed.length;
        let actualStartOffset = runningOffset + leadingSpaces;
        runningOffset += chunk.length;

        let utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = currentSpeed;
        let lang = getSelectedLanguage();
        if (lang) {
            utterance.lang = lang;
            let voices = window.speechSynthesis.getVoices();
            let voice = getBestVoice(voices, lang);
            if (voice) utterance.voice = voice;
        }

        const jobId = currentNarrationJobId;
        let boundaryReceived = false;

        utterance.onboundary = function(event) {
            if (jobId !== currentNarrationJobId || event.name !== 'word') return;
            boundaryReceived = true;
            let charLength = event.charLength || 5;
            let absoluteWordPosition = actualStartOffset + event.charIndex;
            currentAbsoluteCharIndex = absoluteWordPosition;
            highlightReadingWord(absoluteWordPosition, charLength);
        };
        
        utterance.onstart = function() { 
            if (jobId !== currentNarrationJobId) return;
            removeReadingMarks(); 
            let words = [];
            let regex = /\S+/g;
            let match;
            while ((match = regex.exec(trimmed)) !== null) {
                words.push({ startOffset: actualStartOffset + match.index, length: match[0].length });
            }
            
            let baseDuration = (trimmed.length / (14 * utterance.rate)) * 1000;
            let startTime = Date.now();
            let interval = setInterval(() => {
                if (jobId !== currentNarrationJobId || boundaryReceived || !isReadingAloud || isPaused) {
                    clearInterval(interval);
                    return;
                }
                let elapsed = Date.now() - startTime;
                let progress = elapsed / baseDuration;
                if (progress >= 1.0) { clearInterval(interval); return; }
                
                let wordIdx = Math.floor(progress * words.length);
                if (wordIdx < words.length && wordIdx >= 0) {
                    currentAbsoluteCharIndex = words[wordIdx].startOffset;
                    highlightReadingWord(words[wordIdx].startOffset, words[wordIdx].length);
                }
            }, 100);
        };
        
        utterancePool.push(utterance); // Keep reference alive
        utterance.onend = function() {
            utterancePool = utterancePool.filter(u => u !== utterance);
            completedTasks++;
            if (completedTasks === totalTasks) stopReading(true);
        };
        utterance.onerror = () => {
             utterancePool = utterancePool.filter(u => u !== utterance);
             completedTasks++;
             if (completedTasks === totalTasks) stopReading(true);
        };
        window.speechSynthesis.speak(utterance);
    });
    
    if (startPaused) {
        window.speechSynthesis.pause();
    }
}

let currentNarrationJobId = 0;

function stopReading(isComplete = false) {
    currentNarrationJobId++; // Lethal: Instantly invalidates all pending async callbacks
    window.speechSynthesis.resume(); 
    window.speechSynthesis.cancel();
    stopSpeechKeepAlive(); 
    
    if (currentFallbackAudio) {
        currentFallbackAudio.pause();
        currentFallbackAudio.ontimeupdate = null;
        currentFallbackAudio = null;
    }

    fallbackQueue = []; 
    currentEmotionUtterance = null;
    lastEmotionItem = null;
    lastEmotionItemProgress = 0;
    
    isReadingAloud = false;
    isPaused = false;
    lastHighlightPos = -1;
    if (watchdogTimer) clearTimeout(watchdogTimer);
    utterancePool = [];
    
    removeReadingMarks();
    if (isComplete) {
        currentAbsoluteCharIndex = 0;
        let reader = document.getElementById("reader");
        if (reader) reader.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";
}

async function resetReadingSession() {
    isReadingAloud = false;
    isPaused = false;
    stopReading();
    globalReadingText = "";
    globalTextNodes = [];
    globalNodeOffsets = [];
    currentAbsoluteCharIndex = 0;
    lastHighlightPos = -1;
    lastMarkedNodeIndex = 0;
}

async function togglePlayPause() {
    let playPauseBtn = document.getElementById("playPauseBtn");
    
    if (!currentBookId) {
        showUploadToast("📚 Please select a book from your library first!", "info");
        return;
    }
    
    if (!isReadingAloud) {
        // PDF SYNC: Only jump to the visible page if we are starting fresh (offset 0)
        let reader = document.getElementById("reader");
        if (currentAbsoluteCharIndex === 0 && reader && reader.scrollTop > 300) {
            if (!globalTextNodes || globalTextNodes.length === 0) rebuildReadingNodeMap();
            let pages = document.querySelectorAll('[id^="pdf-page-"]');
            let readerRect = reader.getBoundingClientRect();
            for (let page of pages) {
                let rect = page.getBoundingClientRect();
                if (rect.bottom > readerRect.top + 50) {
                    for (let i = 0; i < globalTextNodes.length; i++) {
                        if (page.contains(globalTextNodes[i])) {
                            currentAbsoluteCharIndex = globalNodeOffsets[i];
                            break;
                        }
                    }
                    break;
                }
            }
        }
        await resumeReadingFromIndex(currentAbsoluteCharIndex);
    } else {
        if (isPaused) {
            // RESUME
            isPaused = false;
            // Enhanced Resume
            if (isEmotionModeActive) {
                window.speechSynthesis.cancel();
                if (currentFallbackAudio) { currentFallbackAudio.pause(); currentFallbackAudio = null; }
                playNextFallback(false, true); // Clean restart for sync
            } else if (currentFallbackAudio) {
                currentFallbackAudio.play();
            } else {
                window.speechSynthesis.resume();
            }
            if (playPauseBtn) playPauseBtn.innerText = "Pause ⏸";
        } else {
            // PAUSE
            isPaused = true;
            if (isEmotionModeActive) {
                window.speechSynthesis.pause();
                if (currentFallbackAudio) currentFallbackAudio.pause();

                // TRACK PROGRESS: Save the exact spot where we were paused
                if (lastEmotionItem && typeof lastEmotionItemProgress !== 'undefined' && lastEmotionItemProgress > 0) {
                    console.log("Saving resume point at offset:", lastEmotionItemProgress);
                    lastEmotionItem.text = lastEmotionItem.text.substring(lastEmotionItemProgress).trim();
                    lastEmotionItem.offset += lastEmotionItemProgress;
                    lastEmotionItemProgress = 0; // Reset for next use
                }
                window.speechSynthesis.cancel(); // Necessary for clean restart later
            } else if (currentFallbackAudio) {
                currentFallbackAudio.pause();
            } else {
                window.speechSynthesis.pause();
            }
            if (playPauseBtn) playPauseBtn.innerText = "Resume ▶";
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
            
            // 🚀 High-Performance Lookup: Use our cached map instead of walking the whole tree
            let absoluteIndex = -1;
            if (globalTextNodes && globalTextNodes.length > 0) {
                // Find node index in cache
                const nodeIdx = globalTextNodes.indexOf(targetNode);
                if (nodeIdx !== -1) {
                    absoluteIndex = globalNodeOffsets[nodeIdx] + offset;
                }
            }
            
            if (absoluteIndex !== -1) {
                // Find beginning of clicked word
                while (absoluteIndex > 0 && /\S/.test(globalReadingText[absoluteIndex - 1])) {
                    absoluteIndex--;
                }
                
                // Jump the reading instantly
                resumeReadingFromIndex(absoluteIndex, false);
            }
        });

        reader.addEventListener('scroll', () => {
            if (totalPages <= 0) return;
            const pages = reader.querySelectorAll('.lazy-page-container');
            let currentPage = 1;
            let minDiff = Infinity;
            
            const readerRect = reader.getBoundingClientRect();
            
            pages.forEach((page, index) => {
                const rect = page.getBoundingClientRect();
                const diff = Math.abs(rect.top - readerRect.top);
                if (diff < minDiff) {
                    minDiff = diff;
                    currentPage = index + 1;
                }
            });
            
            const input = document.getElementById('currentPageInput');
            if (input && document.activeElement !== input) {
                input.value = currentPage;
            }
        });
    }
});

function updatePagesList() {
    const currentPageInput = document.getElementById('currentPageInput');
    const totalPagesLabel = document.getElementById('totalPagesLabel');
    const pageControls = document.querySelector('.page-controls');

    if (totalPages > 0) {
        if (pageControls) pageControls.style.display = 'flex';
        if (totalPagesLabel) totalPagesLabel.innerText = `/ ${totalPages}`;
        if (currentPageInput) {
            currentPageInput.max = totalPages;
            currentPageInput.value = 1;
        }
    } else {
        if (pageControls) pageControls.style.display = 'none';
        if (totalPagesLabel) totalPagesLabel.innerText = '/ 0';
    }
}

function jumpToPage(pageNumber) {
    if (!pageNumber || pageNumber < 1 || pageNumber > totalPages) return;
    const targetPage = document.getElementById(`pdf-page-${pageNumber - 1}`);
    if (targetPage) {
        targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}



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
    utterance.rate = currentSpeed;
    
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
    // Enhanced regex to preserve Unicode letters/numbers across all languages (Tamil, Hindi, etc.)
    let word = isPhrase ? selectedText.trim() : words[0].replace(/[.,!?;:()"'«»]/g, '').trim();
    
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
        const currentLang = getSelectedLanguage();
        const langCode = currentLang.split('-')[0].toLowerCase();

        // If it's a phrase, skip the external dictionary and go straight to AI
        if (isPhrase) {
            body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
                <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
                ✨ AI searching book in ${langCode}...
            </div>`;
            askAIDefinition(word, body, currentLang);
            return;
        }

        // Only use the public Dictionary API for supported languages (mostly English, Hindi, etc.)
        const supportedDictLangs = ['en', 'hi', 'es', 'fr', 'ja', 'ru', 'de', 'it', 'ko', 'ar'];
        if (supportedDictLangs.includes(langCode)) {
            let res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/${langCode}/${encodeURIComponent(word)}`);
            if (res.ok) {
                let data = await res.json();
                if (data && data.length > 0 && data[0].meanings && data[0].meanings.length > 0) {
                    let definition = data[0].meanings[0].definitions[0].definition;
                    body.innerText = definition.charAt(0).toUpperCase() + definition.slice(1);
                    return;
                }
            }
        }
        
        // Fallback to our server-side multilingual definition engine
        body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
            <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
            ✨ AI analyzing ${langCode}...
        </div>`;
        askAIDefinition(word, body, currentLang);
    } catch(e) {
        let body = tooltip.querySelector(".tooltip-body");
        if(body) {
            body.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--primary);">
                <div class="loader-spinner" style="width:14px; height:14px; border:2px solid rgba(139,92,246,0.2); border-top-color:var(--primary); border-radius:50%; animation:spin 1s linear infinite;"></div>
                ✨ AI Fallback...
            </div>`;
            askAIDefinition(word, body, getSelectedLanguage());
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

async function askAIDefinition(word, targetElement, langCode = "en") {
    // If targetElement is a button, handle as before (unlikely now but safe fallback)
    let body = targetElement.tagName === "BUTTON" ? targetElement.parentElement : targetElement;
    
    try {
        let res = await fetch("/define", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                word: word, 
                book_id: currentBookId,
                lang: langCode,
                text: document.getElementById("reader").innerText.substring(0, 60000) // Context
            })
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

function clearSearchHighlights() {
    const highlights = document.querySelectorAll('.find-highlight');
    highlights.forEach(el => {
        const parent = el.parentNode;
        if (parent) {
            while (el.firstChild) {
                el.parentNode.insertBefore(el.firstChild, el);
            }
            el.parentNode.removeChild(el);
        }
    });
    // Removed reader.normalize() here as it hangs on large books.
    // The browser handles fragmentation fine, and we normalize on load if needed.

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
            executeSearch(word);
        }
        return;
    }

    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    searchTimeout = setTimeout(() => {
        if (word.length >= 1 || word === "") {
            executeSearch(word);
        }
    }, 200);
}

function executeSearch(word) {
    // 1. Atomically reset state for the next search task
    searchMatchesFound = 0;
    currentSearchIndex = -1;
    let reader = document.getElementById("reader");
    let countEl = document.getElementById("searchCount");
    
    // 2. Clear current highlights immediately without normalizing every time
    clearSearchHighlights();

    if (word === "") {
        if (countEl) countEl.innerText = "";
        return;
    }

    // 3. Kick off the asynchronous highlighting process
    lastActiveSearchIndex = -1;
    highlightTextInNode(reader, word, 'find-highlight');
}

function scrollToSearchMatch() {
    // 1. Reset previous active highlight without scanning the whole book
    if (lastActiveSearchIndex !== -1) {
        let prevMatch = document.getElementById(`search-match-${lastActiveSearchIndex}`);
        if (prevMatch) {
            prevMatch.style.setProperty('background-color', '#2ecc71', 'important');
            prevMatch.style.setProperty('color', 'white', 'important');
        }
    }

    let currentMatch = document.getElementById(`search-match-${currentSearchIndex}`);
    let countEl = document.getElementById("searchCount");
    if (countEl && searchMatchesFound > 0) {
        countEl.innerText = `${currentSearchIndex + 1} of ${searchMatchesFound}`;
    }

    if (currentMatch) {
        // 2. High-contrast marker for active match with !important to overrule search batch inline styles
        currentMatch.style.setProperty('background-color', '#f97316', 'important');
        currentMatch.style.setProperty('color', 'white', 'important');
        
        lastActiveSearchIndex = currentSearchIndex;
        
        // 3. Vertical-only scroll for search matches
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
    
    // Explicitly remove search highlights from the DOM
    clearSearchHighlights();

    if (currentBookId) {
        // Restore manual highlights and other state
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
    
    // Use the auto-detected language if 'Original' is selected
    if (lang === 'orig') {
        lang = currentBookDetectedLangCode || 'en';
    }
    
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
    
    if (targetLang === 'orig') {
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
            resetReadingSession();
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
    
    reader.normalize(); // Merge adjacent text nodes to prevent "First Letter Only" translation bugs
    let walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, null, false);
    let nodes = [];
    while (walker.nextNode()) {
        let node = walker.currentNode;
        // Aggressive capture: even nodes in OCR fallbacks should be translated for a complete book experience
        if (node.nodeValue.trim().length > 0) {
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
    
    resetReadingSession();
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

    let BATCH_CHAR_LIMIT = 1000;
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
    
    // Process first 5 chunks immediately and in parallel for instant visual feedback
    let initialChunks = chunks.slice(0, 5);
    let backgroundChunks = chunks.slice(5);
    
    let translateRecursive = async (batchNodes, retryCount = 0) => {
        if (batchNodes.length === 0 || window.activeTranslationJob !== currentJob) return;
        
        let batchTexts = batchNodes.map(n => n.nodeValue);
        let separator = " ||| ";
        let joinedText = batchTexts.join(separator);
        let translateApiLang = targetLang.split("-")[0];
        
        try {
            // Delay to avoid 429 Rate Limiting on large batches
            if (retryCount > 0) await new Promise(r => setTimeout(r, 1000 * (retryCount+1)));

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
                
                // Flexible splitting for standard " ||| "
                let translatedTexts = fullTranslation.split(/\s*\|\|\|\s*/);
                translatedTexts = translatedTexts.map(t => t.trim()).filter(t => t.length > 0);

                if (translatedTexts.length === batchNodes.length) {
                    for (let j = 0; j < batchNodes.length; j++) {
                        let cleanText = translatedTexts[j];
                        if (batchNodes[j].nodeValue.match(/\s$/)) cleanText += " ";
                        batchNodes[j].nodeValue = cleanText;
                    }
                } else if (batchNodes.length > 1) {
                    // Parity mismatch: Split into tiny pairs for guaranteed success
                    let mid = Math.floor(batchNodes.length / 2);
                    await Promise.all([
                        translateRecursive(batchNodes.slice(0, mid)),
                        translateRecursive(batchNodes.slice(mid))
                    ]);
                } else if (batchNodes.length === 1) {
                    batchNodes[0].nodeValue = fullTranslation.trim() + (batchNodes[0].nodeValue.match(/\s$/) ? " " : "");
                }
            } else if (res.status === 429 && retryCount < 3) {
                // Rate limited: Wait and retry this exact batch
                await translateRecursive(batchNodes, retryCount + 1);
            } else if (batchNodes.length > 1) {
                // Network error or other: binary split
                let mid = Math.floor(batchNodes.length / 2);
                await Promise.all([
                    translateRecursive(batchNodes.slice(0, mid)),
                    translateRecursive(batchNodes.slice(mid))
                ]);
            }
        } catch (e) {
            console.error("Batch Error:", e);
            if (batchNodes.length > 1) {
                let mid = Math.floor(batchNodes.length / 2);
                await Promise.all([
                    translateRecursive(batchNodes.slice(0, mid)),
                    translateRecursive(batchNodes.slice(mid))
                ]);
            }
        }
    };

    let processChunk = async (batchNodes) => {
        if (window.activeTranslationJob !== currentJob) return;
        await translateRecursive(batchNodes);
        processedCount += batchNodes.length;
    };

    // Await initial screen chunks
    await Promise.all(initialChunks.map(processChunk));
    
    // Instantly reveal first pages and snap the node map to the new translation
    if (window.activeTranslationJob === currentJob) {
        currentBookText = reader.innerHTML;
        titleEl.innerText = originalTitle;
        hideLoader();
        setTimeout(() => rebuildReadingNodeMap(), 50); // Important: Map the new translated structure
    }
    
    // Proper background task pool for maximum throughput
    (async () => {
        const CONCURRENCY_LIMIT = 8;
        let queue = [...backgroundChunks];
        let active = 0;

        async function next() {
            if (queue.length === 0 || window.activeTranslationJob !== currentJob) {
                if (active === 0 && queue.length === 0 && window.activeTranslationJob === currentJob) {
                    // All tasks finished! Final sync and re-normalize
                    titleEl.innerText = originalTitle;
                    hideLoader();
                    
                    // Critical: Re-normalize and rebuild map after full translation 
                    // to ensure highlighting and TTS stay in sync in the new language
                    setTimeout(async () => {
                        await normalizeBookDOM(reader);
                        rebuildReadingNodeMap();
                        currentBookText = reader.innerHTML; // Sync final translated state
                        if (currentBookId) loadHighlights(currentBookId);
                    }, 500);
                }
                return;
            }
            active++;
            let chunk = queue.shift();
            try {
                await processChunk(chunk);
            } finally {
                active--;
                next();
            }
        }

        // Start initial workers
        for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, queue.length); i++) {
            next();
        }

        // Wait for workers to finish then remove loader if not caught by next()
        let checkFinish = setInterval(() => {
            if (active === 0 && queue.length === 0) {
                clearInterval(checkFinish);
                document.getElementById("translationLoader").style.display = "none";
                titleEl.innerText = originalTitle;
            }
        }, 1000);

        // Periodically sync results to currentBookText
        let syncInterval = setInterval(() => {
            if (window.activeTranslationJob !== currentJob) {
                clearInterval(syncInterval);
                return;
            }
            currentBookText = reader.innerHTML;
            if (active === 0 && queue.length === 0) clearInterval(syncInterval);
        }, 5000);
    })();
}

// Global Audio Fallback implementation for unsupported TTS languages 
let currentFallbackAudio = null;
let fallbackQueue = [];

function playFallbackAudioQueue(chunks, startOffset, shortLang, startPaused) {
    fallbackQueue = [];
    let currentAbsOffset = startOffset;
    
    // REDUCED LAG: We no longer pre-fetch the whole book's emotion at once.
    // Instead, we build the queue instantly and fetch emotions lazily.

    chunks.forEach((chunk, chunkIdx) => {
        if (!chunk.trim()) {
            currentAbsOffset += chunk.length;
            return;
        }
        
        let start = 0;
        while (start < chunk.length) {
            let end = start + 195;
            if (end < chunk.length) {
                // Find nearest natural break (. , ! ? ; or newline)
                let breakIdx = -1;
                const naturalBreakers = [". ", "! ", "? ", ", ", "; ", "\n", " "];
                for (let breaker of naturalBreakers) {
                    let found = chunk.lastIndexOf(breaker, end);
                    if (found > start + 50) { 
                        breakIdx = found + breaker.length;
                        break;
                    }
                }
                if (breakIdx !== -1) end = breakIdx;
                else {
                    let lastSpace = chunk.lastIndexOf(' ', end);
                    if (lastSpace > start) end = lastSpace;
                }
            } else {
                end = chunk.length;
            }
            
        // PERFORMANCE: Pre-fetch emotion analysis for the next few chunks
        // This eliminates the 200-500ms delay between sentences!
        let emotionCache = new Map();
        const prefetchEmotion = async (text) => {
            if (emotionCache.has(text)) return emotionCache.get(text);
            try {
                let res = await fetch("/analyze_emotion", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text })
                });
                let data = await res.json();
                emotionCache.set(text, data);
                return data;
            } catch(e) { return 'neutral'; }
        };

        let sc = chunk.substring(start, end).trim();
        if (sc) {
            // Immediately kick off analysis for the current chunk
            prefetchEmotion(sc);

            let url = `/tts?lang=${shortLang}&text=${encodeURIComponent(sc)}&gender=${currentNarratorGender}`;
            
            // LAZY EMOTION: Now uses the pre-fetched cache for instant resolution
            const lazyEmotion = async () => {
                if (!isEmotionModeActive) return 'neutral';
                return prefetchEmotion(sc);
            };


                fallbackQueue.push({ 
                    url, 
                    text: sc, 
                    offset: currentAbsOffset + start,
                    getEmotion: lazyEmotion
                });
            }
            start = end;
        }
        currentAbsOffset += chunk.length;
        
        // LIMIT INITIAL QUEUE: For very large documents, only queue the first 100 sentences instantly.
        // This makes the 'Read Full' button feel instant instead of hanging.
        if (fallbackQueue.length > 100) return;
    });

    if (startPaused) {
        isPaused = true;
    }
    
    // Start playback immediately for zero-lag experience
    playNextFallback(startPaused);
}

// Global state to track the LAST touched node for fast hit-testing
let lastMarkedNodeIndex = 0;


function removeReadingMarks() {
    // 1. Clear Modern Custom Highlights (Zero DOM)
    if (readingHighlight) readingHighlight.clear();
    if (sentenceHighlight) sentenceHighlight.clear();

    // 2. Clear Active Glow Containers
    document.querySelectorAll('.reading-active-container').forEach(el => {
        el.classList.remove('reading-active-container');
    });


    // 2. Clear Legacy Spans (If any)
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

function highlightReadingWord(absoluteWordPosition, charLength, sentenceStart = -1, sentenceLength = -1) {
    if (!globalTextNodes || globalTextNodes.length === 0) rebuildReadingNodeMap();
    
    // 1. Clear current marks
    if (readingHighlight) readingHighlight.clear();
    if (sentenceHighlight) sentenceHighlight.clear();
    
    // 2. Fallback Glows
    document.querySelectorAll('.reading-active-container').forEach(el => el.classList.remove('reading-active-container'));

    let startChar = absoluteWordPosition;
    let endChar = absoluteWordPosition + charLength;
    
    let sStart = sentenceStart;
    let sEnd = sentenceStart + sentenceLength;

    let foundAny = false;

    if (globalTextNodes && globalTextNodes.length > 0) {
        let startAt = (typeof lastMarkedNodeIndex !== 'undefined' && lastMarkedNodeIndex < globalTextNodes.length && globalNodeOffsets[lastMarkedNodeIndex] <= startChar) ? lastMarkedNodeIndex : 0;
        
        for (let i = startAt; i < globalTextNodes.length; i++) {
            let nodeStart = globalNodeOffsets[i];
            let node = globalTextNodes[i];
            if (!node || !node.nodeValue) continue;
            let nodeLen = node.nodeValue.length;
            let nodeEnd = nodeStart + nodeLen;

            if (nodeEnd > sStart && nodeStart < sEnd && sentenceHighlight && sStart !== -1) {
                try {
                    let sRange = new Range();
                    sRange.setStart(node, Math.max(0, sStart - nodeStart));
                    sRange.setEnd(node, Math.min(nodeLen, sEnd - nodeStart));
                    sentenceHighlight.add(sRange);
                } catch(e) {}
            }

            if (nodeEnd > startChar && nodeStart < endChar) {
                foundAny = true;
                lastMarkedNodeIndex = i;
                try {
                    let range = new Range();
                    // VISUAL PADDING: Expand the highlight slightly to ensure it fully 'wraps' the word
                    // even with custom kerning or italic fonts.
                    range.setStart(node, Math.max(0, startChar - nodeStart));
                    range.setEnd(node, Math.min(nodeLen, endChar - nodeStart));

                    
                    if (readingHighlight) readingHighlight.add(range);

                    // HIGH VISIBILITY GLOW: Apply to the parent container for extra clarity
                    if (node.parentNode) {
                        node.parentNode.classList.add('reading-active-container');
                        node.parentNode.style.setProperty('--current-reading-color', 'var(--reading-mark)');
                    }

                    // SMOOTH SCROLLING: Keep the active word centered in view
                    if (!window.lastAutoScrollTime || Date.now() - window.lastAutoScrollTime > 2000) {
                        let rect = range.getBoundingClientRect();
                        let reader = document.getElementById("reader");
                        let readerRect = reader.getBoundingClientRect();
                        
                        // Check if word is outside the middle 40% of the screen
                        const threshold = reader.clientHeight * 0.3;
                        if (rect.top < readerRect.top + threshold || rect.top > readerRect.bottom - threshold) {
                            let targetY = reader.scrollTop + rect.top - readerRect.top - (reader.clientHeight / 2);
                            reader.scrollTo({ top: targetY, behavior: 'smooth' });
                            window.lastAutoScrollTime = Date.now();
                        }
                    }
                } catch(e) {}
            }

            if (nodeStart >= endChar) break;
        }
    }

    // SELF-HEALING: If no word found, map drifted (Translation/Edit occurred). Reset and Rebuild.
    if (!foundAny && !window._rebuildingMap && globalReadingText && startChar < globalReadingText.length) {
        window._rebuildingMap = true;
        rebuildReadingNodeMap();
        setTimeout(() => { 
            window._rebuildingMap = false; 
            highlightReadingWord(absoluteWordPosition, charLength); 
        }, 50);
    }
}


function playNextFallback(startPaused = false, isRetry = false) {
    const entryJobId = currentNarrationJobId;

    if (!isReadingAloud || isPaused) return;

    if (fallbackQueue.length === 0 && !window.speechSynthesis.speaking && !isRetry) {
        if (currentAbsoluteCharIndex < globalReadingText.length - 10) {
            // LOAD NEXT CHUNK: Continues the stream seamlessly
            console.log("Queue low, loading next segment from:", currentAbsoluteCharIndex);
            resumeReadingFromIndex(currentAbsoluteCharIndex);
        } else {
            stopReading(true);
        }
        return;
    }


    let item = (isRetry && lastEmotionItem) ? lastEmotionItem : fallbackQueue.shift();
    lastEmotionItem = item;

    if (!item) return;

    currentAbsoluteCharIndex = getSafeResumeIndex(globalReadingText || "", item.offset);
    removeReadingMarks();

    window.speechSynthesis.cancel();
    const jobId = entryJobId;

    // JIT EMOTION: Fetch emotion only when we are about to play this chunk to cut initial lag
    let ePromise = item.getEmotion ? item.getEmotion() : (item.emotionPromise || Promise.resolve('neutral'));
    
    ePromise.then(res => {
        if (jobId !== currentNarrationJobId || !isReadingAloud) return;

        const emotion = (typeof res === 'string') ? res : (res.emotion || 'neutral');
        updateReaderMood(emotion);

        // SEQUENTIAL PRE-FETCH: Fetch the next chunk's emotion while current one plays
        if (fallbackQueue.length > 0) {
            const nextItem = fallbackQueue[0];
            if (!nextItem.emotionPromise && nextItem.getEmotion) {
                nextItem.emotionPromise = nextItem.getEmotion();
            }
        }

        const targetLang = getSelectedLanguage() || 'en-US';
        const shortLang = targetLang.split("-")[0].toLowerCase();
        const voices = window.speechSynthesis.getVoices();
        let nativeVoice = getBestVoice(voices, targetLang);

        if (nativeVoice) {
            let utterance = new SpeechSynthesisUtterance(item.text);
            currentEmotionUtterance = utterance;
            utterance.lang = nativeVoice.lang;
            utterance.voice = nativeVoice;

            let basePitch = 1.0;
            if (currentNarratorGender === 'male') {
                basePitch = isVoiceActuallyMale(nativeVoice) ? 0.82 : 0.72;
            } else {
                basePitch = isVoiceActuallyMale(nativeVoice) ? 1.08 : 1.0;
            }

            if (emotion === 'happy') {
                utterance.pitch = basePitch * 1.08;
                utterance.rate = 1.05 * currentSpeed;
            } else if (emotion === 'excited') {
                utterance.pitch = basePitch * 1.15;
                utterance.rate = 1.10 * currentSpeed;
            } else if (emotion === 'sad') {
                utterance.pitch = basePitch * 0.85;
                utterance.rate = 0.90 * currentSpeed;
            } else if (emotion === 'angry') {
                utterance.pitch = basePitch * 0.92;
                utterance.rate = 1.05 * currentSpeed;
            } else if (emotion === 'fear') {
                utterance.pitch = basePitch * 1.10;
                utterance.rate = 0.95 * currentSpeed;
            } else if (emotion === 'peaceful') {
                utterance.pitch = basePitch * 0.95;
                utterance.rate = 0.85 * currentSpeed;
            } else {
                utterance.pitch = basePitch;
                utterance.rate = 1.0 * currentSpeed;
            }

            let boundaryReceived = false;
            let utteranceStartTime = Date.now();

            utterance.onboundary = (event) => {
                if (jobId !== currentNarrationJobId || event.name === 'sentence') return;
                boundaryReceived = true;
                currentAbsoluteCharIndex = item.offset + event.charIndex;
                highlightReadingWord(item.offset + event.charIndex, event.charLength || 5);
                
                // Real-time Reading Progress in the Badge
                const progEl = document.getElementById("readingProgress");
                if (progEl && globalReadingText) {
                    const prog = Math.round((currentAbsoluteCharIndex / globalReadingText.length) * 100);
                    progEl.innerText = `| ${prog}% Read`;
                }

            };

            utterance.onstart = () => {
                if (jobId !== currentNarrationJobId) return;
                utteranceStartTime = Date.now();

                let words = [];
                let regex = /[\p{L}\p{N}\p{M}]+/gu; 
                let match;
                while ((match = regex.exec(item.text)) !== null) {
                    words.push({
                        startOffset: item.offset + match.index,
                        length: match[0].length
                    });
                }
                if (words.length === 0 && item.text.length > 0) {
                    words.push({ startOffset: item.offset, length: item.text.length });
                }

                // HIGH-PRECISION ESTIMATION LOOP: Used if onboundary isn't firing
                const totalChars = item.text.length;
                const speedEstimate = (15 * (utterance.rate || 1.0)) / 1000; // chars per ms
                
                let hIn = setInterval(() => {
                    if (jobId !== currentNarrationJobId || boundaryReceived || !isReadingAloud || isPaused) {
                        clearInterval(hIn);
                        return;
                    }

                    let elapsed = Date.now() - utteranceStartTime;
                    const estimatedPos = Math.min(totalChars, elapsed * speedEstimate);
                    
                    let bestWord = words[0];
                    for (let w of words) {
                        if (w.startOffset - item.offset <= estimatedPos) bestWord = w;
                        else break;
                    }

                    if (bestWord) {
                        currentAbsoluteCharIndex = bestWord.startOffset;
                        highlightReadingWord(bestWord.startOffset, bestWord.length);
                    }
                    if (estimatedPos >= totalChars) clearInterval(hIn);
                }, 50);
            };

            utterance.onend = () => {
                if (jobId !== currentNarrationJobId) return;
                removeReadingMarks();
                if (isReadingAloud && !isPaused) playNextFallback();
            };

            utterance.onerror = () => {
                if (jobId === currentNarrationJobId) {
                    setTimeout(() => playNextFallback(false, false), 500);
                }
            };

            window.speechSynthesis.speak(utterance);
        } else {
            let url = `/tts?lang=${shortLang}&text=${encodeURIComponent(item.text.trim())}&gender=${currentNarratorGender}`;
            let audio = new Audio(url);
            currentFallbackAudio = audio;

            // Ensure AudioContext is resumed on user interaction
            const ctx = getAudioContext();
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            // HIGH-FIDELITY NEURAL ENGINE: The new Node.js worker provides perfectly mastered voices.
            // Artificial resonators are disabled to preserve the natural neural clarity.
            try {
                const ctx = getAudioContext();
                const source = ctx.createMediaElementSource(audio);
                source.connect(ctx.destination); 
            } catch (e) {
                console.warn("AudioContext already attached or error:", e);
            }

            if (emotion === 'happy') audio.playbackRate = 1.05 * currentSpeed;
            else if (emotion === 'excited') audio.playbackRate = 1.15 * currentSpeed;
            else if (emotion === 'sad') audio.playbackRate = 0.85 * currentSpeed;
            else if (emotion === 'angry') audio.playbackRate = 1.1 * currentSpeed;
            else if (emotion === 'fear') audio.playbackRate = 0.9 * currentSpeed;
            else if (emotion === 'peaceful') audio.playbackRate = 0.8 * currentSpeed;
            else audio.playbackRate = 1.0 * currentSpeed;


            // Prevent audio clipping at high speeds
            audio.preservesPitch = false; 

            let words = [];
            // UNICODE TOKENIZER: Captures words for ALL scripts (Hindi, Tamil, Arabic, etc.)
            // We split by any character that is NOT a word constituent, preserving script boundaries.
            let regex = /[\p{L}\p{N}\p{M}]+/gu; 
            let match;
            while ((match = regex.exec(item.text)) !== null) {
                words.push({
                    startOffset: item.offset + match.index,
                    length: match[0].length
                });
            }

            // SAFETY: In case of empty word list (scripts like Thai/Chinese)
            if (words.length === 0 && item.text.length > 0) {
                words.push({ startOffset: item.offset, length: item.text.length });
            }

            const totalChunkLength = item.text.length;

            const syncHighlight = () => {
                if (jobId !== currentNarrationJobId || !isReadingAloud || isPaused || !currentFallbackAudio) {
                    return;
                }

                // STREAMING SYNC: Handle cases where duration is not yet known (streaming audio)
                let duration = audio.duration;
                // If duration is missing (streaming mode), estimate it using standard neural speech rates 
                // (approx 14 chars/sec) to ensure highlight starts appearing immediately.
                if (isNaN(duration) || duration === Infinity || duration <= 0) {
                    duration = totalChunkLength / (14 * audio.playbackRate); 
                }

                if (audio.currentTime > 0) {
                    let progress = audio.currentTime / duration;
                    if (progress > 1.0) progress = 1.0;
                    if (progress >= 0.999) return;

                    let currentPosInChunk = progress * totalChunkLength;
                    
                    let foundWord = words[0];
                    for (let w of words) {
                        if (w.startOffset - item.offset <= currentPosInChunk) {
                            foundWord = w;
                        } else {
                            break;
                        }
                    }



                    if (foundWord) {
                        lastEmotionItemProgress = foundWord.startOffset - item.offset;
                        currentAbsoluteCharIndex = foundWord.startOffset;
                        highlightReadingWord(foundWord.startOffset, foundWord.length, item.offset, item.text.length);
                    }
                }

                requestAnimationFrame(syncHighlight);
            };

            audio.onplay = () => {
                if (jobId !== currentNarrationJobId) return;
                requestAnimationFrame(syncHighlight);
            };

            audio.onended = () => {
                if (jobId !== currentNarrationJobId) return;
                removeReadingMarks();
                if (isReadingAloud && !isPaused) playNextFallback();
            };

            audio.onerror = () => {
                if (jobId === currentNarrationJobId) {
                    setTimeout(() => playNextFallback(false, false), 500);
                }
            };

            audio.play().catch(() => {
                if (jobId === currentNarrationJobId) {
                    setTimeout(() => playNextFallback(false, false), 500);
                }
            });
        }
    }).catch(() => {
        updateReaderMood('neutral');
        if (isReadingAloud && !isPaused) {
            setTimeout(() => playNextFallback(false, false), 300);
        }
    });
}

function updateReaderMood(emotion) {
    const reader = document.getElementById('reader');
    if (!reader) return;
    
    // Color changes disabled by user request. 
    // We only manage vocal parameters (pitch/rate) now for a cleaner UI.
    
    // Subtly adjust TTS pitch/rate if possible (Web Speech API)
    if (typeof utterance !== 'undefined' && utterance) {
        if (emotion === 'happy') { utterance.pitch = 1.8; utterance.rate = 1.4 * currentSpeed; }
        else if (emotion === 'excited') { utterance.pitch = 2.0; utterance.rate = 1.8 * currentSpeed; }
        else if (emotion === 'sad') { utterance.pitch = 0.3; utterance.rate = 0.4 * currentSpeed; }
        else if (emotion === 'angry') { utterance.pitch = 0.6; utterance.rate = 1.9 * currentSpeed; }
        else if (emotion === 'fear') { utterance.pitch = 2.0; utterance.rate = 0.6 * currentSpeed; }
        else if (emotion === 'peaceful') { utterance.pitch = 0.8; utterance.rate = 0.7 * currentSpeed; }
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
    let reader = document.getElementById("reader");
    
    // Trigger folding shut animation
    if (reader) {
        reader.classList.add('folding-exit');
        // Wait for the animation to finish
        await new Promise(r => setTimeout(r, 600));
    }

    window.speechSynthesis.cancel();
    if (currentFallbackAudio) {
        currentFallbackAudio.pause();
        currentFallbackAudio = null;
    }
    isReadingAloud = false;
    isPaused = false;
    let playPauseBtn = document.getElementById("playPauseBtn");
    if(playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

    if (reader) {
        reader.style.opacity = "1";
        reader.innerHTML = "";
        
        let thankYou = document.getElementById("thankYouState");
        if (thankYou) {
            thankYou.style.display = "block";
            reader.appendChild(thankYou);
        }
        reader.classList.remove('folding-exit');
    }
    
    document.getElementById("booktitle").innerText = "Select a book from your library";
    currentBookId = null;
    currentBookText = "";
    totalPages = 0;
    updatePagesList();
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
    return; // Feature disabled: User requested reading from explicitly extracted bottom text exclusively
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
                
                // CRITICAL: Insert a physical space node into the DOM so the TreeWalker parses words separately
                layer.appendChild(document.createTextNode(" "));
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
    lastActiveRange = range.cloneRange(); // Cache for persistent tools
    
    // 2. High-Performance Intersection Check
    // Only check OCR words that are within the selected container to avoid O(N) slowdown
    let container = range.commonAncestorContainer;
    if (container.nodeType === 3) container = container.parentNode;
    
    // Scan locally first, then go wider if needed
    let locallyMatched = container.querySelectorAll ? container.querySelectorAll(".ocr-word") : [];
    
    locallyMatched.forEach(span => {
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
        let rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
        
        if (rect && (rect.width > 0 || rect.height > 0)) {
            toolbar.style.display = "flex";
            // Important: Use window.scrollY if the reader isn't the offset parent
            toolbar.style.top = (rect.top + window.scrollY - 55) + "px";
            toolbar.style.left = (rect.left + rect.width/2 - toolbar.offsetWidth/2) + "px";
            
            if (parseFloat(toolbar.style.top) < 10) {
                toolbar.style.top = (rect.bottom + window.scrollY + 10) + "px";
            }
        } else {
            toolbar.style.display = "none";
        }
    }
});


let currentZoom = 1.0;

function changeZoom(delta) {
    currentZoom = Math.min(Math.max(0.5, currentZoom + delta), 2.5);
    applyZoom();
}

function applyZoom() {
    let reader = document.getElementById("reader");
    let zoomDisplay = document.getElementById("zoomLevel");
    
    if (zoomDisplay) {
        zoomDisplay.innerText = Math.round(currentZoom * 100) + "%";
    }

    // CONTENT-ONLY ZOOM: Scaled the text and internal elements without resizing the container
    reader.style.setProperty('--zoom-level', currentZoom);
    
    // Update pannable cursor state after zoom changes
    if (typeof updatePannableState === 'function') {
        setTimeout(updatePannableState, 100);
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

        // If user is already selecting, don't start dragging
        const selection = window.getSelection();
        if (selection.toString().length > 0) {
            isDown = false;
            moved = false;
            reader.classList.remove('grabbing');
            return;
        }

        // Only start dragging after moving significant distance to differentiate from selection start
        if (!moved && Math.abs(dx) < 15 && Math.abs(dy) < 15) return;

        // If it was a text node and we haven't selected yet, we give selection one more chance
        if (!moved && (e.target.nodeType === 3 || e.target.closest('p, div[style*="font-size"], .ocr-word'))) {
             // If we really moved far but no selection, then it's a drag
             if (Math.abs(dx) < 25 && Math.abs(dy) < 25) return;
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

// Intercept image clicks for explanation
document.addEventListener('click', function(e) {
    if (!e.target) return;
    
    // Check if target is an img, or a child of an img-ocr-wrapper
    let imgElement = null;
    if (e.target.tagName && e.target.tagName.toLowerCase() === 'img') {
        imgElement = e.target;
    } else {
        // Did user click on an OCR word or the layer over an image?
        let wrapper = e.target.closest('.img-ocr-wrapper');
        if (wrapper) {
            imgElement = wrapper.querySelector('img');
        }
    }

    if (imgElement && imgElement.closest('#reader')) {
        // Only trigger explanation if not selecting text or clicking specifically on a word to highlight it
        if (e.target.closest('.ocr-word') || window.getSelection().toString().trim().length > 0) return;
        
        explainImage(imgElement);
    }
});

function explainImage(imgElement) {
    let src = imgElement.src;
    if (!src) return;

    // Show preview and loading state
    const preview = document.getElementById('imageExplanationPreview');
    const previewContainer = document.getElementById('imageExplanationPreviewContainer');
    const textEl = document.getElementById('imageExplanationText');
    const modal = document.getElementById('imageExplanationModal');

    preview.src = src;
    previewContainer.style.display = 'block';
    textEl.innerHTML = "<div class='ai-loading-container'><span class='pulse-dot'></span> <span style='color: var(--text-light); opacity: 0.8;'>AI is analyzing this visual...</span></div>";
    modal.style.display = 'flex';

    // Capture surrounding text context to help AI understand
    let contextText = "";
    let parent = imgElement.parentElement;
    if (parent) {
        let contentStr = parent.textContent.trim();
        if (contentStr.length < 50) {
            let prev = imgElement.closest('.pdf-img-top')?.previousElementSibling || parent.previousElementSibling;
            if (prev) contextText += prev.innerText + " ";
            let next = imgElement.closest('.pdf-text-bottom')?.nextElementSibling || parent.nextElementSibling;
            if (next) contextText += " " + next.innerText;
        } else {
            contextText = contentStr;
        }
    }
    contextText = contextText.trim().substring(0, 1500);

    fetch("/explain_image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            src: src, 
            book_id: currentBookId,
            context: contextText
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.explanation) {
            typeWriterEffect(textEl, data.explanation);
        } else if (data.error) {
            textEl.innerHTML = `<span style="color: #ef4444; font-weight: 500;">❌ Analysis Failed: ${data.error}</span>`;
        } else {
            textEl.innerText = "The AI couldn't formulate a clear explanation for this image. Try another section.";
        }
    })
    .catch(err => {
        console.error("Explain image error:", err);
        textEl.innerHTML = `<span style="color: #ef4444; font-weight: 500;">🔌 Network Error: Check your server connection.</span>`;
    });
}

function typeWriterEffect(element, text) {
    element.innerText = "";
    let i = 0;
    const speed = 10; // ms per char
    
    function type() {
        if (i < text.length) {
            element.innerText += text.charAt(i);
            i++;
            element.scrollTop = element.scrollHeight;
            setTimeout(type, speed);
        }
    }
    type();
}

// --- SMART VOICE ASSISTANT (AI MODE) ---

let isVoiceAssistantActive = false;
let recognition = null;

function initVoiceAssistant() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error("Speech recognition not supported in this browser.");
        return null;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isVoiceAssistantActive = true;
        document.getElementById('voiceBtn').classList.add('active');
        document.getElementById('voiceStatus').style.display = 'flex';
        document.getElementById('voiceTranscript').innerText = "Listening...";
    };

    recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
        }
        document.getElementById('voiceTranscript').innerText = transcript;
        
        if (event.results[0].isFinal) {
            processVoiceCommand(transcript.toLowerCase());
        }
    };

    recognition.onend = () => {
        isVoiceAssistantActive = false;
        document.getElementById('voiceBtn').classList.remove('active');
        setTimeout(() => {
            if (!isVoiceAssistantActive) {
                document.getElementById('voiceStatus').style.display = 'none';
            }
        }, 3000);
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        stopVoiceAssistant();
    };

    return recognition;
}

function toggleVoiceAssistant() {
    console.log("Toggle AI Mic. Current Active State:", isVoiceAssistantActive);
    if (isVoiceAssistantActive) {
        stopVoiceAssistant();
    } else {
        startVoiceAssistant();
    }
}

function startVoiceAssistant() {
    if (!recognition) initVoiceAssistant();
    if (!recognition) return;

    if (isVoiceAssistantActive) return; // Already active, safety check
    
    isVoiceAssistantActive = true; 
    window.speechSynthesis.cancel(); // Stop talking to listen
    
    try {
        recognition.start();
    } catch(e) { 
        console.warn("Recognition start error:", e);
        isVoiceAssistantActive = false;
        document.getElementById('voiceBtn').classList.remove('active');
    }
}

function stopVoiceAssistant() {
    isVoiceAssistantActive = false;
    if (recognition) {
        try {
            recognition.stop();
        } catch(e) { console.error("Error stopping recognition:", e); }
    }
    
    // UI Cleanup
    document.getElementById('voiceBtn').classList.remove('active');
    document.getElementById('voiceStatus').style.display = 'none';
    window.speechSynthesis.cancel(); // Stop AI talking as well
     
}

async function processVoiceCommand(command) {
    console.log("AI Assistant received:", command);
    
    // 1. Intent: Open Book by Name
    let matchedBook = activeBooksList.find(b => 
        (b[3] === "ready" || !b[3]) && 
        (command.includes(b[1].toLowerCase()) || command.includes(b[1].toLowerCase().replace('.pdf','').replace('.epub','').replace('.docx','')))
    );

    if (matchedBook && (command.includes("open") || command.includes("load") || command.split(' ').length < 5)) {
        document.getElementById('voiceTranscript').innerText = "Opening " + matchedBook[1] + "...";
        openBook(matchedBook[0]);
        return;
    }
    
    // 2. Intent: Contextual Analysis (Dictionary Meaning)
    if (command.includes("meaning") || command.includes("what is") || command.includes("explain")) {
        handleAIQuery(command, "meaning");
    } else if (command.includes("summarize") || command.includes("chapter") || command.includes("book")) {
        handleAIQuery(command, "summarize");
    } else if (command.includes("read") || command.includes("play") || command.includes("start reading")) {
        document.getElementById('voiceTranscript').innerText = "Starting reading...";
        if (typeof togglePlayPause === 'function') {
            togglePlayPause();
        } else if (typeof readSelectedText === 'function') {
            readSelectedText();
        }
    } else if (command.includes("stop") || command.includes("pause") || command.includes("quiet")) {
        document.getElementById('voiceTranscript').innerText = "Stopping...";
        stopReading();
    } else {
        document.getElementById('voiceTranscript').innerText = "Processing question...";
        handleAIQuery(command, "general");
    }
}

async function handleAIQuery(query, type) {
    let context = window.getSelection().toString() || "";
    const reader = document.getElementById('reader');
    
    // Unify lookup logic for 'meaning' or 'explain' intents
    if (type === "meaning" || type === "explain") {
        let targetWord = context.trim();
        if (!targetWord) {
            // Extraction regex for voice commands like "what is the meaning of [word]"
            let wordMatch = query.match(/(?:meaning of|what is|define|explain|meaning for|meaning)\s+([\w\u0080-\uFFFF]+)/i);
            if (wordMatch && wordMatch[1]) targetWord = wordMatch[1];
        }

        if (targetWord) {
            document.getElementById('voiceTranscript').innerText = "Searching meaning of '" + targetWord + "'...";
            try {
                let res = await fetch("/define", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        word: targetWord, 
                        book_id: currentBookId,
                        lang: getSelectedLanguage().split('-')[0].toLowerCase(),
                        text: reader ? reader.innerText.substring(0, 50000) : ""
                    })
                });
                let data = await res.json();
                if (data.answer) {
                    document.getElementById('voiceTranscript').innerText = "📖 Meaning: " + data.answer;
                    speakAIResponse(data.answer);
                    return;
                }
            } catch(e) { console.error("Meaning lookup failed:", e); }
        }
    }

    if (!context && typeof currentAbsoluteCharIndex !== 'undefined') {
        if (reader) context = reader.innerText.substring(0, 1500); // Grab current view context
    }

    try {
        const response = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                context: context,
                book_id: (typeof currentBookId !== 'undefined') ? currentBookId : null
            })
        });

        const data = await response.json();
        if (data.answer) {
            document.getElementById('voiceTranscript').innerText = "🤖 AI: " + data.answer;
            speakAIResponse(data.answer);
        }
    } catch (e) {
        console.error("AI Assistant query failed:", e);
        document.getElementById('voiceTranscript').innerText = "Sorry, I couldn't reach the AI Assistant.";
    }
}

function speakAIResponse(text) {
    window.speechSynthesis.cancel();
    let utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.1; // Slightly higher AI voice
    
    // Find a clear natural voice
    const voices = window.speechSynthesis.getVoices();
    let aiVoice = voices.find(v => v.name.includes("Google") && v.lang.startsWith("en")) || 
                  voices.find(v => v.name.includes("Natural")) ||
                  voices.find(v => v.lang.startsWith("en-US"));
                  
    if (aiVoice) utterance.voice = aiVoice;
    
    utterance.onend = () => {
    };
    window.speechSynthesis.speak(utterance);
}


