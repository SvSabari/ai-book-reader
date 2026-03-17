from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
import os
import sqlite3
import fitz
import docx
from ebooklib import epub, ITEM_DOCUMENT, ITEM_IMAGE
from bs4 import BeautifulSoup
import cv2
import pytesseract
import mammoth
import base64
import numpy as np
import concurrent.futures
from gtts import gTTS
import io

app = Flask(__name__)

UPLOAD_FOLDER = "uploads"
EXTRACTED_FOLDER = "extracted"
DB = "database.db"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(EXTRACTED_FOLDER, exist_ok=True)

# Global cache to store pre-tokenized sentences for the currently active book
# Structure: { book_id: (timestamp, [sentences]) }
SENTENCE_CACHE = {}

def get_book_sentences(book_id):
    """Retrieve or generate tokenized sentences for a book to avoid repeated parsing."""
    import time
    if book_id in SENTENCE_CACHE:
        return SENTENCE_CACHE[book_id][1]
    
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT extracted_path FROM books WHERE id = ?", (book_id,))
    row = cur.fetchone()
    conn.close()
    
    if not row or not os.path.exists(row[0]):
        return []
        
    try:
        with open(row[0], "r", encoding="utf-8", errors="ignore") as f:
            html_content = f.read()
            
        from bs4 import BeautifulSoup
        import re
        soup = BeautifulSoup(html_content, "html.parser")
        text = soup.get_text(separator=" ")
        
        # Tokenize into sentences
        sentences = re.split(r'(?<=[.!?])\s+', text)
        sentences = [re.sub(r'\s+', ' ', s).strip() for s in sentences if len(s.strip()) > 5]
        
        # Keep only the last 3 books in cache to manage memory
        if len(SENTENCE_CACHE) > 3:
            oldest = min(SENTENCE_CACHE.keys(), key=lambda k: SENTENCE_CACHE[k][0])
            del SENTENCE_CACHE[oldest]
            
        SENTENCE_CACHE[book_id] = (time.time(), sentences)
        return sentences
    except Exception:
        return []

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def get_conn():
    return sqlite3.connect(DB)


