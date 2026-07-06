let currentBookId = null;
let currentRoom = null;
let isRemoteScrolling = false;
let socket = null;
try {
    socket = io();
    socket.on('connect', () => {
        const up = new URLSearchParams(window.location.search);
        if (up.get('room')) {
            currentRoom = up.get('room');
            socket.emit('join_room', { room: currentRoom });
        }
    });
    socket.on('remote_scroll', (d) => {
        if (!d.page_id || isRemoteScrolling) return;
        isRemoteScrolling = true;
        const rd = document.getElementById('reader'), tg = document.getElementById(d.page_id);
        if (tg && rd) {
            const cb = rd.getBoundingClientRect(), pb = tg.getBoundingClientRect();
            rd.scrollTo({ top: pb.top - cb.top + rd.scrollTop + (d.scroll_top || 0), behavior: 'smooth' });
        }
        setTimeout(() => { isRemoteScrolling = false; }, 800);
    });
    socket.on('user_joined', () => { showUploadToast("👋 A friend joined!", "info"); });

    // Sync Scroll
    window.addEventListener('load', () => {
        const reader = document.getElementById('reader');
        if (reader) {
            let st;
            reader.addEventListener('scroll', () => {
                if (currentRoom && !isRemoteScrolling) {
                    clearTimeout(st);
                    st = setTimeout(() => {
                        const pages = document.querySelectorAll('.lazy-page-container');
                        let tid = null; let md = 99999;
                        pages.forEach(p => {
                            const b = p.getBoundingClientRect();
                            if (Math.abs(b.top) < md) { md = Math.abs(b.top); tid = p.id; }
                        });
                        if (tid) socket.emit('scroll_sync', { room: currentRoom, page_id: tid, scroll_top: 0 });
                    }, 300);
                }
            });
            setTimeout(() => { isRemoteScrolling = false; }, 800);
        }
        initSidebarResize();
    });
} catch (e) { }

// Global listener to dismiss mobile dashboard summaries when clicking outside
document.addEventListener('click', (e) => {
    if (window.innerWidth < 992 && !e.target.closest('.book-card')) {
        document.querySelectorAll('.book-card.mobile-active').forEach(card => {
            card.classList.remove('mobile-active');
        });
    }
});

let currentBookName = "";
let goalCelebrated = false;
let currentBookText = "";
let currentBookDetectedLangCode = "en";
let activeBooksList = [];
let currentSpeed = 1.0;
let studySessionStartTime = null;
let initialStudyTime = 0;
let studyTimerInterval = null;

function startStudyTimer(startTimeInSeconds = 0) {
    initialStudyTime = startTimeInSeconds;
    studySessionStartTime = Date.now();
    const timerEl = document.getElementById("studyTimer");
    if (timerEl) {
        timerEl.style.display = "inline";
        updateStudyTimer(); // initial update
        if (studyTimerInterval) clearInterval(studyTimerInterval);
        studyTimerInterval = setInterval(updateStudyTimer, 1000);
    }
}

function updateStudyTimer() {
    if (!studySessionStartTime) return;
    const overlay = document.getElementById("dashboardOverlay");
    if (overlay && overlay.style.display === "flex") return;

    const sessionElapsed = Math.floor((Date.now() - studySessionStartTime) / 1000);
    const totalElapsed = initialStudyTime + sessionElapsed;

    const hrs = Math.floor(totalElapsed / 3600);
    const mins = Math.floor((totalElapsed % 3600) / 60);
    const secs = totalElapsed % 60;

    const timeStr = [hrs, mins, secs].map(v => v < 10 ? "0" + v : v).join(":");
    const timerEl = document.getElementById("studyTimer");
    if (timerEl) {
        timerEl.innerText = `| ${timeStr}`;
    }
}

function stopStudyTimer() {
    if (studyTimerInterval) clearInterval(studyTimerInterval);
    studyTimerInterval = null;
    studySessionStartTime = null;
    initialStudyTime = 0;
    const timerEl = document.getElementById("studyTimer");
    if (timerEl) {
        timerEl.style.display = "none";
    }
}

// Translation State Tracking
window.activeTranslationObserver = null;
window.activeTranslationJob = 0;
window.currentTargetLang = 'orig';
window.currentReadingNode = null;
window.currentReadingOffsetInNode = 0;
window.currentReadingStopIndex = -1;
window.speechSyncNext = false;

// Preload Storyteller Assets
['girl', 'man'].forEach(c => {
    new Image().src = `/static/storyteller_${c}_transparent.gif`;
    new Image().src = `/static/storyteller_${c}_transparent_static.png`;
});

// REAL-TIME Narrator Control
let currentEmotionUtterance = null;

// --- Study Hub Interface Management ---
function toggleStudyHub() {
    const dropdown = document.getElementById('studyHubDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('active');
}

// --- Settings & Vision Setup UI ---
// Global listener to close dropdowns when clicking outside
window.addEventListener('click', function (e) {
    const hubContainer = document.querySelector('.study-hub-container');
    const hubDropdown = document.getElementById('studyHubDropdown');
    if (hubContainer && !hubContainer.contains(e.target)) {
        if (hubDropdown) hubDropdown.classList.remove('active');
    }
});

// --- Study Notebook Logic (Plain & Clean) ---
function toggleDashboard() {
    const overlay = document.getElementById("dashboardOverlay");
    // Use getComputedStyle for accurate visibility check regardless of CSS !important
    const isVisible = window.getComputedStyle(overlay).display !== 'none';
    
    if (!isVisible) {
        overlay.style.setProperty('display', 'block', 'important'); // Match mobile-first block layout
        const voiceBtn = document.getElementById("voiceBtn");
        if (voiceBtn) voiceBtn.style.display = "none";
        const drawFab = document.getElementById("floatingDrawFab");
        if (drawFab) drawFab.style.display = "none";
        const drawToolbar = document.getElementById("drawingMiniToolbar");
        if (drawToolbar) drawToolbar.style.display = "none";

        const fabGroup = document.getElementById("dashboardFabGroup");
        if (fabGroup) fabGroup.style.display = "flex";
        const footer = document.getElementById("dashboardMiniFooter");
        if (footer) footer.style.display = "flex";
        
        document.body.style.overflow = "hidden"; // Prevent background scrolling
        stopReadingPulse();
        loadBooks();
        fetchUserStreak();
        checkForInvites();
    } else {
        overlay.style.setProperty('display', 'none', 'important');
        const voiceBtn = document.getElementById("voiceBtn");
        if (voiceBtn && currentBookId) voiceBtn.style.display = "flex";
        const drawFab = document.getElementById("floatingDrawFab");
        if (drawFab && currentBookId) drawFab.style.display = "flex";

        const fabGroup = document.getElementById("dashboardFabGroup");
        if (fabGroup) fabGroup.style.display = "none";
        const footer = document.getElementById("dashboardMiniFooter");
        if (footer) footer.style.display = "none";
        
        document.body.style.overflow = ""; // Restore scrolling
        if (typeof stopDashboardPolling === 'function') stopDashboardPolling();
        
        const subModals = ['collabsModal', 'invitationsModal', 'roomModal', 'profileModal'];
        subModals.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        if (currentBookId) startReadingPulse();
    }
}


function renderDashboard(data) {
    console.log("Rendering Dashboard with", data.length, "books");
    const grid = document.getElementById("dashboardGrid");
    const bookmarkTotal = document.getElementById("libraryBookmarkCount");

    if (!grid) return;

    // Reset processing flag for this render pass
    window._hasProcessingBooks = false;

    // Update Global Library Stats
    const totalCount = data.length;
    let globalBookmarks = 0;

    data.forEach(book => {
        globalBookmarks += (book[8] || 0);
    });
    // Update New Snapshot Displays
    const bookCountDisplay = document.getElementById("libraryBookCountDisplay");
    const totalLibTime = document.getElementById("totalLibraryReadTime");

    if (bookCountDisplay) bookCountDisplay.innerText = totalCount;

    if (totalLibTime) {
        let totalSecs = 0;
        data.forEach(b => totalSecs += (b[6] || 0)); // reading_time is index 6
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        totalLibTime.innerText = `${h}h ${m}m`;

        // Also update the global label if it exists
        const globalTimeLabel = document.getElementById("totalReadTimeGlobal");
        if (globalTimeLabel) globalTimeLabel.innerText = `${h}h ${m}m`;
    }
    if (bookmarkTotal) {
        let bookmarkBooks = data.filter(b => (b[8] || 0) > 0);
        let listHtml = `<div style="font-size: 1.15rem; font-weight: 800; color: #ff9f43; margin-bottom: 5px;">${globalBookmarks} 🔖</div>`;

        if (bookmarkBooks.length > 0) {
            listHtml += `<div style="display: flex; flex-direction: column; gap: 4px;">`;
            bookmarkBooks.slice(0, 2).forEach(b => {
                listHtml += `<div style="font-size: 0.75rem; color: var(--text-white); opacity: 0.8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-left: 2px solid #ff9f43; padding-left: 8px;">${b[1]}</div>`;
            });
            if (bookmarkBooks.length > 2) {
                listHtml += `<div style="font-size: 0.7rem; color: var(--text-light); opacity: 0.5; padding-left: 10px; cursor: pointer; text-decoration: underline;" onclick="toggleBookmarksFilter()">+ ${bookmarkBooks.length - 2} more</div>`;
            }
            listHtml += `</div>`;
        } else {
            listHtml += `<div style="font-size: 0.75rem; color: var(--text-light); opacity: 0.5;">No bookmarks yet</div>`;
        }
        bookmarkTotal.innerHTML = listHtml;
    }

    // Optimization: Only clear and rebuild if data is different or if we were empty
    // To prevent the "empty page" scroll flicker, we can compare stringified data
    let dataHash = "";
    try {
        dataHash = JSON.stringify(data);
    } catch (e) {
        console.error("JSON stringify failed in renderDashboard", e);
    }

    if (window._lastDashboardDataHash === dataHash && !onlyBookmarksFilter && !onlyFavoritesFilter && grid.innerHTML.trim() !== "") {
        return; // No changes, skip heavy DOM rebuild
    }
    window._lastDashboardDataHash = dataHash;

    grid.innerHTML = "";

    if (totalCount === 0) {
        grid.innerHTML = `
            <div class="col-12 text-center py-5" style="color: var(--text-light); opacity: 0.6;">
                <span style="font-size: 5rem; display: block; margin-bottom: 20px;">📚</span>
                <h3>Your library is empty</h3>
                <p>Upload your first book to get started!</p>
            </div>
        `;
        return;
    }

    data.forEach(book => {
        // [id, name, uploaded_at, status, thumb, summary, time, is_favorite, bCount, nCount, relation, pageCount, sharerName]
        const [id, name, uploaded_at, status, thumb, summary, time, is_fav, bCount, nCount, relation, pageCount, collabName] = book;

        // Format upload date
        let uploadDateStr = "";
        try {
            const date = new Date(uploaded_at.replace(" ", "T") + "Z");
            uploadDateStr = date.toISOString().split('T')[0]; // Simple YYYY-MM-DD
        } catch (e) { uploadDateStr = (uploaded_at || "").split(" ")[0]; }

        // Clean the name for display
        const cleanName = name.replace(/_/g, ' ')
            .replace(/\.(pdf|epub|docx|txt)$/i, '')
            .split(' ')
            .map(w => w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)
            .join(' ');

        const card = document.createElement("div");
        card.className = "book-card";
        card.setAttribute("data-book-id", id);
        card.setAttribute("data-book-name", name.toLowerCase());
        card.setAttribute("data-is-favourite", is_fav ? "1" : "0");
        card.setAttribute("data-bookmark-count", bCount || 0);

        // Status check: Case-insensitive match for 'processing'
        // Status check: Include 'analyzing' and 'upgrading' to keep the glow active during background OCR
        const sLower = (status || "").toLowerCase();
        const isProcessing = sLower.includes("processing") || sLower.includes("analyzing") || sLower.includes("upgrading") || sLower.includes("extracting");

        console.log(`[Dashboard] Book: ${name} | Status: "${status}" | isProcessing: ${isProcessing}`);

        if (isProcessing) {
            card.classList.add("processing");
            window._hasProcessingBooks = true;
        }

        let thumbContent = `
            <div class="portait-placeholder" style="height:100%; width:100%; display:flex; align-items:center; justify-content:center; background:#eee; color:#aaa;">
                <span style="font-size:3rem;">📖</span>
            </div>
        `;

        if (thumb) {
            thumbContent = `<img src="/thumbnail/${id}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover;">`;
        }

        const indicators = `
            <div class="card-indicators">
                ${isProcessing ? `<span class="status-badge-processing"><i class="fas fa-cog fa-spin"></i> Processing...</span>` : ''}
                ${(status && status !== 'ready' && !isProcessing) ? `<span class="indicator-badge status-badge"><i class="fas fa-cog"></i> ${status}</span>` : ''}
                ${relation === 'shared' ? `<span class="indicator-badge" style="background: rgba(99, 102, 241, 0.15); color: var(--primary); border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; letter-spacing: 0.02em;" title="Collaborated with ${collabName || 'someone'}"><i class="fas fa-users"></i> SHARED</span>` : ''}
                ${bCount > 0 ? `<span class="indicator-badge" title="Has Bookmarks"><i class="fas fa-bookmark"></i> ${bCount}</span>` : ''}
                ${nCount > 0 ? `<span class="indicator-badge" title="Has Study Notes"><i class="fas fa-sticky-note"></i> ${nCount}</span>` : ''}
            </div>
        `;

        // Mobile tap support for summary
        card.onclick = (e) => {
            if (!e.target.closest('button') && window.innerWidth < 992) {
                document.querySelectorAll('.book-card.mobile-active').forEach(c => {
                    if (c !== card) c.classList.remove('mobile-active');
                });
                card.classList.toggle('mobile-active');
                e.stopPropagation();
            }
        };

        card.innerHTML = `
            <button class="btn-favorite ${is_fav ? 'active' : ''}" onclick="toggleFavorite(${id}, this)" title="${is_fav ? 'Unfavorite' : 'Add to Favorites'}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="${is_fav ? '#ef4444' : 'none'}" stroke="${is_fav ? '#ef4444' : 'white'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible;">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
            </button>
            
            <!-- Floating Smart Symbols (Top Left of Image) -->
            <div class="card-smart-indicators" style="position: absolute; top: 12px; left: 12px; display: flex; flex-direction: column; gap: 6px; z-index: 30;">
                ${relation === 'shared_by_me' ? 
                    `<div class="smart-indicator share-to-indicator"><i class="fas fa-share-alt"></i> TO: @${(collabName || 'USER').toUpperCase()}</div>` : ''
                }
                ${relation === 'shared_with_me' ? 
                    `<div class="smart-indicator share-by-indicator"><i class="fas fa-user-friends"></i> BY: @${(collabName || 'OWNER').toUpperCase()}</div>` : ''
                }
                ${bCount > 0 ? `<div class="smart-indicator bookmark-count-indicator"><i class="fas fa-bookmark"></i> ${bCount}</div>` : ''}
                ${nCount > 0 ? `<div class="smart-indicator note-count-indicator"><i class="fas fa-sticky-note"></i> ${nCount}</div>` : ''}
            </div>

            <!-- The Cover (Swings away) -->
            <div class="book-cover-panel" style="height: 210px; border-top-left-radius: 24px; border-top-right-radius: 24px; overflow: hidden; position: relative; z-index: 15; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div class="card-thumbnail" style="height: 100%; width: 100%; border-radius: 0;">
                    ${thumbContent}
                </div>
                ${isProcessing ? `<div style="position:absolute; inset:0; background:rgba(0,0,0,0.5); backdrop-filter: blur(4px); display:flex; align-items:center; justify-content:center; color:white; font-size:0.75rem; font-weight:800; letter-spacing: 0.05em;">PROCESSING...</div>` : ''}
            </div>

            <!-- AI Summary Overlay (Hidden behind image) -->
            <div class="card-summary-overlay" style="height: 210px; border-top-left-radius: 24px; border-top-right-radius: 24px; position: absolute; top: 0; left: 0; right: 0; z-index: 5; background: var(--bg-panel); border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div class="summary-badge" style="margin: 20px 20px 10px 20px;">🪄 AI Synopsis</div>
                <p class="summary-text" style="padding: 0 20px; font-size: 0.8rem; -webkit-line-clamp: 6; line-clamp: 6; line-height: 1.5; color: var(--text-light); opacity: 0.9;">${summary || "Our AI is currently analyzing this book to provide you with a deep summary. Please check back in a moment!"}</p>
            </div>

            <!-- Info Section (Stable) -->
            <div class="card-info-stable" style="padding: 12px 16px; flex: 1; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <!-- Full Title Display -->
                    <div class="card-title" title="${name}" style="font-size: 1.05rem; font-weight: 800; margin-bottom: 8px; color: var(--text-white); line-height: 1.3; word-break: break-word; white-space: normal;">${cleanName}</div>
                    
                    <div class="card-meta-row" style="display: flex; align-items: center; gap: 12px; font-size: 0.75rem; color: var(--text-light); opacity: 0.6; font-weight: 500;">
                        <span style="display: flex; align-items: center; gap: 5px;"><i class="far fa-calendar-alt"></i> ${uploadDateStr}</span>
                        <span style="display: flex; align-items: center; gap: 5px;"><i class="fas fa-layer-group"></i> ${pageCount || 0} Pages</span>
                    </div>
                </div>
                
                <div class="card-footer-unified" style="display: flex; align-items: center; justify-content: flex-start; gap: 6px; margin-top: 12px;">
                    <button class="btn-read-more" ${isProcessing ? 'disabled' : ''} onclick="openBook(${id}, '${name.replace(/'/g, "\\'")}'); toggleDashboard();" 
                            style="flex: 0 0 auto; height: 38px; background: var(--primary); color: white; border: none; border-radius: 10px; font-weight: 800; font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 4px; cursor: pointer; transition: 0.2s; padding: 0 10px; min-width: 80px;">
                        <span>OPEN</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    </button>
                    
                    <div class="card-actions-row-inner" style="display: flex; gap: 4px; flex-shrink: 0;">
                         <button onclick="deleteBook(${id})" title="Delete" style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.15); background: rgba(239, 68, 68, 0.05); color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;"><i class="fas fa-trash-alt" style="font-size: 0.75rem;"></i></button>
                         <button onclick="downloadBook(${id}, '${name.replace(/'/g, "\\'")}')" title="Download" style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--glass); color: var(--text-light); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;"><i class="fas fa-download" style="font-size: 0.75rem;"></i></button>
                         <button onclick="shareBook(${id}, '${name.replace(/'/g, "\\'")}')" title="Share" style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--border); background: var(--glass); color: var(--text-light); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;"><i class="fas fa-share-alt" style="font-size: 0.75rem;"></i></button>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    // CRITICAL: Re-apply active filters after re-rendering to prevent UI reset
    filterDashboard();

    // Also fetch and show reading stats
    fetchReadingStats();

    // AUTO-REFRESH: If any books are processing, poll the server to unlock them once ready
    if (window._hasProcessingBooks && !window._isPollingDashboard) {
        startDashboardPolling();
    }
}

let dashboardPollTimeout = null;

function stopDashboardPolling() {
    if (dashboardPollTimeout) {
        clearTimeout(dashboardPollTimeout);
        dashboardPollTimeout = null;
    }
    window._isPollingDashboard = false;
}

function startDashboardPolling() {
    if (dashboardPollTimeout) clearTimeout(dashboardPollTimeout);
    if (window._isPollingDashboard) return;
    window._isPollingDashboard = true;

    const poll = async () => {
        const overlay = document.getElementById("dashboardOverlay");
        if (!overlay || overlay.style.display === "none") {
            // Stop polling if dashboard is closed
            window._isPollingDashboard = false;
            return;
        }

        try {
            const res = await fetch("/books");
            const data = await res.json();

            // Check if still processing
            const stillProcessing = data.some(b => b[3] && (b[3].toLowerCase().includes("processing") || b[3].toLowerCase().includes("analyzing") || b[3].toLowerCase().includes("upgrading")));

            // Update UI
            renderDashboard(data);

            if (stillProcessing) {
                dashboardPollTimeout = setTimeout(poll, 3000);
            } else {
                window._isPollingDashboard = false;
                console.log("All books ready. Stopping poll.");
            }
        } catch (e) {
            window._isPollingDashboard = false;
        }
    };

    dashboardPollTimeout = setTimeout(poll, 3000);
}

async function fetchUserStreak() {
    try {
        const res = await fetch("/get_user_streak");
        const data = await res.json();

        const streakEl = document.getElementById("userStreakCount");
        const ribbonEl = document.getElementById("userStreakRibbon");
        const todayTimeEl = document.getElementById("todayReadingTime");
        const goalCircle = document.getElementById("dailyGoalCircle");
        const goalPercent = document.getElementById("dailyGoalPercent");
        const goalStatus = document.getElementById("goalStatus");

        // Update Streak
        if (streakEl) {
            streakEl.innerHTML = `<img src="/static/fire.gif" alt="Streak" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px; object-fit: contain; mix-blend-mode: multiply;"> ${data.streak} Day Streak`;
        }
        if (ribbonEl) {
            ribbonEl.setAttribute("data-streak", `${data.streak} Day Streak`);
        }

        // Today's Time
        const mins = Math.floor(data.today_seconds / 60);
        const goalMins = Math.floor(data.daily_goal_seconds / 60);
        todayTimeEl.innerHTML = `${mins}m <span style="font-size: 0.9rem; font-weight: 400; opacity: 0.5;">/ ${goalMins}m</span>`;

        // Percent & Circle
        const percent = Math.min(100, Math.round((data.today_seconds / data.daily_goal_seconds) * 100));
        if (goalPercent) goalPercent.innerText = percent + "%";

        // Progress Ring: Total circum = 2 * PI * R (R=45) = 282.7
        const offset = 282.7 - (percent / 100) * 282.7;
        if (goalCircle) {
            goalCircle.style.strokeDashoffset = offset;
        }

        // Status & Celebration
        if (goalStatus) {
            const today = new Date().toISOString().split('T')[0];
            const goalKey = `goal_celebrated_${today}`;

            if (percent >= 100) {
                goalStatus.innerHTML = "Goal achieved! You're a legend! <i class='fas fa-trophy'></i>";
                goalStatus.style.color = "#2ed573";

                // CELEBRATION: Only trigger if not already celebrated TODAY
                if (!localStorage.getItem(goalKey)) {
                    console.log("🏆 GOAL REACHED! Triggering celebration...");

                    const duration = 3 * 1000;
                    const end = Date.now() + duration;

                    (function frame() {
                        confetti({
                            particleCount: 5,
                            angle: 60,
                            spread: 55,
                            origin: { x: 0 },
                            colors: ['#ff6b6b', '#ff9f43', '#2ed573']
                        });
                        confetti({
                            particleCount: 5,
                            angle: 120,
                            spread: 55,
                            origin: { x: 1 },
                            colors: ['#ff6b6b', '#ff9f43', '#2ed573']
                        });

                        if (Date.now() < end) {
                            requestAnimationFrame(frame);
                        }
                    }());

                    localStorage.setItem(goalKey, "true");
                }
            } else {
                // Not at 100% yet
            }
        }
    } catch (e) {
        console.error("Streak Error:", e);
    }
}

async function fetchReadingStats() {
    // Cache-busting to ensure recency is reflected instantly
    const res = await fetch(`/reading_stats?t=${Date.now()}`);
    const data = await res.json();
    const chartDiv = document.getElementById("readingChart");
    const totalTimeLabel = document.getElementById("totalReadTimeGlobal");
    const resumePortal = document.getElementById("resumeReadingPortal");
    const resumeBookCard = document.getElementById("lastActiveBookCard");

    if (!chartDiv) return;
    chartDiv.innerHTML = "";

    // Leaderboard sorted by TIME
    const timeSorted = [...data].sort((a, b) => b[2] - a[2]);
    // Recent Portal uses the first item (API already sorts BY last_read_at DESC)
    const lastActiveSorted = [...data];

    // Show total read time
    let totalSecs = 0;
    data.forEach(b => totalSecs += b[2]);
    if (totalTimeLabel) {
        const globalH = Math.floor(totalSecs / 3600);
        const globalM = Math.floor((totalSecs % 3600) / 60);
        // Force strings to ensure correct character rendering in custom fonts
        totalTimeLabel.innerText = String(globalH) + "h " + String(globalM) + "m";
    }

    // Build the Resume Portal: Use the absolute MOST RECENT book
    if (lastActiveSorted.length > 0 && resumePortal && resumeBookCard) {
        const last = lastActiveSorted[0];
        const [lid, lname, ltime, lthumb] = last;

        // Update the "Last Session Activity" card in Snapshot
        const lastActiveDate = document.getElementById("lastActiveDate");
        if (lastActiveDate) {
            const h = Math.floor(ltime / 3600);
            const m = Math.floor((ltime % 3600) / 60);
            lastActiveDate.innerHTML = `<div style="font-size: 0.75rem; color: #60a5fa; margin-bottom:4px;">${lname}</div>
                                      <div style="font-size: 1.15rem; font-weight:800;">${h > 0 ? h + 'h ' : ''}${m}m active</div>`;
        }

        resumePortal.style.display = 'block';
        resumeBookCard.innerHTML = `
            <div style="width: 50px; height: 65px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">
                ${lthumb ? `<img src="/thumbnail/${lid}" style="width:100%; height:100%; object-fit:cover;">` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:1.5rem;">📖</div>`}
            </div>
            <div style="flex-grow: 1; overflow: hidden;">
                <div style="color: var(--text-white); font-weight: 800; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${lname}</div>
                <div style="color: var(--text-light); font-size: 0.8rem; opacity: 0.8;">
                    ${ltime > 0 ? `Resume from ${Math.floor(ltime / 60)}m read time` : 'Start your first session today!'}
                </div>
            </div>
            <button class="btn-read-more" style="background: var(--primary); color: white; padding: 10px 18px; font-size: 0.85rem; height: auto; border-radius: 14px;" onclick="openBook(${lid}, '${lname.replace(/'/g, "\\'")}'); toggleDashboard();">
                <span>Resume</span>
            </button>
        `;
    }

    if (timeSorted.length === 0) {
        chartDiv.innerHTML = "<p style='color:var(--text-light); text-align:center; padding:20px; font-size:0.85rem;'>No books found. Upload one to start!</p>";
        return;
    }

    const maxDelta = Math.max(1, ...timeSorted.map(b => b[2]));

    timeSorted.forEach((book, index) => {
        const [id, name, time] = book;
        const percent = Math.max(10, (time / maxDelta) * 100);

        // Format seconds to compact string
        const h = Math.floor(time / 3600);
        const m = Math.floor((time % 3600) / 60);
        const s = time % 60;
        const timeDisplay = `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;

        const row = document.createElement("div");
        row.className = "chart-bar-row";
        row.style.marginBottom = "12px";

        row.innerHTML = `
            <div class="bar-book-name" title="${name}">${name}</div>
            <div class="bar-wrapper-horizontal">
                <div class="bar-progress-horizontal" style="--bar-width: ${percent}%; background: ${getGradient(index)};"></div>
            </div>
            <div class="bar-time-label">
                ${timeDisplay}
            </div>
        `;
        chartDiv.appendChild(row);
    });
}

function getGradient(index) {
    const gradients = [
        "linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)",
        "linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%)",
        "linear-gradient(90deg, #14b8a6 0%, #2dd4bf 100%)",
        "linear-gradient(90deg, #ec4899 0%, #f472b6 100%)",
        "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)"
    ];
    return gradients[index % gradients.length];
}

function startReadingPulse() {
    stopReadingPulse(); // Clear any existing
    window.readingPulseInterval = setInterval(() => {
        if (currentBookId) {
            fetch("/update_reading_time", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book_id: currentBookId, seconds: 10 })
            }).then(() => {
                // Check if we hit our daily goal WHILE reading
                fetchUserStreak();
            });
        }
    }, 10000); // 10s increments
}

function stopReadingPulse() {
    if (window.readingPulseInterval) {
        clearInterval(window.readingPulseInterval);
        window.readingPulseInterval = null;
    }
}


async function toggleFavorite(bookId, btn) {
    try {
        const res = await fetch(`/toggle_favorite/${bookId}`, { method: 'POST' });
        if (res.ok) {
            const svg = btn.querySelector('svg');
            const isActive = btn.classList.toggle('active');

            if (isActive) {
                svg.setAttribute('fill', '#ef4444');
                svg.setAttribute('stroke', '#ef4444');
                btn.title = "Unfavorite";
                showUploadToast("💖 Added to Favorites", "success");
            } else {
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'white');
                btn.title = "Add to Favorites";
                showUploadToast("💔 Removed from Favorites", "info");
            }

            // Update the state of ALL instances of this book in the UI locally
            updateBookFavoriteUI(bookId, isActive);

            // Re-render dashboard order if NOT in "Only Favorites" mode is handled by the data
            // If the filter is active, we need to refresh the filter view
            filterDashboard();
            filterBooks();
        }
    } catch (e) {
        console.error("Toggle Favorite Error:", e);
    }
}

async function toggleReaderFavorite() {
    if (!currentBookId) return;
    const btn = document.getElementById("readerFavoriteBtn");
    try {
        const res = await fetch(`/toggle_favorite/${currentBookId}`, { method: 'POST' });
        if (res.ok) {
            const isActive = btn.classList.toggle('active');
            btn.title = isActive ? "Unfavorite" : "Add to Favorites";

            // Update the rest of the UI in background without full reload
            updateBookFavoriteUI(currentBookId, isActive);
            filterDashboard();
            filterBooks();
        }
    } catch (e) {
        console.error("Toggle Reader Favorite Error:", e);
    }
}

function updateBookFavoriteUI(bookId, isActive) {
    // 1. Update the local data model
    const book = activeBooksList.find(b => b[0] == bookId);
    if (book) {
        book[7] = isActive ? 1 : 0;
    }

    // 2. Update Dashboard Cards
    const dashboardCards = document.querySelectorAll(`.book-card[data-book-id="${bookId}"]`);
    dashboardCards.forEach(card => {
        card.setAttribute("data-is-favourite", isActive ? "1" : "0");
        const favBtn = card.querySelector(".btn-favorite");
        if (favBtn) {
            favBtn.classList.toggle("active", isActive);
            const svg = favBtn.querySelector("svg");
            if (svg) {
                svg.setAttribute('fill', isActive ? '#ef4444' : 'none');
                svg.setAttribute('stroke', isActive ? '#ef4444' : 'white');
            }
            favBtn.title = isActive ? "Unfavorite" : "Add to Favorites";
        }
    });

    // 3. Update Sidebar Table Rows
    const sidebarRows = document.querySelectorAll(`#booklist tr[data-book-id="${bookId}"]`);
    sidebarRows.forEach(tr => {
        tr.setAttribute("data-is-favourite", isActive ? "1" : "0");
        const favBtn = tr.querySelector(".btn-sidebar-fav");
        if (favBtn) {
            favBtn.classList.toggle("active", isActive);
            const svg = favBtn.querySelector("svg");
            if (svg) {
                svg.setAttribute('fill', isActive ? '#ef4444' : 'none');
                svg.setAttribute('stroke', isActive ? '#ef4444' : 'var(--text-light)');
            }
            favBtn.title = isActive ? "Unfavorite" : "Add to Favorites";
        }
    });

    // 4. Update Reader Button if it's the current book
    if (currentBookId == bookId) {
        const readerBtn = document.getElementById("readerFavoriteBtn");
        if (readerBtn) {
            readerBtn.classList.toggle("active", isActive);
            readerBtn.title = isActive ? "Unfavorite" : "Add to Favorites";
        }
    }
}

