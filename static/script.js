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
        }
    });
} catch (e) { }

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
    const sessionElapsed = Math.floor((Date.now() - studySessionStartTime) / 1000);
    const totalElapsed = initialStudyTime + sessionElapsed;
    
    const hrs = Math.floor(totalElapsed / 3600);
    const mins = Math.floor((totalElapsed % 3600) / 60);
    const secs = totalElapsed % 60;
    
    const timeStr = [hrs, mins, secs].map(v => v < 10 ? "0" + v : v).join(":");
    const timerEl = document.getElementById("studyTimer");
    if (timerEl) {
        timerEl.innerText = `| ${timeStr} Studying`;
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
window.speechSyncNext = false;

let isEmotionModeActive = true;
// REAL-TIME Narrator Control
let currentEmotionUtterance = null;

// --- Study Hub Interface Management ---
function toggleStudyHub() {
    const dropdown = document.getElementById('studyHubDropdown');
    const isVisible = dropdown.style.display === 'flex';
    dropdown.style.display = isVisible ? 'none' : 'flex';
}

// --- Settings & Vision Setup UI ---
// Global listener to close dropdowns when clicking outside
window.addEventListener('click', function(e) {
    const hubContainer = document.querySelector('.study-hub-container');
    const hubDropdown = document.getElementById('studyHubDropdown');
    if (hubContainer && !hubContainer.contains(e.target)) {
        if (hubDropdown) hubDropdown.style.display = 'none';
    }
});

// --- Study Notebook Logic (Plain & Clean) ---
function toggleDashboard() {
    const overlay = document.getElementById("dashboardOverlay");
    const isVisible = overlay.style.display === "flex";
    if (!isVisible) {
        overlay.style.display = "flex";
        stopReadingPulse(); 
        loadBooks(); 
        fetchUserStreak(); 
        checkForInvites(); 
    } else {
        overlay.style.display = "none";
        // CRITICAL: Close any open sub-modals to prevent UI ghosting over the reader
        const subModals = ['collabsModal', 'invitationsModal', 'roomModal', 'profileModal'];
        subModals.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        
        // If we are currently in a book, resume counting
        if (currentBookId) startReadingPulse();
    }
}

function renderDashboard(data) {
    console.log("Rendering Dashboard with", data.length, "books");
    const grid = document.getElementById("dashboardGrid");
    const bookmarkTotal = document.getElementById("libraryBookmarkCount");
    
    if (!grid) return;
    
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
        const [id, name, uploaded_at, status, thumb, summary, time, is_fav, bCount, nCount, relation, pageCount, sharerName] = book;
        
        // Format upload date
        let uploadDateStr = "";
        try {
            // SQLite TIMESTAMP DEFAULT CURRENT_TIMESTAMP is usually UTC
            const date = new Date(uploaded_at.replace(" ", "T") + "Z");
            uploadDateStr = date.toLocaleString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true 
            });
        } catch(e) { uploadDateStr = uploaded_at; }

        const card = document.createElement("div");
        card.className = "book-card";
        card.setAttribute("data-book-id", id);
        card.setAttribute("data-book-name", name.toLowerCase());
        card.setAttribute("data-is-favourite", is_fav ? "1" : "0");
        card.setAttribute("data-bookmark-count", bCount || 0);
        
        let thumbContent = `
            <div class="portait-placeholder" style="height:100%; width:100%; display:flex; align-items:center; justify-content:center; background:#eee; color:#aaa;">
                <span style="font-size:3rem;">📖</span>
            </div>
        `;
        
        if (thumb) {
            thumbContent = `<img src="/thumbnail/${id}" alt="${name}" onerror="this.style.display='none'">`;
        }

        const indicators = `
            <div class="card-indicators">
                ${(status && status !== 'ready') ? `<span class="indicator-badge status-badge">⚙️ ${status}</span>` : ''}
                ${relation === 'shared' ? `<span class="indicator-badge" style="background: rgba(99, 102, 241, 0.15); color: var(--primary); border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; letter-spacing: 0.02em;" title="Collaborated with ${sharerName || 'someone'}">👥 SHARED</span>` : ''}
                ${bCount > 0 ? `<span class="indicator-badge" title="Has Bookmarks">🔖 ${bCount}</span>` : ''}
                ${nCount > 0 ? `<span class="indicator-badge" title="Has Study Notes">📝 ${nCount}</span>` : ''}
            </div>
        `;

        card.innerHTML = `
            <div class="card-thumbnail">
                ${thumbContent}
                <button class="btn-favorite ${is_fav ? 'active' : ''}" onclick="toggleFavorite(${id}, this)" title="${is_fav ? 'Unfavorite' : 'Add to Favorites'}">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="${is_fav ? '#ef4444' : 'none'}" stroke="${is_fav ? '#ef4444' : 'white'}" stroke-width="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                </button>
            </div>
            <div class="card-content">
                <div class="card-title" title="${name}">${name}</div>
                ${indicators}
                <div class="card-meta" style="margin-bottom: 4px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6; margin-right:4px;">
                        <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    ${uploadDateStr}
                </div>
                <div class="card-meta" style="opacity: 0.8; margin-top: 0; margin-bottom: 12px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6; margin-right:4px;">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                    </svg>
                    ${pageCount || 0} Pages
                </div>
                <div class="card-footer">
                    <button class="btn-read-more" onclick="openBook(${id}, '${name.replace(/'/g, "\\'")}'); toggleDashboard();">
                        <span>Open</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    </button>
                    <div class="card-actions-row">
                         <button class="btn-card-icon" onclick="deleteBook(${id})" title="Delete Book">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                         </button>
                         <button class="btn-card-icon" title="Download" onclick="downloadBook(${id}, '${name.replace(/'/g, "\\'")}')">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                         </button>
                         <button class="btn-card-icon" title="Share" onclick="shareBook(${id}, '${name.replace(/'/g, "\\'")}')">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                         </button>
                    </div>
                </div>
            </div>
            <!-- AI Summary Overlay -->
            <div class="card-summary-overlay">
                <div class="summary-badge">🪄 AI Synopsis</div>
                <p class="summary-text">${summary || "Our AI is still processing this book to provide a concise summary. Check back soon!"}</p>
                <div class="summary-footer">
                    <span style="opacity: 0.6; font-size: 0.65rem;">HOVER TO RECALL</span>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    // Also fetch and show reading stats
    fetchReadingStats();
}

async function fetchUserStreak() {
    try {
        const res = await fetch("/get_user_streak");
        const data = await res.json();
        
        const streakEl = document.getElementById("userStreakCount");
        const todayTimeEl = document.getElementById("todayReadingTime");
        const goalCircle = document.getElementById("dailyGoalCircle");
        const goalPercent = document.getElementById("dailyGoalPercent");
        const goalStatus = document.getElementById("goalStatus");

        if (!streakEl) return;

        // Update Streak
        streakEl.innerHTML = `🔥 ${data.streak} Day Streak`;
        
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
                goalStatus.innerText = "Goal achieved! You're a legend! 🏆";
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
    const timeSorted = [...data].sort((a,b) => b[2] - a[2]); 
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
                <div class="bar-progress-horizontal" style="width: ${percent}%; background: ${getGradient(index)};">
                    <span class="bar-time-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;">
                            <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        ${timeDisplay}
                    </span>
                </div>
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
            } else {
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'white');
                btn.title = "Add to Favorites";
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
                    <button onclick="downloadExternalBook('${book.id}', '${encodeURIComponent(book.title)}', '${book.url}')" class="btn-primary" style="width: 100%; padding: 10px; font-size: 0.82rem; border-radius: 10px; font-weight: 600; letter-spacing: 0.3px;">
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

async function downloadExternalBook(id, encodedTitle, sourceUrl) {
    const title = decodeURIComponent(encodedTitle);
    const btn = event.target.closest('button');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = "⌛ Downloading...";
    
    try {
        let res = await fetch("/download_external", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: id, title: title, url: sourceUrl })
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
        let currentLang = document.getElementById('langSelect').value;
        let res = await fetch(`/notes/${currentBookId}?lang=${currentLang}`);
        let notes = await res.json();

        responseCount.innerText = `${notes.length} Study Insights`;
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
        list.innerHTML = `<div style="color: #ef4444;">Error accessing records.</div>`;
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
        alert("Quiz Error: " + e.message);
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
        alert("No quiz data available to download.");
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

    const icons = document.querySelectorAll('.themeIcon');
    icons.forEach(icon => {
        if (icon) icon.innerText = isDark ? '☀️' : '🌙';
    });
}

// Apply Saved Theme
(function initTheme() {
    const saved = localStorage.getItem('reader-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('DOMContentLoaded', () => {
        const icons = document.querySelectorAll('.themeIcon');
        icons.forEach(icon => {
            if (icon) icon.innerText = saved === 'light' ? '☀️' : '🌙';
        });
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

    // INSTANT SWITCH: If reading is active, pivot narrator immediately
    if (isReadingAloud && !isPaused) {
        restartNarrator();
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
        warn: "#b5451b",
        error: "#7f1d1d",
        info: "#1e3a5f"
    };
    let bg = colors[type] || colors.info;

    let toast = document.createElement("div");
    toast.id = "uploadToast";
    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: ${bg}; color: #fff; padding: 12px 24px; border-radius: 12px;
        font-size: 0.9rem; font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,0.35);
        z-index: 100000; animation: toastIn 0.3s ease; max-width: 380px; text-align: center;
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
            activeBooksList = data; 
            
            // Sync filter buttons
            syncFilterButtons();
            
            // Sync both Library views
            renderDashboard(data);
            loadCollaborations();

            let list = document.getElementById("booklist");
            list.innerHTML = "";

            let hasProcessing = false;

            data.forEach(book => {
                const [id, name, uploaded_at, status, thumb, summary, time, is_fav, bCount, nCount, relation, pageCount, sharerName] = book;
                if (status === "processing") hasProcessing = true;

                let tr = document.createElement("tr");
                tr.setAttribute("data-book-id", id);
                tr.setAttribute("data-is-favourite", is_fav ? "1" : "0");
                tr.setAttribute("data-bookmark-count", bCount || 0);
                
                if (currentBookId && id == currentBookId) {
                    tr.classList.add("active-book-row");
                }

                let badge = "";
                let btnClass = "";
                if (status === "processing") {
                    badge = `<span class="processing-badge"><span class="spinner"></span> Processing…</span>`;
                    btnClass = "processing-btn";
                } else if (status === "error") {
                    badge = `<span class="processing-badge" style="background:#7f1d1d;color:#fca5a5;">❌ Failed</span>`;
                }

                let isActive = (currentBookId && id == currentBookId);
                let openBtnText = isActive ? "Active" : "Open";
                let openBtn = (status !== "processing" && status !== "error")
                    ? `<button class="btn-open ${isActive ? 'active-pulse' : ''}" onclick="openBook(${id})">${openBtnText}</button>`
                    : `<button disabled class="btn-open processing-btn" style="opacity:0.6;cursor:not-allowed;">Open</button>`;

                let downloadBtn = (status !== "processing" && status !== "error")
                    ? `<button class="btn-download" onclick="downloadBook(${book[0]}, '${book[1].replace(/'/g, "\\'")}')">Download</button>`
                    : `<button disabled class="btn-download" style="opacity:0.4;cursor:not-allowed;">Download</button>`;

                tr.innerHTML = `
                <td>
                    <div class="book-entry">
                        <div class="book-info">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="book-name">${name}${badge}${relation === 'shared' ? ' <span style="font-size:0.65rem; background:rgba(99,102,241,0.1); color:var(--primary); padding:2px 6px; border-radius:4px; font-weight:800; border:1px solid rgba(99,102,241,0.2); vertical-align:middle; margin-left:4px;">👥 SHARED</span>' : ''}</span>
                                <button class="btn-sidebar-fav ${is_fav ? 'active' : ''}" onclick="toggleFavorite(${book[0]}, this)" title="${is_fav ? 'Unfavorite' : 'Add to Favorites'}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${is_fav ? '#ef4444' : 'none'}" stroke="${is_fav ? '#ef4444' : 'var(--text-light)'}" stroke-width="2.5">
                                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l8.84-8.84 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                                    </svg>
                                </button>
                            </div>
                            <div class="book-meta" style="display: flex; flex-direction: column; gap: 4px; margin-top: 5px;">
                                <span>${book[2]}</span>
                                <span style="opacity: 0.8; font-weight: 500;">${book[11] || 0} Pages</span>
                            </div>
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
    const favBtns = [document.getElementById("btnFilterFavs"), document.getElementById("sidebarBtnFilterFavs")];
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
    
    // 🧹 PRE-FETCH CLEANUP: Clear massive strings and DOM right now
    currentBookText = "";
    if (window._currentBookPages) window._currentBookPages = [];
    
    // Detach old DOM instantly to help GC
    let reader = document.getElementById("reader");
    if (reader) {
        while (reader.firstChild) {
            reader.removeChild(reader.firstChild);
        }
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
                alert(data.error);
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
                window.currentTargetLang = "orig"; 
                window.originalBookContent = null;
                window.activeTranslationJob = Date.now(); // Cancel any stale background translation jobs
            }

            // 1. FORCE THE CLEAN SLATE (Fast reset + DOM detachment)
            if (reader) {
                // Using child removal is often faster than innerHTML="" for huge DOMs
                while (reader.firstChild) {
                    reader.removeChild(reader.firstChild);
                }
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
            // Check first 10k chars for the marker to avoid full-string search for detection
            const head = currentBookText.substring(0, 10000);
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
                    // Optimized DOM parsing: only if truly necessary and for reasonable sizes
                    if (currentBookText.length < 3000000) {
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
            setTimeout(renderBookmarkIcons, 1500); // Wait for initial render
        })
        .catch(err => {
            console.error("Reader Fetch Error:", err);
            hideLoader();
            alert("📚 Reader Error: " + (err.message || "Connection failed. Please try again."));
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
                    if (typeof renderDashboard === 'function') renderDashboard();
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

function getNodesAndText(root) {
    let nodes = [];
    let offsets = [];
    let parts = [];
    let currentLen = 0;
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);

    let lastParent = null;
    let lastNode = null;

    while (walker.nextNode()) {
        let node = walker.currentNode;
        
        // Fast Ancestor Check: Skip hidden/UI subtrees efficiently
        let isVisible = true;
        let curr = node.parentNode;
        while (curr && curr !== root) {
            // IGNORE Reading Marks (🔖) - Critical to prevent character drift!
            // IGNORE Hidden Metadata/OCR Layers
            if (curr.classList.contains('reading-mark') || 
                curr.classList.contains('bookmark-label') || 
                curr.classList.contains('bookmark-symbol') || 
                curr.classList.contains('ocr-hidden') || 
                curr.classList.contains('junk-metadata-layer') ||
                curr.classList.contains('scanned-junk-hidden')) {
                isVisible = false;
                break;
            }
            curr = curr.parentNode;
        }
        if (!isVisible) continue;

        // Skip genuinely empty nodes to keep the character map dense
        if (!node.nodeValue || node.nodeValue.trim().length === 0) {
            // But keep track for space injection logic
            lastNode = node;
            continue;
        }

        // SPACE INJECTION: Crucial for drift-free highlighting
        // If we jump between elements, the browser/narrator implies a space.
        // We must add this space to our character map to keep everything aligned.
        if (lastParent && parts.length > 0) {
            let lastPart = parts[parts.length - 1];
            // If parent changed OR we are at a new block boundary, inject a virtual space
            // to ensure words don't smash together for the TTS engine.
            if ((node.parentNode !== lastParent || node.previousSibling !== lastNode) && !lastPart.endsWith(" ") && !node.nodeValue.startsWith(" ")) {
                parts.push(" ");
                currentLen += 1;
            }
        }

        let val = node.nodeValue
            .replace(/\u00AD/g, '')  // REMOVE soft-hyphens (matches normalizeBookDOM)
            .replace(/\u00A0/g, ' ') // MAP non-breaking spaces to standard spaces
            .replace(/\u200B/g, '')  // REMOVE zero-width spaces
            .replace(/\r/g, '');     // REMOVE carriage returns

        nodes.push(node);
        offsets.push(currentLen);
        parts.push(val);
        currentLen += val.length;
        lastParent = node.parentNode;
        lastNode = node;
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

async function resumeReadingFromIndex(index, startPaused = false, forceExactPosition = false) {
    const playPauseBtn = document.getElementById("playPauseBtn");
    if (playPauseBtn && !startPaused) {
        playPauseBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> <span>Preparing...</span>`;
    }

    // CRITICAL: Always rebuild the map when starting a fresh narration to catch any 
    // recent translations that happened while the reader was idle. 
    window.speechSyncNext = false; // Reset sync flag for new session start
    rebuildReadingNodeMap();

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
    window.forceResumeScroll = true; // FORCE JUMP TO THE STARTING POINT
    currentAbsoluteCharIndex = index;
    
    // INSTANT JUMP: Don't wait for audio engine to start; reveal current reading point now.
    highlightReadingWord(index, 5);

    let text = globalReadingText;
    // PERFORMANCE FIX: Only chunk the next 10,000 characters at a time.
    // This makes the 'start' time instant regardless of book length.
    let processingLimit = 10000;
    let remainingText = text.substring(index, index + processingLimit);
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

        utterance.onboundary = function (event) {
            if (jobId !== currentNarrationJobId || event.name !== 'word') return;
            boundaryReceived = true;
            let charLength = event.charLength || 5;
            let absoluteWordPosition = actualStartOffset + event.charIndex;
            currentAbsoluteCharIndex = absoluteWordPosition;
            highlightReadingWord(absoluteWordPosition, charLength);
        };

        utterance.onstart = function () {
            if (jobId !== currentNarrationJobId) return;
            removeReadingMarks();
            let words = [];
            let regex = /\S+/g;
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
                // DURATION ESTIMATION: Based on characters at natural speed (approx 14 chars/sec)
                // This must remain stable even if utterance.rate changes to avoid highlight skips.
                let duration = trimmed.length / 14; 
                let progress = (Date.now() - startTime) / (duration * 1000 / (utterance.rate || 1.0));
                if (progress >= 1.0) { clearInterval(interval); return; }

                let wordIdx = Math.floor(progress * words.length);
                if (wordIdx < words.length && wordIdx >= 0) {
                    currentAbsoluteCharIndex = words[wordIdx].startOffset;
                    highlightReadingWord(words[wordIdx].startOffset, words[wordIdx].length);
                }
            }, 100);
        };

        utterancePool.push(utterance); // Keep reference alive
        utterance.onend = function () {
            utterancePool = utterancePool.filter(u => u !== utterance);
            if (jobId !== currentNarrationJobId) return;
            completedTasks++;
            if (completedTasks === totalTasks) {
                // CRITICAL COMPLETION LOGIC: Check if more text remains before stopping
                if (currentAbsoluteCharIndex < globalReadingText.length - 100) {
                    resumeReadingFromIndex(currentAbsoluteCharIndex, false, true);
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
    if (playPauseBtn) playPauseBtn.innerText = "Read Full ▶";
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
    
    if (window.activeTranslationObserver) {
        window.activeTranslationObserver.disconnect();
        window.activeTranslationObserver = null;
    }
}

async function togglePlayPause() {
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
        if (playPauseBtn) playPauseBtn.innerText = "Pause ⏸";
        currentNarrationJobId++; // Start a clean narration session with no stale callbacks
        isReadingAloud = true;
        isPaused = false;
        window.forceResumeScroll = true; // ENSURE WE SCROLL TO STARTING POINT

        // ALWAYS START FROM BEGINNING when using "Read Full", unless already in a session.
        let r = document.getElementById("reader");
        // USE 'auto' for instant jump to avoid interference/throttling during start
        if (r) r.scrollTo({ top: 0, behavior: 'auto' });
        
        await resumeReadingFromIndex(0, false, true);
    } else {
        if (isPaused) {
            // RESUME
            isPaused = false;
            // By calling resumeReadingFromIndex, we ensure the queue is freshly generated 
            // from the current index, and any stale callbacks are invalidated.
            window.forceResumeScroll = true; // FORCE JUMP BACK TO PAUSE POINT
            await resumeReadingFromIndex(currentAbsoluteCharIndex, false, true);
            if (playPauseBtn) playPauseBtn.innerHTML = "⏸ <span>Pause</span>";
        } else {
            // PAUSE
            isPaused = true;
            window.speechSynthesis.pause();
            if (currentFallbackAudio) currentFallbackAudio.pause();

            // TRACK PROGRESS: currentAbsoluteCharIndex is updated live by syncHighlight/onboundary event listeners.
            // We cancel the speech to free resources and prepare for a clean restart.
            window.speechSynthesis.cancel();
            if (playPauseBtn) playPauseBtn.innerHTML = "▶ <span>Resume</span>";
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
            // 🛡️ DRAG-LOCK: Ignore click if we just finished a drag/pan operation
            if (window.isRecentlyPanned) {
                window.isRecentlyPanned = false; // Reset for next time
                return;
            }
            
            // REBUILD MAP: Always ensure we have a fresh map for plain documents
            const isPlain = (totalPages === 0 || !document.querySelector('[id^="pdf-page-"]'));
            if (!globalReadingText || globalTextNodes.length === 0 || isPlain) {
                rebuildReadingNodeMap();
            }

            if (!globalReadingText) return;

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

            let absoluteIndex = -1;
            const nodeIdx = globalTextNodes.indexOf(targetNode);
            if (nodeIdx !== -1) {
                absoluteIndex = globalNodeOffsets[nodeIdx] + offset;
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
    if (playPauseBtn) playPauseBtn.innerText = "Pause ⏸";



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
        let voice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase()) ||
            voices.find(v => v.lang.toLowerCase().startsWith(shortLang)) ||
            voices.find(v => v.name.toLowerCase().includes(langText));
        if (voice) {
            utterance.voice = voice;

        }
    }

    utterance.onend = function () {
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
        if (isReadingAloud && window.currentTargetLang !== 'orig') {
            window.speechSyncNext = true; 
        }
        
        currentBookText = document.getElementById("reader")?.innerHTML || "";
    }, 800);
}

async function translateNodeList(nodes, lang, job) {
    if (!nodes.length || (job && window.activeTranslationJob !== job)) return;
    const texts = nodes.map(n => n.nodeValue);
    try {
        const res = await fetch("/translate_text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // FORCED AUTO: We now use 'auto' regardless of server-side detection,
            // as Google's auto-detect is 100x more accurate for mixed-content books.
            body: JSON.stringify({ texts, target_lang: lang, source_lang: 'auto' })
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
    }
}

async function translateBook() {
    let targetLang = document.getElementById('langSelect').value;
    let reader = document.getElementById("reader");
    let titleEl = document.getElementById("bookTitle");
    let originalTitle = titleEl.innerText;

    if (!reader || !currentBookText) return;

    // Restore Original?
    if (targetLang === 'orig') {
        showTranslationLoader("Restoring original...");
        window.currentTargetLang = 'orig';
        if (window.activeTranslationObserver) window.activeTranslationObserver.disconnect();
        window.activeTranslationObserver = null;
        
        try {
            let res = await fetch("/book/" + currentBookId);
            let data = await res.json();
            if (data && data.text) {
                reader.innerHTML = data.text;
                currentBookText = data.text;
                // CLEAR TRANSLATION STATE: allow pages to be re-translated
                document.querySelectorAll('.lazy-page-container').forEach(p => {
                    delete p.dataset.translated;
                });
            }
            hideLoader();
            setTimeout(() => rebuildReadingNodeMap(), 50);
        } catch (e) {
            hideLoader();
        }
        return;
    }

    // SOURCE LOCK: Cache original English version for seamless language toggling
    // Note: If the book is still rendering, this might be incomplete, but 
    // translatePage works on DOM nodes directly, so it's safer than re-rendering.
    if (!window.originalBookContent) {
        window.originalBookContent = reader.innerHTML;
    } 

    window.speechSynthesis.cancel();
    isReadingAloud = false;

    showTranslationLoader("Initializing High-Speed engine...");
    window.activeTranslationJob = Date.now();
    window.currentTargetLang = targetLang;

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

    const pages = Array.from(document.querySelectorAll('.lazy-page-container'));
    pages.forEach(p => window.activeTranslationObserver.observe(p));

    const currentPageInput = document.getElementById('currentPageInput');
    const startPageIdx = Math.max(0, (parseInt(currentPageInput?.value || 1) - 1));
    
    showTranslationLoader(`Translating Current Page (${startPageIdx + 1})...`);
    
    // PHASE 1: Priority Spread (Current Page Only)
    // Reducing from 3 pages to 1 allows narration to start nearly instantly on language change.
    const priorityPages = pages.slice(startPageIdx, startPageIdx + 1);
    for (const p of priorityPages) {
        await translatePage(p, window.currentTargetLang, window.activeTranslationJob);
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

            if (sc) {
                allSentenceTexts.push(sc);
                let url = `/tts?lang=${shortLang}&text=${encodeURIComponent(sc)}&gender=${currentNarratorGender}`;
                
                const item = {
                    url,
                    text: sc,
                    offset: currentAbsOffset + start + leadingSpaces
                };

                fallbackQueue.push(item);

                // ULTRA-FAST STARTUP: Trigger the first audio request IMMEDIATELY 
                // while we continue building the rest of the queue in the background.
                if (!hasStarted && fallbackQueue.length === 1 && !startPaused) {
                    hasStarted = true;
                    item.audioObj = new Audio(item.url);
                    item.audioObj.preload = "auto";
                    item.audioObj.load();
                    // Don't even wait for the loop to finish - start playing the first chunk now
                    setTimeout(() => playNextFallback(false), 10);
                } else if (fallbackQueue.length <= 6) {
                    // Pre-fetch the next few sentences in parallel during queue construction
                    setTimeout(() => {
                        item.audioObj = new Audio(item.url);
                        item.audioObj.preload = "auto";
                        item.audioObj.load();
                    }, 50);
                }
            }
            start = end;
            if (fallbackQueue.length > 150) break; 
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
    if (isEmotionModeActive && allSentenceTexts.length > 0) {
        // Optimize: Batch the first 50 results together
        const emotionBatch = allSentenceTexts.slice(0, 50);
        fetch("/analyze_emotion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texts: emotionBatch })
        }).then(res => res.json()).then(emotions => {
            if (Array.isArray(emotions)) {
                emotions.forEach((em, i) => {
                    if (fallbackQueue[i]) emotionCache.set(fallbackQueue[i].text, em.emotion || 'neutral');
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

    let { nodes, offsets, text } = getNodesAndText(reader);
    if (nodes.length > 0) {
        globalTextNodes = nodes;
        globalNodeOffsets = offsets;
        globalReadingText = text;

        // POSITION RESCUE: Re-calculate currentAbsoluteCharIndex based on node anchor
        if (isReadingAloud && snapshotNode && snapshotNode.isConnected) {
            let nodeIdx = nodes.indexOf(snapshotNode);
            if (nodeIdx !== -1) {
                // We've successfully anchored to the exact node being read,
                // even though its content changed from English to another language.
                currentAbsoluteCharIndex = offsets[nodeIdx] + snapshotOffset;
            }
        }
    } else if (!globalReadingText) {
        // First initialization failed? Fallback to empty but don't clear a working one
        globalTextNodes = [];
        globalNodeOffsets = [];
        globalReadingText = "";
    }
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
                } catch (e) { }
            }

            if (nodeEnd > startChar && nodeStart < endChar) {
                foundAny = true;
                lastMarkedNodeIndex = i;
                
                // TRACK CURRENT NODE for translation-resync (Anchors narrator to semantic position)
                window.currentReadingNode = node;
                window.currentReadingOffsetInNode = Math.max(0, startChar - nodeStart);

                try {
                    let range = new Range();
                    
                    // SMART BOUNDARY CORRECTION:
                    // Browser TTS often reports offsets slightly off or truncates suffixes (e.g. 'Secret' instead of 'Secrets').
                    // We reach forward in the DOM text to find the logical end of the current word.
                    let localStart = Math.max(0, startChar - nodeStart);
                    let text = node.nodeValue || "";
                    let localEnd = Math.min(nodeLen, endChar - nodeStart);
                    
                    // Expand localEnd to next non-word character if it looks like we clipped a word (Unicode-aware)
                    const letterRegex = /[\p{L}\p{M}]/u;
                    if (localEnd < nodeLen && letterRegex.test(text[localEnd - 1]) && letterRegex.test(text[localEnd])) {
                        while (localEnd < nodeLen && letterRegex.test(text[localEnd])) {
                            localEnd++;
                        }
                    }

                    range.setStart(node, localStart);
                    range.setEnd(node, localEnd);

                    if (readingHighlight) readingHighlight.add(range);

                    // HIGH VISIBILITY GLOW: Apply to the parent container for extra clarity
                    if (node.parentNode) {
                        node.parentNode.classList.add('reading-active-container');
                        node.parentNode.style.setProperty('--current-reading-color', 'var(--reading-mark)');
                    }

                    // SMOOTH SCROLLING: Keep the active word centered in view
                    let timeSinceLastScroll = Date.now() - (window.lastAutoScrollTime || 0);
                    if (timeSinceLastScroll > 1500 || window.forceResumeScroll) {
                        let rect = range.getBoundingClientRect();
                        let reader = document.getElementById("reader");
                        if (!reader) return;
                        let readerRect = reader.getBoundingClientRect();

                        // Centered scrolling logic
                        const threshold = reader.clientHeight * 0.35;
                        
                        // DRIFT PROTECTION: If we are reading forward, only auto-scroll if the word 
                        // is actually FURTHER DOWN than where we already are. 
                        // This prevents 'previous page jumps' if a background task briefly renders something elsewhere.
                        const isPhysicallyBehind = rect.bottom < readerRect.top;
                        const isPhysicallyBeyond = rect.top > readerRect.bottom - threshold;
                        const isAboveMiddle = rect.top < readerRect.top + threshold;

                        if (isPhysicallyBeyond || (isAboveMiddle && !isPhysicallyBehind) || window.forceResumeScroll) {
                            const zoom = (typeof currentZoom !== 'undefined') ? currentZoom : 1;
                            
                            // IMPROVED SCROLL LOGIC: Target the top 15% of the reader for better reading flow (don't blindly center)
                            let targetY = reader.scrollTop + (rect.top - readerRect.top) / zoom - (reader.clientHeight / zoom * 0.15);
                            targetY = Math.max(0, targetY);
                            
                            // FORWARD-MOTION ENFORCEMENT: Generally prevent reverse-jumps to avoid 'Scroll Drift',
                            // but ALWAYS allow the jump if the user just clicked 'Resume' (forceResumeScroll).
                            if (targetY >= reader.scrollTop - 50 || window.forceResumeScroll) {
                                // USE 'auto' if forced to ensure instant jump without interference
                                reader.scrollTo({ top: targetY, behavior: window.forceResumeScroll ? 'auto' : 'smooth' });
                                window.lastAutoScrollTime = Date.now();
                                window.forceResumeScroll = false; // Reset after one successful sync
                            }
                        }
                    }
                } catch (e) { }
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
    let nativeVoice = getBestVoice(voices, targetLang);

    // CRITICAL FIX: Only use native window.speechSynthesis for English.
    // For all other languages, we MUST use the server-side Neural TTS engine (Edge/gTTS) 
    // as it is 100x more reliable and high-quality across all devices.
    if (nativeVoice && shortLang === 'en') {
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

        // Apply emotion parameters if we got them from cache
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

        // Apply dynamic rate to Edge-TTS fallback audio
        if (currentFallbackAudio && !window.speechSynthesis.speaking) {
            if (emotion === 'happy') currentFallbackAudio.playbackRate = 1.05 * currentSpeed;
            else if (emotion === 'excited') currentFallbackAudio.playbackRate = 1.15 * currentSpeed;
            else if (emotion === 'sad') currentFallbackAudio.playbackRate = 0.85 * currentSpeed;
            else if (emotion === 'angry') currentFallbackAudio.playbackRate = 1.1 * currentSpeed;
            else if (emotion === 'fear') currentFallbackAudio.playbackRate = 0.9 * currentSpeed;
            else if (emotion === 'peaceful') currentFallbackAudio.playbackRate = 0.8 * currentSpeed;
            else currentFallbackAudio.playbackRate = 1.0 * currentSpeed;
        }

        let utteranceStartTime = Date.now();
        const progEl = document.getElementById("readingProgress");

        let boundaryReceived = false;
        utterance.onboundary = (event) => {
            if (jobId !== currentNarrationJobId) return;
            boundaryReceived = true; 
            currentAbsoluteCharIndex = item.offset + event.charIndex;
            highlightReadingWord(item.offset + event.charIndex, event.charLength || 5);
            if (progEl) {
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
                words.push({ startOffset: item.offset + match.index, length: match[0].length });
            }
            if (words.length === 0 && item.text.length > 0) {
                words.push({ startOffset: item.offset, length: item.text.length });
            }
            const totalChars = item.text.length;
            const speedEstimate = (15 * (utterance.rate || 1.0)) / 1000; 
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

        // Rate adjustment (async emotion might change this later via applyEmotionToUI)
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
            // More conservative duration estimation for non-English (usually slower)
            const charsPerSec = (langSelect.value === 'en' || !langSelect.value) ? 14 : 9;
            if (isNaN(duration) || duration === Infinity || duration <= 0) duration = totalChunkLength / charsPerSec; 
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
                    highlightReadingWord(foundWord.startOffset, foundWord.length, item.offset, item.text.length);
                    
                    const progEl = document.getElementById("readingProgress");
                    if (progEl && globalReadingText && globalReadingText.length > 0) {
                        const prog = Math.round((currentAbsoluteCharIndex / globalReadingText.length) * 100);
                        progEl.innerText = `| ${prog}% Read`;
                    }
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
            // SYNC LOCK: Force progress to the end of this sentence to prevent re-reading on sync/drift
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

        // PRE-FETCH ENGINE: Fetch next 4 sentences in the background
        const PREFETCH_LOOKAHEAD = 4;
        for (let i = 0; i < Math.min(PREFETCH_LOOKAHEAD, fallbackQueue.length); i++) {
            const nextItem = fallbackQueue[i];
            if (!nextItem.audioObj) {
                nextItem.audioObj = new Audio(nextItem.url);
                nextItem.audioObj.preload = "auto";
                nextItem.audioObj.load();
            }
        }

        audio.play().catch(e => {
            // AbortError is common if play() was interrupted by a pause() or state-sync; 
            // we should not skip the sentence in this case, just retry that exact sentence.
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
    if (playPauseBtn) playPauseBtn.innerText = "Read Full ▶";

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
            // Auto-dismiss after 4 seconds
            setTimeout(() => {
                if (thankYou.style.display === "block") {
                    thankYou.style.display = "none";
                }
            }, 4000);
        }
        reader.classList.remove('folding-exit');
    }

    document.getElementById("bookTitle").innerText = "Select a book from your library";
    
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

    // Use established extraction logic to ensure exact offset mapping (accounting for virtual spaces)
    let { nodes, offsets } = getNodesAndText(reader);
    
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
        // Auto-Open Deep Link Logic: Handle books shared via ?open=ID
        const urlParams = new URLSearchParams(window.location.search);
        const openId = urlParams.get('open');
        if (openId && activeBooksList) {
            const bookToOpen = activeBooksList.find(b => b[0] == openId);
            if (bookToOpen) {
                 openBook(bookToOpen[0], bookToOpen[1]);
                 // Strip param after opening to avoid repeat opens on refresh
                 window.history.replaceState({}, document.title, window.location.pathname);
            }
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
        let match = command.match(/page\s*(\d+)/) || command.match(/to\s*(\d+)/);
        if (match && match[1]) {
            let pageNum = parseInt(match[1]);
            const pageId = (pageNum > 100) ? `pdf-page-${pageNum}` : `pdf-page-${pageNum - 1}`;
            let pageEl = document.getElementById(pageId) || document.getElementById(`pdf-page-${pageNum}`);
            if (pageEl) {
                pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                const navMsg = `Scrolling to page ${pageNum}.`;
                feedback.innerText = navMsg;
                speakAIResponse(navMsg);
                return;
            } else {
                speakAIResponse(`I couldn't find page ${pageNum} in this document.`);
                return;
            }
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
        const res = await fetch("/explain_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                src: img.getAttribute('src'),
                ocr_text: ocrText,
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
                if (globalNodeOffsets[i] <= charIndex && (i === globalNodeOffsets.length - 1 || globalNodeOffsets[i+1] > charIndex)) {
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
            // Silent Success - No Toast as requested, just visual feedback
            const toolbar = document.getElementById('selectionToolbar');
            if (toolbar) toolbar.style.display = 'none';
            if (selection) selection.removeAllRanges();
            
            // Pulse the bookmark icon if visible in any UI
            console.log("Bookmark updated successfully.");
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
            if (globalNodeOffsets[i] <= charIndex && (i === globalNodeOffsets.length - 1 || globalNodeOffsets[i+1] > charIndex)) {
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
    let textChunkRaw = globalReadingText.substring(index, index + 10000);
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
        while(start < chunk.length) {
            let end = Math.min(start + 190, chunk.length);
            if (end < chunk.length) {
                let lastSpace = chunk.lastIndexOf(' ', end);
                if (lastSpace > start) end = lastSpace;
            }
            let sc = chunk.substring(start, end).trim();
            if (sc) {
                const lazyEmotion = () => {
                    if (!isEmotionModeActive) return Promise.resolve('neutral');
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
                
                if (isInteractive && !isSearchInput && !isMenuBtn) {
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
        reader.onload = function(e) {
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

function createReadingRoom() {
    if (!currentBookId) {
        showUploadToast("Open a book first to create a room!", "error");
        return;
    }
    if (!currentRoom && socket) {
        currentRoom = `room_${currentBookId}_${Math.random().toString(36).substring(7)}`;
        socket.emit('join_room', { room: currentRoom });
    }
    const inviteLink = `${window.location.origin}/?id=${currentBookId}&room=${currentRoom}`;
    document.getElementById('roomLink').innerText = inviteLink;
    document.getElementById('roomModal').style.display = 'flex';
    
    // Check for Native Share API support (Mobile/Modern Browsers)
    if (navigator.share) {
        document.getElementById('webShareBtn').style.display = 'block';
    }
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
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({receiver_identity: identity, book_id: currentBookId})
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) showUploadToast(data.error, "error");
        else {
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
        `; }).join('');
    });
}

function triggerDashboardUpload() {
    const input = document.getElementById('dashboardFileInput');
    if (input) input.click();
}

async function uploadDashboardBook() {
    const input = document.getElementById('dashboardFileInput');
    if (!input || !input.files || input.files.length === 0) return;

    // Use a temporary swap to reuse the existing upload() function's logic
    const originalFileInput = document.getElementById('file');
    if (originalFileInput) {
        // We can't easily swap files due to security, so we'll just implement a direct call
        const file = input.files[0];
        const formData = new FormData();
        formData.append("file", file);

        showUploadToast(`🚀 Uploading ${file.name}...`, "info");
        
        try {
            const res = await fetch("/upload", {
                method: "POST",
                body: formData
            });
            const data = await res.json();
            if (data.error) {
                showUploadToast(data.error, "error");
            } else {
                showUploadToast("✅ Book added to library!", "success");
                loadBooks(); // Refresh the list
                input.value = ""; // Reset
            }
        } catch (err) {
            showUploadToast("Connection failed", "error");
        }
    } else {
        // Fallback or handle if the main file input is missing (unlikely)
        upload(); 
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
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({invite_id: inviteId, action: action})
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
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({collab_id: collabId})
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
            <div class="glass-panel" style="padding: 20px; border-radius: 20px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: space-between;">
                <div style="text-align: left;">
                    <p style="margin: 0; color: var(--text-white); font-weight: 700; font-size: 1rem;">${c.book_name}</p>
                    <p style="margin: 4px 0 0 0; color: var(--text-light); font-size: 0.85rem;">
                        Reading with <strong style="color: var(--primary);">@${c.partner}</strong> 
                        <span style="margin-left: 10px; font-size: 0.75rem; background: rgba(99,102,241,0.1); padding: 2px 8px; border-radius: 6px; color: var(--primary); font-weight: 800; border: 1px solid rgba(99,102,241,0.2);">
                            ${c.role === 'Owner' ? 'You Shared' : 'Shared with You'}
                        </span>
                    </p>
                </div>
                <button onclick="disconnectCollaboration(${c.id})" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; cursor: pointer; padding: 8px 15px; border-radius: 10px; font-size: 0.85rem; font-weight: 600; transition: all 0.2s;">
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