def init_db():
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS books(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        path TEXT,
        extracted_path TEXT,
        status TEXT DEFAULT 'ready',
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Migrate existing databases that don't have the status column
    try:
        cur.execute("ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'ready'")
    except Exception:
        pass  # Column already exists

    cur.execute("""
    CREATE TABLE IF NOT EXISTS highlights(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER,
        highlighted_text TEXT
    )
    """)

    conn.commit()
    conn.close()


init_db()


def extract_image_text(file_path):
    image = cv2.imread(file_path)
    if image is None:
        return ""

    # Upscale significantly to catch small labels in infographics
    h, w = image.shape[:2]
    image = cv2.resize(image, (w*2, h*2), interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    passes = []
    
    # Pass 1: Standard PSM 3 (Auto segmentation)
    passes.append(pytesseract.image_to_string(gray, config='--oem 3 --psm 3'))
    
    # Pass 2: Adaptive Thresholding (Handles shadows/gradients)
    adaptive = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    passes.append(pytesseract.image_to_string(adaptive, config='--oem 3 --psm 6'))
    
    # Pass 3: Inverted Adaptive (Light text on dark backgrounds)
    inverted = cv2.bitwise_not(adaptive)
    passes.append(pytesseract.image_to_string(inverted, config='--oem 3 --psm 6'))
    
    # Pass 4: PSM 11 (Sparse text, good for labels)
    passes.append(pytesseract.image_to_string(gray, config='--oem 3 --psm 11'))
    
    all_text = "\n".join(passes)
    lines = [L.strip() for L in all_text.split('\n') if len(L.strip()) > 2]
    
    unique_lines = []
    seen = set()
    for L in lines:
        clean_L = "".join(filter(str.isalnum, L.lower()))
        if clean_L and clean_L not in seen:
            unique_lines.append(L)
            seen.add(clean_L)
            
    return " ".join(unique_lines)


def build_ocr_overlay_html(img_tag_str, img_cv):
    """Given an OpenCV image, run OCR and return an HTML snippet with
    the <img> inside a relative wrapper plus transparent, selectable word spans."""
    h, w = img_cv.shape[:2]
    if h < 20 or w < 20:
        return None

    # Up-scale for better OCR accuracy
    scale = 2.0
    img_scaled = cv2.resize(img_cv, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LANCZOS4)
    gray = cv2.cvtColor(img_scaled, cv2.COLOR_BGR2GRAY)

    # Use image_to_data for bounding boxes (Output.DICT does not require pandas)
    try:
        data = pytesseract.image_to_data(gray, config='--oem 3 --psm 3', output_type=pytesseract.Output.DICT)
    except Exception:
        return None

    spans_html = []
    for i in range(len(data['text'])):
        word = str(data['text'][i]).strip()
        conf = int(data['conf'][i])
        if not word or conf < 30:
            continue

        # Scale bounding box back to original image dimensions
        bx = data['left'][i] / scale
        by = data['top'][i] / scale
        bw = data['width'][i] / scale
        bh = data['height'][i] / scale

        # Express as percentages of original image size
        left_pct   = round(bx / w * 100, 4)
        top_pct    = round(by / h * 100, 4)
        width_pct  = round(bw / w * 100, 4)
        height_pct = round(bh / h * 100, 4)

        # Font size roughly matches the rendered word bbox height
        font_size_pct = round(bh / h * 100, 4)

        spans_html.append(
            f'<span class="ocr-word" style="'
            f'left:{left_pct}%;top:{top_pct}%;'
            f'width:{width_pct}%;height:{height_pct}%;'
            f'font-size:{font_size_pct}cqh;'
            f'" title="{word}">{word}</span>'
        )

    if not spans_html:
        return None

    ocr_layer = '<div class="ocr-layer">' + ''.join(spans_html) + '</div>'
    wrapper = f'<div class="img-ocr-wrapper">{img_tag_str}{ocr_layer}</div>'
    return wrapper


def ocr_embedded_images(html):
    """
    Fast pass: extract raw text from embedded images for TTS/search purposes only.
    Uses regex and multithreading for high performance without BeautifulSoup overhead.
    """
    import re
    img_pattern = re.compile(r'(<img[^>]*src=[\'"](data:image/[^\'"]+)[\'"][^>]*>)', re.IGNORECASE)
    matches = list(img_pattern.finditer(html))
    
    if not matches:
        return html
        
    def process_match_data(match_tuple):
        start, end, img_tag, src_data = match_tuple
        try:
            _, encoded = src_data.split(",", 1)
            data = base64.b64decode(encoded)
            nparr = np.frombuffer(data, np.uint8)
            img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img_cv is not None:
                h, w = img_cv.shape[:2]
                if h >= 20 and w >= 20:
                    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
                    text = pytesseract.image_to_string(gray, config='--oem 3 --psm 3')
                    text = " ".join(t.strip() for t in text.split("\n") if len(t.strip()) > 2)
                    if text:
                        return start, end, f'{img_tag}<span class="ocr-text-hidden" aria-hidden="true">{text}</span>'
        except Exception:
            pass
        return start, end, img_tag

    tasks = [(m.start(), m.end(), m.group(1), m.group(2)) for m in matches]
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(process_match_data, tasks))
        
    parts = []
    last_end = 0
    # Process results in sequential order of occurrence in the HTML
    results.sort(key=lambda x: x[0])
    for start, end, replacement in results:
        parts.append(html[last_end:start])
        parts.append(replacement)
        last_end = end
    parts.append(html[last_end:])
    
    return "".join(parts)


def extract_pdf_html(file_path):
    html_parts = ["<div class='book-content-container'>"]
    pdf = fitz.open(file_path)
    # We no longer scrub styles here because PyMuPDF's HTML output 
    # relies on absolute positioning for layout fidelity. 
    # We handle scaling and centering globally in script.js.
    for page_num in range(len(pdf)):
        page = pdf[page_num]
        raw_html = page.get_text("html")
        # Ensure each page has a consistent wrapper ID for lazy rendering on frontend
        wrapped_html = f'<div id="pdf-page-{page_num}" class="lazy-page-container">{raw_html}</div>'
        html_parts.append(wrapped_html)
        
    pdf.close()
    html_parts.append("</div>")
    return "".join(html_parts)


def extract_docx_html(file_path):
    with open(file_path, "rb") as docx_file:
        result = mammoth.convert_to_html(docx_file)
        html = result.value
    return f"<div class='book-content-container'>{html}</div>"


def extract_epub_html(file_path):
    book = epub.read_epub(file_path)
    
    images = {}
    for item in book.get_items():
        if item.get_type() == ITEM_IMAGE:
            images[item.get_name().split('/')[-1]] = item.get_content()

    html_content = "<div class='book-content-container'>"
    for item in book.get_items():
        if item.get_type() == ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            
            for img in soup.find_all("img"):
                src = img.get("src")
                if src:
                    filename = src.split('/')[-1]
                    if filename in images:
                        b64 = base64.b64encode(images[filename]).decode('utf-8')
                        ext = filename.split('.')[-1].lower() if '.' in filename else 'jpeg'
                        ext = 'jpeg' if ext == 'jpg' else ext
                        img['src'] = f"data:image/{ext};base64,{b64}"

            body = soup.find('body')
            if body:
                html_content += "".join(str(c) for c in body.contents)
            else:
                text = soup.get_text()
                if text.strip():
                    html_content += f"<p>{text}</p>"
    html_content += "</div>"
    return html_content


def extract_pptx_html(file_path):
    import pptx
    prs = pptx.Presentation(file_path)
    html = "<div class='pptx-content-wrapper'>"
    for i, slide in enumerate(prs.slides):
        html += f"<div class='pptx-slide' style='border: 1px solid rgba(0,0,0,0.1); margin-bottom: 20px; padding: 40px; aspect-ratio: 16/9; position: relative;'><h3 style='color: #888; font-size: 14px;'>Slide {i+1}</h3>"
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                text = shape.text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')
                html += f"<p>{text}</p>"
        html += "</div>"
    html += "</div>"
    return html


def extract_txt_html(file_path):
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read().replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')
        return f"<div class='txt-content-wrapper' style='padding: 40px; font-family: monospace; line-height: 1.5;'>{text}</div>"


def extract_book_html(file_path):
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        html = extract_pdf_html(file_path)
        return ocr_embedded_images(html)
    elif ext == ".docx":
        html = extract_docx_html(file_path)
        return ocr_embedded_images(html)
    elif ext == ".epub":
        html = extract_epub_html(file_path)
        return ocr_embedded_images(html)
    elif ext in [".txt", ".prn"]:
        return extract_txt_html(file_path)
    elif ext == ".pptx":
        return extract_pptx_html(file_path)
    elif ext in [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif", ".tiff"]:
        text = extract_image_text(file_path).replace('\n', '<br>')
        filename = os.path.basename(file_path)
        return f"<div style='background: white; padding: 40px; font-family: monospace; line-height: 1.5; color: black; max-width: 800px; margin: 0 auto;'><img src='/uploads/{filename}' style='max-width: 100%;' /><br><span style='font-size: 1px; color: rgba(0,0,0,0.01); display: inline-block; width: 1px; height: 1px; overflow: hidden;'>{text}</span></div>"
    else:
        return "<div style='background: white; padding: 40px; color: red;'>Unsupported file format</div>"


@app.route("/ocr_image", methods=["POST"])
def ocr_image_endpoint():
    """
    Accept a base64-encoded image, run OCR, and return word bounding boxes
    as JSON so the browser can render transparent selectable text spans over it.
    """
    data = request.get_json()
    if not data:
        return jsonify({"words": []})

    b64 = data.get("image", "")
    if not b64:
        return jsonify({"words": []})

    try:
        # Strip data URI header if present
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        nparr = np.frombuffer(raw, np.uint8)
        img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_cv is None:
            return jsonify({"words": []})

        h, w = img_cv.shape[:2]
        if h < 20 or w < 20:
            return jsonify({"words": []})

        # Upscale for accuracy
        scale = 2.0
        img_scaled = cv2.resize(img_cv, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LANCZOS4)
        gray = cv2.cvtColor(img_scaled, cv2.COLOR_BGR2GRAY)

        ocr_data = pytesseract.image_to_data(gray, config='--oem 3 --psm 3', output_type=pytesseract.Output.DICT)

        words = []
        for i in range(len(ocr_data['text'])):
            word = str(ocr_data['text'][i]).strip()
            conf = int(ocr_data['conf'][i])
            if not word or conf < 30:
                continue
            # Scale back to original coordinates
            words.append({
                "text": word,
                "left":   round(ocr_data['left'][i]   / scale / w * 100, 4),
                "top":    round(ocr_data['top'][i]    / scale / h * 100, 4),
                "width":  round(ocr_data['width'][i]  / scale / w * 100, 4),
                "height": round(ocr_data['height'][i] / scale / h * 100, 4),
            })

        return jsonify({"words": words})
    except Exception as e:
        return jsonify({"words": [], "error": str(e)})


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route("/upload", methods=["POST"])
def upload():
    if "file" not in request.files:
        return "No file selected", 400

    file = request.files["file"]

    if file.filename == "":
        return "No file selected", 400

    # --- Duplicate Detection ---
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM books WHERE name = ?", (file.filename,))
    existing = cur.fetchone()
    conn.close()

    if existing:
        return jsonify({
            "status": "duplicate",
            "message": f"'{file.filename}' is already in your library!"
        }), 409

    # Save the file right away
    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)

    extracted_path = os.path.join(EXTRACTED_FOLDER, file.filename + ".html")

    # Insert DB record immediately with status = 'processing'
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO books(name, path, extracted_path, status) VALUES (?, ?, ?, ?)",
        (file.filename, filepath, extracted_path, "processing")
    )
    book_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Run heavy extraction in a background thread — don't block the HTTP response
    def do_extract(fpath, epath, bid):
        try:
            html = extract_book_html(fpath)
            with open(epath, "w", encoding="utf-8") as f:
                f.write(html)
            conn2 = get_conn()
            conn2.execute("UPDATE books SET status='ready' WHERE id=?", (bid,))
            conn2.commit()
            conn2.close()
        except Exception as e:
            conn2 = get_conn()
            conn2.execute("UPDATE books SET status='error' WHERE id=?", (bid,))
            conn2.commit()
            conn2.close()

    import threading
    t = threading.Thread(target=do_extract, args=(filepath, extracted_path, book_id), daemon=True)
    t.start()

    return jsonify({"status": "processing", "message": "Book received! Processing in background..."})