function shareBook(id, name) {
    // We create a direct link with the book ID
    const shareUrl = window.location.origin + window.location.pathname + `?open=${id}`;

    if (navigator.share) {
        navigator.share({
            title: name,
            text: `Reading '${name}' on AI Reader. Join me!`,
            url: shareUrl
        }).catch(err => console.log('Share canceled:', err));
    } else {
        // Fallback: Copy link
        navigator.clipboard.writeText(shareUrl).then(() => {
            showUploadToast("📋 Book link copied to clipboard!", "info");
        }).catch(err => {
            showUploadToast("❌ Background processes might be blocking clipboard access.", "error");
        });
    }
}


function filterDashboard() {
    const desktopQ = document.getElementById("dashboardSearch")?.value || "";
    const mobileQ = document.getElementById("dashboardSearchMobile")?.value || "";
    const q = (desktopQ || mobileQ).toLowerCase();

    const cards = document.querySelectorAll(".book-card");
    const container = document.getElementById("dashboardGrid");
    let visibleCount = 0;

    cards.forEach(card => {
        const name = card.getAttribute("data-book-name") || "";
        const isFav = card.getAttribute("data-is-favourite") === "1";

        let shouldShow = name.toLowerCase().includes(q);
        if (onlyFavoritesFilter && !isFav) {
            shouldShow = false;
        }
        if (onlyBookmarksFilter && parseInt(card.getAttribute("data-bookmark-count") || "0") === 0) {
            shouldShow = false;
        }

        card.style.display = shouldShow ? "flex" : "none";
        if (shouldShow) visibleCount++;
    });

    // Show empty state if needed
    const emptyState = document.getElementById("dashboardEmptyState");
    if (visibleCount === 0) {
        if (!emptyState) {
            const div = document.createElement("div");
            div.id = "dashboardEmptyState";
            div.style.textAlign = "center";
            div.style.padding = "40px";
            div.style.color = "#888";
            div.innerHTML = `<span style="font-size: 3rem; display: block; margin-bottom: 20px;">🏜️</span><p>No books found matching your current filters.</p>`;
            container.appendChild(div);
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

function filterDashboardMobile(val) {
    // Sync both inputs for consistency
    const desktopInput = document.getElementById("dashboardSearch");
    if (desktopInput) desktopInput.value = val;
    filterDashboard();
}

async function saveAsNote() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Hide toolbars
    let toolbar = document.getElementById("selectionToolbar");
    if (toolbar) toolbar.style.display = "none";

    try {
        let res = await fetch("/save_note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                book_id: currentBookId,
                content: selectedText
            })
        });

        if (res.ok) {
            showUploadToast("✍️ Snippet added to archive", "success");
            window.getSelection().removeAllRanges();
            const modal = document.getElementById("notebookModal");
            if (modal && modal.style.display === "flex") {
                renderNotebook();
            }
        }
    } catch (e) { console.error(e); }
}

async function loadRecommendations() {
    if (!currentBookId) return;
    const hub = document.getElementById("discoveryHub");
    const grid = document.getElementById("recommendationGrid");
    const status = document.getElementById("discoveryStatus");

    // Clear previous results and show searching status
    if (status) {
        status.style.display = "block";
        status.innerHTML = "🔍 AI is searching for similar books...";
    }

    // Clear only children that are book cards
    const cards = grid.querySelectorAll('.external-rec');
    cards.forEach(c => c.remove());

    try {
        let res = await fetch("/get_recommendations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book_id: currentBookId })
        });
        let data = await res.json();

        if (data.recommendations && data.recommendations.length > 0) {
            if (status) status.style.display = "none";

            data.recommendations.forEach(book => {
                const card = document.createElement("div");
                card.className = "book-card external-rec";
                card.style.cssText = "background: var(--bg-header); border: 1px solid var(--border); padding: 15px; border-radius: 18px; position: relative; margin-bottom: 20px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);";
                card.onmouseover = () => card.style.transform = "translateY(-5px)";
                card.onmouseout = () => card.style.transform = "translateY(0)";

                card.innerHTML = `
                    <div style="position: absolute; top: 12px; right: 12px; background: var(--primary); color: white; font-size: 0.65rem; padding: 2px 10px; border-radius: 20px; font-weight: 700; text-transform: uppercase; box-shadow: 0 4px 10px rgba(0,0,0,0.2);">Discover</div>
                    <img src="${book.cover || 'https://placehold.co/150x220?text=No+Cover'}" style="width: 100%; height: auto; max-height: 190px; min-height: 160px; object-fit: cover; border-radius: 12px; margin-bottom: 12px; border: 1px solid var(--border); background: #2d3748;">
                    <h4 style="color: var(--text-white); font-size: 0.85rem; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;" title="${book.title}">${book.title}</h4>
                    <p style="color: var(--text-light); font-size: 0.72rem; margin-bottom: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${book.author}</p>
                    <button onclick="downloadExternalBook('${book.id}', '${encodeURIComponent(book.title)}', '${book.url}', '${book.cover || ''}')" class="btn-primary" style="width: 100%; padding: 10px; font-size: 0.82rem; border-radius: 10px; font-weight: 600; letter-spacing: 0.3px;">
                        📥 Add to Library
                    </button>
                `;
                grid.appendChild(card);
            });
        } else {
            if (status) status.innerHTML = "✨ No similar books found for this title.";
        }
    } catch (e) {
        console.error("Discovery error:", e);
        if (status) status.innerHTML = "❌ Could not connect to OpenLibrary.";
    }
}

async function downloadExternalBook(id, encodedTitle, sourceUrl, coverUrl = '') {
    const title = decodeURIComponent(encodedTitle);
    const btn = event.target.closest('button');
    const originalText = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = "⌛ Downloading...";

    try {
        let res = await fetch("/download_external", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: id, title: title, url: sourceUrl, cover_url: coverUrl })
        });

        if (res.ok) {
            btn.innerHTML = "✅ Added!";
            setTimeout(() => {
                loadBooks(); // Reload main library
            }, 1000);
        } else {
            throw new Error("Download failed");
        }
    } catch (e) {
        btn.innerHTML = "❌ Failed";
        setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 2000);
    }
}

async function openNotebook() {
    document.getElementById("notebookModal").style.display = "flex";
    renderNotebook();
}

async function renderNotebook() {
    let list = document.getElementById("notebookList");
    let responseCount = document.getElementById("notebookCount");
    list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-light);">Reviewing your notes...</div>`;

    try {
        let currentLangSelect = document.getElementById('langSelect');
        let currentLang = currentLangSelect ? currentLangSelect.value : 'orig';
        let res = await fetch(`/notes/${currentBookId}?lang=${currentLang}`);
        let notes = await res.json();

        if (responseCount) responseCount.innerText = `${notes.length} Study Insights`;
        list.innerHTML = "";

        if (notes.length === 0) {
            list.innerHTML = `<div style="text-align: center; padding: 60px; color: var(--text-light); border: 2px dashed var(--border); border-radius: 12px; font-style: italic;">No text is added to the Notes📝.</div>`;
            return;
        }

        notes.forEach((note, i) => {
            let div = document.createElement("div");
            div.className = "study-card-flat";
            div.style.cssText = `background: var(--bg-panel); border-bottom: 1px solid var(--border); padding: 25px 0; margin: 0 auto; max-width: 800px; position: relative; width: 100%;`;

            div.innerHTML = `
                <button onclick="deleteNote(${note.id})" style="position: absolute; top: 20px; right: 0; background: rgba(239, 68, 68, 0.05); border: none; color: #ef4444; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 16px; opacity: 0.3; transition: 0.3s; display: flex; align-items: center; justify-content: center; z-index: 5;" onmouseover="this.style.opacity=1; this.style.background='rgba(239, 68, 68, 0.15)'" onmouseout="this.style.opacity=0.3; this.style.background='rgba(239, 68, 68, 0.05)'">✕</button>
                <div style="padding: 0 40px;">
                    <textarea class="clean-note-area" 
                        onchange="updateNote(${note.id}, this.value)"
                        placeholder="Refine this insight..."
                        style="width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; color: var(--text-white); font-family: 'Inter', sans-serif; font-size: 1.15rem; line-height: 1.8; padding: 15px 25px; resize: none; overflow: hidden; height: auto; transition: 0.2s; border-radius: 12px; outline: none; display: block;"
                        onfocus="this.style.background='rgba(255,255,255,0.02)'; this.style.borderColor='var(--glass-border)';"
                        onblur="this.style.background='transparent'; this.style.borderColor='transparent';"
                        oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'">${note.content}</textarea>
                </div>
            `;
            list.appendChild(div);
            // Height sync
            const t = div.querySelector('textarea');
            t.style.height = t.scrollHeight + 'px';
        });



    } catch (e) {
        console.error("Error in renderNotebook:", e);
        list.innerHTML = `<div style="color: #ef4444;">Error accessing records: ${e.message}</div>`;
    }
}

async function updateNote(noteId, content) {
    if (!content.trim()) return;
    try {
        await fetch("/update_note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note_id: noteId, content: content })
        });
        showUploadToast("✍️ Change persistent", "success");
    } catch (e) { }
}

function deleteNote(noteId) {
    showConfirmModal(
        "Discard Snippet?",
        "Are you sure you want to erase this study note? This action is permanent.",
        "Delete Insight",
        "Keep Note",
        null,
        async () => {
            try {
                await fetch("/delete_note/" + noteId, { method: "POST" });
                showUploadToast("🗑️ Insight erased", "info");
                renderNotebook();
            } catch (e) { }
        },
        null,
        null,
        true
    );
}



function downloadNotes(format) {
    const currentLang = document.getElementById('langSelect')?.value || 'en';
    // Generate a download link for the specific backend route with translation support
    const url = `/download_notes/${currentBookId}?format=${format}&lang=${currentLang}`;
    window.open(url, "_blank");
}

function closeNotebook() {
    document.getElementById("notebookModal").style.display = "none";
}


// --- Quiz Feature Logic ---
let currentQuizData = [];

async function generateQuiz() {
    const modal = document.getElementById("quizModal");
    if (!modal) return;

    // Reset View to Selection
    modal.style.display = "flex";
    document.getElementById("quizBackBtn").style.display = "none";
    document.getElementById("quizTypeSelection").style.display = "block";
    document.getElementById("quizLoading").style.display = "none";
    document.getElementById("quizContent").style.display = "none";
    document.getElementById("quizResult").style.display = "none";
    document.getElementById("quizSubmitBtn").style.display = "none";
    document.getElementById("downloadQuizBtn").style.display = "none";

    // Hide footer status initially
    const statusEl = document.getElementById("quizStatus");
    if (statusEl) statusEl.style.display = "none";
}

function backToQuizSelection() {
    generateQuiz();
    // Re-hide the progress bar top indicator
    const pbContainer = document.getElementById("quizProgressBarContainer");
    if (pbContainer) pbContainer.style.display = "none";
}

async function startQuiz(type) {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();

    document.getElementById("quizBackBtn").style.display = "flex";
    document.getElementById("quizTypeSelection").style.display = "none";
    document.getElementById("quizLoading").style.display = "block";

    try {
        const targetLang = document.getElementById("langSelect").value;
        let res = await fetch("/generate_quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: selectedText || "",
                book_id: currentBookId,
                type: type,
                target_lang: targetLang
            })
        });

        if (!res.ok) {
            let errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Quiz generation failed.");
        }

        let data = await res.json();
        currentQuizData = data.questions;
        renderQuiz(type);
    } catch (e) {
        showUploadToast("Quiz Error: " + e.message, "error");
        closeQuiz();
    }
}

function renderQuiz(type) {
    document.getElementById("quizLoading").style.display = "none";
    document.getElementById("quizContent").style.display = "block";
    document.getElementById("downloadQuizBtn").style.display = "flex";

    const statusEl = document.getElementById("quizStatus");
    if (statusEl) statusEl.style.display = (type === 'mcq') ? "block" : "none";

    let body = document.getElementById("quizBody");
    body.innerHTML = "";

    if (type === 'mcq') {
        document.getElementById("quizSubmitBtn").style.display = "block";
        currentQuizData.forEach((q, i) => {
            let qDiv = document.createElement("div");
            qDiv.className = "quiz-question";
            qDiv.id = `q-container-${i}`;
            qDiv.style.marginBottom = "24px";
            qDiv.style.padding = "20px";
            qDiv.style.borderRadius = "15px";
            qDiv.style.border = "1px solid transparent"; // Placeholder for error highlight
            qDiv.style.transition = "all 0.3s ease";

            qDiv.innerHTML = `
                <p style="font-weight: 600; margin-bottom: 12px; color: var(--text-white); font-size: 1.1rem;">${i + 1}. ${q.question}</p>
                <div class="quiz-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    ${q.options.map(opt => `
                        <label style="background: var(--glass); padding: 12px 18px; border-radius: 12px; cursor: pointer; border: 1px solid var(--glass-border); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; gap: 10px; font-weight: 500; color: var(--text-white);">
                            <input type="radio" name="q${i}" value="${opt}" onchange="clearQuizError(${i})" style="accent-color: var(--primary); width: 18px; height: 18px;">
                            <span>${opt}</span>
                        </label>
                    `).join('')}
                </div>
            `;
            body.appendChild(qDiv);
        });
    } else {
        // Short or Long Answers
        document.getElementById("quizSubmitBtn").style.display = "none";
        currentQuizData.forEach((q, i) => {
            let qDiv = document.createElement("div");
            qDiv.className = "quiz-question-sl";
            qDiv.style.cssText = `background: var(--glass); padding: 25px; border-radius: 15px; border: 1px solid var(--glass-border); margin-bottom: 20px;`;
            qDiv.innerHTML = `
                <p style="font-weight: 600; margin-bottom: 15px; color: var(--text-white); font-size: 1.1rem; line-height: 1.5;">${i + 1}. ${q.question}</p>
                <div id="answer-${i}" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border); color: var(--primary); font-family: 'Inter', sans-serif; font-weight: 500; line-height: 1.6;">
                    <span style="display: block; font-size: 0.8rem; color: var(--text-light); text-transform: uppercase; margin-bottom: 8px;">Answer:</span>
                    ${q.answer}
                </div>
                <button onclick="toggleQuizAnswer(event, ${i})" class="btn-secondary" style="margin-top: 10px; padding: 10px 20px; font-size: 0.9rem; border-radius: 10px; border: 1px solid var(--glass-border);">Show Answer</button>
            `;
            body.appendChild(qDiv);
        });
    }

    updateQuizProgress();
}

function exportQuizToFile() {
    if (!currentQuizData || currentQuizData.length === 0) {
        showUploadToast("No quiz data available to download.", "error");
        return;
    }

    let content = `AI BOOK READER - QUIZ EXPORT\n`;
    content += `==========================\n\n`;
    content += `Book: ${currentBookName || 'Untitled'}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n\n`;

    currentQuizData.forEach((q, i) => {
        content += `${i + 1}. ${q.question}\n`;
        if (q.options) {
            content += `   Options:\n`;
            q.options.forEach((opt, idx) => {
                content += `   [${String.fromCharCode(65 + idx)}] ${opt}\n`;
            });
            content += `\n   Answer Key: ${q.answer}\n`;
        } else {
            content += `\n   Recommended Answer / Key Points:\n   ${q.answer}\n`;
        }
        content += `\n--------------------------\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz_study_guide_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function toggleQuizAnswer(event, index) {
    const ans = document.getElementById(`answer-${index}`);
    const btn = event.currentTarget || event.target;
    if (ans.style.display === "none") {
        ans.style.display = "block";
        btn.innerText = "Hide Answer";
        btn.style.color = "var(--text-light)";
    } else {
        ans.style.display = "none";
        btn.innerText = "Show Answer";
        btn.style.color = "";
    }
}

function clearQuizError(index) {
    const qDiv = document.getElementById(`q-container-${index}`);
    if (qDiv) {
        qDiv.style.border = "1px solid transparent";
        qDiv.style.background = "transparent";
    }
    updateQuizProgress();
}

function updateQuizProgress() {
    if (!currentQuizData) return;
    let total = currentQuizData.length;
    let attended = 0;
    for (let i = 0; i < total; i++) {
        if (document.querySelector(`input[name="q${i}"]:checked`)) {
            attended++;
        }
    }
    const attendedEl = document.getElementById("quizAttendedCount");
    const remainingEl = document.getElementById("quizRemainingCount");
    const statusEl = document.getElementById("quizStatus");

    if (attendedEl) attendedEl.innerText = attended;
    if (remainingEl) remainingEl.innerText = total - attended;

    // Only show the footer status if the current quiz is MCQ
    if (statusEl) {
        const isMCQ = document.querySelector('input[type="radio"]') !== null;
        statusEl.style.display = isMCQ ? "block" : "none";
    }

    // Also update the Sticky Progress Bar
    const pbContainer = document.getElementById("quizProgressBarContainer");
    const pb = document.getElementById("quizProgressBar");

    if (pbContainer) pbContainer.style.display = "block";
    if (pb && total > 0) {
        let percent = Math.round((attended / total) * 100);
        pb.style.width = Math.max(5, percent) + "%"; // Keep at least 5% visible at start
    }
}

function submitQuiz() {
    let score = 0;
    let total = currentQuizData.length;
    let answeredCount = 0;

    // First Pass: Check if everything is answered
    let missingAt = [];
    for (let i = 0; i < total; i++) {
        const selected = document.querySelector(`input[name="q${i}"]:checked`);
        if (selected) {
            answeredCount++;
        } else {
            missingAt.push(i);
        }
    }

    if (answeredCount < total) {
        showUploadToast("🚫 Please attend all the questions before submitting!", "error");

        // VISIVE FEEDBACK: Highlight the first missing question and scroll to it
        const allQuestions = document.querySelectorAll('.quiz-question');
        missingAt.forEach(idx => {
            if (allQuestions[idx]) {
                allQuestions[idx].style.border = "1px dashed #ef4444";
                allQuestions[idx].style.background = "rgba(239, 68, 68, 0.05)";
                allQuestions[idx].style.borderRadius = "12px";
            }
        });
        const firstMissing = allQuestions[missingAt[0]];
        if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Hide progress during results
    const statusEl = document.getElementById("quizStatus");
    if (statusEl) statusEl.style.display = "none";

    currentQuizData.forEach((q, i) => {
        let selected = document.querySelector(`input[name="q${i}"]:checked`);
        let radios = document.querySelectorAll(`input[name="q${i}"]`);

        radios.forEach(input => {
            let label = input.parentElement;
            let span = label.querySelector('span');

            // Disable further selection
            input.disabled = true;

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

// --- Revision Mode Master Feature ---
async function generateRevision() {
    if (!currentBookId) {
        showUploadToast("⚠️ Load a book to begin revision", "error");
        return;
    }

    const modal = document.getElementById("revisionModal");
    const loading = document.getElementById("revisionLoading");
    const list = document.getElementById("revisionList");

    modal.style.display = "flex";
    loading.style.display = "block";
    list.style.display = "none";
    list.innerHTML = "";

    const targetLang = document.getElementById('langSelect').value;

    try {
        const res = await fetch("/generate_revision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ book_id: currentBookId, target_lang: targetLang })
        });

        if (!res.ok) throw new Error("Revision distillation failed.");
        const data = await res.json();

        renderRevision(data.revision_points);
    } catch (e) {
        showUploadToast("Revision Error: " + e.message, "error");
        closeRevisionModal();
    }
}

function renderRevision(points) {
    const loading = document.getElementById("revisionLoading");
    const list = document.getElementById("revisionList");

    loading.style.display = "none";
    list.style.display = "block";
    list.innerHTML = "";

    if (!points || points.length === 0) {
        list.innerHTML = `<div style="text-align: center; padding: 40px; color: #64748b; font-style: italic;">No key insights could be distilled. Try a longer book section.</div>`;
        return;
    }

    points.forEach((point, i) => {
        const item = document.createElement("p");
        item.style.cssText = `
            margin-bottom: 30px;
            color: #334155;
            font-size: 1.15rem;
            line-height: 1.8;
            opacity: 0;
            transform: translateY(10px);
            animation: fadeIn 0.4s forwards ${i * 0.05}s;
        `;

        item.innerHTML = `<strong style="color: #4f46e5; margin-right: 12px;">•</strong> ${point}`;
        list.appendChild(item);
    });

    // Simple fade in
    if (!document.getElementById("plainFadeAnim")) {
        const style = document.createElement("style");
        style.id = "plainFadeAnim";
        style.innerHTML = `
            @keyframes fadeIn {
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
}

function downloadRevision() {
    if (!currentBookId) return;
    const targetLang = document.getElementById('langSelect').value;
    window.open(`/download_revision/${currentBookId}?target_lang=${targetLang}`, "_blank");
}

async function exportAudiobook() {
    if (!currentBookId) {
        showUploadToast("📚 Please open a book first!", "info");
        return;
    }

    const lang = document.getElementById('langSelect').value || 'en';
    const gender = currentNarratorGender || 'female';
    const bookTitle = currentBookName || "audiobook";

    const exportUrl = `/export_audiobook/${currentBookId}?lang=${encodeURIComponent(lang)}&gender=${encodeURIComponent(gender)}`;

    // Open the modal
    const modal = document.getElementById("audiobookModal");
    const player = document.getElementById("audiobookPlayer");
    const downloadBtn = document.getElementById("btnDownloadAudiobookAction");

    if (modal && player && downloadBtn) {
        player.src = exportUrl;
        player.load();

        downloadBtn.onclick = () => {
            showUploadToast("📥 Starting full audiobook download. This may take a while...", "success");
            window.location.href = exportUrl + "&download=1";
        };

        modal.style.display = "flex";
    }
}

function closeAudiobookModal() {
    const modal = document.getElementById("audiobookModal");
    const player = document.getElementById("audiobookPlayer");
    if (modal) modal.style.display = "none";
    if (player) {
        player.pause();
        player.src = "";
    }
}

function closeRevisionModal() {
    document.getElementById("revisionModal").style.display = "none";
}


let speedChangeTimer = null;

function changeSpeed(delta) {
    // 1. INCREASE INCREMENTS: users often prefer 0.2x or 0.25x over 0.1x for better feedback
    currentSpeed = Math.max(0.2, Math.min(3.5, parseFloat((currentSpeed + delta).toFixed(2))));

    // Update UI
    const display = document.getElementById("speedDisplay");
    if (display) display.innerText = currentSpeed.toFixed(1) + "x";

    // 2. STREAMING AUDIO (Emotion/Fallback): Immediate update
    if (currentFallbackAudio) {
        currentFallbackAudio.playbackRate = currentSpeed;
    }

    // 3. NATIVE TTS: Debounced "Quick-Skip"
    // Rapidly clicking +/- shouldn't restart the engine 10 times in 100ms.
    // We debounce the restart so it only happens when the user stops clicking.
    if (window.speechSynthesis.speaking && isReadingAloud && !isPaused) {
        clearTimeout(speedChangeTimer);
        speedChangeTimer = setTimeout(() => {
            const resumeAt = currentAbsoluteCharIndex;
            currentNarrationJobId++; // Invalidate stale callbacks immediately
            window.speechSynthesis.cancel();

            // Re-check state before resuming
            setTimeout(() => {
                if (isReadingAloud && !isPaused) {
                    // USE SAFE BACKTRACK: This ensures we don't start in the middle of a word at the new speed.
                    resumeReadingFromIndex(resumeAt, false, false);
                }
            }, 100);
        }, 250); // 250ms debounce
    }
}


// Theme Engine
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('reader-theme', newTheme);

    const checkBoxes = document.querySelectorAll('.theme-switch__checkbox');
    checkBoxes.forEach(cb => {
        if (cb) cb.checked = (newTheme === 'dark');
    });

    const icons = document.querySelectorAll('.themeIcon');
    icons.forEach(icon => {
        if (icon) icon.innerText = newTheme === 'light' ? '☀️' : '🌙';
    });
}

// Apply Saved Theme
(function initTheme() {
    const saved = localStorage.getItem('reader-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('DOMContentLoaded', () => {
        const checkBoxes = document.querySelectorAll('.theme-switch__checkbox');
        checkBoxes.forEach(cb => {
            if (cb) cb.checked = (saved === 'dark');
        });
        const icons = document.querySelectorAll('.themeIcon');
        icons.forEach(icon => {
            if (icon) icon.innerText = saved === 'light' ? '☀️' : '🌙';
        });
    });
})();


let isRestartingNarrator = false;

function getSafeResumeIndex(text, index) {
    if (!text || index <= 0) return 0;
    if (index >= text.length) return text.length;

    let i = index;

    // BACKTRACK: Instead of skipping to the next word, we backtrack to the beginning of the CURRENT word.
    // This ensures that if the user pauses mid-word, the entire word is re-read for context,
    // which is the expected and most reliable behavior for users.
    while (i > 0 && /\S/.test(text[i - 1])) i--;

    // Skip any leading whitespace at the jump point
    while (i < text.length && /\s/.test(text[i])) i++;

    return i;
}

function restartNarrator() {
    if (!isReadingAloud || isRestartingNarrator) return;

    isRestartingNarrator = true;

    // Use current position; resumeReadingFromIndex will handle safe handoff unless forced
    let resumePos = currentAbsoluteCharIndex;

    // Kill all running jobs
    currentNarrationJobId++;
    utterancePool = [];

    try {
        window.speechSynthesis.cancel();
    } catch (e) { }

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
            setTimeout(restartWhenClear, 30);
            return;
        }

        // NO DELAY: Switch immediately now that queue is clear
        resumeReadingFromIndex(resumePos, false);
        isRestartingNarrator = false;
    };

    restartWhenClear();
}

let totalPages = 0;
let currentNarratorGender = "female";
const chosenVoiceCache = {};

function getGenderForName(name) {
    if (!name) return currentNarratorGender;
    const femaleNames = ['rani', 'radha', 'dipti', 'vijaya', 'mary', 'alice', 'priya', 'anitha', 'sneha', 'divya', 'kala', 'malar', 'kavitha', 'shanthi', 'lakshmi', 'sita', 'gita', 'uma', 'anu', 'hema', 'shanti', 'vidya', 'jaya'];
    const maleNames = ['rahul', 'amit', 'vijay', 'arjun', 'vicky', 'john', 'peter', 'sam', 'mani', 'raja', 'siva', 'kumar', 'raj', 'mohan', 'guru', 'ram', 'krishna', 'suresh', 'ramesh', 'rajesh', 'somu', 'ganesh', 'murugan', 'shiva', 'prakash'];

    let n = name.toLowerCase().trim();
    if (femaleNames.includes(n)) return 'female';
    if (maleNames.includes(n)) return 'male';

    // Heuristic for Indian names: ends with 'a', 'i', 'u', 'e' (often female) vs 'n', 'j', 'r', 'm', 'h', 's' (often male)
    if (n.endsWith('a') || n.endsWith('i') || n.endsWith('e') || n.endsWith('u')) return 'female';
    return 'male';
}

function setNarratorGender(gender) {
    if (currentNarratorGender === gender) return;

    currentNarratorGender = gender;

    // Clear cached voice picks so a fresh voice is selected
    for (let key in chosenVoiceCache) delete chosenVoiceCache[key];

    const maleBtn = document.getElementById("maleVoiceBtn");
    const femaleBtn = document.getElementById("femaleVoiceBtn");

    if (maleBtn && femaleBtn) {
        maleBtn.style.background = "";
        femaleBtn.style.background = "";
        if (gender === "male") {
            maleBtn.classList.add("active");
            femaleBtn.classList.remove("active");
        } else {
            femaleBtn.classList.add("active");
            maleBtn.classList.remove("active");
        }
        updateStorytellerState();
    }

    // INSTANT SWITCH: If reading is active, pivot narrator immediately
    if (isReadingAloud && !isPaused) {
        // FOR TRANSLATED/FALLBACK NARRATION:
        if (fallbackQueue && fallbackQueue.length > 0) {
            const shortLang = getSelectedLanguage().split('-')[0].toLowerCase();

            // 1. Update the remaining queue URLs and pre-fetches
            if (lastEmotionItem) {
                lastEmotionItem.url = `/tts?lang=${shortLang}&text=${encodeURIComponent(lastEmotionItem.text)}&gender=${currentNarratorGender}`;
                lastEmotionItem.audioObj = null;
            }

            fallbackQueue.forEach(item => {
                item.url = `/tts?lang=${shortLang}&text=${encodeURIComponent(item.text)}&gender=${currentNarratorGender}`;
                item.audioObj = null; // Force reload with new gender
            });

            // 2. Stop current audio and trigger immediate retry of the current chunk with new gender
            if (currentFallbackAudio) {
                currentFallbackAudio.pause();
                currentFallbackAudio = null;
            }

            // 3. Kickstart the next chunk (which is now the updated current chunk)
            playNextFallback(false, true);
        } else {
            // FOR NATIVE SPEECH (English):
            restartNarrator();
        }
    }
}

function prefetchOtherGender(gender) {
    if (!isReadingAloud || currentNarratorGender === gender || !lastEmotionItem) return;
    const shortLang = (getSelectedLanguage() || 'en-US').split('-')[0].toLowerCase();
    const url = `/tts?lang=${shortLang}&text=${encodeURIComponent(lastEmotionItem.text)}&gender=${gender}`;
    const prefetch = new Audio();
    prefetch.src = url;
    prefetch.preload = "auto";
}

