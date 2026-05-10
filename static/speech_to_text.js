let s2tRecognition = null;
let isS2TRecording = false;
let s2tIntentionalStop = false;

function initS2TRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        showUploadToast("Speech recognition is not supported in this browser.", "error");
        return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    s2tRecognition = new SpeechRec();
    s2tRecognition.continuous = true;
    s2tRecognition.interimResults = true;
    s2tRecognition.lang = 'en-US';

    let previousTranscript = "";

    s2tRecognition.onstart = () => {
        isS2TRecording = true;
        document.getElementById("s2tMicIcon").innerText = "⏹️";
        document.getElementById("s2tBtnText").innerText = "Stop Recording";
        document.getElementById("s2tStatusBadge").style.display = "block";
        const area = document.getElementById("s2tTranscriptArea");
        previousTranscript = area ? area.value + (area.value ? " " : "") : "";
    };

    s2tRecognition.onresult = (event) => {
        let currentSessionTranscript = "";
        for (let i = 0; i < event.results.length; ++i) {
            currentSessionTranscript += event.results[i][0].transcript;
        }

        const area = document.getElementById("s2tTranscriptArea");
        if (area) {
            area.value = previousTranscript + currentSessionTranscript;
        }
    };


    s2tRecognition.onerror = (event) => {
        console.error("Speech Recognition Error", event.error);
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
            try {
                if (isS2TRecording && !s2tIntentionalStop) {
                    s2tRecognition.start();
                }
            } catch(e) {}
        }
    };

    s2tRecognition.onend = () => {
        if (isS2TRecording && !s2tIntentionalStop) {
            try {
                s2tRecognition.start();
                return;
            } catch(e) {}
        }
        isS2TRecording = false;
        document.getElementById("s2tMicIcon").innerText = "🎙️";
        document.getElementById("s2tBtnText").innerText = "Start Recording";
        document.getElementById("s2tStatusBadge").style.display = "none";
    };
}

function openSpeechToText() {
    const modal = document.getElementById("speechToTextModal");
    if (modal) {
        modal.style.display = "flex";
    }
    if (!s2tRecognition) {
        initS2TRecognition();
    }
}

function closeSpeechToText() {
    const modal = document.getElementById("speechToTextModal");
    if (modal) {
        modal.style.display = "none";
    }
    stopS2TRecording();
}

function toggleS2TRecording() {
    if (!s2tRecognition) {
        initS2TRecognition();
    }
    if (!s2tRecognition) return;

    if (isS2TRecording) {
        stopS2TRecording();
    } else {
        try {
            s2tIntentionalStop = false;
            s2tRecognition.start();
        } catch (e) {
            console.error(e);
        }
    }
}

function stopS2TRecording() {
    s2tIntentionalStop = true;
    if (s2tRecognition && isS2TRecording) {
        try {
            s2tRecognition.stop();
        } catch(e) {}
    }
}

function clearS2TText() {
    const area = document.getElementById("s2tTranscriptArea");
    if (area) area.value = "";
}

function copyS2TText() {
    const area = document.getElementById("s2tTranscriptArea");
    if (area && area.value.trim()) {
        area.select();
        document.execCommand("copy");
        showUploadToast("Text copied to clipboard", "success");
    } else {
        showUploadToast("No text to copy", "error");
    }
}

function saveS2TToLibrary() {
    const area = document.getElementById("s2tTranscriptArea");
    if (!area || !area.value.trim()) {
        showUploadToast("Please speak or write some text before saving.", "error");
        return;
    }

    fetch("/save_text_as_book", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: area.value.trim() })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            showUploadToast(data.message, "success");
            closeSpeechToText();
            // Refresh books list
            if (typeof fetchBooks === "function") {
                fetchBooks();
            } else if (typeof loadBooks === "function") {
                loadBooks();
            } else {
                window.location.reload();
            }
        } else {
            showUploadToast(data.error || "Failed to save text", "error");
        }
    })
    .catch(err => {
        console.error(err);
        showUploadToast("An error occurred while saving the text.", "error");
    });
}

function saveVoiceNoteStandalone() {
    const area = document.getElementById("s2tTranscriptArea");
    if (!area || !area.value.trim()) {
        showUploadToast("Please speak or write some text before saving.", "error");
        return;
    }

    const modal = document.getElementById("voiceNoteTitlePromptModal");
    if (modal) {
        modal.style.display = "flex";
        document.getElementById("voiceNotePromptTitleInput").focus();
    }
}

function cancelVoiceNoteTitlePrompt() {
    const modal = document.getElementById("voiceNoteTitlePromptModal");
    if (modal) {
        modal.style.display = "none";
    }
}

function confirmVoiceNoteTitlePrompt() {
    const area = document.getElementById("s2tTranscriptArea");
    const titleInput = document.getElementById("voiceNotePromptTitleInput");
    if (!area || !titleInput) return;

    const content = area.value.trim();
    const title = titleInput.value.trim() || "Untitled Note";

    if (window._editingVoiceNoteId) {
        if (!confirm("Are you sure you want to update this note?")) {
            return;
        }
        fetch(`/update_voice_note/${window._editingVoiceNoteId}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ content: content, title: title })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                showUploadToast(data.message, "success");
                area.value = "";
                titleInput.value = "My Voice Note";
                window._editingVoiceNoteId = null;
                cancelVoiceNoteTitlePrompt();
                closeSpeechToText();
                if (typeof fetchVoiceNotes === "function") {
                    fetchVoiceNotes();
                }
            } else {
                showUploadToast(data.message || "Failed to update voice note", "error");
            }
        })
        .catch(err => {
            console.error(err);
            showUploadToast("An error occurred while updating the note.", "error");
        });
        return;
    }

    fetch("/voice_notes", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: content, title: title })
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success") {
            showUploadToast(data.message, "success");
            area.value = "";
            titleInput.value = "My Voice Note";
            cancelVoiceNoteTitlePrompt();
            closeSpeechToText();
            if (typeof fetchVoiceNotes === "function") {
                fetchVoiceNotes();
            }
        } else {
            showUploadToast(data.message || "Failed to save voice note", "error");
        }
    })
    .catch(err => {
        console.error(err);
        showUploadToast("An error occurred while saving the note.", "error");
    });
}



function translateS2TText() {
    const area = document.getElementById("s2tTranscriptArea");
    const langSelect = document.getElementById("s2tTargetLang");
    if (!area || !langSelect) return;

    const text = area.value.trim();
    const targetLang = langSelect.value;

    if (!text) {
        showUploadToast("Please enter or speak text before translating.", "error");
        return;
    }

    if (targetLang === "orig" || !targetLang) {
        showUploadToast("Please select a target language.", "error");
        return;
    }

    const translateBtn = document.getElementById("s2tTranslateBtn");
    const originalText = translateBtn.innerHTML;
    translateBtn.innerHTML = `<span>⏳ Translating...</span>`;
    translateBtn.disabled = true;

    fetch("/translate_text", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            texts: [text],
            target_lang: targetLang,
            source_lang: "auto"
        })
    })
    .then(res => res.json())
    .then(data => {
        if (Array.isArray(data) && data[0]) {
            area.value = data[0].trim();
            showUploadToast("Translation successful!", "success");
        } else {
            showUploadToast("Failed to translate the text.", "error");
        }
    })
    .catch(err => {
        console.error(err);
        showUploadToast("An error occurred during translation.", "error");
    })
    .finally(() => {
        translateBtn.innerHTML = originalText;
        translateBtn.disabled = false;
    });
}