@app.route("/books")
def books():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name, uploaded_at, status FROM books ORDER BY id DESC")
    data = cur.fetchall()
    conn.close()
    return jsonify(data)


@app.route("/tts")
def tts():
    text = request.args.get("text", "")
    lang = request.args.get("lang", "en")
    if not text:
        return "No text", 400
    
    try:
        tts_obj = gTTS(text=text, lang=lang)
        fp = io.BytesIO()
        tts_obj.write_to_fp(fp)
        fp.seek(0)
        return send_file(fp, mimetype="audio/mpeg")
    except Exception as e:
        print(f"TTS Error: {e}")
        return str(e), 500


@app.route("/book/<int:book_id>")
def open_book(book_id):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT name, path, extracted_path FROM books WHERE id = ?", (book_id,))
    book = cur.fetchone()
    conn.close()

    if not book:
        return jsonify({"error": "Book not found"})

    name, file_path, extracted_path = book
    file_name = os.path.basename(file_path) if file_path else ""

    if not os.path.exists(extracted_path):
        return jsonify({"error": "Extracted text file not found"})

    with open(extracted_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    return jsonify({
        "name": name,
        "text": text,
        "file_name": file_name
    })


@app.route("/save_highlight", methods=["POST"])
def save_highlight():
    data = request.get_json()

    book_id = data.get("book_id")
    highlighted_text = data.get("highlighted_text")

    if not book_id or not highlighted_text:
        return jsonify({"error": "Missing data"})

    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "INSERT INTO highlights(book_id, highlighted_text) VALUES (?, ?)",
        (book_id, highlighted_text)
    )

    conn.commit()
    conn.close()

    return jsonify({"message": "Highlight saved successfully"})