function updateStorytellerState(forcedGender = null) {
    const container = document.getElementById("storytellerContainer");
    if (!container) return;

    if (!isReadingAloud) {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";

    const gender = forcedGender || currentNarratorGender;

    // 1. Mirror and resize logic
    if (gender === 'female') {
        container.classList.add("mirrored");
        container.classList.add("is-girl");
    } else {
        container.classList.remove("mirrored");
        container.classList.remove("is-girl");
    }

    // 2. Identify all 4 possible image states
    const states = {
        'female_play': 'storyteller_girl_gif',
        'female_pause': 'storyteller_girl_static',
        'male_play': 'storyteller_man_gif',
        'male_pause': 'storyteller_man_static'
    };

    const currentStateKey = `${gender === 'female' ? 'female' : 'male'}_${isPaused ? 'pause' : 'play'}`;
    const activeId = states[currentStateKey];

    // 3. ZERO-LAG SWAP: Toggle visibility of pre-loaded elements
    Object.values(states).forEach(id => {
        const img = document.getElementById(id);
        if (img) {
            img.style.display = (id === activeId) ? 'block' : 'none';
        }
    });

    // 4. SYNC PLAY/PAUSE BUTTON TEXT
    const playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn) {
        if (!isReadingAloud) {
            playPauseBtn.innerHTML = "🔊 <span>Read Full</span>";
        } else if (isPaused) {
            playPauseBtn.innerHTML = "▶ <span>Resume</span>";
        } else {
            playPauseBtn.innerHTML = "⏸ <span>Pause</span>";
        }
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
const bookmarkHighlight = (typeof Highlight !== 'undefined') ? new Highlight() : null;

if (typeof CSS !== 'undefined' && CSS.highlights) {
    if (readingHighlight) CSS.highlights.set('reading-word', readingHighlight);
    if (sentenceHighlight) CSS.highlights.set('reading-sentence', sentenceHighlight);
    if (bookmarkHighlight) CSS.highlights.set('bookmark-highlight', bookmarkHighlight);
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
    } catch (err) {
        console.error("Dictionary error:", err);
        meaningObj.innerText = "Network Error";
    }
}

function upload() {
    let input = document.getElementById("file");
    let file = input ? input.files[0] : null;

    if (!file) {
        showUploadToast("Please choose a file first.", "warn");
        return;
    }

    const renameInput = document.getElementById('dashboardBookRenameInputSidebar');
    const customName = renameInput ? renameInput.value.trim() : "";

    let form = new FormData();
    form.append("file", file);
    if (customName) {
        form.append("custom_name", customName);
    }

    // Show uploading indicator
    showUploadToast("⏳ Uploading " + (customName || file.name) + "...", "info");

    const uploadBtn = document.getElementById('btnConfirmAddBookSidebar');
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    }

    fetch("/upload", {
        method: "POST",
        body: form
    })
        .then(async res => {
            let data = await res.json().catch(() => ({ message: "Unknown error" }));
            if (res.status === 409) {
                showUploadToast("📚 " + data.message, "warn");
                if (uploadBtn) {
                    uploadBtn.disabled = false;
                    uploadBtn.innerText = "Upload Book";
                }
                return;
            }
            if (!res.ok) {
                showUploadToast("❌ Upload failed: " + data.message, "error");
                if (uploadBtn) {
                    uploadBtn.disabled = false;
                    uploadBtn.innerText = "Upload Book";
                }
                return;
            }
            // Success
            showUploadToast("✅ Book uploaded successfully!", "success");
            resetSidebarUpload();
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerText = "Upload Book";
            }
            setTimeout(() => loadBooks(), 600);
        })
        .catch(err => {
            console.error(err);
            showUploadToast("❌ Upload failed. Check your connection.", "error");
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerText = "Upload Book";
            }
        });
}

function handleSidebarFileSelection() {
    const input = document.getElementById('file');
    const chooseBtn = document.getElementById('dashboardChooseFileBtnSidebar');
    const renameWrapper = document.getElementById('dashboardRenameWrapperSidebar');
    const renameInput = document.getElementById('dashboardBookRenameInputSidebar');
    const confirmBtn = document.getElementById('btnConfirmAddBookSidebar');

    if (!input || !input.files || input.files.length === 0) return;

    const file = input.files[0];
    const nameWithoutExt = file.name.split('.').slice(0, -1).join('.');
    const finalName = nameWithoutExt || file.name;

    if (chooseBtn) chooseBtn.style.display = 'none';
    if (renameWrapper) renameWrapper.style.display = 'flex';
    if (renameInput) {
        renameInput.value = finalName;
        setTimeout(() => renameInput.focus(), 50);
    }
    if (confirmBtn) confirmBtn.style.display = 'flex';

    showUploadToast(`Selected: ${file.name}. Rename if you wish!`, "info");
}

function resetSidebarUpload() {
    const input = document.getElementById('file');
    if (input) input.value = "";

    const chooseBtn = document.getElementById('dashboardChooseFileBtnSidebar');
    const renameWrapper = document.getElementById('dashboardRenameWrapperSidebar');
    const confirmBtn = document.getElementById('btnConfirmAddBookSidebar');

    if (chooseBtn) chooseBtn.style.display = 'flex';
    if (renameWrapper) renameWrapper.style.display = 'none';
    if (confirmBtn) confirmBtn.style.display = 'none';
    
    showUploadToast("Selection cancelled", "info");
}