@app.route("/highlights/<int:book_id>")
def get_highlights(book_id):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT highlighted_text FROM highlights WHERE book_id = ?",
        (book_id,)
    )
    rows = cur.fetchall()

    conn.close()

    highlights = [row[0] for row in rows]
    return jsonify(highlights)


@app.route("/delete_book/<int:book_id>", methods=["POST"])
def delete_book(book_id):
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT path, extracted_path FROM books WHERE id = ?", (book_id,))
    book = cur.fetchone()

    if not book:
        conn.close()
        return jsonify({"error": "Book not found"})

    file_path, extracted_path = book

    cur.execute("DELETE FROM highlights WHERE book_id = ?", (book_id,))
    cur.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()
    conn.close()

    if file_path and os.path.exists(file_path):
        os.remove(file_path)

    if extracted_path and os.path.exists(extracted_path):
        os.remove(extracted_path)

    return jsonify({"message": "Book deleted successfully"})


@app.route("/download/<int:book_id>")
def download_book(book_id):
    from urllib.parse import quote
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT path, name FROM books WHERE id = ?", (book_id,))
    book = cur.fetchone()
    conn.close()

    if not book:
        return "Book not found", 404

    file_path, name = book
    if not file_path or not os.path.exists(file_path):
        return "File not found", 404

    response = send_from_directory(
        os.path.dirname(file_path),
        os.path.basename(file_path),
        as_attachment=True
    )
    # Ensure browsers don't fallback to UUIDs by explicitly encoding the filename
    encoded_name = quote(name)
    response.headers["Content-Disposition"] = f"attachment; filename=\"{name}\"; filename*=UTF-8''{encoded_name}"
    return response