function showUploadToast(msg, type) {
    let existing = document.getElementById("uploadToast");
    if (existing) existing.remove();

    let colors = {
        success: "#2d6a4f",
        warn: "#b5451b",
        error: "#7f1d1d",
        info: "#1e3a5f"
    };
    
    let icons = {
        success: '<i class="fas fa-check-circle" style="margin-right: 8px;"></i>',
        warn: '<i class="fas fa-exclamation-triangle" style="margin-right: 8px;"></i>',
        error: '<i class="fas fa-exclamation-circle" style="margin-right: 8px;"></i>',
        info: '<i class="fas fa-info-circle" style="margin-right: 8px;"></i>'
    };

    let bg = colors[type] || colors.info;
    let icon = icons[type] || icons.info;

    // Remove any leading emojis or spaces from the message
    let cleanMsg = msg.replace(/^[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, '');

    let toast = document.createElement("div");
    toast.id = "uploadToast";
    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: ${bg}; color: #fff; padding: 12px 24px; border-radius: 12px;
        font-size: 0.9rem; font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,0.35);
        z-index: 100000; animation: toastIn 0.3s ease; max-width: 380px; text-align: center;
        display: flex; align-items: center; justify-content: center;
    `;
    toast.innerHTML = icon + `<span>${cleanMsg}</span>`;
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
            activeBooksList = data;

            // Sync filter buttons
            syncFilterButtons();

            // Sync both Library views
            renderDashboard(data);
            loadCollaborations();
            if (typeof fetchVoiceNotes === "function") fetchVoiceNotes();

            let list = document.getElementById("booklist");
            list.innerHTML = "";

            let hasProcessing = false;

            data.forEach(book => {
                let [id, name, uploaded_at, status, thumb, summary, time, is_fav, bCount, nCount, relation, pageCount, sharerName] = book;

                // Clean the name for display: "my_book.pdf" -> "My Book"
                const cleanName = name.replace(/_/g, ' ')
                    .replace(/\.(pdf|epub|docx|txt)$/i, '')
                    .split(' ')
                    .map(w => w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)
                    .join(' ');

                const sLower = (status || "").toLowerCase();
                const isProcessing = sLower.includes("processing") || sLower.includes("analyzing") || sLower.includes("upgrading") || sLower.includes("extracting");

                if (isProcessing) hasProcessing = true;

                let tr = document.createElement("tr");
                tr.setAttribute("data-book-id", id);
                tr.setAttribute("data-is-favourite", is_fav ? "1" : "0");
                tr.setAttribute("data-bookmark-count", bCount || 0);

                if (currentBookId && id == currentBookId) {
                    tr.classList.add("active-book-row");
                }

                let badge = "";
                let btnClass = "";
                if (isProcessing) {
                    badge = `<span class="processing-badge"><span class="spinner"></span> Processing…</span>`;
                    btnClass = "processing-btn";
                } else if (status === "error") {
                    badge = `<span class="processing-badge" style="background:#7f1d1d;color:#fca5a5;">❌ Failed</span>`;
                }

                let isActive = (currentBookId && id == currentBookId);
                let openBtnText = isActive ? "Active" : "Open";
                let openBtn = (!isProcessing && status !== "error")
                    ? `<button class="btn-open ${isActive ? 'active-pulse' : ''}" onclick="openBook(${id})"><i class="fas fa-book-open"></i> <span>${openBtnText}</span></button>`
                    : `<button disabled class="btn-open processing-btn" style="opacity:0.6;cursor:not-allowed;"><span>${isProcessing ? 'Wait...' : 'Open'}</span></button>`;

                let downloadBtn = (!isProcessing && status !== "error")
                    ? `<button class="btn-download" onclick="downloadBook(${book[0]}, '${book[1].replace(/'/g, "\\'")}')" title="Download Book"><i class="fas fa-download"></i></button>`
                    : `<button disabled class="btn-download" style="opacity:0.4;cursor:not-allowed;" title="Download Book"><i class="fas fa-download"></i></button>`;

                tr.innerHTML = `
                <td>
                    <div class="book-entry">
                        <div class="book-main-info">
                            <div class="book-title-row">
                                <span class="book-name"><i class="fas fa-book" style="color:var(--primary); margin-right:10px; font-size:0.95rem; opacity:0.8;"></i>${cleanName}</span>
                                <button class="btn-sidebar-fav ${is_fav ? 'active' : ''}" onclick="toggleFavorite(${id}, this)" title="${is_fav ? 'Unfavorite' : 'Add to Favorites'}">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="${is_fav ? '#ef4444' : 'none'}" stroke="${is_fav ? '#ef4444' : 'var(--text-light)'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="overflow: visible;">
                                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                                    </svg>
                                </button>
                            </div>
                            ${relation === 'shared_by_me' ? 
                                '<div class="original-badge" style="background: rgba(245, 158, 11, 0.1); color: #f59e0b; border-color: rgba(245, 158, 11, 0.2); display: flex; align-items: center; gap: 5px;"><i class="fas fa-share-alt" style="font-size: 0.65rem;"></i> YOU SHARED</div>' : ''
                            }
                            ${relation === 'shared_with_me' ? 
                                '<div class="shared-badge" style="display: flex; align-items: center; gap: 5px;"><i class="fas fa-user-friends" style="font-size: 0.65rem;"></i> THEY SHARED BY ' + (sharerName || 'COLLABORATOR').toUpperCase() + '</div>' : ''
                            }
                            <div class="book-metadata">
                                <span><i class="far fa-calendar-alt"></i> ${book[2].split(' ')[0]}</span>
                                <span><i class="far fa-file-alt"></i> ${book[11] || 0} Pages</span>
                            </div>
                        </div>
                        <div class="book-footer-actions">
                            ${openBtn}
                            ${downloadBtn}
                            <button class="btn-delete" onclick="deleteBook(${id})" title="Delete Book"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    </div>
                </td>
                `;

                list.appendChild(tr);
            });

            // Populate AI Chat Book Selector
            const chatSelector = document.getElementById('chatBookFocus');
            if (chatSelector) {
                const currentVal = chatSelector.value;
                chatSelector.innerHTML = '<option value="">General Chat</option>';
                data.forEach(book => {
                    const [id, name] = book;
                    const cleanName = name.replace(/_/g, ' ').replace(/\.(pdf|epub|docx|txt)$/i, '');
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.innerText = `Focus: ${cleanName}`;
                    chatSelector.appendChild(opt);
                });
                // Keep selection if it still exists
                if (currentVal) chatSelector.value = currentVal;
                else if (window.currentBookId) chatSelector.value = window.currentBookId;
            }

            // Auto-refresh every 3s while any book is still processing
            if (hasProcessing) {
                if (!_processingPollTimer) {
                    _processingPollTimer = setInterval(() => {
                        const overlay = document.getElementById("dashboardOverlay");
                        if (!overlay || overlay.style.display === "none") {
                            clearInterval(_processingPollTimer);
                            _processingPollTimer = null;
                            return;
                        }
                        loadBooks().then(d => {
                            let stillProcessing = (d || []).some(b => {
                                const s = (b[3] || "ready").toLowerCase();
                                return s.includes("processing") || s.includes("analyzing") || s.includes("upgrading");
                            });
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
            console.error("❌ Library Sync Failed:", err);
            const container = document.getElementById('dashboardBooksContainer');
            if (container) container.innerHTML = `
                <div class="text-center p-5">
                    <i class="fas fa-exclamation-triangle mb-3" style="font-size: 2rem; color: #f59e0b;"></i>
                    <h4>Library temporarily unavailable</h4>
                    <p class="text-muted">The server is busy or restarting. Please try again in a moment.</p>
                    <button class="btn btn-outline-primary mt-2" onclick="loadBooks()">Retry Sync</button>
                </div>
            `;
        });
}

function filterBooks() {
    const searchEl = document.getElementById("librarySearch");
    let filter = searchEl ? searchEl.value.toLowerCase() : "";
    let rows = document.querySelectorAll("#booklist tr");

    rows.forEach(tr => {
        let nameEl = tr.querySelector(".book-name");
        let isFav = tr.getAttribute("data-is-favourite") === "1";

        if (nameEl) {
            let bookName = nameEl.innerText.toLowerCase();
            let shouldShow = bookName.includes(filter);

            if (onlyFavoritesFilter && !isFav) {
                shouldShow = false;
            }
            if (onlyBookmarksFilter && parseInt(tr.getAttribute("data-bookmark-count") || "0") === 0) {
                shouldShow = false;
            }

            tr.style.display = shouldShow ? "" : "none";
        }
    });
}

let onlyFavoritesFilter = false;

function toggleFavoritesFilter() {
    onlyFavoritesFilter = !onlyFavoritesFilter;
    if (onlyFavoritesFilter) onlyBookmarksFilter = false; // Mutually exclusive for better UX
    syncFilterButtons();
    filterDashboard();
    filterBooks();
}

let onlyBookmarksFilter = false;
function toggleBookmarksFilter(forceValue = null) {
    if (forceValue !== null) {
        onlyBookmarksFilter = forceValue;
    } else {
        onlyBookmarksFilter = !onlyBookmarksFilter;
    }

    if (onlyBookmarksFilter) onlyFavoritesFilter = false; // Mutually exclusive

    syncFilterButtons();
    filterDashboard();
    filterBooks();
}

function syncFilterButtons() {
    // Sync Favorites Buttons
    const favBtns = [
        document.getElementById("btnFilterFavs"),
        document.getElementById("sidebarBtnFilterFavs"),
        document.getElementById("btnFilterFavsMobile")
    ];
    favBtns.forEach(btn => {
        if (btn) {
            if (onlyFavoritesFilter) {
                btn.classList.add("active");
                let svg = btn.querySelector("svg");
                if (svg) svg.setAttribute("fill", "currentColor");
            } else {
                btn.classList.remove("active");
                let svg = btn.querySelector("svg");
                if (svg) svg.setAttribute("fill", "none");
            }
        }
    });

    // Handle visual feedback for Bookmarks filter
    const bookmarkStatCard = document.getElementById("bookmarkStatCard");
    if (bookmarkStatCard) {
        if (onlyBookmarksFilter) {
            bookmarkStatCard.style.borderColor = "#ff9f43";
            bookmarkStatCard.style.background = "rgba(255, 159, 67, 0.1)";
        } else {
            bookmarkStatCard.style.borderColor = "var(--glass-border)";
            bookmarkStatCard.style.background = "rgba(255,255,255,0.03)";
        }
    }
}
function showLoader(msg) {
    const loader = document.getElementById("simpleLoader");
    const loaderText = document.getElementById("loaderText");
    const bookState = document.getElementById("loaderBookState");
    const transState = document.getElementById("loaderTranslateState");
    const thankYou = document.getElementById("thankYouState");

    if (thankYou) thankYou.style.display = "none";
    if (loaderText) loaderText.innerText = msg || "Loading book...";
    if (loader) loader.style.display = "flex";

    // Show Book Opening state by default for normal loader
    if (bookState) bookState.style.display = "flex";
    if (transState) transState.style.display = "none";

    const reader = document.getElementById("reader");
    if (reader) {
        reader.classList.add('no-spine-shadow');
        reader.style.opacity = "0";
    }
}

function showTranslationLoader(msg) {
    const loader = document.getElementById("simpleLoader");
    const loaderText = document.getElementById("loaderText");
    const bookState = document.getElementById("loaderBookState");
    const transState = document.getElementById("loaderTranslateState");

    if (loaderText) loaderText.innerText = msg || "Translating...";
    if (loader) loader.style.display = "flex";

    // Show Neural Translation state
    if (bookState) bookState.style.display = "none";
    if (transState) transState.style.display = "flex";
}

function hideLoader() {
    const loader = document.getElementById("simpleLoader");
    const bookState = document.getElementById("loaderBookState");
    const transState = document.getElementById("loaderTranslateState");

    if (loader) loader.style.display = "none";
    if (bookState) bookState.style.display = "none";
    if (transState) transState.style.display = "none";

    const reader = document.getElementById("reader");
    if (reader) {
        reader.classList.remove('no-spine-shadow');
        reader.style.opacity = "1";
    }
}

// Bookmark Helper
// Bookmark Helper
function showConfirmModal(title, text, primaryText, secondaryText, tertiaryText, onPrimary, onSecondary, onTertiary, isDestructive = false) {
    const modal = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmTitle");
    const textEl = document.getElementById("confirmText");
    const primaryBtn = document.getElementById("confirmPrimaryBtn");
    const secondaryBtn = document.getElementById("confirmSecondaryBtn");
    const tertiaryBtn = document.getElementById("confirmTertiaryBtn");

    if (!modal || !titleEl || !textEl || !primaryBtn || !secondaryBtn || !tertiaryBtn) return;

    titleEl.innerText = title;
    textEl.innerText = text;
    primaryBtn.innerText = primaryText;
    secondaryBtn.innerText = secondaryText;

    // Apply destructive styling if requested
    if (isDestructive) {
        primaryBtn.classList.remove('btn-primary');
        primaryBtn.classList.add('btn-danger');
    } else {
        primaryBtn.classList.remove('btn-danger');
        primaryBtn.classList.add('btn-primary');
    }

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
    const placeholder = document.getElementById("emptyBookPlaceholder");
    if (placeholder) placeholder.style.display = "none";

    // ⚡ INSTANT CANCELLATION: Kill everything from the previous book immediately
    // Don't wait for the new book's fetch to return.
    const myRenderJobId = Date.now();
    window._currentRenderJobId = myRenderJobId;
    window.activeTranslationJob = myRenderJobId;

    // Stop expensive tasks
    isReadingAloud = false;
    isPaused = false;
    if (typeof stopReading === 'function') stopReading();
    if (typeof stopStudyTimer === 'function') stopStudyTimer();
    hasMadeSessionDrawing = false; // Reset drawing flag for new book

    // 🧹 PRE-FETCH CLEANUP: Clear massive strings and DOM right now
    currentBookText = "";
    if (window._currentBookPages) window._currentBookPages = [];
    window.originalBookContent = null;
    window.currentTargetLang = "orig";

    // Detach old DOM instantly to help GC
    let reader = document.getElementById("reader");
    if (reader) {
        reader.replaceChildren(); // High-performance alternative to while-loop
    }

    let bookmarkIndex = currentAbsoluteCharIndex;
    let oldBookId = currentBookId;

    // If switching books and we have progress, ask to save bookmark
    if (oldBookId && oldBookId !== bookId && bookmarkIndex > 0) {
        showConfirmModal(
            "Save Progress?",
            "Would you like to save your current position before switching books?",
            "Save Bookmark",
            "Don't Save",
            "Cancel",
            () => {
                localStorage.setItem(`bookmark_${oldBookId}`, bookmarkIndex);
                resetReadingSession(); // Still call for deep variable reset
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
    currentBookId = bookId;
    proceedToOpenBook(bookId);

    // Load recommendations async
    setTimeout(() => loadRecommendations(), 1000);
}


function proceedToOpenBook(bookId) {
    const placeholder = document.getElementById("emptyBookPlaceholder");
    if (placeholder) placeholder.style.display = "none";
    const voiceBtn = document.getElementById("voiceBtn");
    if (voiceBtn) voiceBtn.style.display = "flex";
    const drawFab = document.getElementById("floatingDrawFab");
    if (drawFab) drawFab.style.display = "flex";
    showLoader();
    window._pendingBookmarkResume = null; // Clear old book's residue
    window._isRenderingFinished = false; // Track if rendering is done for late-arriving bookmarks

    // 🔖 PARALLEL BOOKMARK FETCH: Start fetching immediately while the book content is loading
    // This ensures we have the resume target ready by the time the first batch renders.
    fetch(`/bookmarks/${bookId}`)
        .then(r => r.json())
        .then(list => {
            if (list && list.length > 0) {
                const bm = list[0];
                const resumeData = {
                    charIndex: bm.char_index,
                    page: bm.page_number,
                    scrollY: bm.scroll_y
                };

                if (window._isRenderingFinished) {
                    // Safety: If rendering already completed before fetch returned, jump now
                    console.log("📍 Late-arriving bookmark. Jumping now.");
                    jumpToBookmark(resumeData.page, resumeData.scrollY, true, resumeData.charIndex);
                } else {
                    window._pendingBookmarkResume = resumeData;
                }
            }
        })
        .catch(e => console.log("Bookmark check bypassed.", e));

    fetch("/book/" + bookId)
        .then(res => res.json())
        .then(async data => {
            if (data.error) {
                hideLoader();
                showUploadToast(data.error, "error");
                return;
            }

            currentBookId = bookId;
            currentBookName = data.name || "Untitled";
            currentBookText = data.text || "";
            currentBookDetectedLangCode = data.detected_lang || "en";

            // 🛡️ IMMEDIATE LAST-READ STAMP: Ensure this book shows up in the dashboard INSTANTLY 
            // even if the user only looks at it for a second.
            fetch("/update_reading_time", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book_id: currentBookId, seconds: 0 })
            });

            // Start precision time logging (10s heartbeats) for the chart
            startReadingPulse();

            // Update Floating Badge and reveal it
            const bookTitleEl = document.getElementById("bookTitle");
            const bookBadgeEl = document.getElementById("bookBadge");
            const readerFavBtn = document.getElementById("readerFavoriteBtn");

            if (bookTitleEl) bookTitleEl.innerText = data.name;

            if (bookBadgeEl) bookBadgeEl.classList.add('visible');
            const drawFab = document.getElementById('floatingDrawFab');
            if (drawFab) drawFab.style.display = 'flex';

            // Highlight active book in sidebar instantly
            document.querySelectorAll("#booklist tr").forEach(row => {
                const rowId = row.getAttribute("data-book-id");
                const openBtn = row.querySelector(".btn-open");
                if (rowId == bookId) {
                    row.classList.add("active-book-row");
                    if (openBtn) {
                        openBtn.classList.add("active-pulse");
                        openBtn.innerText = "Active";
                    }
                } else {
                    row.classList.remove("active-book-row");
                    if (openBtn && !openBtn.classList.contains("processing-btn")) {
                        openBtn.classList.remove("active-pulse");
                        openBtn.innerText = "Open";
                    }
                }
            });

            if (readerFavBtn) {
                if (data.is_favorite) {
                    readerFavBtn.classList.add('active');
                    readerFavBtn.title = "Unfavorite";
                } else {
                    readerFavBtn.classList.remove('active');
                    readerFavBtn.title = "Add to Favorites";
                }
            }

            startStudyTimer(data.reading_time || 0);

            // Clear progress on new book
            const progEl = document.getElementById("readingProgress");
            if (progEl) progEl.innerText = "| 0% Read";

            // TRANSLATION RESET: Critical for preventing "language bleeding" between book loads
            window.currentTargetLang = 'orig';
            window.activeTranslationJob = Date.now(); // Instantly kills any stale background jobs
            if (window.activeTranslationObserver) {
                window.activeTranslationObserver.disconnect();
                window.activeTranslationObserver = null;
            }

            let reader = document.getElementById("reader");
            let detectedLang = "Original Language";

            let langSelectBtn = document.getElementById("langSelect");
            if (langSelectBtn) {
                langSelectBtn.value = "orig";

                // Dynamic Language Labeling
                // Take a safe sample for detection without blowing up memory on massive books
                let rawText = data.text || "";
                let detectionSample = rawText;
                
                // Remove head, style, script content entirely
                detectionSample = detectionSample.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ');
                detectionSample = detectionSample.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
                detectionSample = detectionSample.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
                // Remove base64 images
                detectionSample = detectionSample.replace(/src=["']data:image\/[^"']+["']/g, '');
                // Remove remaining HTML tags
                detectionSample = detectionSample.replace(/<[^>]*>/g, ' ');
                // Remove URLs & emails
                detectionSample = detectionSample.replace(/https?:\/\/\S+/g, ' ');
                detectionSample = detectionSample.replace(/\S+@\S+/g, ' ');
                
                // Now take a clean text sample for detection
                detectionSample = detectionSample.substring(0, 3000).trim();

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
                window.currentTargetLang = "orig";
                window.originalBookContent = null;
                window.activeTranslationJob = Date.now(); // Cancel any stale background translation jobs
            }

            // 1. FORCE THE CLEAN SLATE (Fast reset + DOM detachment)
            if (reader) {
                // High-performance clearing
                reader.replaceChildren();
                const contentCont = document.createElement('div');
                contentCont.className = 'book-content-container';
                reader.appendChild(contentCont);
                reader.scrollTop = 0;
                reader.scrollLeft = 0;
            }
            let container = reader.querySelector('.book-content-container');

            // Efficiently split currentBookText into individual pages without massive memory duplication
            let pageChunks = [];
            window._currentBookPages = pageChunks; // Global reference for cleanup

            // 1. Optimized splitting with index-based substring search
            // Use a larger sample for detection to handle books with heavy metadata or large first-page assets.
            const head = currentBookText.substring(0, 500000);
            let splitMarker = head.includes('id="pdf-page-') ? '<div id="pdf-page-' : (head.includes("id='pdf-page-") ? "<div id='pdf-page-" : null);

            if (splitMarker) {
                let markerIdx = currentBookText.indexOf(splitMarker);
                if (markerIdx !== -1) {
                    while (markerIdx !== -1) {
                        let nextMarkerIdx = currentBookText.indexOf(splitMarker, markerIdx + 1);
                        if (nextMarkerIdx !== -1) {
                            pageChunks.push(currentBookText.substring(markerIdx, nextMarkerIdx));
                        } else {
                            pageChunks.push(currentBookText.substring(markerIdx));
                        }
                        markerIdx = nextMarkerIdx;

                        // Yielding more frequently for massive books to keep UI snappy
                        if (pageChunks.length % 100 === 0) {
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                }
            }

            // 2. Fallback for older PPT slides or other block-like structures
            if (pageChunks.length === 0) {
                const headSample = currentBookText.substring(0, 50000);
                const hasSlidePattern = headSample.includes('Slide ') || headSample.includes('pptx-slide') || headSample.includes('aspect-ratio: 16/9') || headSample.includes('lazy-page-container') || headSample.includes('slide-');

                if (hasSlidePattern) {
                    // Optimized DOM parsing: increased limit to 20MB to handle large textbooks.
                    if (currentBookText.length < 20000000) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = currentBookText;
                        const blocks = tempDiv.querySelectorAll('.lazy-page-container, .reader-page, .pptx-slide, div[style*="aspect-ratio: 16/9"], div[id*="page-"], div[class*="slide-"]');
                        if (blocks.length > 0) {
                            blocks.forEach((b, i) => {
                                b.id = `pdf-page-${i}`;
                                b.classList.add('lazy-page-container');
                                pageChunks.push(b.outerHTML);
                            });
                        }
                        tempDiv.innerHTML = ""; // Fast cleanup
                    }
                }
            }

            if (pageChunks.length === 0 && currentBookText.trim()) {
                if (container) container.innerHTML = currentBookText;
                hideLoader();
            }

            // Once split, we can potentially null out currentBookText if we only use pageChunks
            // but we need it for 'Find in Book' and TTS. So we keep it but ensure it's not duplicated.

            totalPages = pageChunks.length || (currentBookText.trim() ? 1 : 0);
            updatePagesList();

            let containerW = reader.clientWidth - 20;
            // Mobile width safety: Ensure it doesn't shrink due to initial layout calculations
            if (window.innerWidth < 992) {
                containerW = Math.max(containerW, window.innerWidth - 40);
            }
            let renderedCount = 0;
            const myRenderJobId = Date.now();
            window._currentRenderJobId = myRenderJobId;

            async function renderBatch(startIndex) {
                if (myRenderJobId !== window._currentRenderJobId) {
                    console.log("🛑 Stale render job detected. Terminating batch for old book.");
                    return;
                }
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

                    // DYNAMIC TRANSLATION HOOK: Ensure lazy-rendered pages are observed for translation
                    if (window.activeTranslationObserver) {
                        window.activeTranslationObserver.observe(pageWrapper);
                    }

                    // 🛠️ INSTANT NORMALIZATION: Clean soft-hyphens/spaces IMMEDIATELY
                    // This ensures charIndex mapping is STABLE before any jump occurs.
                    await normalizeBookDOM(pageWrapper);

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

                // CHECKPOINT: If we are resuming from a bookmark, check if the target page is now available
                if (window._pendingBookmarkResume) {
                    const pb = window._pendingBookmarkResume;
                    // page_number is 1-indexed, pdf-page-N is 0-indexed
                    if (pb.page <= endIndex) {
                        console.log("📍 Bookmark target page rendered. Jumping now...");
                        jumpToBookmark(pb.page, pb.scrollY, true, pb.charIndex);
                        window._pendingBookmarkResume = null; // Successfully resumed
                    }
                }

                if (renderedCount < pageChunks.length) {
                    // Return to main thread to keep UI responsive. 
                    const yieldTime = isMassive ? 35 : 12;
                    await new Promise(r => setTimeout(r, yieldTime));
                    return renderBatch(renderedCount);
                } else {
                    // Final pass once everything is rendered
                    applyExistingHighlights();
                    renderBookmarkIcons();

                    // Final fallback check if bookmark was never cleared (e.g. for massive books)
                    if (window._pendingBookmarkResume) {
                        const pb = window._pendingBookmarkResume;
                        jumpToBookmark(pb.page, pb.scrollY, true, pb.charIndex);
                        window._pendingBookmarkResume = null;
                    }
                    window._isRenderingFinished = true;
                }
            }

            currentAbsoluteCharIndex = 0;
            renderBatch(0);

            loadHighlights(bookId);
            setTimeout(() => initDrawingForBook(bookId), 500);
            setTimeout(renderBookmarkIcons, 1500); // Wait for initial render

        })
        .catch(err => {
            console.error("Reader Fetch Error:", err);
            hideLoader();
            showUploadToast("📚 Reader Error: " + (err.message || "Connection failed. Please try again."), "error");
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
    showConfirmModal(
        "Permanently Delete?",
        "This will erase this book from your library. This action cannot be undone.",
        "Delete Book",
        "Keep Book",
        "Cancel",
        () => {
            // Check if we are deleting the currently open book
            const isDeletingActiveBook = (typeof currentBookId !== 'undefined' && currentBookId == bookId);

            if (isDeletingActiveBook) {
                resetReadingSession();
                let playPauseBtn = document.getElementById("playPauseBtn");
                if (playPauseBtn) playPauseBtn.innerHTML = "🔊 <span>Read Full</span>";

                const voiceBtn = document.getElementById("voiceBtn");
                if (voiceBtn) voiceBtn.style.display = "none";

                document.getElementById("reader").innerHTML = '<div class="empty-state">Select a book from the sidebar to start reading.</div>';
                document.getElementById("bookTitle").innerText = "No book selected";
                const badge = document.getElementById("bookBadge");
                if (badge) badge.classList.remove('visible');
                currentBookId = null;
            }

            fetch("/delete_book/" + bookId, { method: "POST" })
                .then(res => res.json())
                .then(data => {
                    showUploadToast(data.message || data.error, data.error ? "error" : "success");
                    loadBooks();
                });
        },
        () => { /* Stay - no action */ },
        () => { /* Cancel - no action */ },
        true // isDestructive
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
        // Robust intersection check: If selection overlaps with an existing highlight
        const isOverlap = (rangeData.startChar < jh.endChar && rangeData.endChar > jh.startChar);
        if (!isOverlap) return false;

        // Ensure we aren't accidentally toggling off a highlight just because we brushed past it
        // Check if the intersection is meaningful
        const startDiff = Math.abs(jh.startChar - rangeData.startChar);
        const endDiff = Math.abs(jh.endChar - rangeData.endChar);

        // Match if offsets are very close OR if selection is completely inside the existing highlight (Sub-selection for un-highlighting)
        return (startDiff < 15 && endDiff < 15) || (rangeData.startChar >= jh.startChar && rangeData.endChar <= jh.endChar);
    });

    // --- Precision Un-highlighting (Punch-Hole Logic) ---
    let overlaps = currentHighlights.filter(h => {
        let jh = typeof h === 'string' ? JSON.parse(h) : h;
        return (rangeData.startChar < jh.endChar && rangeData.endChar > jh.startChar);
    });

    if (overlaps.length > 0) {
        console.log("Toggle OFF/Precision Trim: Found overlaps", overlaps.length);

        let newSegments = [];
        overlaps.forEach(h => {
            let jh = typeof h === 'string' ? JSON.parse(h) : h;

            // Case 1: Keep start of original highlight if it precedes our un-highlight selection
            if (jh.startChar < rangeData.startChar) {
                newSegments.push(JSON.stringify({
                    startChar: jh.startChar,
                    endChar: rangeData.startChar,
                    text: jh.text.substring(0, rangeData.startChar - jh.startChar)
                }));
            }
            // Case 2: Keep end of original highlight if it follows our un-highlight selection
            if (jh.endChar > rangeData.endChar) {
                newSegments.push(JSON.stringify({
                    startChar: rangeData.endChar,
                    endChar: jh.endChar,
                    text: jh.text.substring(rangeData.endChar - jh.startChar)
                }));
            }

            // Remove original from total and server
            fetch("/delete_highlight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book_id: currentBookId, highlighted_text: h })
            });

            let idx = currentHighlights.indexOf(h);
            if (idx !== -1) currentHighlights.splice(idx, 1);
        });

        // Add the new carved-out segments
        newSegments.forEach(seg => {
            currentHighlights.push(seg);
            fetch("/save_highlight", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ book_id: currentBookId, highlighted_text: seg })
            });
        });

        // Refresh UI
        clearManualHighlights();
        applyExistingHighlights();
        // ALSO RESTORE BOOKMARKS & TTS BOUNDS: Toggling a highlight splits DOM nodes.
        renderBookmarkIcons();
        rebuildReadingNodeMap();

        if (toolbar) toolbar.style.display = "none";
        if (selection) selection.removeAllRanges();
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
        if (res.ok) {
            console.log("Highlight saved to server");
            // CRITICAL: Re-render bookmarks because highlightAbsoluteRange splits text nodes,
            // which can displace or remove existing bookmark symbols and highlight layers.
            renderBookmarkIcons();
        }
    }).catch(err => console.error("Error saving highlight:", err));

    // Cleanup
    if (toolbar) toolbar.style.display = "none";
    if (selection) selection.removeAllRanges();
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
        while (node = walker.nextNode()) last = node;
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
            try { parent.replaceChild(span, node); } catch (e) { }
        } else {
            let beforeText = nodeText.slice(0, sliceStart);
            let midText = nodeText.slice(sliceStart, sliceEnd);
            let afterText = nodeText.slice(sliceEnd);

            let span = document.createElement("span");
            span.className = className;
            span.textContent = midText;

            if (afterText) {
                try { parent.insertBefore(document.createTextNode(afterText), node.nextSibling); } catch (e) { }
            }
            try { parent.insertBefore(span, node.nextSibling); } catch (e) { }
            if (beforeText) {
                node.nodeValue = beforeText;
            } else {
                try { parent.removeChild(node); } catch (e) { }
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
        } catch (e) { }
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
    while (walker.nextNode()) {
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
let emotionCache = new Map(); // Global Emotion Cache to eliminate all LAG
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
            let prevNode = nodesToProcess[i - 1];
            let prevVal = prevNode.nodeValue;
            if (prevVal.length > 0 && !prevVal.endsWith(" ") && !prevVal.endsWith("\n") && !val.startsWith(" ") && !val.startsWith("\n")) {
                // If they are in different parents, or have elements like <br> between them
                if (node.parentNode !== prevNode.parentNode || node.previousSibling !== prevNode) {
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

function getNodesAndText(root, targetPages = null, startOffset = 0) {
    let nodes = [];
    let offsets = [];
    let parts = [];
    let currentLen = startOffset; // Start from global offset

    const itemsToScan = (targetPages && targetPages.length > 0) ? targetPages : [root];

    itemsToScan.forEach((scope, scopeIdx) => {
        // CRITICAL: Add newline bridge between pages to match rebuildReadingNodeMap's +1 logic
        if (scopeIdx > 0) {
            parts.push("\n");
            currentLen++;
        }

        let walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null, false);
        let lastParent = null;
        let lastNode = null;

        while (walker.nextNode()) {
            let node = walker.currentNode;
            let parent = node.parentNode;

            // 1. VISIBILITY CHECK (Skip hidden elements)
            if (!parent || parent === root) {
                // Root level is fine
            } else if (parent !== lastParent) {
                lastParent = parent;
                let isVisible = true;
                let curr = parent;
                while (curr && curr !== root) {
                    if (curr._is_ai_visible !== undefined) {
                        isVisible = curr._is_ai_visible;
                        break;
                    }
                    if (curr.classList && (
                        curr.classList.contains('reading-mark') ||
                        curr.classList.contains('junk-metadata-layer') ||
                        curr.classList.contains('scanned-junk-hidden')
                    )) {
                        isVisible = false;
                        break;
                    }
                    curr = curr.parentNode;
                }
                parent._is_ai_visible = isVisible;
            }
            if (parent && parent._is_ai_visible === false) continue;

            if (!node.nodeValue || node.nodeValue.trim().length === 0) continue;

            // 2. SPACE INJECTION (Inject virtual spaces between elements)
            if (lastParent && parts.length > 0) {
                let lastPart = parts[parts.length - 1];
                const hasBreak = (node.parentNode !== lastParent || node.previousSibling !== lastNode);
                const needsSpace = !lastPart.endsWith(" ") && !lastPart.endsWith("\n") &&
                    !node.nodeValue.startsWith(" ") && !node.nodeValue.startsWith("\n");

                if (hasBreak && needsSpace) {
                    parts.push(" ");
                    currentLen++;
                }
            }

            // 3. CAPTURE CONTENT
            let rawVal = node.nodeValue;
            let val = rawVal
                .replace(/\u00AD/g, '')  // REMOVE soft-hyphens
                .replace(/\u00A0/g, ' ') // MAP non-breaking spaces to standard spaces
                .replace(/\u200B/g, '')  // REMOVE zero-width spaces
                .replace(/\r/g, '');     // REMOVE carriage returns

            // CRITICAL SYNC: Update DOM node to match the cleaned map text exactly.
            // This prevents highlight drift caused by hidden characters like &shy;
            if (val !== rawVal) {
                node.nodeValue = val;
            }

            // 3b. METADATA FILTER (Skip technical filenames/IDs often found in image-based books)
            const lowerVal = val.toLowerCase().trim();
            const isTechnical = (
                lowerVal.includes(".png") || lowerVal.includes(".jpg") || lowerVal.includes(".jpeg") ||
                lowerVal.startsWith("img_") || lowerVal.startsWith("image_") ||
                (lowerVal.length > 30 && !lowerVal.includes(" ")) // Likely a long ID/hash
            );
            
            if (isTechnical) {
                continue; 
            }

            nodes.push(node);
            offsets.push(currentLen);
            parts.push(val);
            currentLen += val.length;
            lastParent = node.parentNode;
            lastNode = node;
        }
    });

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

    // CRITICAL: Gather text nodes first to avoid "First Match Only" bugs. 
    // Live TreeWalkers are invalidated when we modify the DOM (replaceChild).
    let walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null, false);
    let nodes = [];
    let n;
    while (n = walker.nextNode()) {
        nodes.push(n);
    }

    // Batch processing configuration
    const batchSize = 500;
    let nodeIndex = 0;

    function processBatch() {
        if (processId !== currentSearchProcessId) return; // Stale search

        let end = Math.min(nodeIndex + batchSize, nodes.length);
        for (; nodeIndex < end; nodeIndex++) {
            let node = nodes[nodeIndex];

            // Skip nodes that are already highlighted or detached
            if (!node.parentNode || node.parentNode.classList.contains('find-highlight')) continue;

            let text = node.nodeValue;
            if (text && regex.test(text)) {
                regex.lastIndex = 0; // Reset regex state
                let html = text.replace(regex, (match) => {
                    let idAttr = className === 'find-highlight' ? ` id="search-match-${searchMatchesFound++}"` : '';
                    return `<span class="${className}"${idAttr} style="background-color: var(--find-highlight) !important; color: white !important; border-radius: 2px; padding: 0 1px; display: inline;">${match}</span>`;
                });

                if (html !== text) {
                    let span = document.createElement("span");
                    span.innerHTML = html;
                    let parent = node.parentNode;
                    if (parent) parent.replaceChild(span, node);
                }
            }
        }

        if (nodeIndex < nodes.length) {
            // Schedule next batch
            setTimeout(processBatch, 0);
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

async function resumeReadingFromIndex(index, startPaused = false, forceExactPosition = false, stopIndex = -1) {
    window.currentReadingStopIndex = stopIndex;
    const playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn && !startPaused) {
        playPauseBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> <span>Preparing...</span>`;
    }

    // OPTIMIZATION: Skip map rebuild if it's already recently synced (within 3 seconds) 
    const now = Date.now();
    if (!window.lastMapRebuildTime || (now - window.lastMapRebuildTime > 3000) || forceExactPosition) {
        rebuildReadingNodeMap();
        window.lastMapRebuildTime = now;
    }

    if (!globalReadingText || !globalReadingText.trim() || (globalReadingText.length < 5 && !isReadingAloud)) {
        console.warn("No text found in reader after rebuild.", { nodes: globalTextNodes?.length, text: globalReadingText });
        showUploadToast("📚 No readable text found to narrate.", "error");
        if (playPauseBtn) playPauseBtn.innerHTML = "▶ <span>Read Full</span>";
        return;
    }

    // Resume from a safe word boundary to avoid repeated fragments, unless exactly requested
    if (!forceExactPosition) {
        index = getSafeResumeIndex(globalReadingText, index);
    }

    if (index >= globalReadingText.length) {
        stopReading(true);
        return;
    }

    window.speechSynthesis.resume(); // Ensure it's not paused before canceling (Chrome Fix)
    window.speechSynthesis.cancel();
    if (currentFallbackAudio) {
        currentFallbackAudio.pause();
        currentFallbackAudio.src = ""; // Force stop network stream
        currentFallbackAudio = null;
    }
    currentNarrationJobId++; // Invalidate any pending callbacks from previous sessions
    removeReadingMarks();
    window.lastAutoScrollTime = 0; // RE-ENABLE IMMEDIATE SCROLLING ON START

    isReadingAloud = true;
    isPaused = startPaused;
    updateStorytellerState();

    window.forceResumeScroll = true; // FORCE JUMP TO THE STARTING POINT
    currentAbsoluteCharIndex = index;

    // INSTANT JUMP: Don't wait for audio engine to start; reveal current reading point now.
    highlightReadingWord(index, 5);

    let text = globalReadingText;
    const windowOffset = window._mapWindowOffset || 0;
    
    // PERFORMANCE FIX: Only chunk the next 10,000 characters at a time.
    // We must adjust the 'index' by the 'windowOffset' because globalReadingText
    // only contains the text of the currently mapped windowed pages.
    let localIndex = Math.max(0, index - windowOffset);
    
    // 🛑 SELECTION LIMIT: If reading a specific selection, limit the chunking window to that range.
    let windowLimit = 10000;
    if (stopIndex !== -1) {
        windowLimit = Math.min(windowLimit, Math.max(0, stopIndex - windowOffset - localIndex));
    }
    
    let remainingText = text.substring(localIndex, localIndex + windowLimit);
    let chunks = [];
    let lastSplit = 0;

    // Fast boundary splitter for international support (includes Hindi/Japanese/Chinese full stops)
    const splitterRegex = /[.!?\n।。\?]/;
    for (let i = 0; i < remainingText.length; i++) {
        let isBoundary = splitterRegex.test(remainingText[i]);
        let nextChar = remainingText[i + 1];
        if (isBoundary && (!nextChar || !splitterRegex.test(nextChar))) {
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

    if (playPauseBtn) playPauseBtn.innerHTML = startPaused ? "▶ <span>Resume</span>" : "⏸ <span>Pause</span>";

    // PHASE 2: Use Native Speech (Instant) if a local voice exists, otherwise Fallback to Server TTS
    const voices = window.speechSynthesis.getVoices();
    const hasNativeVoice = getBestVoice(voices, testLang, currentNarratorGender);

    if (!hasNativeVoice) {
        playFallbackAudioQueue(chunks, chunkOffset, testShort, startPaused);
        return;
    }

    // PHASE 3: FETCH EMOTIONS IN BACKGROUND (FOR ENGLISH)
    const emotionBatch = chunks.map(c => c.trim()).filter(c => c.length > 0).slice(0, 50);
    if (emotionBatch.length > 0) {
        fetch("/analyze_emotion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts: emotionBatch })
        }).then(res => res.json()).then(emotions => {
            if (Array.isArray(emotions)) {
                emotions.forEach((em, i) => {
                    if (emotionBatch[i]) emotionCache.set(emotionBatch[i], em.emotion || 'neutral');
                });
            }
        }).catch(e => console.warn("Background Emotion Batching Failed:", e));
    }

    let totalTasks = chunks.filter(c => c.trim().length > 0).length;
    if (totalTasks === 0) {
        stopReading(true);
        return;
    }

    let completedTasks = 0;
    let runningOffset = chunkOffset;
    let activeSpeakerGender = currentNarratorGender;

    chunks.forEach((chunk, chunkIdx) => {
        let trimmed = chunk.trimStart();
        if (!trimmed) {
            runningOffset += chunk.length;
            return;
        }

        // DIALOGUE SPEAKER DETECTION: Catch names even if preceded by short intro text
        const speakerMatch = trimmed.substring(0, 60).match(/\b([A-Z][A-Za-z]{2,20})\s*:/);
        if (speakerMatch) {
            activeSpeakerGender = getGenderForName(speakerMatch[1]);
        }

        let leadingSpaces = chunk.length - trimmed.length;
        let actualStartOffset = runningOffset + leadingSpaces;
        runningOffset += chunk.length;

        let utterance = new SpeechSynthesisUtterance(trimmed);
        let lang = getSelectedLanguage();
        if (lang) {
            utterance.lang = lang;
            let voices = window.speechSynthesis.getVoices();
            let voice = getBestVoice(voices, lang, activeSpeakerGender);
            if (voice) utterance.voice = voice;
        }

        // Apply Emotion Modulation to Native Utterance
        let emotion = 'neutral';
        const cleanTrimmed = trimmed.trim();
        if (emotionCache.has(cleanTrimmed)) {
            const cached = emotionCache.get(cleanTrimmed);
            emotion = (typeof cached === 'string') ? cached : (cached.emotion || 'neutral');
        }

        let basePitch = 1.0;
        if (activeSpeakerGender === 'male') {
            basePitch = 0.85;
        } else {
            basePitch = 1.05;
        }

        if (emotion === 'happy') {
            utterance.pitch = basePitch * 1.08;
            utterance.rate = 1.05 * currentSpeed;
        } else if (emotion === 'surprised') {
            utterance.pitch = basePitch * 1.25;
            utterance.rate = 1.10 * currentSpeed;
        } else if (emotion === 'energetic') {
            utterance.pitch = basePitch * 1.18;
            utterance.rate = 1.15 * currentSpeed;
        } else if (emotion === 'question') {
            utterance.pitch = basePitch * 1.12;
            utterance.rate = 1.02 * currentSpeed;
        } else if (emotion === 'sad') {
            utterance.pitch = basePitch * 0.80;
            utterance.rate = 0.85 * currentSpeed;
            utterance.volume = 0.75;
        } else if (emotion === 'serious') {
            utterance.pitch = basePitch * 0.92;
            utterance.rate = 0.95 * currentSpeed;
        } else {
            utterance.pitch = basePitch;
            utterance.rate = 1.0 * currentSpeed;
        }

        const jobId = currentNarrationJobId;
        const speakerGenderForThisTask = activeSpeakerGender;
        let boundaryReceived = false;

        utterance.onboundary = function (event) {
            if (jobId !== currentNarrationJobId || event.name !== 'word') return;
            
            let absolutePos = actualStartOffset + event.charIndex;
            // Relaxed monotonic check: Only ignore if jump-back is very large (likely wrong chunk)
            if (absolutePos < currentAbsoluteCharIndex - 200) return;
            
            boundaryReceived = true;
            currentAbsoluteCharIndex = absolutePos;
            highlightReadingWord(absolutePos, event.charLength || 5);
        };

        utterance.onstart = function () {
            if (jobId !== currentNarrationJobId) return;
            updateStorytellerState(speakerGenderForThisTask);
            removeReadingMarks();
            let words = [];
            // Use robust regex for word detection
            let regex = /[\p{L}\p{N}\p{M}]+/gu;
            let match;
            while ((match = regex.exec(trimmed)) !== null) {
                words.push({ startOffset: actualStartOffset + match.index, length: match[0].length });
            }

            let startTime = Date.now();
            let interval = setInterval(() => {
                if (jobId !== currentNarrationJobId || boundaryReceived || !isReadingAloud || isPaused) {
                    clearInterval(interval);
                    return;
                }
                
                // PRECISION ESTIMATION: Based on language-aware character density
                const lang = getSelectedLanguage() || 'en';
                const isIndic = lang.startsWith('ta') || lang.startsWith('hi') || lang.startsWith('ml') || lang.startsWith('kn');
                const baseCharsPerSec = isIndic ? 12 : 16;
                
                let elapsed = Date.now() - startTime;
                let estimatedChars = (elapsed / 1000) * (baseCharsPerSec * (utterance.rate || 1.0));
                
                // Find the word that contains this estimated character position
                let bestWord = null;
                for (let w of words) {
                    if (w.startOffset - actualStartOffset <= estimatedChars) {
                        bestWord = w;
                    } else {
                        break;
                    }
                }

                if (bestWord) {
                    currentAbsoluteCharIndex = bestWord.startOffset;
                    highlightReadingWord(bestWord.startOffset, bestWord.length);
                }
            }, 100);
        };

        utterancePool.push(utterance); // Keep reference alive
        utterance.onend = function () {
            if (isPaused) return;
            utterancePool = utterancePool.filter(u => u !== utterance);
            if (jobId !== currentNarrationJobId) return;
            completedTasks++;
            if (completedTasks === totalTasks) {
                // 🛑 SELECTION STOP: If we were reading a selection and reached the end of the chunks, stop now.
                if (window.currentReadingStopIndex !== -1 && currentAbsoluteCharIndex >= window.currentReadingStopIndex - 10) {
                    stopReading(true);
                    return;
                }

                // CRITICAL COMPLETION LOGIC: Check if more text remains before stopping
                if (currentAbsoluteCharIndex < globalReadingText.length - 100) {
                    resumeReadingFromIndex(currentAbsoluteCharIndex, false, true, window.currentReadingStopIndex);
                } else {
                    stopReading(true);
                }
            }
        };
        utterance.onerror = () => {
            utterancePool = utterancePool.filter(u => u !== utterance);
            if (jobId !== currentNarrationJobId) return;
            completedTasks++;
            if (completedTasks === totalTasks) {
                if (currentAbsoluteCharIndex < globalReadingText.length - 100) {
                    resumeReadingFromIndex(currentAbsoluteCharIndex, false, true);
                } else {
                    stopReading(true);
                }
            }
        };
        window.speechSynthesis.speak(utterance);
    });

    if (startPaused) {
        window.speechSynthesis.pause();
    }
}

let currentNarrationJobId = 0;

function stopReading(isComplete = false) {
    window.currentReadingStopIndex = -1;
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
    if (playPauseBtn) playPauseBtn.innerHTML = "▶ <span>Read Full</span>";

    updateStorytellerState();
}

async function resetReadingSession() {
    isReadingAloud = false;
    isPaused = false;
    stopReading();
    stopStudyTimer();
    globalReadingText = "";
    globalTextNodes = [];
    globalNodeOffsets = [];
    currentAbsoluteCharIndex = 0;
    lastHighlightPos = -1;
    lastMarkedNodeIndex = 0;

    // TRANSLATION RESET: Prevent stale jobs from "bleeding" into new book contents
    window.activeTranslationJob = Date.now(); // Instantly invalidates previous background jobs
    window.originalBookContent = null;
    window.currentTargetLang = 'orig'; // Reset logic state

    // UI SYNC: Ensure language selector reflects the reset
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = 'orig';

    const drawFab = document.getElementById('floatingDrawFab');
    const drawToolbar = document.getElementById('floatingDrawToolbar');
    if (drawFab) drawFab.style.display = 'none';
    if (drawToolbar) drawToolbar.style.display = 'none';
    if (drawCanvas) {
        drawCanvas.remove();
        drawCanvas = null;
        drawCtx = null;
    }
    isDrawingActive = false;

    if (window.activeTranslationObserver) {
        window.activeTranslationObserver.disconnect();
        window.activeTranslationObserver = null;
    }
}

async function togglePlayPause() {
    if (typeof drawingState !== 'undefined' && drawingState > 0) return;
    let playPauseBtn = document.getElementById("playPauseBtn");

    if (!currentBookId) {
        showUploadToast("📚 Please select a book from your library first!", "info");
        return;
    }

    if (!isReadingAloud) {
        // Explicitly resume AudioContext on user gesture to allow regional TTS playback
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        // INSTANT UI RESPONSE
        if (playPauseBtn) playPauseBtn.innerHTML = "⏸ <span>Pause</span>";
        currentNarrationJobId++; // Start a clean narration session with no stale callbacks
        isReadingAloud = true;
        isPaused = false;
        window.forceResumeScroll = true; // ENSURE WE SCROLL TO STARTING POINT

        updateStorytellerState();

        // INSTANT START: Don't jump to top if we are already in the middle of a translated section
        // But the user requested "Read Full", which traditionally starts from 0. 
        // We'll prioritize the current page if it's already translated.
        const currentP = document.querySelector('.lazy-page-container:not([data-translated="orig"])');
        if (currentP && currentP.dataset.translated === window.currentTargetLang) {
            // If already on a translated page, just start from current index
            await resumeReadingFromIndex(currentAbsoluteCharIndex, false, true);
        } else {
            await resumeReadingFromIndex(0, false, true);
        }
    } else {
        if (isPaused) {
            // RESUME
            isPaused = false;
            // By calling resumeReadingFromIndex, we ensure the queue is freshly generated 
            // from the current index, and any stale callbacks are invalidated.
            window.forceResumeScroll = true; // FORCE JUMP BACK TO PAUSE POINT
            await resumeReadingFromIndex(currentAbsoluteCharIndex, false, true);
            updateStorytellerState();
        } else {
            // PAUSE
            isPaused = true;
            updateStorytellerState(); // Instant visual feedback

            window.speechSynthesis.pause();
            if (currentFallbackAudio) currentFallbackAudio.pause();

            // TRACK PROGRESS: currentAbsoluteCharIndex is updated live by syncHighlight/onboundary event listeners.
            // We cancel the speech to free resources and prepare for a clean restart.
            window.speechSynthesis.cancel();
            updateStorytellerState();
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
    } catch (err) {
        console.error("Ask question error:", err);
        answerObj.innerHTML = `<span style="color: #ef4444;">Connection failed</span>`;
    }
}


document.addEventListener("click", function (e) {
    let toolbar = document.getElementById("selectionToolbar");
    if (toolbar && !toolbar.contains(e.target)) {
        setTimeout(() => {
            if (!window.getSelection().toString().trim()) {
                toolbar.style.display = "none";
            }
        }, 100);
    }
});

function initializeReader() {
    let reader = document.getElementById("reader");

    // Reader Interaction Handler
    if (reader) {
        reader.addEventListener("click", function (e) {
            // 🛡️ DRAWING-LOCK: Ignore click if in drawing/handwriting mode
            if (typeof drawingState !== 'undefined' && drawingState > 0) return;

            // 🛡️ DRAG-LOCK: Ignore click if we just finished a drag/pan operation
            if (window.isRecentlyPanned) {
                window.isRecentlyPanned = false;
                return;
            }

            // 🛡️ INITIALIZATION: If the book is open but not yet mapped, allow mapping now.
            // (Removed the early return for empty globalReadingText)

            // Stop if selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().trim()) return;

            let range;
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(e.clientX, e.clientY);
            } else if (e.rangeParent) {
                range = document.createRange();
                range.setStart(e.rangeParent, e.rangeOffset);
            }

            if (!range) return;

            let targetNode = range.startContainer;
            let offset = range.startOffset;

            // Precise drilling to text node
            if (targetNode.nodeType !== 3) {
                if (targetNode.hasChildNodes()) {
                    let child = targetNode.childNodes[offset] || targetNode.firstChild;
                    if (child && child.nodeType === 3) {
                        targetNode = child;
                        offset = 0;
                    } else if (child && child.hasChildNodes()) {
                        let walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null, false);
                        let firstText = walker.nextNode();
                        if (firstText) {
                            targetNode = firstText;
                            offset = 0;
                        }
                    }
                }
            }

            // FALLBACK: If we missed the text node (e.g., clicked margin or end of line), find the closest text inside the clicked element
            if (!targetNode || targetNode.nodeType !== 3) {
                let walker = document.createTreeWalker(e.target, NodeFilter.SHOW_TEXT, null, false);
                let firstText = walker.nextNode();
                if (firstText) {
                    targetNode = firstText;
                    offset = 0;
                } else {
                    return;
                }
            }

            // 🎯 ANCHOR: Set the clicked node as the current narrator anchor 
            // This ensures rebuildReadingNodeMap (Virtual Window) centers exactly here.
            window.currentReadingNode = targetNode;
            window.currentReadingOffsetInNode = offset;

            // CRITICAL: For massive books, the clicked node might be outside the current mapped window.
            // Force an immediate map rebuild centered on this click to ensure it's mapped correctly.
            rebuildReadingNodeMap();

            let absoluteIndex = -1;
            let nodeIdx = globalTextNodes.indexOf(targetNode);

            // EMERGENCY RECALIBRATION: If node isn't in map (rare sync issue), force a centered rebuild
            if (nodeIdx === -1) {
                rebuildReadingNodeMap();
                nodeIdx = globalTextNodes.indexOf(targetNode);
            }

            if (nodeIdx !== -1) {
                absoluteIndex = globalNodeOffsets[nodeIdx] + offset;
            } else {
                // LAST RESORT: Search for the node by content if reference lost
                const searchTxt = targetNode.nodeValue;
                if (searchTxt) {
                    absoluteIndex = globalReadingText.indexOf(searchTxt);
                    if (absoluteIndex !== -1) absoluteIndex += offset;
                }
            }

            if (absoluteIndex !== -1) {
                // Precise Snap
                if (/\s/.test(globalReadingText[absoluteIndex] || '')) {
                    while (absoluteIndex < globalReadingText.length && /\s/.test(globalReadingText[absoluteIndex])) {
                        absoluteIndex++;
                    }
                } else {
                    while (absoluteIndex > 0 && /\S/.test(globalReadingText[absoluteIndex - 1])) {
                        absoluteIndex--;
                    }
                }

                // CRITICAL: Immediately increment Job ID to kill any current audio/boundary tasks
                currentNarrationJobId++;
                const thisClickJobId = currentNarrationJobId;

                if (isReadingAloud) {
                    window.speechSynthesis.cancel();
                    if (currentFallbackAudio) {
                        currentFallbackAudio.pause();
                        currentFallbackAudio = null;
                    }

                    setTimeout(() => {
                        // Only resume if no other click has happened in the meantime
                        if (thisClickJobId === currentNarrationJobId) {
                            resumeReadingFromIndex(absoluteIndex, false, true);
                        }
                    }, 50);
                } else {
                    resumeReadingFromIndex(absoluteIndex, false, true);
                }
            }
        });

        // AUTO-PAUSE ON MANUAL SCROLL
        function pauseReadingOnUserScroll() {
            if (typeof drawingState !== 'undefined' && drawingState > 0) return;
            if (isReadingAloud && !isPaused) {
                // If the last auto-scroll was VERY recent, ignore it to prevent false positives
                if (Date.now() - (window.lastAutoScrollTime || 0) < 500) return;
                togglePlayPause();
                showUploadToast("Reading paused (manual scroll)", "info");
            }
        }
        reader.addEventListener('wheel', pauseReadingOnUserScroll, { passive: true });
        reader.addEventListener('touchmove', pauseReadingOnUserScroll, { passive: true });

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
}

// Initialize based on readyState to avoid DOMContentLoaded races
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeReader);
} else {
    initializeReader();
}

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
    const num = parseInt(pageNumber);
    if (!num || num < 1) {
        showUploadToast("⚠️ Invalid page number.", "info");
        return;
    }

    if (num > totalPages) {
        showUploadToast(`⚠️ Page ${num} is not available in this book. Going to last page instead.`, "info");
        const lastPage = document.getElementById(`pdf-page-${totalPages - 1}`);
        if (lastPage) {
            lastPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
            const input = document.getElementById('currentPageInput');
            if (input) input.value = totalPages;
        }
        return;
    }

    const targetPage = document.getElementById(`pdf-page-${num - 1}`);
    if (targetPage) {
        targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const input = document.getElementById('currentPageInput');
        if (input) input.value = num;
    } else {
        // Fallback for missing elements
        const allPages = document.querySelectorAll('.lazy-page-container');
        if (num <= allPages.length) {
            allPages[num - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            showUploadToast("⚠️ Page content is still loading or unavailable.", "info");
        }
    }
}



function readSelectedText() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    if (!selectedText) return;

    // 🎯 SYNC: Map the selection to the global narrator engine to enable highlighting and smooth playback
    try {
        const range = selection.getRangeAt(0);
        window.currentReadingNode = range.startContainer;
        window.currentReadingOffsetInNode = range.startOffset;

        rebuildReadingNodeMap();

        const nodeIdx = globalTextNodes.indexOf(range.startContainer);
        const endNodeIdx = globalTextNodes.indexOf(range.endContainer);

        if (nodeIdx !== -1 && endNodeIdx !== -1) {
            const absIndex = globalNodeOffsets[nodeIdx] + range.startOffset;
            const absEndIndex = globalNodeOffsets[endNodeIdx] + range.endOffset;

            // Clean up UI and start engine
            let toolbar = document.getElementById("selectionToolbar");
            if (toolbar) toolbar.style.display = "none";
            selection.removeAllRanges();

            // 🛑 STOP INDEX: Pass the exact end of selection to ensure we don't read beyond it.
            resumeReadingFromIndex(absIndex, false, true, absEndIndex);
            return;
        }
    } catch (e) {
        console.warn("Selection Sync Failed, falling back to basic TTS", e);
    }

    // FALLBACK: Basic TTS (no highlighting) if mapping fails
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    isReadingAloud = true;
    isPaused = false;

    let playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn) playPauseBtn.innerHTML = "⏸ <span>Pause</span>";

    let lang = getSelectedLanguage();
    let shortLang = lang ? lang.split('-')[0].toLowerCase() : 'en';

    if (shortLang !== 'en') {
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
        let voice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) ||
            voices.find(v => v.lang.toLowerCase().startsWith(shortLang)) ||
            voices.find(v => v.name.toLowerCase().includes(langText));
        if (voice) {
            utterance.voice = voice;
        }
    }

    utterance.onend = function () {
        if (isPaused) return;
        stopReading();
    };

    window.speechSynthesis.speak(utterance);

    let toolbar = document.getElementById("selectionToolbar");
    if (toolbar) toolbar.style.display = "none";
}

async function summarizeSelectedText() {
    let selection = window.getSelection();
    let selectedText = selection.toString().trim();
    if (!selectedText) return;

    let toolbar = document.getElementById("selectionToolbar");
    if (toolbar) toolbar.style.display = "none";

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
                book_id: currentBookId,
                target_lang: document.getElementById('langSelect')?.value || 'orig'
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
    } catch (e) {
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
    if (toolbar) toolbar.style.display = "none";

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
    } catch (e) {
        let body = tooltip.querySelector(".tooltip-body");
        if (body) {
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
    } catch (e) {
        body.innerText = "Connection failed.";
        console.error("AI Lookup error:", e);
    }
}

function clearSearchHighlights() {
    const highlights = document.querySelectorAll('.find-highlight');
    let affectedParents = new Set();

    highlights.forEach(el => {
        const parent = el.parentNode;
        if (parent) {
            affectedParents.add(parent);
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
        }
    });

    affectedParents.forEach(p => {
        if (p.isConnected) p.normalize();
    });

    // Invalidate node map because DOM structure has been altered by removing markups
    globalTextNodes = [];
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
    // 1. Reset previous active highlight 
    if (lastActiveSearchIndex !== -1) {
        let prevMatch = document.getElementById(`search-match-${lastActiveSearchIndex}`);
        if (prevMatch) {
            prevMatch.style.setProperty('background-color', 'var(--find-highlight)', 'important');
            prevMatch.style.setProperty('color', 'white', 'important');
            prevMatch.style.border = 'none';
        }
    }

    let currentMatch = document.getElementById(`search-match-${currentSearchIndex}`);
    if (currentMatch) {
        // High Contrast for the ACTIVE match
        currentMatch.style.setProperty('background-color', '#2ecc71', 'important');
        currentMatch.style.setProperty('color', '#fff', 'important');
        currentMatch.style.outline = '3px solid #10b981';
        currentMatch.style.outlineOffset = '2px';
        currentMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        lastActiveSearchIndex = currentSearchIndex;
    }
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
document.addEventListener("keydown", function (event) {
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

let mapRebuildTimeout = null;
function debouncedRebuildMap() {
    if (mapRebuildTimeout) clearTimeout(mapRebuildTimeout);
    mapRebuildTimeout = setTimeout(() => {
        rebuildReadingNodeMap();

        // FLUID SYNC: Instead of stopping the audio (which causes 4s silence),
        // we signal the narrator to refresh its queue as soon as the current sentence ends.
        // We use a 300ms delay instead of 800ms for tighter sync during active reading.
        if (isReadingAloud && window.currentTargetLang !== 'orig') {
            window.speechSyncNext = true;
        }

        currentBookText = document.getElementById("reader")?.innerHTML || "";
    }, 300);
}

async function translateNodeList(nodes, lang, job) {
    if (!nodes.length || (job && window.activeTranslationJob !== job)) return;
    const texts = nodes.map(n => n.nodeValue);
    try {
        const res = await fetch("/translate_text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Use the detected language of the book instead of 'auto' to force-translate 
            // English words (like 'venture') even when mixed with other languages.
            // We explicitly pass 'auto' as a fallback if the detection failed.
            body: JSON.stringify({
                texts,
                target_lang: lang,
                source_lang: currentBookDetectedLangCode || 'auto'
            })
        });
        const translated = await res.json();
        if (Array.isArray(translated) && translated.length === nodes.length) {
            nodes.forEach((node, i) => {
                let orig = node.nodeValue;
                let lead = orig.match(/^\s*/)[0] || "";
                let trail = orig.match(/\s*$/)[0] || "";
                node.nodeValue = lead + (translated[i] || "").trim() + trail;
            });
            // If narrator is running, we MUST rebuild the map to avoid offset drift
            // Rebuilding ensures the globalReadingText is updated to the new language.
            if (isReadingAloud) debouncedRebuildMap();

            // UPDATE DATA-CHAR-COUNT: Ensures subsequent pages stay aligned even if windowing is used
            const pageParent = nodes[0].parentElement;
            if (pageParent) {
                let pageContainer = pageParent;
                while(pageContainer && !pageContainer.classList.contains('lazy-page-container')) {
                    pageContainer = pageContainer.parentElement;
                }
                if (pageContainer) {
                    // Quick recount of the current page content
                    let newCount = 0;
                    let w = document.createTreeWalker(pageContainer, NodeFilter.SHOW_TEXT, null, false);
                    while(w.nextNode()) newCount += w.currentNode.nodeValue.length;
                    pageContainer.setAttribute('data-char-count', newCount);
                }
            }
            return true;
        } else {
            console.warn(`Translation mismatch: Expected ${nodes.length}, got ${translated ? translated.length : 'null'}`);
            return false;
        }
    } catch (e) {
        console.error("Lazy translation failed", e);
        return false;
    }
}

// DOM NORMALIZER: Merges fragmented text nodes that often break translation in DOCX/PDF
function normalizePageTextNodes(root) {
    // We walk through all elements and call normalize() which is a native browser function
    // that merges adjacent text nodes and removes empty ones.
    if (root.normalize) root.normalize();
}

async function translatePage(pageEl, targetLang, job) {
    if (!pageEl || pageEl.dataset.translated === targetLang || (job && window.activeTranslationJob !== job)) return;

    // 1. NORMALIZE: Merges siblings like <span>H</span><span>e</span><span>l</span><span>l</span><span>o</span>
    // which previously broke translation engine split-logic and quality.
    normalizePageTextNodes(pageEl);

    // 1b. HARD SPLIT: For files like "Frankenstein" (TXTs) that might have 
    // exceptionally long paragraphs or no newlines, we must split huge nodes 
    // into 3,000-character chunks or they will fail the translation API limit.
    const MAX_NODE_TEXT = 3000;
    let textNodesToSplit = [];
    let splitWalker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT, null, false);
    while (splitWalker.nextNode()) {
        if (splitWalker.currentNode.nodeValue.length > MAX_NODE_TEXT) {
            textNodesToSplit.push(splitWalker.currentNode);
        }
    }

    textNodesToSplit.forEach(node => {
        let val = node.nodeValue;
        let parent = node.parentNode;
        if (!parent) return;

        let lastNode = node;
        for (let i = MAX_NODE_TEXT; i < val.length; i += MAX_NODE_TEXT) {
            let nextPart = val.substring(i, i + MAX_NODE_TEXT);
            let newNode = document.createTextNode(nextPart);
            parent.insertBefore(newNode, lastNode.nextSibling);
            lastNode = newNode;
        }
        node.nodeValue = val.substring(0, MAX_NODE_TEXT);
    });

    // 2. TARGET READABLE TEXT: We include ocr-reading-layers explicitly 
    let walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT, null, false);
    let nodes = [];
    while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.trim().length > 0) nodes.push(walker.currentNode);
    }

    if (nodes.length === 0) {
        // Handle "Blank" pages (common in images before background OCR finishes)
        // We check if there are images. If so, we might need to wait or refresh
        const images = pageEl.querySelectorAll('img');
        if (images.length > 0) {
            console.warn("Translation: Page has images but no readable text nodes yet. OCR may be in progress.");
        }
        pageEl.dataset.translated = targetLang;
        return;
    }

    // CONCURRENCY & BATCHING: Optimized for massive documents
    const CONCURRENCY_LIMIT = 2; // Reduced from 4 to prevent browser connection saturation
    const BATCH_SIZE = 500; // Increased from 150 to reduce total requests significantly
    const batches = [];
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        batches.push(nodes.slice(i, i + BATCH_SIZE));
    }

    let allSuccessful = true;
    for (let i = 0; i < batches.length; i += CONCURRENCY_LIMIT) {
        if (job && window.activeTranslationJob !== job) break;
        const currentParallelSet = batches.slice(i, i + CONCURRENCY_LIMIT);
        const results = await Promise.all(currentParallelSet.map(batch => translateNodeList(batch, targetLang, job)));
        if (results.some(r => r === false)) allSuccessful = false;

        // Anti-Throttling: Breathable gap between massive batches
        if (i + CONCURRENCY_LIMIT < batches.length) await new Promise(r => setTimeout(r, 100));
    }

    if (allSuccessful) {
        pageEl.dataset.translated = targetLang;
        // PROACTIVE PRE-FETCH: Kick off TTS generation for the first few nodes of this page
        // so they are ready by the time the user reaches them or clicks "Read Full"
        if (isReadingAloud || true) {
            prefetchTTS(nodes.slice(0, 5), targetLang);
        }
    }
}

function prefetchTTS(nodes, lang) {
    if (!nodes || nodes.length === 0) return;
    const shortLang = lang.split('-')[0].toLowerCase();
    nodes.forEach((node, i) => {
        const text = node.nodeValue.trim();
        if (text.length > 5) {
            // We don't need to do anything with the Audio object, 
            // just creating it and calling load() will trigger the server-side generation 
            // and browser caching.
            setTimeout(() => {
                const url = `/tts?lang=${shortLang}&text=${encodeURIComponent(text)}&gender=${currentNarratorGender}`;
                const audio = new Audio(url);
                audio.preload = "auto";
                audio.load();
            }, i * 100); // Stagger requests slightly
        }
    });
}

async function translateBook() {
    let targetLang = document.getElementById('langSelect').value;
    let reader = document.getElementById("reader");
    let titleEl = document.getElementById("bookTitle");
    let originalTitle = titleEl.innerText;

    if (!reader || !currentBookText) return;

    // 1. ATOMIC STATE RESET: Invalidate all pending narration and translation tasks immediately
    // to prevent race conditions during the DOM restoration phase.
    window.speechSynthesis.cancel();
    isReadingAloud = false;
    isPaused = false;
    currentAbsoluteCharIndex = 0;

    // Reset Read Full button text
    const playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn) playPauseBtn.innerHTML = "🔊 <span>Read Full</span>";

    if (window.activeTranslationObserver) window.activeTranslationObserver.disconnect();
    window.activeTranslationObserver = null;
    window.activeTranslationJob = Date.now(); // Invalidate all pending translatePage calls

    updateStorytellerState(); // Hide storyteller during translation

    // Restore Original?
    if (targetLang === 'orig') {
        showTranslationLoader("Restoring original...");
        window.currentTargetLang = 'orig';
        if (window.originalBookContent) {
            // HIGH-SPEED RESTORATION: Use the cached original English/Source DOM
            const currentScroll = reader.scrollTop;
            reader.innerHTML = window.originalBookContent;
            reader.scrollTop = currentScroll;
            currentBookText = window.originalBookContent;

            rebuildReadingNodeMap(); // Sync narrator map to the new (restored) nodes
            hideLoader();
        } else {
            // FALLBACK: Use server fetch if cache is missing
            try {
                let res = await fetch("/book/" + currentBookId);
                let data = await res.json();
                if (data && data.text) {
                    reader.innerHTML = data.text;
                    currentBookText = data.text;
                    document.querySelectorAll('.lazy-page-container').forEach(p => {
                        delete p.dataset.translated;
                    });
                    rebuildReadingNodeMap();
                }
                hideLoader();
            } catch (e) {
                hideLoader();
            }
        }
        return;
    }

    // 🛡️ SOURCE LOCK: Cache the original version before the first translation occurs.
    if (!window.originalBookContent) {
        window.originalBookContent = reader.innerHTML;
    }

    // 🚀 MULTI-JUMP FIX: Restore original text before translating to the NEW target.
    if (window.currentTargetLang && window.currentTargetLang !== 'orig' && window.currentTargetLang !== targetLang) {
        showTranslationLoader("Preparing original source...");
        const currentScroll = reader.scrollTop;
        reader.innerHTML = window.originalBookContent;
        reader.scrollTop = currentScroll;

        // SYNC MAP: Rebuild the narrator's node map immediately after DOM replacement 
        // so that 'Read' works instantly even before translation finishes.
        rebuildReadingNodeMap();
    }

    window.currentTargetLang = targetLang;
    showTranslationLoader("Initializing High-Speed engine...");

    // --- PROACTIVE FULL-BOOK TRANSLATION ENGINE ---
    // Instead of waiting for scroll, we proactively translate the whole book in priority order.

    // Create/Refresh the Observer (as a backup for ultra-fast scrolling)
    if (window.activeTranslationObserver) window.activeTranslationObserver.disconnect();
    window.activeTranslationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                translatePage(entry.target, window.currentTargetLang, window.activeTranslationJob);
            }
        });
    }, { root: reader, threshold: 0.1 });

    let pages = Array.from(document.querySelectorAll('.lazy-page-container'));
    if (pages.length === 0 && reader) {
        pages = (reader.children.length > 0) ? Array.from(reader.children) : [reader];
    }
    pages.forEach(p => window.activeTranslationObserver.observe(p));

    const currentPageInput = document.getElementById('currentPageInput');
    const startPageIdx = Math.max(0, (parseInt(currentPageInput?.value || 1) - 1));

    showTranslationLoader(`Translating Current Page (${startPageIdx + 1})...`);

    // PHASE 1: Priority Spread (Current Page ONLY for instant start)
    // We only await the current page so the user can start reading immediately.
    // Page 1 is launched in the background with high priority.
    showTranslationLoader(`Translating Current Page (${startPageIdx + 1})...`);
    await translatePage(pages[startPageIdx], window.currentTargetLang, window.activeTranslationJob);

    // Launch Page 1 translation in background if it's different from current
    if (startPageIdx !== 0 && pages[0]) {
        translatePage(pages[0], window.currentTargetLang, window.activeTranslationJob);
    }

    // CRITICAL: Rebuild map immediately so user can read the current section
    rebuildReadingNodeMap();
    currentBookText = reader.innerHTML;
    titleEl.innerText = originalTitle;
    hideLoader();

    // PHASE 2: Background Proactive Translation (First to Last)
    // We launch this without "awaiting" it so the UI is free, but it finishes the whole book.
    (async () => {
        const jobId = window.activeTranslationJob;
        const totalPages = pages.length;

        // SPEED BOOST: Group into smaller blocks (2 pages) to avoid blocking narration
        for (let i = 0; i < totalPages; i += 2) {
            // Cancellation Check: Stop if language changed or book switched
            if (window.activeTranslationJob !== jobId || window.currentTargetLang === 'orig') break;

            const segment = pages.slice(i, i + 2);
            try {
                // Parallelize within the segment; if one page fails, the rest continue
                await Promise.all(segment.map(p => translatePage(p, window.currentTargetLang, jobId).catch(e => console.error("Page BG Error:", e))));
            } catch (e) {
                console.error("Batch Job Fatal Error:", e);
                // Continue to next batch instead of crashing
            }

            // Proactive narration re-mapping: Update every 8 pages
            if (i % 8 === 0 && window.activeTranslationJob === jobId) {
                rebuildReadingNodeMap();
            }

            // DYNAMIC THROTTLING: If user is reading aloud, slow down background translation
            // to 1.5 seconds per block to ensure narration audio requests have priority.
            const delay = isReadingAloud ? 1500 : 300;
            await new Promise(r => setTimeout(r, delay));
        }

        if (window.activeTranslationJob === jobId) {
            rebuildReadingNodeMap();
            showUploadToast(`✅ Full Book Translation Complete (${totalPages} pages)`, "success");
        }
    })();

    showUploadToast("🌍 Translating whole book in background. Read now!", "info");
}

// Global Audio Fallback implementation for unsupported TTS languages 
let currentFallbackAudio = null;
let fallbackQueue = [];

function playFallbackAudioQueue(chunks, startOffset, shortLang, startPaused) {
    fallbackQueue = [];
    let currentAbsOffset = startOffset;
    const allSentenceTexts = [];

    let hasStarted = false;
    let activeSpeakerGender = currentNarratorGender; // Tracks current dialogue speaker

    // PHASE 1: Build the basic queue structure (FAST)
    chunks.forEach((chunk) => {
        if (!chunk.trim()) {
            currentAbsOffset += chunk.length;
            return;
        }

        let start = 0;
        while (start < chunk.length) {
            let end = start + 195;
            if (end < chunk.length) {
                let breakIdx = -1;
                const naturalBreakers = [". ", "! ", "? ", "। ", "।", ". ", "! ", "? ", ", ", "; ", "\n", ". ", " "];
                for (let breaker of naturalBreakers) {
                    let found = chunk.lastIndexOf(breaker, end);
                    if (found > start + 30) {
                        breakIdx = found + breaker.length;
                        break;
                    }
                }
                if (breakIdx !== -1) end = breakIdx;
                else {
                    // Final fallback to any punctuation if no space/standard breaker exists
                    let lastPunc = chunk.search(/[.!?;:]/);
                    if (lastPunc > start && lastPunc < end) end = lastPunc + 1;
                    else {
                        let lastSpace = chunk.lastIndexOf(' ', end);
                        if (lastSpace > start) end = lastSpace;
                    }
                }
            } else {
                end = chunk.length;
            }

            let rawPart = chunk.substring(start, end);
            let trimmedPart = rawPart.trimStart();
            let leadingSpaces = rawPart.length - trimmedPart.length;
            let sc = trimmedPart.trimEnd();

            // CHUNK SANITY CHECK
            if (sc && /[\p{L}\p{N}]/u.test(sc)) {
                // DIALOGUE SPEAKER DETECTION: Patterns like "Rani : ", "Thomas:", etc.
                const speakerMatch = sc.substring(0, 60).match(/\b([A-Z][A-Za-z]{2,20})\s*:/);
                if (speakerMatch) {
                    activeSpeakerGender = getGenderForName(speakerMatch[1]);
                }

                allSentenceTexts.push(sc);
                let url = `/tts?lang=${shortLang}&text=${encodeURIComponent(sc)}&gender=${activeSpeakerGender}`;

                const item = {
                    url,
                    text: sc,
                    gender: activeSpeakerGender,
                    offset: currentAbsOffset + start + leadingSpaces
                };

                fallbackQueue.push(item);

                // ULTRA-FAST STARTUP: Trigger the first audio request IMMEDIATELY 
                if (!hasStarted && fallbackQueue.length === 1 && !startPaused) {
                    hasStarted = true;
                    item.audioObj = new Audio(item.url);
                    item.audioObj.preload = "auto";
                    item.audioObj.load();
                    // Instant play
                    playNextFallback(false);
                } else if (fallbackQueue.length <= 15) {
                    // Aggressive Pre-fetch: Load next 15 sentences in parallel
                    setTimeout(() => {
                        item.audioObj = new Audio(item.url);
                        item.audioObj.preload = "auto";
                        item.audioObj.load();
                    }, 0);
                }
            }
            start = end;
            if (fallbackQueue.length > 300) break; // Extended queue limit
        }
        currentAbsOffset += chunk.length;
    });

    if (startPaused) {
        isPaused = true;
    }

    // ENSURE START: If it didn't start in the loop (e.g. empty first chunks), start now
    if (!isPaused && !hasStarted && fallbackQueue.length > 0) {
        hasStarted = true;
        playNextFallback(false);
    }

    // PHASE 3: FETCH EMOTIONS IN BACKGROUND
    if (allSentenceTexts.length > 0) {
        // Optimize: Batch the first 50 results together
        const emotionBatch = allSentenceTexts.slice(0, 50);
        fetch("/analyze_emotion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts: emotionBatch })
        }).then(res => res.json()).then(emotions => {
            if (Array.isArray(emotions)) {
                emotions.forEach((em, i) => {
                    if (emotionBatch[i]) emotionCache.set(emotionBatch[i], em.emotion || 'neutral');
                });
            }
        }).catch(e => console.warn("Background Emotion Batching Failed:", e));
    }
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

    // SYNC SNAPSHOT: Capture current position before mapping changes
    let snapshotNode = window.currentReadingNode;
    let snapshotOffset = window.currentReadingOffsetInNode;

    // 🚀 VIRTUAL MAPPING FOR MASSIVE DOCUMENTS:
    // We STRICTLY only scan page containers to avoid picking up dashboard cards or hidden metadata.
    const allPages = Array.from(reader.querySelectorAll('.lazy-page-container, .reader-page, .pdf-page'));
    const isMassive = allPages.length > 200;

    let targetPages = allPages;
    let offsetPrefix = 0;

    if (isMassive) {
        // Find current page based on scroll or snapshot
        let currentIndex = -1;
        if (snapshotNode) {
            // Robust parent search: check multiple layers to find the page container
            let curr = snapshotNode.parentElement;
            while (curr && curr !== reader) {
                if (curr.classList.contains('lazy-page-container') || curr.classList.contains('reader-page') || curr.id.startsWith('pdf-page-')) {
                    currentIndex = allPages.indexOf(curr);
                    break;
                }
                curr = curr.parentElement;
            }
        }

        // Fallback to scroll position if node search failed
        if (currentIndex === -1) {
            const readerRect = reader.getBoundingClientRect();
            let minDiff = Infinity;
            allPages.forEach((p, idx) => {
                const r = p.getBoundingClientRect();
                const d = Math.abs(r.top - readerRect.top);
                if (d < minDiff) {
                    minDiff = d;
                    currentIndex = idx;
                }
            });
        }

        if (currentIndex === -1) currentIndex = 0;

        // Map a window: 10 pages back, 100 pages forward
        const start = Math.max(0, currentIndex - 10);
        const end = Math.min(allPages.length, currentIndex + 100);
        targetPages = allPages.slice(start, end);

        // 🧮 CALCULATE OFFSET PREFIX
        // We use the 'data-char-count' attribute provided by the server for 100% accuracy.
        // This works even for unrendered/lazy pages.
        for(let i=0; i<start; i++) {
            let page = allPages[i];
            
            // CRITICAL: If the page is rendered (has children), we should trust its LIVE length
            // because it might have been translated, changing its character count.
            let count = NaN;
            if (page.children.length > 0) {
                // Quickly scan live nodes for accuracy using the SHARED mapping logic
                // This ensures that injected spaces and filtered nodes are accounted for perfectly.
                const { text: pageText } = getNodesAndText(page, [page], 0);
                count = pageText.length;
                
                // Keep attribute in sync for windowed jumps
                page.setAttribute('data-char-count', count);
            } else {
                count = parseInt(page.getAttribute('data-char-count'));
            }

            if (isNaN(count)) {
                count = (page.innerText || "").length;
            }
            offsetPrefix += count + 1; // +1 for the newline bridge between pages
        }
    }

    let { nodes, offsets, text } = getNodesAndText(reader, targetPages, offsetPrefix);
    
    globalTextNodes = nodes;
    globalNodeOffsets = offsets;
    globalReadingText = text;
    window._mapWindowOffset = offsetPrefix;
    window._lastMapRebuildTime = Date.now();
    
    window._rebuildingMap = false;
    
    // POSITION RESCUE: Re-anchor the narrator to the correct text node if we are reading
    if (isReadingAloud && snapshotNode && snapshotNode.isConnected) {
        let nodeIdx = nodes.indexOf(snapshotNode);
        if (nodeIdx !== -1) {
            currentAbsoluteCharIndex = offsets[nodeIdx] + snapshotOffset;
        }
    }
}

function highlightReadingWord(absoluteWordPosition, charLength, sentenceStart = -1, sentenceLength = -1) {
    if (!globalTextNodes || globalTextNodes.length === 0) rebuildReadingNodeMap();

    // PERFORMANCE: Avoid redundant work if we are still on the same word
    if (window._lastHighlightPos === absoluteWordPosition && window._lastHighlightLen === charLength) return;
    window._lastHighlightPos = absoluteWordPosition;
    window._lastHighlightLen = charLength;

    // 1. Clear current marks
    if (readingHighlight) readingHighlight.clear();
    if (sentenceHighlight) sentenceHighlight.clear();

    // 2. Fallback Glows (Selective removal for performance)
    const activeNodes = document.querySelectorAll('.reading-active-container');
    activeNodes.forEach(el => el.classList.remove('reading-active-container'));

    let startChar = absoluteWordPosition;
    let endChar = absoluteWordPosition + charLength;

    let sStart = sentenceStart;
    let sEnd = sentenceStart + sentenceLength;

    let foundAny = false;

    if (globalTextNodes && globalTextNodes.length > 0) {
        // 🚀 HIGH-PERFORMANCE BINARY SEARCH: Find the correct node in O(log N)
        // This is critical for massive books where linear search causes UI lag and highlight delays.
        let low = 0;
        let high = globalTextNodes.length - 1;
        let nodeIdx = -1;

        while (low <= high) {
            let mid = Math.floor((low + high) / 2);
            let nodeStart = globalNodeOffsets[mid];
            let nodeEnd = nodeStart + (globalTextNodes[mid].nodeValue || "").length;

            if (startChar >= nodeStart && startChar < nodeEnd) {
                nodeIdx = mid;
                break;
            } else if (startChar < nodeStart) {
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        // If not found exactly, find the closest previous node
        if (nodeIdx === -1) nodeIdx = Math.max(0, high);

        // Highlight Sentence (Optional but helps context)
        if (sStart !== -1 && sentenceHighlight) {
            for (let i = nodeIdx; i < globalTextNodes.length; i++) {
                let ns = globalNodeOffsets[i];
                let n = globalTextNodes[i];
                let ne = ns + (n.nodeValue || "").length;
                if (ne > sStart && ns < sEnd) {
                    try {
                        let sr = new Range();
                        sr.setStart(n, Math.max(0, sStart - ns));
                        sr.setEnd(n, Math.min(n.nodeValue.length, sEnd - ns));
                        sentenceHighlight.add(sr);
                    } catch(e) {}
                } else if (ns >= sEnd) break;
            }
        }

        // Highlight Word
        let node = globalTextNodes[nodeIdx];
        let nodeStart = globalNodeOffsets[nodeIdx];
        if (node && node.nodeValue) {
            foundAny = true;
            lastMarkedNodeIndex = nodeIdx;
            window.currentReadingNode = node;
            window.currentReadingOffsetInNode = Math.max(0, startChar - nodeStart);

            try {
                let range = new Range();
                const letterRegex = /[\p{L}\p{M}\p{N}]/u;
                let text = node.nodeValue || "";
                let nodeLen = text.length;
                
                let localStart = Math.max(0, startChar - nodeStart);
                let localEnd = Math.min(nodeLen, endChar - nodeStart);

                // 1. SNAP BACKWARD to word start
                if (localStart > 0 && letterRegex.test(text[localStart]) && letterRegex.test(text[localStart - 1])) {
                    while (localStart > 0 && letterRegex.test(text[localStart - 1])) {
                        localStart--;
                    }
                } else if (localStart < nodeLen && !letterRegex.test(text[localStart])) {
                    while (localStart < nodeLen && !letterRegex.test(text[localStart])) {
                        localStart++;
                    }
                }

                // 2. SNAP FORWARD to word end
                if (localEnd < nodeLen && letterRegex.test(text[localEnd - 1]) && letterRegex.test(text[localEnd])) {
                    while (localEnd < nodeLen && letterRegex.test(text[localEnd])) {
                        localEnd++;
                    }
                }

                range.setStart(node, localStart);
                range.setEnd(node, localEnd);

                if (readingHighlight) readingHighlight.add(range);

                if (node.parentNode) {
                    node.parentNode.classList.add('reading-active-container');
                    node.parentNode.style.setProperty('--current-reading-color', 'var(--reading-mark)');
                }

                // SMOOTH SCROLLING: Keep the active word centered in view
                let isMobile = window.innerWidth < 992;
                let scrollInterval = isMobile ? 2500 : 1500;
                
                let timeSinceLastScroll = Date.now() - (window.lastAutoScrollTime || 0);
                if (timeSinceLastScroll > scrollInterval || window.forceResumeScroll) {
                    let rect = range.getBoundingClientRect();
                    let reader = document.getElementById("reader");
                    if (reader) {
                        let readerRect = reader.getBoundingClientRect();
                        const threshold = reader.clientHeight * (isMobile ? 0.45 : 0.35);

                        const isPhysicallyBeyond = rect.top > readerRect.bottom - threshold;
                        const isAboveMiddle = rect.top < readerRect.top + threshold;

                        if (isPhysicallyBeyond || (isAboveMiddle && rect.bottom > readerRect.top) || window.forceResumeScroll) {
                            const zoom = (typeof currentZoom !== 'undefined') ? currentZoom : 1;
                            let targetY = reader.scrollTop + (rect.top - readerRect.top) / zoom - (reader.clientHeight / zoom * (isMobile ? 0.2 : 0.15));
                            targetY = Math.max(0, targetY);

                            if (targetY >= reader.scrollTop - 50 || window.forceResumeScroll) {
                                let behavior = (window.forceResumeScroll || isMobile) ? 'auto' : 'smooth';
                                reader.scrollTo({ top: targetY, behavior: behavior });
                                window.lastAutoScrollTime = Date.now();
                                window.forceResumeScroll = false;
                            }
                        }
                    }
                }
            } catch (e) { }
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
    const playPauseBtn = document.getElementById("playPauseBtn");

    if (!isReadingAloud || isPaused) return;

    // SEAMLESS QUEUE RE-SYNC: If a translation occurred, rebuild the queue from the current place
    // WITHOUT stopping playback. This removes the 4-second silence gap.
    if (window.speechSyncNext) {
        window.speechSyncNext = false;
        // SILENT RE-CHUNK: Recalculate remaining chunks from the new globalReadingText
        rebuildRemainingFallbackQueue();
    }

    if (fallbackQueue.length === 0 && !window.speechSynthesis.speaking && !isRetry) {
        // DRIFT RESCUE: If queue is empty but we haven't reached the true end of the book, 
        // the translation likely shifted some text. Force a map rebuild and try to resume.
        let remainingTextLength = (globalReadingText.substring(currentAbsoluteCharIndex) || "").trim().length;
        if (remainingTextLength > 15) {
            console.warn("Narration queue depleted unexpectedly. Re-calculating book map...");
            rebuildReadingNodeMap();
            // Re-sync progress against new text 
            resumeReadingFromIndex(currentAbsoluteCharIndex, false, true);
            return;
        } else {
            console.log("True end of text reached.");
            stopReading(true);
            return;
        }
    }


    let item = (isRetry && lastEmotionItem) ? lastEmotionItem : fallbackQueue.shift();
    lastEmotionItem = item;

    if (!item) return;

    // PREVENT INFINITE RETRY LOOPS: If this specific item has failed 3 times, skip it.
    item.retryCount = (item.retryCount || 0);
    if (isRetry) item.retryCount++;
    if (item.retryCount > 3) {
        console.error("Narration Failure: Skipping stalled item after 3 retries", item.text.substring(0, 30));
        playNextFallback(false, false);
        return;
    }

    // USE PRE-FETCHED OBJECT: If background pre-fetching already started this request,
    // we use the existing DOM object to skip the initial connection handshake.
    let audio = item.audioObj || new Audio(item.url);
    currentFallbackAudio = audio;

    currentAbsoluteCharIndex = item.offset;

    // 🛑 SELECTION STOP: If we reached or passed the requested stop point, kill narration immediately.
    if (window.currentReadingStopIndex !== -1 && currentAbsoluteCharIndex >= window.currentReadingStopIndex - 5) {
        stopReading(true);
        return;
    }

    removeReadingMarks();

    // Only cancel native speech on the FIRST attempt to avoid AbortError loops on retries
    if (!isRetry) window.speechSynthesis.cancel();
    const jobId = entryJobId;

    // JIT EMOTION: Use pre-fetched cache or fallback to neutral instantly
    let emotion = 'neutral';
    if (item.text && emotionCache.has(item.text)) {
        const cached = emotionCache.get(item.text);
        emotion = (typeof cached === 'string') ? cached : (cached.emotion || 'neutral');
    }
    updateReaderMood(emotion);

    const targetLang = getSelectedLanguage() || 'en-US';
    const shortLang = targetLang.split("-")[0].toLowerCase();
    const voices = window.speechSynthesis.getVoices();
    const speakerGender = item.gender || currentNarratorGender;
    let nativeVoice = getBestVoice(voices, targetLang, speakerGender);

    // SPEED OPTIMIZATION: Use native window.speechSynthesis whenever a voice is available.
    // This provides instant playback for all languages (English, Tamil, Hindi, etc.)
    // If no native voice is found, it will gracefully fallback to the Neural Server TTS.
    if (nativeVoice) {
        let utterance = new SpeechSynthesisUtterance(item.text);
        currentEmotionUtterance = utterance;
        utterance.lang = nativeVoice.lang;
        utterance.voice = nativeVoice;

        let basePitch = 1.0;
        if (speakerGender === 'male') {
            basePitch = isVoiceActuallyMale(nativeVoice) ? 0.82 : 0.72;
        } else {
            basePitch = isVoiceActuallyMale(nativeVoice) ? 1.08 : 1.0;
        }

        // Apply emotion parameters if we got them from cache
        if (emotion === 'happy') {
            utterance.pitch = basePitch * 1.08;
            utterance.rate = 1.05 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'surprised') {
            utterance.pitch = basePitch * 1.25; // Highly energetic/surprised
            utterance.rate = 1.10 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'energetic') {
            utterance.pitch = basePitch * 1.18;
            utterance.rate = 1.15 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'question') {
            utterance.pitch = basePitch * 1.12;
            utterance.rate = 1.02 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'sad') {
            utterance.pitch = basePitch * 0.80;
            utterance.rate = 0.85 * currentSpeed;
            utterance.volume = 0.72; // Soft & Slow
        } else if (emotion === 'angry') {
            utterance.pitch = basePitch * 0.90;
            utterance.rate = 1.10 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'fear') {
            utterance.pitch = basePitch * 1.12;
            utterance.rate = 0.92 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'serious') {
            utterance.pitch = basePitch * 0.92;
            utterance.rate = 0.95 * currentSpeed;
            utterance.volume = 1.0;
        } else if (emotion === 'peaceful') {
            utterance.pitch = basePitch * 0.95;
            utterance.rate = 0.85 * currentSpeed;
            utterance.volume = 0.85;
        } else {
            utterance.pitch = basePitch;
            utterance.rate = 1.0 * currentSpeed;
            utterance.volume = 1.0;
        }

        // Apply dynamic rate & volume to Edge-TTS fallback audio
        if (currentFallbackAudio && !window.speechSynthesis.speaking) {
            if (emotion === 'happy') { currentFallbackAudio.playbackRate = 1.05 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'surprised') { currentFallbackAudio.playbackRate = 1.1 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'energetic') { currentFallbackAudio.playbackRate = 1.15 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'question') { currentFallbackAudio.playbackRate = 1.05 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'sad') { currentFallbackAudio.playbackRate = 0.85 * currentSpeed; currentFallbackAudio.volume = 0.7; }
            else if (emotion === 'angry') { currentFallbackAudio.playbackRate = 1.1 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'fear') { currentFallbackAudio.playbackRate = 0.9 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'serious') { currentFallbackAudio.playbackRate = 0.92 * currentSpeed; currentFallbackAudio.volume = 1.0; }
            else if (emotion === 'peaceful') { currentFallbackAudio.playbackRate = 0.8 * currentSpeed; currentFallbackAudio.volume = 0.8; }
            else { currentFallbackAudio.playbackRate = 1.0 * currentSpeed; currentFallbackAudio.volume = 1.0; }
        }

        let utteranceStartTime = Date.now();
        const progEl = document.getElementById("readingProgress");

        let boundaryReceived = false;
        utterance.onboundary = (event) => {
            if (jobId !== currentNarrationJobId) return;
            
            let absolutePos = item.offset + event.charIndex;
            if (absolutePos < currentAbsoluteCharIndex - 200) return;
            
            boundaryReceived = true;
            currentAbsoluteCharIndex = absolutePos;
            highlightReadingWord(absolutePos, event.charLength || 5);
            
            if (progEl) {
                const prog = Math.round((currentAbsoluteCharIndex / (globalReadingText.length || 1)) * 100);
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
                words.push({ startOffset: item.offset + match.index, length: match[0].length });
            }
            if (words.length === 0 && item.text.length > 0) {
                words.push({ startOffset: item.offset, length: item.text.length });
            }
            
            const totalChars = item.text.length;
            const lang = getSelectedLanguage() || 'en';
            const isIndic = lang.startsWith('ta') || lang.startsWith('hi') || lang.startsWith('ml') || lang.startsWith('kn');
            const baseCharsPerSec = isIndic ? 12 : 16;
            const speedEstimate = (baseCharsPerSec * (utterance.rate || 1.0)) / 1000;

            let hIn = setInterval(() => {
                if (jobId !== currentNarrationJobId || boundaryReceived || !isReadingAloud || isPaused) {
                    clearInterval(hIn);
                    return;
                }
                let elapsed = Date.now() - utteranceStartTime;
                const estimatedPosInChunk = Math.min(totalChars, elapsed * speedEstimate);
                const absoluteEstimatedPos = item.offset + estimatedPosInChunk;
                
                // Find best word match
                let bestWord = words[0];
                for (let w of words) {
                    if (w.startOffset <= absoluteEstimatedPos) bestWord = w;
                    else break;
                }

                if (bestWord && bestWord.startOffset > currentAbsoluteCharIndex) {
                    currentAbsoluteCharIndex = bestWord.startOffset;
                    highlightReadingWord(bestWord.startOffset, bestWord.length);
                }
                
                if (estimatedPosInChunk >= totalChars) clearInterval(hIn);
            }, 100);
        };

        utterance.onend = () => {
            if (jobId !== currentNarrationJobId) return;
            removeReadingMarks();
            if (isReadingAloud && !isPaused) {
                currentAbsoluteCharIndex = item.offset + item.text.length;
                playNextFallback();
            }
        };

        utterance.onerror = () => {
            if (jobId === currentNarrationJobId) setTimeout(() => playNextFallback(false, false), 500);
        };

        window.speechSynthesis.speak(utterance);
    } else {
        currentFallbackAudio = audio;

        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        try {
            const ctx = getAudioContext();
            const source = ctx.createMediaElementSource(audio);
            source.connect(ctx.destination);
        } catch (e) {
            console.warn("AudioContext already attached or error:", e);
        }

        // Rate adjustment (async emotion might change this later)
        audio.playbackRate = 1.0 * currentSpeed;
        audio.preservesPitch = false;

        let words = [];
        let regex = /[\p{L}\p{N}\p{M}]+/gu;
        let match;
        while ((match = regex.exec(item.text)) !== null) {
            words.push({ startOffset: item.offset + match.index, length: match[0].length });
        }
        if (words.length === 0 && item.text.length > 0) {
            words.push({ startOffset: item.offset, length: item.text.length });
        }

        const totalChunkLength = item.text.length;
        const syncHighlight = () => {
            if (jobId !== currentNarrationJobId || !isReadingAloud || isPaused || !currentFallbackAudio) return;
            let duration = audio.duration;
            const baseCharsPerSec = (shortLang === 'en' || !shortLang) ? 16 : 13;
            if (isNaN(duration) || duration === Infinity || duration <= 0) {
                duration = totalChunkLength / (baseCharsPerSec * (audio.playbackRate || 1));
            }
            if (audio.currentTime > 0) {
                let progress = audio.currentTime / duration;
                if (progress > 1.0) progress = 1.0;
                if (progress >= 0.999) return;
                let currentPosInChunk = progress * totalChunkLength;
                let foundWord = words[0];
                for (let w of words) {
                    if (w.startOffset - item.offset <= currentPosInChunk) foundWord = w;
                    else break;
                }
                if (foundWord) {
                    lastEmotionItemProgress = foundWord.startOffset - item.offset;
                    currentAbsoluteCharIndex = foundWord.startOffset;
                    highlightReadingWord(foundWord.startOffset, foundWord.length);
                    const percent = Math.round((currentAbsoluteCharIndex / (globalReadingText.length || 1)) * 100);
                    const progEl = document.getElementById("readingProgress");
                    if (progEl) progEl.innerText = `| ${percent}% Read`;
                }
            }
            requestAnimationFrame(syncHighlight);
        };

        audio.onplay = () => {
            if (jobId !== currentNarrationJobId) return;
            if (playPauseBtn) playPauseBtn.innerHTML = "⏸ <span>Pause</span>";
            requestAnimationFrame(syncHighlight);
        };

        audio.onended = () => {
            if (jobId !== currentNarrationJobId) return;
            currentAbsoluteCharIndex = item.offset + item.text.length;
            removeReadingMarks();
            if (isReadingAloud && !isPaused) playNextFallback();
        };

        audio.onerror = () => {
            if (jobId === currentNarrationJobId) {
                if (playPauseBtn) playPauseBtn.innerHTML = "▶ <span>Retry</span>";
                setTimeout(() => playNextFallback(false, false), 500);
            }
        };

        audio.play().catch(e => {
            if (e.name === 'AbortError') {
                console.warn("Playback aborted by browser/sync, retrying...", item.text.substring(0, 20));
                if (jobId === currentNarrationJobId) setTimeout(() => {
                    if (isReadingAloud && !isPaused) playNextFallback(false, true);
                }, 100);
                return;
            }
            console.error("Playback failed:", e);
            if (jobId === currentNarrationJobId) setTimeout(() => playNextFallback(false, false), 500);
        });
    }

    // GAPLESS PREFETCH: Prime the cache for the next several sentences
    // This ensures the browser has the data ready BEFORE the current sentence ends.
    if (fallbackQueue.length > 0) {
        fallbackQueue.slice(0, 3).forEach(nextItem => {
            const preload = new Audio();
            preload.src = nextItem.url;
            preload.preload = "auto";
            preload.volume = 0; // Don't play yet
            preload.load();
        });
    }
}

function updateReaderMood(emotion) {
    // UI Mood indicators could be added here in the future (e.g. ambient glows)
    // Currently, all vocal modulation is handled JIT in playNextFallback for precision.
}

async function closeBookAction() {
    if (!currentBookId) return;

    // Stop and save final pulse if needed
    stopReadingPulse();

    // Ask for bookmark if progress made
    if (currentAbsoluteCharIndex > 0) {
        showConfirmModal(
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
    if (drawCanvas && currentBookId && hasMadeSessionDrawing) {
        showConfirmModal(
            "Save Handwritten Notes?",
            "Would you like to save your drawings/handwritten notes for this book?",
            "Save",
            "Don't Save",
            "Cancel",
            () => {
                localStorage.setItem(`book_drawing_${currentBookId}`, drawCanvas.toDataURL());
                proceedClosing();
            },
            () => {
                proceedClosing();
            },
            () => { /* Cancel */ }
        );
    } else {
        proceedClosing();
    }
}

async function proceedClosing() {
    let reader = document.getElementById("reader");

    // Trigger folding shut animation
    if (reader) {
        reader.classList.add('folding-exit');
        // Wait for the animation to finish
        await new Promise(r => setTimeout(r, 600));
    }

    window.speechSynthesis.cancel();
    stopStudyTimer();
    if (currentFallbackAudio) {
        currentFallbackAudio.pause();
        currentFallbackAudio = null;
    }
    isReadingAloud = false;
    isPaused = false;
    let playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn) playPauseBtn.innerHTML = "▶ <span>Read Full</span>";

    if (reader) {
        reader.classList.add('no-spine-shadow');
        reader.style.opacity = "1";
        reader.innerHTML = "";

        // Hide the floating book badge
        const bookBadgeEl = document.getElementById("bookBadge");
        if (bookBadgeEl) bookBadgeEl.classList.remove('visible');
        stopStudyTimer();

        // Show thank you state if it exists (moved to a safe location in HTML)
        let thankYou = document.getElementById("thankYouState");
        if (thankYou) {
            thankYou.style.display = "block";
            // Auto-dismiss after 1 second
            setTimeout(() => {
                if (thankYou.style.display === "block") {
                    thankYou.style.display = "none";
                }
            }, 1000);
        }
        reader.classList.remove('folding-exit');
    }

    document.getElementById("bookTitle").innerText = "Select a book from your library";

    const voiceBtn = document.getElementById("voiceBtn");
    if (voiceBtn) voiceBtn.style.display = "none";

    const drawFab = document.getElementById("floatingDrawFab");
    const drawToolbar = document.getElementById("drawingMiniToolbar");
    if (drawFab) drawFab.style.display = "none";
    if (drawToolbar) drawToolbar.style.display = "none";
    if (drawCanvas) {
        drawCanvas.remove();
        drawCanvas = null;
        drawCtx = null;
    }
    isDrawingActive = false;

    const placeholder = document.getElementById("emptyBookPlaceholder");
    if (placeholder) placeholder.style.display = "flex";

    // Clear sidebar highlights and button states
    document.querySelectorAll("#booklist tr").forEach(row => {
        row.classList.remove("active-book-row");
        const openBtn = row.querySelector(".btn-open");
        if (openBtn && !openBtn.classList.contains("processing-btn")) {
            openBtn.classList.remove("active-pulse");
            openBtn.innerText = "Open";
        }
    });

    currentBookId = null;
    currentBookText = "";
    totalPages = 0;
    updatePagesList();
}

function scrollToIndex(index, behavior = 'smooth') {
    let reader = document.getElementById("reader");
    if (!reader) return;

    // Use established extraction logic to ensure exact offset mapping (accounting for virtual spaces and page boundaries)
    const pages = Array.from(reader.querySelectorAll('.lazy-page-container, .reader-page, .pdf-page'));
    let { nodes, offsets } = getNodesAndText(reader, pages);

    let targetNode = null;
    let nodeOffset = 0;

    for (let i = 0; i < nodes.length; i++) {
        const start = offsets[i];
        const end = start + nodes[i].nodeValue.length;

        if (index >= start && index < end) {
            targetNode = nodes[i];
            nodeOffset = index - start;
            break;
        }
    }

    if (targetNode) {
        try {
            // Use Range for most precise visual centering (targets the specific character)
            const range = document.createRange();
            range.setStart(targetNode, nodeOffset);
            range.setEnd(targetNode, Math.min(nodeOffset + 1, targetNode.nodeValue.length));

            const rect = range.getBoundingClientRect();
            const readerRect = reader.getBoundingClientRect();

            // Fixed jump-scroll: Target top 15% instead of center
            const zoom = (typeof currentZoom !== 'undefined') ? currentZoom : 1;
            const targetY = Math.max(0, reader.scrollTop + (rect.top - readerRect.top) / zoom - (reader.clientHeight / zoom * 0.15));

            reader.scrollTo({
                top: targetY,
                behavior: behavior
            });
        } catch (e) {
            // Fallback to simple scrollIntoView if range fails
            targetNode.parentNode.scrollIntoView({ behavior: behavior, block: 'center' });
        }
    }
}

async function applyImageOcrOverlays() {
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
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            let ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            b64 = canvas.toDataURL("image/png");
        } catch (e) { continue; }

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

            let renderedW = img.offsetWidth || img.naturalWidth;
            let renderedH = img.offsetHeight || img.naturalHeight;

            let layer = document.createElement("div");
            layer.className = "ocr-layer";

            data.words.forEach(w => {
                let span = document.createElement("span");
                span.className = "ocr-word";
                span.textContent = w.text;
                span.style.left = Math.round(w.left / 100 * renderedW) + "px";
                span.style.top = Math.round(w.top / 100 * renderedH) + "px";
                span.style.width = Math.round(w.width / 100 * renderedW) + "px";
                span.style.height = Math.round(w.height / 100 * renderedH) + "px";
                span.title = w.text;
                layer.appendChild(span);

                // CRITICAL: Insert a physical space node into the DOM so the TreeWalker parses words separately
                layer.appendChild(document.createTextNode(" "));
            });

            wrapper.appendChild(layer);

            if (window.ResizeObserver) {
                let ro = new ResizeObserver(() => {
                    let newW = img.offsetWidth || img.naturalWidth;
                    let newH = img.offsetHeight || img.naturalHeight;
                    if (newW === renderedW && newH === renderedH) return;
                    renderedW = newW;
                    renderedH = newH;
                    layer.querySelectorAll(".ocr-word").forEach((span, idx) => {
                        let w2 = data.words[idx];
                        if (!w2) return;
                        span.style.left = Math.round(w2.left / 100 * newW) + "px";
                        span.style.top = Math.round(w2.top / 100 * newH) + "px";
                        span.style.width = Math.round(w2.width / 100 * newW) + "px";
                        span.style.height = Math.round(w2.height / 100 * newH) + "px";
                    });
                });
                ro.observe(wrapper);
            }
        } catch (e) {
            console.warn("OCR overlay failed for image:", e);
        }
    }
}

// --- OCR Word Visual Selection Highlight ---
// Browser ::selection CSS is unreliable over transparent text.
// Track selectionchange and apply .ocr-selected class to hovered spans instead.
document.addEventListener("selectionchange", () => {
    if (typeof drawingState !== 'undefined' && drawingState > 0) return;
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
        } catch (e) { }
    });

    // 3. Position and Show Floating Toolbar
    if (toolbar) {
        let rects = range.getClientRects();
        let rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();

        if (rect && (rect.width > 0 || rect.height > 0)) {
            toolbar.style.display = "flex";
            // Important: Use window.scrollY if the reader isn't the offset parent
            toolbar.style.top = (rect.top + window.scrollY - 55) + "px";
            toolbar.style.left = (rect.left + rect.width / 2 - toolbar.offsetWidth / 2) + "px";

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

    // Maintain visual marker sync after scaling
    setTimeout(() => renderBookmarkIcons(), 150);
}



window.onload = () => {
    loadBooks().then(() => {
        fetchUserStreak();
        checkForInvites();
        // Auto-Open Deep Link Logic: Handle books shared via ?open=ID
        const urlParams = new URLSearchParams(window.location.search);
        const openId = urlParams.get('open');
        const overlay = document.getElementById("dashboardOverlay");
        if (openId && activeBooksList) {
            const bookToOpen = activeBooksList.find(b => b[0] == openId);
            if (bookToOpen) {
                openBook(bookToOpen[0], bookToOpen[1]);
                if (overlay) overlay.style.display = "none";
                window.history.replaceState({}, document.title, window.location.pathname);
            } else {
                if (overlay) overlay.style.display = "flex";
            }
        } else {
            if (overlay) overlay.style.display = "flex";
        }
    });
    initDragging();
};


function initDragging() {
    let reader = document.getElementById("reader");
    let isDown = false;
    let startX;
    let startY;
    let scrollLeft;
    let scrollTop;
    let moved = false;
    window.isRecentlyPanned = false;

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
        if (isDown && moved) {
            // Mark that we just finished a drag so the 'click' event can be ignored
            window.isRecentlyPanned = true;
            // Safety timeout to clear it just in case the click event doesn't fire as expected
            setTimeout(() => { window.isRecentlyPanned = false; }, 100);
        }
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
document.addEventListener('click', function (e) {
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
        }),
        signal: AbortSignal.timeout(45000) // Increase timeout to 45s for heavy OCR/Vision tasks
    })
        .then(res => res.json())
        .then(data => {
            if (data.explanation) {
                typeWriterEffect(textEl, data.explanation);
            } else if (data.error) {
                if (data.error.includes("downloading") || data.error.includes("loading")) {
                    textEl.innerHTML = `<span style="color: var(--primary); font-weight: 500;">🧠 Vision Engine is warming up...</span><br><p style="font-size: 0.9rem; opacity: 0.7; margin-top: 8px;">The AI model is being prepared for its first run. This usually takes 30-60 seconds. Please try again in a moment.</p>`;
                } else {
                    textEl.innerHTML = `<span style="color: #ef4444; font-weight: 500;">❌ Analysis Failed: ${data.error}</span>`;
                }
            } else {
                textEl.innerText = "The AI couldn't formulate a clear explanation for this image. Try another section.";
            }
        })
        .catch(err => {
            console.error("Explain image error:", err);
            if (err.name === 'TimeoutError') {
                textEl.innerHTML = `<span style="color: #f59e0b; font-weight: 500;">⏳ Connection Timed Out.</span><br><p style="font-size: 0.85rem; opacity: 0.7; margin-top: 5px;">Analyzing complex visuals can take a moment. If the image is very large, try a smaller section.</p>`;
            } else {
                textEl.innerHTML = `<span style="color: #ef4444; font-weight: 500;">🔌 Connection to Vision Engine lost.</span><br><p style="font-size: 0.85rem; opacity: 0.7; margin-top: 5px;">Check if the server is running or try refreshing the page.</p>`;
            }
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
    } catch (e) {
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
        } catch (e) { console.error("Error stopping recognition:", e); }
    }

    // UI Cleanup
    document.getElementById('voiceBtn').classList.remove('active');
    document.getElementById('voiceStatus').style.display = 'none';
    window.speechSynthesis.cancel(); // Stop AI talking as well

}

async function processVoiceCommand(command) {
    console.log("AI Assistant received:", command);
    const feedback = document.getElementById('voiceTranscript');

    // 1. HELP / CAPABILITIES
    if (command.includes("what can you do") || command.includes("help")) {
        feedback.innerText = "I can read, pause, change speed, navigate pages, open quizzes, bookmarks, and switch themes.";
        speakAIResponse("I can help you read, pause, or change speed. I can also open your quiz, bookmarks, or notebook. Try saying: 'Open my quiz' or 'Read faster'.");
        return;
    }

    // 2. THEME CONTROL
    if (command.includes("dark mode") || command.includes("light mode") || command.includes("switch theme")) {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const isCurrentlyDark = currentTheme === 'dark';
        const wantDark = command.includes("dark");
        const wantLight = command.includes("light");

        if ((wantDark && !isCurrentlyDark) || (wantLight && isCurrentlyDark) || command.includes("switch theme")) {
            toggleTheme();
            const themeMsg = wantDark ? "Switching to dark mode." : (wantLight ? "Switching to light mode." : "Theme toggled.");
            feedback.innerText = themeMsg;
            speakAIResponse(themeMsg);
        }
        return;
    }

    // 3. STUDY TOOLS CONTROL (Quiz, Bookmarks, Notebook, Revision)
    if (command.includes("quiz")) {
        feedback.innerText = "Opening Quiz...";
        if (typeof generateQuiz === 'function') {
            generateQuiz();
            speakAIResponse("Opening your book quiz.");
        }
        return;
    }
    if (command.includes("bookmark")) {
        feedback.innerText = "Opening Bookmarks...";
        if (typeof openBookmarks === 'function') {
            openBookmarks();
            speakAIResponse("Opening your saved bookmarks.");
        }
        return;
    }
    if (command.includes("notebook") || command.includes("notes")) {
        feedback.innerText = "Opening Notebook...";
        if (typeof openNotebook === 'function') {
            openNotebook();
            speakAIResponse("Opening your study notebook.");
        }
        return;
    }
    if (command.includes("revision") || command.includes("key points")) {
        feedback.innerText = "Generating Revision...";
        if (typeof generateRevision === 'function') {
            generateRevision();
            speakAIResponse("Generating the revision guide for this book.");
        }
        return;
    }

    // 4. ZOOM / TEXT SIZE CONTROL
    if (command.includes("zoom in") || command.includes("increase text") || command.includes("larger text") || command.includes("increase size")) {
        changeZoom(0.1);
        feedback.innerText = "Increasing text size...";
        speakAIResponse("Increasing text size.");
        return;
    }
    if (command.includes("zoom out") || command.includes("decrease text") || command.includes("smaller text") || command.includes("decrease size")) {
        changeZoom(-0.1);
        feedback.innerText = "Decreasing text size...";
        speakAIResponse("Decreasing text size.");
        return;
    }

    // 5. SPEED CONTROL
    if (command.includes("speed")) {
        const match = command.match(/speed(?:(?:\s+to)?\s+)?(\d+(?:\.\d+)?)/i);
        if (match && match[1]) {
            const newSpeed = parseFloat(match[1]);
            if (newSpeed >= 0.5 && newSpeed <= 3.0) {
                playbackRate = newSpeed;
                const speedInput = document.getElementById('speedRange');
                if (speedInput) speedInput.value = newSpeed;
                feedback.innerText = `Setting speed to ${newSpeed}x...`;
                speakAIResponse(`Speed set to ${newSpeed} times.`);
                return;
            }
        }
    }

    // 6. LANGUAGE CONTROL (Translation)
    const langMap = {
        "tamil": "ta",
        "hindi": "hi",
        "english": "en",
        "original": "orig",
        "french": "fr",
        "german": "de",
        "spanish": "es",
        "kannada": "kn",
        "telugu": "te",
        "malayalam": "ml"
    };

    const lowerCommand = command.toLowerCase();
    for (let langName in langMap) {
        if (lowerCommand.includes(langName) || (lowerCommand.includes("translate to") && lowerCommand.includes(langName))) {
            const langCode = langMap[langName];
            const select = document.getElementById('langSelect');
            if (select) {
                select.value = langCode;
                feedback.innerText = `Switching language to ${langName.charAt(0).toUpperCase() + langName.slice(1)}...`;
                speakAIResponse(`Switching language to ${langName}.`);

                // Trigger translation
                if (typeof translateBook === 'function') {
                    translateBook();
                }
                return;
            }
        }
    }

    if (command.includes("fast") || command.includes("increase speed") || command.includes("faster")) {
        changeSpeed(0.2);
        const fasterMsg = `Reading faster at ${currentSpeed.toFixed(1)}x.`;
        feedback.innerText = fasterMsg;
        speakAIResponse(fasterMsg);
        return;
    }

    if (command.includes("slow") || command.includes("decrease speed") || command.includes("slower")) {
        changeSpeed(-0.2);
        const slowerMsg = `Reading slower at ${currentSpeed.toFixed(1)}x.`;
        feedback.innerText = slowerMsg;
        speakAIResponse(slowerMsg);
        return;
    }

    // 6. SEARCH CONTROL (Find words)
    if (command.includes("find") || command.includes("search for")) {
        let wordMatch = command.match(/(?:find the word|find|search for|search)\s+([\w\u0080-\uFFFF]+)/i);
        if (wordMatch && wordMatch[1]) {
            let targetWord = wordMatch[1];
            const findBox = document.getElementById("findBox");
            const findInput = document.getElementById("findInput");
            if (findBox) findBox.style.display = "flex";
            if (findInput) findInput.value = targetWord;
            executeSearch(targetWord);
            const searchMsg = `Searching for "${targetWord}".`;
            feedback.innerText = searchMsg;
            speakAIResponse(searchMsg);
            return;
        }
    }

    // 7. NAVIGATION CONTROL (Go to page X)
    if (command.includes("page") || command.includes("scroll to") || command.includes("go to")) {
        let match = command.match(/(?:page|to|at)\s*(\d+)/i);
        if (match && match[1]) {
            let pageNum = parseInt(match[1]);
            const navMsg = `Navigating to page ${pageNum}.`;
            feedback.innerText = navMsg;
            speakAIResponse(navMsg);
            jumpToPage(pageNum);
            return;
        }
    }

    // 8. NARRATION CONTROL (Start/Stop)
    if (command.includes("read") || command.includes("play") || command.includes("start") || command.includes("resume")) {
        if (!isReadingAloud || isPaused) {
            feedback.innerText = "Starting narration...";
            togglePlayPause();
            speakAIResponse("Starting reading.");
        } else {
            speakAIResponse("I am already reading the book for you.");
        }
        return;
    }

    if (command.includes("stop") || command.includes("pause") || command.includes("quiet") || command.includes("shut up")) {
        if (isReadingAloud && !isPaused) {
            feedback.innerText = "Pausing...";
            togglePlayPause();
            speakAIResponse("Okay, pausing the reading.");
        }
        return;
    }

    // 9. LANGUAGE CONTROL (Tamil, Hindi, English, etc.)
    const languages = {
        "tamil": "ta",
        "hindi": "hi",
        "english": "en",
        "bengali": "bn",
        "telugu": "te",
        "marathi": "mr",
        "urdu": "ur",
        "gujarati": "gu",
        "kannada": "kn",
        "malayalam": "ml",
        "punjabi": "pa",
        "odia": "or",
        "korean": "ko",
        "thai": "th",
        "chinese": "zh-CN",
        "japanese": "ja",
        "french": "fr",
        "german": "de",
        "spanish": "es",
        "original": "orig",
        "default": "orig"
    };

    for (let langName in languages) {
        if (command.includes(langName)) {
            const langCode = languages[langName];
            const langSelect = document.getElementById('langSelect');
            if (langSelect) {
                langSelect.value = langCode;
                const capitalizedLang = langName.charAt(0).toUpperCase() + langName.slice(1);
                feedback.innerText = `Switching to ${capitalizedLang}...`;
                speakAIResponse(`Switching language to ${langName}.`);

                // 1. Trigger Book Translation
                translateBook();

                // 2. Refresh open tools if they are visible
                if (document.getElementById('notebookModal')?.style.display === 'flex') renderNotebook();
                if (document.getElementById('revisionModal')?.style.display === 'flex') generateRevision();
                if (document.getElementById('quizModal')?.style.display === 'flex') generateQuiz();

                return;
            }
        }
    }

    // 9. EXIT CONTROL
    if (command.includes("close the book") || command.includes("exit book") || command.includes("stop book")) {
        feedback.innerText = "Closing book...";
        speakAIResponse("Closing the book.");
        setTimeout(() => closeBookAction(), 1000);
        return;
    }

    // 10. AI QUERY FALLBACK (Meaning, explanation, etc.)
    if (command.includes("meaning") || command.includes("what is") || command.includes("explain") || command.includes("summarize") || command.includes("who is")) {
        handleAIQuery(command, "general");
    } else {
        feedback.innerText = "Processing query...";
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
            } catch (e) { console.error("Meaning lookup failed:", e); }
        }
    }

    if (!context && typeof currentAbsoluteCharIndex !== 'undefined') {
        if (reader) context = reader.innerText.substring(0, 1500); // Grab current view context
    }

    try {
        const response = await fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: query,
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

window.stopAIChatVoice = function() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (window._chatAudio) {
        window._chatAudio.pause();
        window._chatAudio = null;
    }
};

function speakAIResponse(text) {
    window.stopAIChatVoice();
    
    // Clean text: strip markdown characters
    let cleanText = text
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/`/g, "")
        .replace(/<[^>]*>/g, "") // Strip any HTML tags
        .trim();

    if (!cleanText) return;

    // Detect script and language code
    let lang = "en";
    if (/[\u0B80-\u0BFF]/.test(cleanText)) {
        lang = "ta";
    } else if (/[\u0900-\u097F]/.test(cleanText)) {
        lang = "hi";
    } else if (/[\u0C00-\u0C7F]/.test(cleanText)) {
        lang = "te";
    } else if (/[\u0C80-\u0CFF]/.test(cleanText)) {
        lang = "kn";
    } else if (/[\u0D00-\u0D7F]/.test(cleanText)) {
        lang = "ml";
    } else if (/[\u0980-\u09FF]/.test(cleanText)) {
        lang = "bn";
    } else {
        lang = window._chatLanguage || "en";
    }

    const gender = window.currentNarratorGender || "female";
    const url = `/tts?lang=${lang}&text=${encodeURIComponent(cleanText)}&gender=${gender}`;

    const audio = new Audio(url);
    window._chatAudio = audio;
    audio.play().catch(err => {
        console.error("Chat TTS play failed:", err);
        // Fallback to local speechSynthesis if server-side TTS fails
        let utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = lang;
        window.speechSynthesis.speak(utterance);
    });
}


async function explainImage(element) {
    const img = element.querySelector('img');
    if (!img) return;

    // Show Modal
    const modal = document.getElementById("imageExplanationModal");
    const preview = document.getElementById("imageExplanationPreview");
    const previewContainer = document.getElementById("imageExplanationPreviewContainer");
    const textOutput = document.getElementById("imageExplanationText");

    if (modal) modal.style.display = "flex";
    if (preview) {
        preview.src = img.src;
        if (previewContainer) previewContainer.style.display = "block";
    }
    if (textOutput) textOutput.innerText = "🔍 AI Vision is analyzing image markers...";

    // Check if we have OCR reading layer text embedded
    let ocrText = "";
    const ocrLayer = element.querySelector('.ocr-reading-layer');
    if (ocrLayer) ocrText = ocrLayer.innerText;

    try {
        // Capture context from surrounding text
        let semanticContext = "";
        const currentPageEl = document.querySelector('.book-page[style*="display: block"]');
        if (currentPageEl) semanticContext = currentPageEl.innerText.substring(0, 1000);

        const res = await fetch("/explain_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                src: img.getAttribute('src'),
                ocr_text: ocrText,
                context: semanticContext,
                book_id: currentBookId
            }),
            signal: AbortSignal.timeout(45000)
        });

        const data = await res.json();
        if (data.explanation && textOutput) {
            textOutput.innerText = data.explanation;
        } else if (data.error && textOutput) {
            if (data.error.includes("downloading") || data.error.includes("loading")) {
                textOutput.innerText = "🧠 Vision Engine is warming up. Please try again in a moment.";
            } else {
                textOutput.innerText = "❌ Analysis failed: " + data.error;
            }
        }
    } catch (e) {
        if (textOutput) {
            if (e.name === 'TimeoutError') {
                textOutput.innerText = "⏳ Connection Timed Out. High-resolution analysis is taking longer than expected.";
            } else {
                textOutput.innerText = "❌ Connection to Vision Engine lost.";
            }
        }
    }
}


async function saveBookmarkManual(forceReplace = false) {
    if (!currentBookId) {
        showUploadToast("📚 Open a book to save progress", "info");
        return;
    }

    const selection = window.getSelection();
    let selectedText = selection.toString().trim();
    let pageNum = parseInt(document.getElementById('currentPageInput')?.value || 1);

    const reader = document.getElementById('reader');
    let charIndex = 0;
    let nodeIndex = -1;
    let nodeOffset = 0;

    // Precise Cursor / Selection Detection
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        // Calculate charIndex from reader start
        const { nodes, offsets } = getNodesAndText(reader);

        let startNode = range.startContainer;
        let startOffset = range.startOffset;

        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i] === startNode) {
                charIndex = offsets[i] + startOffset;
                nodeIndex = i;
                nodeOffset = startOffset;
                break;
            }
        }

        // Also update page number from selection context if possible
        const container = range.startContainer.parentElement?.closest('.lazy-page-container');
        if (container && container.id.includes('pdf-page-')) {
            pageNum = parseInt(container.id.replace('pdf-page-', '')) + 1;
        }
    } else {
        // Fallback to current reading progress or scroll position
        charIndex = currentAbsoluteCharIndex || 0;
        // Find node for charIndex to store for language-switching support
        if (globalTextNodes && globalTextNodes.length > 0) {
            for (let i = 0; i < globalNodeOffsets.length; i++) {
                if (globalNodeOffsets[i] <= charIndex && (i === globalNodeOffsets.length - 1 || globalNodeOffsets[i + 1] > charIndex)) {
                    nodeIndex = i;
                    nodeOffset = charIndex - globalNodeOffsets[i];
                    break;
                }
            }
        }
    }

    const currentLangSelect = document.getElementById('langSelect');
    const langCode = currentLangSelect ? currentLangSelect.value : 'en';

    const scrollY = reader ? Math.round(reader.scrollTop) : 0;

    // Auto-Label from context (Premium Identification)
    let label = selectedText;
    if (!label) {
        // If no text selected, try to get the word at currentAbsoluteCharIndex
        if (currentAbsoluteCharIndex > 0 && globalReadingText) {
            const contextText = globalReadingText.substring(currentAbsoluteCharIndex, currentAbsoluteCharIndex + 40);
            const firstWordMatch = contextText.match(/^\s*(\S+)/);
            label = firstWordMatch ? firstWordMatch[1] : `Bookmark @ ${currentAbsoluteCharIndex}`;
        } else {
            label = `Bookmark @ Char ${charIndex}`;
        }
    }

    try {
        const res = await fetch("/save_bookmark", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                book_id: currentBookId,
                page_number: pageNum,
                scroll_y: scrollY,
                char_index: charIndex,
                node_index: nodeIndex,
                node_offset: nodeOffset,
                lang_code: langCode,
                label: label,
                replace: forceReplace
            })
        });

        const data = await res.json();

        if (data.status === "exists") {
            // Use custom modal for confirmation as requested
            showConfirmModal(
                "Update Bookmark?",
                "You already have a bookmark for this book. Would you like to move it to this new location?",
                "Update Positon",
                "Keep Old",
                null,
                () => saveBookmarkManual(true) // Retry with forceReplace=true
            );
            return;
        }

        if (res.ok) {
            const toolbar = document.getElementById('selectionToolbar');
            if (toolbar) toolbar.style.display = 'none';
            if (selection) selection.removeAllRanges();

            showUploadToast("🔖 Bookmark saved successfully!", "success");
            renderBookmarkIcons(); // Show the icon immediately
        }
    } catch (e) {
        console.error("Bookmark save error:", e);
    }
}

async function openBookmarks() {
    if (!currentBookId) return;
    document.getElementById("bookmarksModal").style.display = "flex";

    const list = document.getElementById("bookmarksList");
    list.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-light);">Loading bookmarks...</div>`;

    try {
        const res = await fetch(`/bookmarks/${currentBookId}`);
        let bookmarks = await res.json();

        // --- REAL-TIME HUB TRANSLATION ---
        const currentLang = document.getElementById('langSelect')?.value || 'orig';

        if (currentLang !== 'orig' && bookmarks.length > 0) {
            const needsTranslation = bookmarks.filter(bm => bm.lang_code !== currentLang && bm.label && !bm.label.includes('Page '));
            if (needsTranslation.length > 0) {
                const labels = needsTranslation.map(bm => bm.label);
                const tRes = await fetch("/translate_text", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ texts: labels, target_lang: currentLang })
                });
                const translatedLabels = await tRes.json();
                needsTranslation.forEach((bm, i) => {
                    bm.label = translatedLabels[i];
                });
            }
        }

        document.getElementById("bookmarksCount").innerText = `${bookmarks.length} Saved Locations`;
        list.innerHTML = "";

        if (bookmarks.length === 0) {
            list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-light);">No bookmarks found. Click the 🔖 button to save your progress!</div>`;
            return;
        }

        bookmarks.forEach(bm => {
            const div = document.createElement("div");
            div.className = "bookmark-card";
            div.style.cssText = "background: var(--bg-panel); border-bottom: 1px solid var(--border); padding: 20px; display: flex; justify-content: space-between; align-items: center; border-radius: 12px; margin-bottom: 10px; transition: all 0.3s;";

            div.innerHTML = `
                <div style="flex: 1; cursor: pointer;" onclick="jumpToBookmark(${bm.page_number}, ${bm.scroll_y}, false, ${bm.char_index})">
                    <h4 style="color: var(--text-white); margin-bottom: 5px;">${bm.label}</h4>
                    <p style="color: var(--text-light); font-size: 0.85rem;">${bm.char_index > 0 ? 'Exact Location' : 'Page ' + bm.page_number} • ${new Date(bm.created_at).toLocaleDateString()}</p>
                </div>
                <button onclick="deleteBookmark(${bm.id})" style="background: none; border: none; color: #ef4444; opacity: 0.5; cursor: pointer; padding: 10px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5">✕</button>
            `;
            list.appendChild(div);
        });
    } catch (err) {
        list.innerHTML = `<div style="color: #ef4444;">Failed to load bookmarks.</div>`;
    }
}