@app.route("/original/<int:book_id>")
def original_book(book_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT path FROM books WHERE id = ?", (book_id,))
    book = cur.fetchone()
    conn.close()

    if not book:
        return "Book not found", 404

    file_path = book[0]
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path))
    else:
        html = extract_book_html(file_path)
        return f"<html><head><style>body {{ margin: 0; background: #f0f0f0; }}</style></head><body>{html}</body></html>"


@app.route("/translate_text", methods=["POST"])
def translate_text():
    from deep_translator import GoogleTranslator
    import traceback
    import re
    try:
        data = request.get_json()
        texts = data.get("texts", [])
        target_lang = data.get("target_lang", "en")
        
        if not texts:
            return jsonify([])
            
        translator = GoogleTranslator(source='auto', target=target_lang)
        
        # We join strings to drastically reduce Google Translate API hits and avoid IP limits
        delimiter = " ||| "
        translated_texts = []
        
        chunks = []
        current_chunk = []
        current_len = 0
        
        for text in texts:
            text_len = len(text)
            
            # Massive single block handler
            if text_len > 4000:
                if current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = []
                    current_len = 0
                chunks.append([text[:4500]]) # Safe cutoff
                continue
                
            if current_len + text_len > 4000:
                chunks.append(current_chunk)
                current_chunk = []
                current_len = 0
                
            current_chunk.append(text)
            current_len += text_len + len(delimiter)
            
        if current_chunk:
            chunks.append(current_chunk)
            
        if not hasattr(app, "translation_cache"):
            app.translation_cache = {}

        def translate_recursive(chunk):
            if not chunk: return []
            if len(chunk) == 1:
                t = chunk[0].strip()
                if not t: return chunk
                cache_key = f"{target_lang}_{t}"
                if cache_key in app.translation_cache:
                    return [app.translation_cache[cache_key]]
                try:
                    res = translator.translate(t)
                    app.translation_cache[cache_key] = res
                    return [res]
                except Exception:
                    return chunk

            try:
                batch_str = " ||| ".join(chunk)
                res = translator.translate(batch_str)
                parts = [s.strip() for s in re.split(r'\s*\|\s*\|\s*\|\s*', res)]
                
                if len(parts) == len(chunk):
                    return parts
                else:
                    # Fallback binary split for ultra fast recovery instead of sequential O(N)
                    mid = len(chunk) // 2
                    return translate_recursive(chunk[:mid]) + translate_recursive(chunk[mid:])
            except Exception:
                mid = len(chunk) // 2
                return translate_recursive(chunk[:mid]) + translate_recursive(chunk[mid:])

        def process_chunk(chunk):
            return translate_recursive(chunk)

        with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
            results = list(executor.map(process_chunk, chunks))
            
        for r in results:
            translated_texts.extend(r)

        # Force identical array lengths
        if len(translated_texts) != len(texts):
            print("CRITICAL LENGTH MISMATCH", len(translated_texts), len(texts))
            return jsonify(texts) # Return original English rather than breaking the DOM mapping

        return jsonify(translated_texts)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route("/summarize", methods=["POST"])