function jumpToBookmark(page, scrollY, isAuto = false, charIndex = 0) {
    if (isAuto && isReadingAloud) return;
    closeBookmarks();

    const targetId = `pdf-page-${page - 1}`;
    const targetPage = document.getElementById(targetId);

    // If the page is NOT yet rendered (Lazy Loading), we need a fallback
    if (!targetPage && page > 0) {
        console.warn(`📍 Target page ${page} not in DOM yet. Forcing jump to page.`);
        // Note: In this version, we wait for renderBatch to hit the page.
        // We set it as pending so the auto-resume logic picks it up.
        window._pendingBookmarkResume = { page, scrollY, charIndex };
        showUploadToast(`⏳ Navigating to Page ${page}...`, "info");
        return;
    }

    // Precision character-based jumping (Center the specific text)
    if (charIndex > 0) {
        scrollToIndex(charIndex, isAuto ? 'auto' : 'smooth');
        if (!isAuto) {
            showUploadToast(`📍 Exact Location Reached`, "success");
        }
        // Ensure icon is visible immediately
        setTimeout(renderBookmarkIcons, 100);
        return;
    }

    // Page-based jumping
    if (targetPage) {
        targetPage.scrollIntoView({ behavior: isAuto ? 'auto' : 'smooth', block: 'start' });
        if (scrollY > 0) {
            const reader = document.getElementById('reader');
            // If scrollIntoView isn't enough (e.g. we want specific Y inside the page)
            setTimeout(() => {
                reader.scrollTo({ top: scrollY, behavior: isAuto ? 'auto' : 'smooth' });
            }, 100);
        }
        if (!isAuto) {
            showUploadToast(`📍 Page ${page} reached`, "success");
        }
        // Ensure icons are visible
        setTimeout(renderBookmarkIcons, 100);
    }
}