def summarize_text():
    import traceback
    try:
        data = request.get_json()
        text = data.get("text", "")
        book_id = data.get("book_id")
        
        # If book_id provided, we use the cached full-book sentences or read from disk
        # (Allows summarization of specific highlights OR full context search)
        if book_id and not text:
            sentences = get_book_sentences(book_id)
            text = " ".join(sentences)
            
        if not text or len(text.strip()) < 50:
            return jsonify({"summary": "Text is too short to summarize. Please highlight a larger section."})

        # Pure Python Extractive Summarization (Fallback/Offline mode without heavy NLP dependencies)
        import re
        from collections import defaultdict
        
        # 1. Clean and tokenize sentences
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        if len(sentences) <= 3:
            return jsonify({"summary": text})
            
        # 2. Word frequency calculation (ignore common stop words)
        stop_words = set(['the', 'is', 'in', 'and', 'to', 'a', 'of', 'for', 'it', 'on', 'with', 'as', 'by', 'that', 'this', 'an', 'are', 'was', 'be', 'or', 'at', 'from'])
        words = re.findall(r'\w+', text.lower())
        freq_table = defaultdict(int)
        for word in words:
            if word not in stop_words:
                freq_table[word] += 1
                
        # 3. Score sentences based on word frequency
        sentence_scores = defaultdict(int)
        for i, sentence in enumerate(sentences):
            words_in_sentence = re.findall(r'\w+', sentence.lower())
            
            sentence_score = 0
            for word in words_in_sentence:
                if word in freq_table:
                    sentence_score += freq_table[word]
            
            # Normalize score by sentence length to prevent unfairly weighting extremely long run-ons
            if len(words_in_sentence) > 0:
                sentence_scores[i] = sentence_score / len(words_in_sentence)

        # 4. Extract top sentences (aim for ~30% compression, max 6 bullet points)
        target_length = max(2, min(6, int(len(sentences) * 0.35)))
        
        # Get the indices of the highest-scoring sentences
        top_sentence_indices = sorted(sentence_scores, key=sentence_scores.get, reverse=True)[:target_length]
        
        # 5. Re-sort chronologically so the summary reads in the correct order
        top_sentence_indices.sort()
        
        summary_sentences = []
        for index in top_sentence_indices:
            clean_sentence = sentences[index].strip()
            if clean_sentence:
                summary_sentences.append("- " + clean_sentence)
            
        summary = "\n".join(summary_sentences)
        
        return jsonify({"summary": summary})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Summarization failed internally."}), 500