function renderBookmarkIcons() {
    const reader = document.getElementById('reader');
    if (!reader || !currentBookId) return;

    fetch(`/bookmarks/${currentBookId}`)
        .then(r => r.json())
        .then(bookmarks => {
            // 1. CLEAR existing icons ONLY AFTER we have new data to show
            reader.querySelectorAll('.bookmark-symbol').forEach(el => el.remove());
            if (bookmarkHighlight) bookmarkHighlight.clear();

            if (!bookmarks || bookmarks.length === 0) return;

            // 2. FORCE REBUILD MAP: Now that icons are gone, the offsets will be perfect
            rebuildReadingNodeMap();

            // Use character index for precision symbol placement
            bookmarks.forEach(bm => {
                if (bm.char_index >= 0) {
                    placeSymbolAtIndex(bm.char_index, bm.id, bm.node_index, bm.node_offset);
                }
            });
        })
        .catch(err => {
            console.error("Failed to fetch bookmarks for rendering:", err);
        });
}

function placeSymbolAtIndex(charIndex, id, nodeIndex = -1, nodeOffset = 0) {
    const reader = document.getElementById('reader');
    if (!reader) return;

    // Use established global map (rebuilt once at the start of renderBookmarkIcons)
    // No redundant rebuild here! (Huge speed boost for many bookmarks)

    // Prefer absolute charIndex mapping for original language (STABLE even after splits/merges)
    // We only use node-relative mapping as a rescue for translated docs where offsets shifted.
    const isTranslated = typeof window.currentTargetLang !== 'undefined' && window.currentTargetLang !== 'orig';

    let node;
    let offsetInNode;

    if (!isTranslated || nodeIndex < 0 || nodeIndex >= globalTextNodes.length) {
        // Absolute Mapping: Best for 'orig' language and for recovery
        let bestIdx = -1;
        for (let i = 0; i < globalNodeOffsets.length; i++) {
            if (globalNodeOffsets[i] <= charIndex && (i === globalNodeOffsets.length - 1 || globalNodeOffsets[i + 1] > charIndex)) {
                bestIdx = i;
                break;
            }
        }
        if (bestIdx !== -1) {
            node = globalTextNodes[bestIdx];
            offsetInNode = Math.min(charIndex - globalNodeOffsets[bestIdx], (node.nodeValue || "").length);
        }
    } else {
        // Node-Relative Rescue: Use for translated documents
        node = globalTextNodes[nodeIndex];
        offsetInNode = nodeOffset;
    }

    if (!node || node.nodeType !== 3) return;

    // Find the best relative container
    const parentContainer = node.parentElement?.closest('.lazy-page-container') || node.parentElement?.closest('.book-content-container') || reader;

    try {
        const range = document.createRange();
        let text = node.nodeValue || "";

        // Identify word boundaries around the bookmark index for clear visual identifying
        let startBound = offsetInNode;
        let endBound = offsetInNode;

        // Expand to word boundaries (universal support for all languages: non-whitespace)
        while (startBound > 0 && /\S/.test(text[startBound - 1])) startBound--;
        while (endBound < text.length && /\S/.test(text[endBound])) endBound++;

        // Fallback for single characters if not inside a word
        if (startBound === endBound && text.length > 0) {
            endBound = Math.min(text.length, endBound + 1);
        }

        range.setStart(node, startBound);
        range.setEnd(node, endBound);

        // 1. Precise Word Highlight (Premium Identification)
        if (bookmarkHighlight) {
            bookmarkHighlight.add(range);
        } else {
            // No Highlight API support? We don't want to fragment the DOM, 
            // so we'll rely only on the icon positioning.
        }

        const rect = range.getBoundingClientRect();
        const contRect = parentContainer.getBoundingClientRect();

        // 2. The Bookmark Symbol (Pin)
        const bmSpan = document.createElement('span');
        bmSpan.className = 'bookmark-symbol notranslate';
        bmSpan.innerHTML = '🔖';
        bmSpan.title = "Saved Bookmark Location";

        // Exact position relative to the container, with a small safety margin to avoid overlapping word
        const zoom = (typeof currentZoom !== 'undefined') ? currentZoom : 1;
        bmSpan.style.left = ((rect.left - contRect.left) / zoom + parentContainer.scrollLeft + (rect.width / 2 / zoom)) + "px";
        bmSpan.style.top = ((rect.top - contRect.top) / zoom + parentContainer.scrollTop - (3 / zoom)) + "px";

        bmSpan.onclick = (e) => {
            e.stopPropagation();
            jumpToBookmark(0, 0, false, charIndex); // Snaps back precisely if scrolled away
        };

        parentContainer.appendChild(bmSpan);
    } catch (e) {
        console.error("Failed to place bookmark symbol:", e);
    }
}

// Reposition symbols on window resize
window.addEventListener('resize', () => {
    if (currentBookId) {
        renderBookmarkIcons();
    }
});


async function deleteBookmark(id) {
    showConfirmModal(
        "Remove Bookmark?",
        "This will permanently delete this saved location. Are you sure?",
        "Delete Bookmark",
        "Keep It",
        null,
        async () => {
            try {
                await fetch(`/delete_bookmark/${id}`, { method: "POST" });
                showUploadToast("📍 Bookmark removed.", "info");
                renderBookmarkIcons();
                openBookmarks(); // Refresh list
            } catch (err) {
                console.error("Failed to delete bookmark:", err);
            }
        }
    );
}

function closeBookmarks() {
    document.getElementById("bookmarksModal").style.display = "none";
}

function rebuildRemainingFallbackQueue() {
    if (!isReadingAloud || !globalReadingText) return;

    // 1. Snapshot settings
    const index = currentAbsoluteCharIndex;
    const testLang = getSelectedLanguage();
    const testShort = testLang ? testLang.split('-')[0].toLowerCase() : 'en';

    // 2. Fragment the remaining 10k characters (same logic as resumeReadingFromIndex)
    const windowOffset = window._mapWindowOffset || 0;
    let localIndex = Math.max(0, index - windowOffset);
    let textChunkRaw = globalReadingText.substring(localIndex, localIndex + 10000);
    let chunks = [];
    let lastSplit = 0;
    const bridgeRegex = /[.!?\n।。\?]/;
    for (let i = 0; i < textChunkRaw.length; i++) {
        let isBoundary = bridgeRegex.test(textChunkRaw[i]);
        let nextChar = textChunkRaw[i + 1];
        if (isBoundary && (!nextChar || !bridgeRegex.test(nextChar))) {
            chunks.push(textChunkRaw.substring(lastSplit, i + 1));
            lastSplit = i + 1;
        } else if (i - lastSplit > 200 && /\s/.test(textChunkRaw[i])) {
            chunks.push(textChunkRaw.substring(lastSplit, i + 1));
            lastSplit = i + 1;
        }
    }
    if (lastSplit < textChunkRaw.length) chunks.push(textChunkRaw.substring(lastSplit));

    // 3. RE-BUILD THE FALLBACK QUEUE (but don't touch the active audio/job ID)
    let newQueue = [];
    let curAbs = index;

    const prefetchEmotion = (t) => {
        if (!t || t.length < 2) return Promise.resolve('neutral');
        if (emotionCache.has(t)) return emotionCache.get(t);
        let p = fetch("/analyze_emotion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: t })
        }).then(res => res.json()).catch(() => 'neutral');
        emotionCache.set(t, p);
        return p;
    };

    chunks.forEach(chunk => {
        if (!chunk.trim()) { curAbs += chunk.length; return; }
        // Simple internal splitter for emotion/TTS batches
        let start = 0;
        while (start < chunk.length) {
            let end = Math.min(start + 190, chunk.length);
            if (end < chunk.length) {
                let lastSpace = chunk.lastIndexOf(' ', end);
                if (lastSpace > start) end = lastSpace;
            }
            let sc = chunk.substring(start, end).trim();
            if (sc) {
                const lazyEmotion = () => {
                    return Promise.resolve('neutral');
                    return prefetchEmotion(sc);
                };
                newQueue.push({
                    url: `/tts?lang=${testShort}&text=${encodeURIComponent(sc)}&gender=${currentNarratorGender}`,
                    text: sc,
                    offset: curAbs + start,
                    getEmotion: lazyEmotion
                });
            }
            start = end;
        }
        curAbs += chunk.length;
    });

    // 4. DESTROY OLD QUEUE AND SWAP IN NEW ONE
    fallbackQueue = newQueue;
    console.log("Narrator queue hot-swapped mid-session for translation sync.");
}

// --- MOBILE UI HELPERS ---
function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    if (forceClose === true) {
        sidebar.classList.remove('active');
    } else {
        sidebar.classList.toggle('active');
    }

    // NEW: Manage Floating Action Buttons visibility
    const isNowActive = sidebar.classList.contains('active');
    const drawFab = document.getElementById('floatingDrawFab');
    const voiceBtn = document.getElementById('voiceBtn');
    
    if (isNowActive) {
        if (drawFab) drawFab.style.display = 'none';
        if (voiceBtn) voiceBtn.style.display = 'none';
    } else {
        // Only restore if we are actually in a book (currentBookId exists)
        if (drawFab && window.currentBookId) drawFab.style.display = 'flex';
        if (voiceBtn && window.currentBookId) voiceBtn.style.display = 'flex';
    }
}

// Global click listener for sidebar interaction (auto-close on mobile)
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            // Check if we are on a mobile/tablet screen size
            if (window.innerWidth < 992) {
                // List of elements that should trigger a sidebar close
                const isInteractive = e.target.closest('button') ||
                    e.target.closest('.profile-trigger') ||
                    e.target.closest('tr') ||
                    e.target.closest('.btn-mobile-action');

                // Don't close if clicking the search input or specific toggle buttons
                const isSearchInput = e.target.tagName === 'INPUT';
                const isMenuBtn = e.target.closest('.mobile-menu-btn');
                const isFilterBtn = e.target.closest('.btn-sidebar-filter');

                if (isInteractive && !isSearchInput && !isMenuBtn && !isFilterBtn) {
                    // Small timeout to allow the click action to register before the UI shifts
                    setTimeout(() => toggleSidebar(true), 150);
                }
            }
        });
    }
});



function toggleProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) {
        const isOpening = modal.style.display !== 'flex';
        modal.style.display = isOpening ? 'flex' : 'none';

        if (isOpening) {
            // Initial state when opening
            document.getElementById('removePhotoFlag').value = "0";
        } else {
            // Modal is closing (Dismiss clicked or Saved)
            // Reset preview to user's CURRENT profile image (from the sidebar icon)
            const sidebarPic = document.querySelector('#userProfileIcon img');
            if (sidebarPic) {
                document.getElementById('profilePreview').src = sidebarPic.src;
            }
            // Clear inputs
            document.getElementById('profileUpload').value = "";
            document.getElementById('removePhotoFlag').value = "0";
        }
    }
}