@app.route("/ask", methods=["POST"])
def ask_question():
    import traceback
    try:
        data = request.get_json()
        question = data.get("question", "")
        book_id = data.get("book_id")
        text = data.get("text", "")
        
        if not question:
            return jsonify({"answer": "Please provide a question."})
            
        # Optimization: Fetch pre-cached sentences from the server instead of receiving them via network
        if book_id:
            sentences = get_book_sentences(book_id)
        elif text:
            import re
            sentences = re.split(r'(?<=[.!?])\s+', text)
        else:
            return jsonify({"answer": "Ensure a book is open."})

        if not sentences:
            return jsonify({"answer": "Could not read book text or book is empty."})
            
        # 2. Extract question keywords (ignoring stop words)
        stop_words = set(['what', 'who', 'is', 'a', 'at', 'is', 'he', 'the', 'in', 'and', 'to', 'of', 'for', 'it', 'on', 'with', 'as', 'by', 'that', 'this', 'an', 'are', 'was', 'be', 'or', 'from', 'where', 'when', 'why', 'how', 'does', 'do', 'did'])
        question_words = [w.lower() for w in re.findall(r'\w+', question) if w.lower() not in stop_words]
        
        if not question_words:
            # Fallback if they asked "what is it"
            question_words = [w.lower() for w in re.findall(r'\w+', question)]
            
        # 3. Calculate Inverse Document Frequency (IDF) for question words
        word_doc_count = defaultdict(int)
        for sentence in sentences:
            sentence_words = set(re.findall(r'\w+', sentence.lower()))
            for qw in question_words:
                if qw in sentence_words:
                    word_doc_count[qw] += 1
                    
        num_sentences = len(sentences)
        idf = {}
        for qw in question_words:
            # Add 1 to avoid division by zero
            idf[qw] = math.log(num_sentences / (1 + word_doc_count[qw]))
            
        # 4. Score sentences based on TF-IDF of question keywords
        sentence_scores = {}
        for i, sentence in enumerate(sentences):
            sentence_words = re.findall(r'\w+', sentence.lower())
            score = 0
            for qw in question_words:
                tf = sentence_words.count(qw)
                if tf > 0:
                    # Give bonus for exact phrase matching
                    if question.lower().find(qw) != -1 and sentence.lower().find(question.lower()) != -1:
                        score += 50
                    score += tf * idf[qw]
            
            if score > 0:
                # Add slight penalty for extremely long sentences to prefer concise answers
                length_penalty = math.log(max(10, len(sentence_words)))
                sentence_scores[i] = score / length_penalty
                
        if not sentence_scores:
            return jsonify({"answer": "I couldn't find an answer to that in the current book."})
            
        # 5. Extract top 2 most relevant sentences
        best_indices = sorted(sentence_scores, key=sentence_scores.get, reverse=True)[:2]
        best_indices.sort() # keep chronological
        
        answer = " ".join([sentences[idx].strip() for idx in best_indices])
        
        # Friendly formatting
        return jsonify({"answer": f"💡 Based on the book: {answer}"})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to search the book. It might be too large."}), 500

@app.route("/define", methods=["POST"])
def define_word():
    import traceback
    try:
        data = request.get_json()
        word = data.get("word", "").lower()
        book_id = data.get("book_id")
        text_from_client = data.get("text", "")
        
        if not word:
            return jsonify({"answer": "Word missing."})
            
        if book_id:
            sentences = get_book_sentences(book_id)
        elif text_from_client:
            from bs4 import BeautifulSoup
            import re
            soup = BeautifulSoup(text_from_client, "html.parser")
            raw_text = soup.get_text(separator=" ")
            sentences = re.split(r'(?<=[.!?])\s+', raw_text)
            sentences = [re.sub(r'\s+', ' ', s).strip() for s in sentences if len(s.strip()) > 5]
        else:
            return jsonify({"answer": "Book context missing."})
        
        # 2. Search for definition patterns: "Word is...", "Word means...", "Word refers to..."
        patterns = [
            rf"\b{word}\s+is\b",
            rf"\b{word}\s+means\b",
            rf"\b{word}\s+refers\s+to\b",
            rf"\b{word}\s+defined\s+as\b",
            rf"\bdefinition\s+of\s+{word}\b"
        ]
        
        definition_sentences = []
        for s in sentences:
            s_lower = s.lower()
            if any(re.search(p, s_lower) for p in patterns):
                definition_sentences.append(s)
        
        if definition_sentences:
            return jsonify({"answer": " ".join(definition_sentences[:2])})
            
        # 3. Fallback: Search for sentences containing the word in context
        matches = []
        for s in sentences:
            if re.search(rf"\b{word}\b", s.lower()):
                matches.append(s)
        
        if matches:
            # Sort by descriptive power (longer sentences that aren't overly long)
            matches.sort(key=lambda x: abs(60 - len(x)))
            return jsonify({"answer": f"💡 AI Context: {matches[0]}"})
            
        return jsonify({"answer": "I couldn't find a specific meaning for this word in the current book contents."})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)