function previewProfileImage(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('profilePreview').src = e.target.result;
            // If they chose a new photo, they definitely don't want to "remove" it anymore
            document.getElementById('removePhotoFlag').value = "0";
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function removeProfilePhoto() {
    // 1. Update preview to default placeholder or avatar API
    const userFullName = document.getElementById('displayFullName').innerText;
    document.getElementById('profilePreview').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userFullName)}&background=6366f1&color=fff`;

    // 2. Set the removal flag for the backend
    document.getElementById('removePhotoFlag').value = "1";

    // 3. Clear any pending file upload
    document.getElementById('profileUpload').value = "";
}

function deleteAccount() {
    showConfirmModal(
        "Delete Account",
        "Are you sure you want to permanently delete your account and all your data? This action cannot be undone.",
        "Delete Account",
        "Cancel",
        null,
        async () => {
            try {
                const res = await fetch("/delete_account", { method: "POST" });
                const data = await res.json();
                if (res.ok && data.status === "success") {
                    showUploadToast("Your account has been deleted successfully.", "success");
                    setTimeout(() => {
                        window.location.href = "/logout";
                    }, 1500);
                } else {
                    showUploadToast(data.error || "Failed to delete account.", "error");
                }
            } catch (e) {
                console.error(e);
                showUploadToast("An error occurred. Please try again.", "error");
            }
        },
        null,
        null,
        true
    );
}


function createReadingRoom() {
    if (!currentBookId) {
        showUploadToast("Open a book first to create a room!", "error");
        return;
    }
    if (!currentRoom && socket) {
        currentRoom = `room_${currentBookId}_${Math.random().toString(36).substring(7)}`;
        socket.emit('join_room', { room: currentRoom });
    }
    
    // Open the modal directly (Link display has been removed)
    const modal = document.getElementById('roomModal');
    if (modal) modal.style.display = 'flex';
}

function copyRoomLink() {
    const link = document.getElementById('roomLink').innerText;
    navigator.clipboard.writeText(link).then(() => {
        showUploadToast("📋 Invite link copied!", "success");
    });
}

async function shareRoomLink() {
    const link = document.getElementById('roomLink').innerText;
    const shareData = {
        title: 'AI Book Reader - Join my Reading Room!',
        text: 'Join me to read together in real-time!',
        url: link
    };
    try {
        await navigator.share(shareData);
        showUploadToast("📤 Shared successfully!", "success");
    } catch (err) {
        console.log('Share failed:', err);
        copyRoomLink(); // Fallback to copy
    }
}

function closeRoomModal() {
    document.getElementById('roomModal').style.display = 'none';
}

function sendDirectInvite() {
    const identity = document.getElementById('inviteIdentity').value;
    if (!identity) {
        showUploadToast("Please enter a username or email", "error");
        return;
    }
    fetch('/send_invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver_identity: identity, book_id: currentBookId })
    })
        .then(r => r.json())
        .then(data => {
            if (data.error) {
                showUploadToast(data.error, "error");
            } else if (data.info) {
                showUploadToast(data.info, "info");
                document.getElementById('inviteIdentity').value = "";
            } else {
                showUploadToast(data.message || "Invitation sent!", "success");
                document.getElementById('inviteIdentity').value = "";
            }
        });
}

function showInvitationsModal() {
    document.getElementById('invitationsModal').style.display = 'flex';
    loadInvitations();
}

function hideInvitationsModal() {
    document.getElementById('invitationsModal').style.display = 'none';
}

function loadInvitations() {
    fetch('/get_invites')
        .then(r => r.json())
        .then(data => {
            const container = document.getElementById('invitationsList');
            if (data.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: var(--text-light); font-style: italic; opacity: 0.7;">No pending requests.</p>';
                document.getElementById('inviteCountBadge').style.display = 'none';
                return;
            }

            document.getElementById('inviteCountBadge').innerText = data.length;
            document.getElementById('inviteCountBadge').style.display = 'flex';

            container.innerHTML = data.map(inv => {
                let notice = inv.already_has ? `
                <div style="font-size: 0.75rem; color: #ff9f43; background: rgba(255, 159, 67, 0.1); padding: 8px 12px; border-radius: 10px; margin-bottom: 15px; border: 1px solid rgba(255, 159, 67, 0.2); line-height: 1.3; text-align: left;">
                    💡 <strong>Note:</strong> You already have this book in your library. Accepting will add a collaborative copy.
                </div>` : '';

                return `
            <div class="glass-panel" style="padding: 18px; border-radius: 20px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 800; color: white;">
                        ${inv.sender[0].toUpperCase()}
                    </div>
                    <div style="text-align: left;">
                        <p style="margin: 0; color: var(--text-white); font-weight: 700; font-size: 0.95rem;">${inv.sender_name}</p>
                        <p style="margin: 0; color: var(--text-light); font-size: 0.8rem;">@${inv.sender}</p>
                    </div>
                </div>
                <p style="text-align: left; color: var(--text-light); font-size: 0.9rem; margin-bottom: 18px; line-height: 1.4;">
                    Wants to read <strong style="color: var(--primary);">"${inv.book_name}"</strong> together with you.
                </p>
                ${notice}
                <div style="display: flex; gap: 10px;">
                    <button class="btn-primary" onclick="respondToInvite(${inv.id}, 'accept')" style="flex: 1; padding: 10px; font-size: 0.85rem;">Accept & Join</button>
                    <button class="btn-secondary" onclick="respondToInvite(${inv.id}, 'reject')" style="flex: 1; padding: 10px; font-size: 0.85rem; background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2);">Decline</button>
                </div>
            </div>
        `;
            }).join('');
        });
}

function triggerDashboardUpload() {
    const input = document.getElementById('dashboardFileInput');
    if (input) input.click();
}

function handleDashboardFileSelection() {
    const input = document.getElementById('dashboardFileInput');
    if (!input || !input.files || input.files.length === 0) return;

    const file = input.files[0];
    const nameWithoutExt = file.name.split('.').slice(0, -1).join('.');
    const finalName = nameWithoutExt || file.name;

    // Robustly handle all potential upload UI elements (Desktop & Mobile)
    const chooseButtons = document.querySelectorAll('#dashboardChooseFileBtn, #dashboardChooseFileBtnMobile');
    const renameWrappers = document.querySelectorAll('#dashboardRenameWrapper, #dashboardRenameWrapperMobile');
    const renameInputs = document.querySelectorAll('#dashboardBookRenameInput, #dashboardBookRenameInputMobile');
    const confirmButtons = document.querySelectorAll('#btnConfirmAddBook, #btnConfirmAddBookMobile');

    chooseButtons.forEach(btn => btn.style.display = 'none');
    renameWrappers.forEach(wrapper => {
        wrapper.style.display = 'flex'; 
    });
    
    renameInputs.forEach(inp => {
        inp.value = finalName;
        // Only focus if it's visible to avoid jarring scrolls
        if (window.getComputedStyle(inp).display !== 'none') {
            setTimeout(() => inp.focus(), 50);
        }
    });

    confirmButtons.forEach(btn => btn.style.display = 'flex');

    showUploadToast(`Selected: ${file.name}. Rename if you wish!`, "info");
}

function resetDashboardUpload() {
    const input = document.getElementById('dashboardFileInput');
    if (input) input.value = "";

    const chooseButtons = document.querySelectorAll('#dashboardChooseFileBtn, #dashboardChooseFileBtnMobile');
    const renameWrappers = document.querySelectorAll('#dashboardRenameWrapper, #dashboardRenameWrapperMobile');
    const confirmButtons = document.querySelectorAll('#btnConfirmAddBook, #btnConfirmAddBookMobile');

    chooseButtons.forEach(btn => btn.style.display = 'flex');
    renameWrappers.forEach(wrapper => wrapper.style.display = 'none');
    confirmButtons.forEach(btn => btn.style.display = 'none');
    
    showUploadToast("Selection cancelled", "info");
}

async function confirmDashboardUpload() {
    const input = document.getElementById('dashboardFileInput');
    if (!input || !input.files || input.files.length === 0) {
        showUploadToast("Please choose a file first.", "error");
        return;
    }

    // Check which rename input is active
    const renameInput = document.getElementById('dashboardBookRenameInput');
    const renameInputMobile = document.getElementById('dashboardBookRenameInputMobile');
    
    // Use desktop input if visible, otherwise use mobile input
    let customName = "";
    if (renameInput && window.getComputedStyle(renameInput.parentElement).display !== 'none') {
        customName = renameInput.value.trim();
    } else if (renameInputMobile && window.getComputedStyle(renameInputMobile.parentElement).display !== 'none') {
        customName = renameInputMobile.value.trim();
    }

    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);
    if (customName) {
        formData.append("custom_name", customName);
    }

    // Confirm buttons
    const confirmBtn = document.getElementById('btnConfirmAddBook');
    const confirmBtnMobile = document.getElementById('btnConfirmAddBookMobile');

    const updateBtnState = (btn, isLoading) => {
        if (!btn) return;
        btn.disabled = isLoading;
        btn.innerHTML = isLoading ? '<i class="fas fa-spinner fa-spin"></i> Adding...' : 'Add Book';
    };

    updateBtnState(confirmBtn, true);
    updateBtnState(confirmBtnMobile, true);
    
    showUploadToast(`🚀 Adding ${customName || file.name} to library...`, "info");

    try {
        // Implement a timeout to prevent infinite "Adding..." state
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

        const res = await fetch("/upload", {
            method: "POST",
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json();
        
        if (data.status === "error" || data.status === "duplicate" || res.status >= 400) {
            showUploadToast(data.message || data.error || "Upload failed", "error");
            updateBtnState(confirmBtn, false);
            updateBtnState(confirmBtnMobile, false);
        } else {
            showUploadToast(data.message || "✅ Book added successfully!", "success");
            resetDashboardUpload();
            if (typeof loadBooks === 'function') loadBooks();
        }
    } catch (err) {
        console.error("Upload failed:", err);
        showUploadToast("Connection failed", "error");
        updateBtnState(confirmBtn, false);
        updateBtnState(confirmBtnMobile, false);
    }
}

function filterDashboardMobile(val) {
    const desktopSearch = document.getElementById('dashboardSearch');
    if (desktopSearch) desktopSearch.value = val;
    filterDashboard();
}

function respondToInvite(inviteId, action) {
    fetch('/respond_invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_id: inviteId, action: action })
    })
        .then(r => r.json())
        .then(data => {
            if (action === 'accept') {
                showUploadToast("Welcome to the Reading Room!", "success");
                loadInvitations();
                loadBooks(); // Refresh library
            } else {
                showUploadToast("Request declined", "info");
                loadInvitations();
            }
        });
}

function loadCollaborations() {
    fetch('/get_collaborations')
        .then(r => r.json())
        .then(data => {
            const container = document.getElementById('activeCollabsList');
            if (!container) return;
            container.innerHTML = data.map(c => `
            <div class="indicator-badge" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; padding: 6px 12px; border-radius: 10px; font-size: 0.8rem; display: flex; align-items: center; gap: 8px;">
                👥 ${c.partner} (${c.role})
                <button onclick="disconnectCollaboration(${c.id})" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 0; font-size: 1rem; display: flex; align-items: center;" title="Stop Collaborating">&times;</button>
            </div>
        `).join('');
        });
}

function disconnectCollaboration(collabId) {
    showConfirmModal(
        "End Collaboration?",
        "This will disconnect the shared reading link. Both you and your partner will keep your own personal copies of the book and your individual progress.",
        "End Session",
        "Keep Reading",
        null,
        () => {
            fetch('/disconnect_collaboration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ collab_id: collabId })
            })
                .then(r => r.json())
                .then(() => {
                    showUploadToast("📍 Collaboration ended. Both users kept personal copies.", "info");
                    hideCollabsModal(); // Auto-close the list for a cleaner flow
                    loadBooks();
                });
        },
        null,
        null,
        true
    );
}

function showCollabsModal() {
    document.getElementById('collabsModal').style.display = 'flex';
    loadCollaborations();
}

function hideCollabsModal() {
    document.getElementById('collabsModal').style.display = 'none';
}

function loadCollaborations() {
    fetch('/get_collaborations')
        .then(r => r.json())
        .then(data => {
            const container = document.getElementById('activeCollabsListFull');
            if (!container) return;
            if (data.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: var(--text-light); font-style: italic; opacity: 0.7;">No active collaborations.</p>';
                return;
            }
            container.innerHTML = data.map(c => `
            <div class="glass-panel" style="padding: 20px; border-radius: 20px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: space-between; gap: 15px;">
                <div style="text-align: left; flex: 1; min-width: 0;">
                    <p style="margin: 0; color: var(--text-white); font-weight: 700; font-size: 1rem; overflow-wrap: break-word; word-break: break-word; line-height: 1.4;">${c.book_name}</p>
                    <div style="margin: 8px 0 0 0; color: var(--text-light); font-size: 0.85rem; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                        <span>Reading with <strong style="color: var(--primary);">@${c.partner}</strong></span>
                        <span style="display: inline-block; white-space: nowrap; font-size: 0.75rem; background: rgba(99,102,241,0.1); padding: 3px 8px; border-radius: 6px; color: var(--primary); font-weight: 800; border: 1px solid rgba(99,102,241,0.2);">
                            ${c.role === 'Owner' ? 'You Shared' : 'Shared with You'}
                        </span>
                    </div>
                </div>
                <button onclick="disconnectCollaboration(${c.id})" style="flex-shrink: 0; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; cursor: pointer; padding: 8px 15px; border-radius: 10px; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;">
                    Stop
                </button>
            </div>
        `).join('');
        });
}


function checkForInvites() {
    fetch('/get_invites').then(r => r.json()).then(data => {
        const badge = document.getElementById('inviteCountBadge');
        if (!badge) return;
        if (data.length > 0) {
            badge.innerText = data.length;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    });
}

// Auto-check for invites every 15 seconds if dashboard is open
setInterval(() => {
    const dashboard = document.getElementById('dashboardOverlay');
    if (dashboard && dashboard.style.display !== 'none') {
        checkForInvites();
    }
}, 15000);

function toggleMobileTools() {
    const drawer = document.getElementById('mobileToolsDrawer');
    if (drawer) {
        drawer.classList.toggle('active');
    }
}

let drawingState = 0; // 0 = none, 1 = draw, 2 = erase
let drawCanvas = null;
let drawCtx = null;
let isDrawingNow = false;
let brushColor = "#1e293b";
let brushSize = 3;
let hasMadeSessionDrawing = false;

function initDrawingForBook(bookId) {
    let reader = document.getElementById("reader");
    if (!reader) return;

    if (drawCanvas) {
        drawCanvas.remove();
        drawCanvas = null;
        drawCtx = null;
    }

    drawingState = 0;

    const fab = document.getElementById("floatingDrawFab");
    if (fab) {
        fab.style.display = "flex";
        fab.innerHTML = '<img src="/static/pencil.png" style="width: 32px; height: 32px; object-fit: contain; mix-blend-mode: multiply;"><span id="drawStatusBadge" style="position: absolute; top: 0px; right: 0px; width: 18px; height: 18px; border-radius: 50%; background: #ef4444; border: 1.5px solid #ffffff; display: none; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: bold; box-shadow: 0 2px 5px rgba(0,0,0,0.25); z-index: 21;">✕</span>';
        fab.title = "Enable Drawing Mode";
    }

    drawCanvas = document.createElement("canvas");
    drawCanvas.id = "readerDrawCanvas";
    drawCanvas.style.position = "absolute";
    drawCanvas.style.top = "0";
    drawCanvas.style.left = "0";
    drawCanvas.style.width = "100%";
    drawCanvas.style.height = "100%";
    drawCanvas.style.pointerEvents = "none";
    drawCanvas.style.cursor = "crosshair";
    drawCanvas.style.zIndex = "2147483640";

    // Wait until full scrolling size is available
    drawCanvas.width = reader.scrollWidth || reader.offsetWidth || 800;
    drawCanvas.height = reader.scrollHeight || reader.offsetHeight || 600;

    reader.style.position = "relative";
    reader.appendChild(drawCanvas);

    drawCtx = drawCanvas.getContext("2d");
    drawCtx.strokeStyle = brushColor;
    drawCtx.lineWidth = brushSize;
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";

    drawCanvas.addEventListener("mousedown", startDraw);
    drawCanvas.addEventListener("mousemove", drawMove);
    drawCanvas.addEventListener("mouseup", endDraw);
    drawCanvas.addEventListener("mouseleave", endDraw);

    drawCanvas.addEventListener("touchstart", (e) => {
        if (e.cancelable) e.preventDefault();
        let touch = e.touches[0];
        let mouseEvent = new MouseEvent("mousedown", {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        drawCanvas.dispatchEvent(mouseEvent);
    }, { passive: false });
    drawCanvas.addEventListener("touchmove", (e) => {
        if (e.cancelable) e.preventDefault();
        let touch = e.touches[0];
        let mouseEvent = new MouseEvent("mousemove", {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        drawCanvas.dispatchEvent(mouseEvent);
    }, { passive: false });
    drawCanvas.addEventListener("touchend", (e) => {
        if (e.cancelable) e.preventDefault();
        let mouseEvent = new MouseEvent("mouseup", {});
        drawCanvas.dispatchEvent(mouseEvent);
    }, { passive: false });

    let savedDrawing = localStorage.getItem(`book_drawing_${bookId}`);
    if (savedDrawing) {
        let img = new Image();
        img.onload = () => {
            drawCtx.drawImage(img, 0, 0);
        };
        img.src = savedDrawing;
    }
}

function toggleDrawingMode() {
    const toolbar = document.getElementById("drawingMiniToolbar");
    const fab = document.getElementById("floatingDrawFab");
    if (!toolbar) return;
    if (toolbar.style.display === "none" || toolbar.style.display === "") {
        toolbar.style.display = "flex";
        if (fab) {
            fab.style.opacity = "0"; // Hide button while toolbar is open
            fab.style.pointerEvents = "none";
        }
        // Auto-activate pencil for better UX
        activatePencilTool();
    } else {
        toolbar.style.display = "none";
        if (fab) {
            fab.style.opacity = "1";
            fab.style.pointerEvents = "auto";
        }
    }
}

function activatePencilTool() {
    if (!drawCanvas || !drawCtx) return;
    drawingState = 1;
    drawCanvas.style.pointerEvents = "auto";
    drawCanvas.style.touchAction = "none";
    drawCanvas.style.cursor = "crosshair";
    
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    
    let reader = document.getElementById("reader");
    if (reader) {
        reader.style.touchAction = "none";
        reader.style.userSelect = "none";
        reader.style.webkitUserSelect = "none";
    }
    drawCtx.globalCompositeOperation = "source-over";
    drawCtx.strokeStyle = brushColor;
    drawCtx.lineWidth = brushSize;

    const badge = document.getElementById("drawStatusBadge");
    if (badge) {
        badge.style.display = "flex";
        badge.style.background = "#10b981";
        badge.innerText = "✓";
    }
    showUploadToast("✍️ Pencil mode active!", "success");
}

function activateEraserTool() {
    if (!drawCanvas || !drawCtx) return;
    drawingState = 2;
    drawCanvas.style.pointerEvents = "auto";
    drawCanvas.style.touchAction = "none";
    drawCanvas.style.cursor = "pointer";
    
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    
    let reader = document.getElementById("reader");
    if (reader) {
        reader.style.touchAction = "none";
        reader.style.userSelect = "none";
        reader.style.webkitUserSelect = "none";
    }
    drawCtx.globalCompositeOperation = "destination-out";
    drawCtx.lineWidth = 30;

    const badge = document.getElementById("drawStatusBadge");
    if (badge) {
        badge.style.display = "flex";
        badge.style.background = "#ef4444";
        badge.innerText = "✕";
    }
    showUploadToast("🧹 Eraser mode active!", "info");
}

function clearDrawCanvas() {
    if (drawCtx && drawCanvas) {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        hasMadeSessionDrawing = true; // Clearing counts as a change that might need saving
        showUploadToast("🗑️ Drawing cleared successfully.", "success");
    }
}

function disableDrawingMode() {
    if (!drawCanvas || !drawCtx) return;
    drawingState = 0;
    drawCanvas.style.pointerEvents = "none";
    drawCanvas.style.touchAction = "auto";
    drawCtx.globalCompositeOperation = "source-over";

    document.body.style.userSelect = "auto";
    document.body.style.webkitUserSelect = "auto";

    let reader = document.getElementById("reader");
    if (reader) {
        reader.style.touchAction = "auto";
        reader.style.userSelect = "auto";
        reader.style.webkitUserSelect = "auto";
    }

    const toolbar = document.getElementById("drawingMiniToolbar");
    if (toolbar) toolbar.style.display = "none";
    
    const fab = document.getElementById("floatingDrawFab");
    if (fab) {
        fab.style.opacity = "1";
        fab.style.pointerEvents = "auto";
    }

    const badge = document.getElementById("drawStatusBadge");
    if (badge) badge.style.display = "none";

    showUploadToast("🎨 Drawing mode disabled.", "info");
}

function startDraw(e) {
    if (drawingState === 0 || !drawCtx) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    isDrawingNow = true;
    let rect = drawCanvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) * (drawCanvas.width / rect.width);
    let y = (e.clientY - rect.top) * (drawCanvas.height / rect.height);
    
    drawCtx.beginPath();
    drawCtx.moveTo(x, y);
    hasMadeSessionDrawing = true; // Mark that user has interacted with the canvas
}

function drawMove(e) {
    if (drawingState === 0 || !isDrawingNow || !drawCtx) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    let rect = drawCanvas.getBoundingClientRect();
    let x = (e.clientX - rect.left) * (drawCanvas.width / rect.width);
    let y = (e.clientY - rect.top) * (drawCanvas.height / rect.height);
    
    drawCtx.lineTo(x, y);
    drawCtx.stroke();
}

function endDraw() {
    isDrawingNow = false;
}

let allVoiceNotes = [];

function fetchVoiceNotes() {
    return fetch("/voice_notes")
        .then(res => res.json())
        .then(data => {
            allVoiceNotes = data;
            const section = document.getElementById("standaloneVoiceNotesSection");
            const grid = document.getElementById("voiceNotesGrid");
            if (!section || !grid) return;

            if (!data || data.length === 0) {
                section.style.display = "none";
                grid.innerHTML = "";
                return;
            }

            section.style.display = "block";
            grid.innerHTML = data.map(note => `
                <div class="glass-panel voice-note-scratchpad-card" style="padding: 12px 14px; border-radius: 14px; display: flex; flex-direction: column; border: 1px solid var(--border); background: rgba(255, 255, 255, 0.02); box-shadow: var(--shadow-sm); transition: all 0.2s; cursor: pointer;" onclick="openVoiceNoteViewer(${note.id})">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <span style="font-weight: 700; color: var(--text-white); font-size: 0.92rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 170px;">
                            <i class="fas fa-thumbtack" style="color: #ef4444; margin-right: 4px; font-size: 0.85rem;"></i> ${note.title || "Untitled Note"}
                        </span>
                        <span style="font-size: 0.72rem; color: var(--text-light); opacity: 0.65;">${new Date(note.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            `).join("");
        })
        .catch(err => console.error("Error loading voice notes:", err));
}

function openVoiceNoteViewer(noteId) {
    const note = allVoiceNotes.find(n => n.id === noteId);
    if (!note) return;

    const modal = document.getElementById("voiceNoteViewerModal");
    const idInput = document.getElementById("currentViewVoiceNoteId");
    const textarea = document.getElementById("viewVoiceNoteContentArea");
    if (!modal || !idInput || !textarea) return;

    idInput.value = noteId;
    textarea.value = note.content;
    modal.style.display = "flex";
}

function closeVoiceNoteViewer() {
    const modal = document.getElementById("voiceNoteViewerModal");
    if (modal) {
        modal.style.display = "none";
    }
}

function deleteCurrentVoiceNote() {
    const idInput = document.getElementById("currentViewVoiceNoteId");
    if (!idInput || !idInput.value) return;

    fetch(`/delete_voice_note/${idInput.value}`, {
        method: "POST"
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            showUploadToast(data.message, "success");
            closeVoiceNoteViewer();
            fetchVoiceNotes();
        } else {
            showUploadToast(data.message || "Failed to delete voice note", "error");
        }
    })
    .catch(err => console.error(err));
}

function moveNoteToLibrary() {
    const idInput = document.getElementById("currentViewVoiceNoteId");
    if (!idInput || !idInput.value) return;

    fetch(`/add_voice_note_to_library/${idInput.value}`, {
        method: "POST"
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            showUploadToast(data.message, "success");
            closeVoiceNoteViewer();
            fetchVoiceNotes();
            if (typeof loadBooks === "function") {
                loadBooks();
            }
        } else {
            showUploadToast(data.message || "Failed to add voice note to library", "error");
        }
    })
    .catch(err => console.error(err));
}

function editCurrentVoiceNote() {
    const idInput = document.getElementById("currentViewVoiceNoteId");
    const contentArea = document.getElementById("viewVoiceNoteContentArea");
    if (!idInput || !idInput.value || !contentArea) return;

    window._editingVoiceNoteId = idInput.value;

    const s2tArea = document.getElementById("s2tTranscriptArea");
    if (s2tArea) {
        s2tArea.value = contentArea.value;
    }

    const titleInput = document.getElementById("voiceNotePromptTitleInput");
    if (titleInput) {
        titleInput.value = "My Voice Note";
    }

    closeVoiceNoteViewer();
    openSpeechToText();
}

// --- AI CHAT LOGIC ---
let isChatVoiceActive = false;
let chatRecognition = null;
let chatAbortController = null;

function toggleAIChat() {
    const modal = document.getElementById('aiChatModal');
    const chatMessages = document.getElementById('chatMessages');

    if (modal.style.display === 'none' || !modal.style.display) {
        modal.style.display = 'flex';
        // If chat is empty, add welcome message
        if (chatMessages && chatMessages.innerHTML.trim() === '') {
            appendChatMessage('ai', "Hello! I'm your AI Reading Assistant. How can I help you today?");
        }
        document.getElementById('chatInput').focus();

        // HIDE Floating Buttons when chat opens
        const drawFab = document.getElementById('floatingDrawFab');
        const voiceBtn = document.getElementById('voiceBtn');
        if (drawFab) drawFab.style.display = 'none';
        if (voiceBtn) voiceBtn.style.display = 'none';
    } else {
        // CLOSE via 'X' button - Hide and Reset
        modal.style.display = 'none';
        
        // 🔇 Stop AI from talking immediately
        if (window.stopAIChatVoice) window.stopAIChatVoice();
        
        if (isChatVoiceActive) stopChatVoice();
        if (chatAbortController) {
            chatAbortController.abort();
            chatAbortController = null;
        }
        // Clear history for a fresh start
        if (chatMessages) chatMessages.innerHTML = '';
        showUploadToast("Chat session reset.", "info");

        // RESTORE Floating Buttons when chat closes
        const drawFab = document.getElementById('floatingDrawFab');
        const voiceBtn = document.getElementById('voiceBtn');
        if (drawFab && window.currentBookId) drawFab.style.display = 'flex';
        if (voiceBtn && window.currentBookId) voiceBtn.style.display = 'flex';
    }
}

function minimizeAIChat() {
    const modal = document.getElementById('aiChatModal');
    // Minimize simply hides the window but DOES NOT clear history
    if (modal) {
        modal.style.display = 'none';
        
        // 🔇 Stop AI from talking immediately
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        
        if (isChatVoiceActive) stopChatVoice();
        // We do NOT clear chatMessages here, so it's "saved" for next time
        showUploadToast("Chat minimized (history saved).", "info");

        // RESTORE Floating Buttons when chat minimizes
        const drawFab = document.getElementById('floatingDrawFab');
        const voiceBtn = document.getElementById('voiceBtn');
        if (drawFab && window.currentBookId) drawFab.style.display = 'flex';
        if (voiceBtn && window.currentBookId) voiceBtn.style.display = 'flex';
    }
}

function restoreAIChat() {
    // This function is now redundant as toggleAIChat handles showing
    toggleAIChat();
}

async function sendChatMessage(overrideText = null) {
    const input = document.getElementById('chatInput');
    const msg = overrideText || input.value.trim();
    if (!msg) return;

    if (!overrideText) input.value = '';
    appendChatMessage('user', msg);

    // Cancel any previous pending request
    if (chatAbortController) chatAbortController.abort();
    chatAbortController = new AbortController();

    // Show loading
    const loadingId = 'ai-loading-' + Date.now();
    appendChatMessage('ai', 'AI is thinking...', loadingId);

    if (isChatVoiceActive) stopChatVoice();

    const chatFocus = document.getElementById('chatBookFocus');
    const selectedBookId = chatFocus ? chatFocus.value : null;
    const selectedBookName = chatFocus && chatFocus.selectedIndex > 0 ? chatFocus.options[chatFocus.selectedIndex].text : "";

    try {
        const response = await fetch('/api/ai_chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: chatAbortController.signal,
            body: JSON.stringify({ 
                message: msg,
                book_id: selectedBookId || window.currentBookId || null,
                context: selectedBookName || window.currentBookTitle || "",
                previous_response: window._lastAIResponse || "",
                previous_user_message: window._lastUserMessage || "",
                chat_lang: window._chatLanguage || "en"
            })
        });
        window._lastUserMessage = msg; // Store current for next time
        const data = await response.json();
        chatAbortController = null;
        
        // Remove loading
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.parentElement.remove();

        if (data.status === 'success') {
            if (data.new_chat_lang) {
                window._chatLanguage = data.new_chat_lang;
                const selector = document.getElementById('chatLanguageSelector');
                if (selector) {
                    selector.value = data.new_chat_lang;
                }
                showUploadToast(`🌐 Chat language changed to: ${data.lang_name || data.new_chat_lang}`, "success");
            }
            window._lastAIResponse = data.response;
            appendChatMessage('ai', data.response);
            speakAIResponse(data.response);
        } else {
            appendChatMessage('ai', 'Sorry, I encountered an error: ' + (data.message || 'Unknown error'));
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log("Chat request aborted.");
            // Loading bubble is already handled in stopAIChatThinking if needed, 
            // but here we just ensure it's gone.
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) loadingEl.parentElement.remove();
        } else {
            console.error("Chat error:", e);
            const loadingEl = document.getElementById(loadingId);
            if (loadingEl) loadingEl.parentElement.remove();
            appendChatMessage('ai', 'Sorry, I could not connect to the AI service.');
        }
        chatAbortController = null;
    }
}

function stopAIChatThinking() {
    if (chatAbortController) {
        chatAbortController.abort();
        chatAbortController = null;
        showUploadToast("AI thinking cancelled.", "info");
    }
}

function formatMarkdown(text) {
    if (!text) return "";
    let escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    
    // Parse bold **text**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    
    // Parse italic *text*
    escaped = escaped.replace(/\*(.*?)\*/g, "<em>$1</em>");
    
    // Parse inline code `text`
    escaped = escaped.replace(/`(.*?)`/g, "<code>$1</code>");
    
    // Parse newlines to <br/>
    escaped = escaped.replace(/\n/g, "<br/>");
    
    return escaped;
}

function appendChatMessage(sender, text, id = null) {
    const container = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg-container ' + sender;
    msgDiv.style.display = 'flex';
    msgDiv.style.flexDirection = 'column';
    msgDiv.style.alignItems = sender === 'user' ? 'flex-end' : 'flex-start';
    msgDiv.style.marginBottom = '15px';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (id) bubble.id = id;
    
    bubble.style.padding = '12px 16px';
    bubble.style.borderRadius = sender === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px';
    bubble.style.maxWidth = '85%';
    bubble.style.wordBreak = 'break-word';
    bubble.style.fontSize = '0.95rem';
    bubble.style.lineHeight = '1.4';
    bubble.style.textAlign = 'left';
    
    if (sender === 'user') {
        bubble.style.background = 'var(--primary)';
        bubble.style.color = 'white';
    } else {
        bubble.style.background = 'var(--glass)';
        bubble.style.color = 'var(--text-main)';
        bubble.style.border = '1px solid var(--glass-border)';
    }

    bubble.innerHTML = formatMarkdown(text);
    msgDiv.appendChild(bubble);

    // Add Voice Controls for AI messages
    if (sender === 'ai' && !id?.includes('loading')) {
        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '8px';
        actions.style.marginTop = '6px';
        actions.style.marginLeft = '4px';
        
        // Professional SVG Icons
        const volumeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
        const stopIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;

        actions.innerHTML = `
            <button class="chat-hear-btn" 
                    title="Hear again"
                    style="background:rgba(181, 130, 101, 0.08); border:none; border-radius:8px; cursor:pointer; color:var(--text-main); padding: 8px; display:inline-flex; align-items:center; justify-content:center; transition:0.2s; opacity:0.8;">
                ${volumeIcon}
            </button>
            <button onclick="window.stopAIChatVoice()" 
                    title="Stop Voice"
                    style="background:rgba(239, 68, 68, 0.05); border:none; border-radius:8px; cursor:pointer; color:#ef4444; padding: 8px; display:inline-flex; align-items:center; justify-content:center; transition:0.2s; opacity:0.8;"
                    onmouseover="this.style.background='rgba(239, 68, 68, 0.12)'; this.style.opacity='1'" onmouseout="this.style.background='rgba(239, 68, 68, 0.05)'; this.style.opacity='0.8'">
                ${stopIcon}
            </button>
        `;

        const hearBtn = actions.querySelector('.chat-hear-btn');
        hearBtn.onclick = () => speakAIResponse(text);
        
        msgDiv.appendChild(actions);
    }

    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function toggleChatVoice() {
    if (isChatVoiceActive) {
        stopChatVoice();
    } else {
        startChatVoice();
    }
}

function startChatVoice() {
    if (window.stopAIChatVoice) window.stopAIChatVoice();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Voice recognition not supported in this browser.");
        return;
    }

    if (!chatRecognition) {
        chatRecognition = new SpeechRecognition();
        chatRecognition.continuous = true;
        chatRecognition.interimResults = true;
    }

    // DYNAMIC LANGUAGE SYNC: Update recognition language to match current chat setting, fallback to reader language
    let currentLang = window._chatLanguage;
    if (!currentLang && typeof getSelectedLanguage === 'function') {
        const appLang = getSelectedLanguage();
        if (appLang) {
            currentLang = appLang.split('-')[0].toLowerCase();
        }
    }
    if (!currentLang) currentLang = 'en';

    const langCodes = {
        'en': 'en-US', 'ta': 'ta-IN', 'hi': 'hi-IN', 'te': 'te-IN', 
        'ml': 'ml-IN', 'bn': 'bn-IN', 'mr': 'mr-IN', 'kn': 'kn-IN',
        'gu': 'gu-IN', 'pa': 'pa-IN', 'fr': 'fr-FR', 'es': 'es-ES',
        'de': 'de-DE'
    };
    chatRecognition.lang = langCodes[currentLang] || 'en-US';
    
    // Sync UI Selector
    const selector = document.getElementById('chatLanguageSelector');
    if (selector) {
        selector.value = currentLang;
    }

    chatRecognition.onresult = (event) => {
        let final_transcript = '';
        let interim_transcript = '';

        // REBUILD TRANSCRIPT FROM ZERO: This prevents "double-typing" by getting the clean state of the whole message
        // We use the entire results array to ensure we don't miss anything or repeat segments
        for (let i = 0; i < event.results.length; ++i) {
            const transcriptSegment = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final_transcript += transcriptSegment;
            } else {
                interim_transcript += transcriptSegment;
            }
        }

        const currentInput = document.getElementById('chatInput');
        if (currentInput) {
            const combined = (final_transcript + interim_transcript).trim();
            // Only update if there's actually a change to avoid cursor jumping/flickering
            if (combined && currentInput.value !== combined) {
                currentInput.value = combined;
                currentInput.dispatchEvent(new Event('input'));
            }
        }
    };

    chatRecognition.onstart = () => {
        isChatVoiceActive = true;
        const micBtn = document.getElementById('chatMicBtn');
        if (micBtn) {
            micBtn.classList.add('mic-active');
        }
        const input = document.getElementById('chatInput');
        if (input) {
            input.placeholder = "Listening...";
            input.focus(); // Ensure focus for better feedback
        }
        console.log(`Speech Recognition Started: ${chatRecognition.lang}`);
    };

    chatRecognition.onend = () => {
        isChatVoiceActive = false;
        const micBtn = document.getElementById('chatMicBtn');
        if (micBtn) {
            micBtn.classList.remove('mic-active');
        }
        const input = document.getElementById('chatInput');
        if (input) {
            input.placeholder = "Type a message...";
        }
    };

    chatRecognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error !== 'no-speech') {
            stopChatVoice();
        }
    };

    try {
        chatRecognition.start();
    } catch (e) {
        console.warn("Recognition already started or error:", e);
    }
}

function stopChatVoice() {
    isChatVoiceActive = false;
    if (chatRecognition) chatRecognition.stop();
    document.getElementById('chatMicBtn').classList.remove('active');
    document.getElementById('chatInput').placeholder = "Type a message...";
}

// --- Sidebar Resize Logic ---
function initSidebarResize() {
    const resizer = document.getElementById('sidebarResizer');
    const layout = document.querySelector('.app-layout');
    if (!resizer || !layout) return;

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        // Add an overlay or prevent pointer events on other elements to avoid flickering
        document.body.style.userSelect = 'none';
        
        // Ensure reader iframe/content doesn't capture mouse
        const reader = document.getElementById('reader');
        if (reader) reader.style.pointerEvents = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        let newWidth = e.clientX;
        
        // Constraints
        if (newWidth < 250) newWidth = 250;
        if (newWidth > 600) newWidth = 600;

        layout.style.setProperty('--sidebar-width', `${newWidth}px`);
        
        // Save to localStorage for persistence
        localStorage.setItem('sidebarWidth', `${newWidth}px`);
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        const reader = document.getElementById('reader');
        if (reader) reader.style.pointerEvents = '';
    });

    // Restore saved width
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        layout.style.setProperty('--sidebar-width', savedWidth);
    }
}

