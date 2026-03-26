from flask import Flask, render_template, request, jsonify, send_from_directory, send_file
import os
from typing import List
import sqlite3
import time
import math
import re
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
import json
import requests
import traceback
import io
import pyttsx3
import uuid
from werkzeug.utils import secure_filename

app = Flask(__name__)

UPLOAD_FOLDER = "uploads"
EXTRACTED_FOLDER = "extracted"
DB = "database.db"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(EXTRACTED_FOLDER, exist_ok=True)

# Global cache to store pre-tokenized sentences for the currently active book
# Structure: { book_id: (timestamp, [sentences]) }
SENTENCE_CACHE = {}
_SENTIMENT_ANALYZER = None

def get_sentiment_analyzer():
    global _SENTIMENT_ANALYZER
    if _SENTIMENT_ANALYZER is None:
        try:
            from transformers import pipeline
            _SENTIMENT_ANALYZER = pipeline("sentiment-analysis", model="distilbert-base-uncased-finetuned-sst-2-english", device=-1)
        except Exception as e:
            print(f"Sentiment model pre-load failed: {e}")
            _SENTIMENT_ANALYZER = "FAILED"
    return _SENTIMENT_ANALYZER if _SENTIMENT_ANALYZER != "FAILED" else None

def get_book_sentences(book_id):
    """Retrieve or generate tokenized sentences for a book to avoid repeated parsing."""
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

    cur.execute("""
    CREATE TABLE IF NOT EXISTS notes(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)


    conn.commit()
    conn.close()


init_db()


def extract_image_text(file_path):
    image = cv2.imread(file_path)
    if image is None:
        return ""

    h, w = image.shape[:2]
    
    # Scale image upwards for better character recognition (Premium resolution)
    max_dim = 2400
    scale = 1.0
    if max(h, w) < 1400:
        scale = 1400 / max(h, w)
    elif max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        
    if scale != 1.0:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LANCZOS4)
        
    # Pre-processing for better OCR accuracy
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # SHARPEN: Enhance character edges before binarization
    sharpen_kernel = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
    sharpened = cv2.filter2D(gray, -1, sharpen_kernel)
    
    # 1. Pipeline A: Adaptive (Handles uneven paper/lighting)
    denoised = cv2.bilateralFilter(sharpened, 9, 75, 75)
    thresh_adaptive = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    
    # 2. Pipeline B: Otsu Global (Best for clean digital slides)
    _, thresh_otsu = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # 3. Pipeline C: Inverted Otsu (Crucial for white text on colored backgrounds)
    _, thresh_inv = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # 4. Pipeline D: Channel-Specific (Best for Red/Maroon text on Orange/Yellow backgrounds)
    # Standard grayscale averages channels, making red-on-orange disappear.
    # The green channel provides the highest contrast for red-spectrum text.
    _, g_chan, _ = cv2.split(image)
    thresh_green = cv2.adaptiveThreshold(g_chan, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)

    config = r'--tessdata-dir c:\ai_book_reader\tessdata --oem 3 --psm 3 -l eng+tam'
    
    try:
        # Multi-Strategy Pipeline
        passes = [
            ("adaptive", thresh_adaptive),
            ("otsu", thresh_otsu),
            ("inverted", thresh_inv),
            ("green_chan", thresh_green),
            ("raw_gray", gray)
        ]
        
        all_results = []
        for name, img_pass in passes:
            res_text = pytesseract.image_to_string(img_pass, config=config).strip()
            if res_text:
                # Basic cleaning
                res_text = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', res_text)
                all_results.append(res_text)
        
        if not all_results: return ""
        
        # Strategy: Instead of choosing ONE pass, we aggregate unique lines from ALL successful passes
        # This catches "HOW TO COMBINE" from pass A AND "TEXT AND IMAGE" from pass B.
        seen_lines = set()
        final_lines = []
        
        for block in all_results:
            for line in block.split('\n'):
                # Clean line
                line = re.sub(r'[^a-zA-Z0-9\s.,!?:;@&()\"\'-]', '', line).strip()
                if len(line) < 3: continue
                
                # Heuristic Fixes
                if line.startswith("FIOW "): line = "HOW " + line[5:]
                
                # Deduplication logic (Case-insensitive matching to avoid duplicates like 'How' and 'HOW')
                norm_line = line.lower().replace(" ", "")
                if norm_line not in seen_lines:
                    seen_lines.add(norm_line)
                    final_lines.append(line)
        
        return "\n".join(final_lines)
    except Exception as e:
        print(f"OCR failed:", e)
        return ""


def build_clickable_img_wrapper(img_tag_str, img_cv):
    """Given an OpenCV image tag and image, wrap it in a clickable container for AI explanation."""
    # We no longer run OCR here as requested.
    wrapper = f'<div class="img-clickable-wrapper" onclick="explainImage(this)">{img_tag_str}</div>'
    return wrapper


def ocr_embedded_images(html):
    """
    Fast pass: extract raw text from embedded images for TTS/search purposes only.
    Uses regex and multithreading for high performance without BeautifulSoup overhead.
    """
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
                # Wrap images in a clickable container for explanation instead of OCR overlay
                clickable_html = build_clickable_img_wrapper(img_tag, img_cv)
                if clickable_html:
                    return start, end, clickable_html
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
    import base64
    html_parts = []
    pdf = fitz.open(file_path)
    
    for page_num in range(len(pdf)):
        page = pdf[page_num]
        
        # Start a sequential Block Container
        page_html = f'<div id="pdf-page-{page_num}" class="lazy-page-container flex-page" data-original-width="800" style="display: flex; flex-direction: column; margin-bottom: 40px; border-bottom: 2px solid #ddd; padding: 20px 40px; gap: 30px;">'
        
        img_html = '<div class="pdf-img-top" style="text-align: center; margin-bottom: 20px; width: 100%; display: block;">'
        text_html = '<div class="pdf-text-bottom" style="line-height: 1.8; color: var(--text-main); word-break: break-word; text-align: left; padding: 0 10px;">'
        
        blocks = page.get_text("dict").get("blocks", [])
        
        # Sort blocks by reading order (Top to Bottom, then Left to Right)
        # b["bbox"] is (x0, y0, x1, y1)
        blocks.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
        seen_texts = set()
        page_texts = []
        page_imgs = []
        
        for b in blocks:
            if b["type"] == 0:
                # Text node logic
                block_text = ""
                for line in b.get("lines", []):
                    for span in line.get("spans", []):
                        block_text += span.get("text", "")
                    block_text += "\n"
                
                clean_t = " ".join(block_text.strip().split("\n")).strip()
                if not clean_t:
                    continue
                    
                # Deduplicate overlapping background/shadow artifacts
                if clean_t in seen_texts:
                    continue
                seen_texts.add(clean_t)
                
                page_texts.append(f'<p style="margin-bottom: 1.25em;">{clean_t}</p>')
                
            elif b["type"] == 1:
                # Image node logic
                x0, y0, x1, y1 = b.get("bbox", (0, 0, 0, 0))
                w = x1 - x0
                h = y1 - y0
                
                # Allow all images to render natively (many children's books use full-page illustrations!)
                if not b.get("image"):
                    continue
                
                b64 = base64.b64encode(b["image"]).decode()
                ext = b.get("ext", "png")
                
                # Image flows down centrally, explicitly forcing height to lock the aspect ratio 
                img_tag = f'<img src="data:image/{ext};base64,{b64}" style="max-width: 100%; height: auto; max-height: 550px; display: inline-block; border-radius: 12px; box-shadow: 0 6px 16px rgba(0,0,0,0.15);" />'
                page_imgs.append(img_tag)
        
        img_html += "".join(page_imgs) + "</div>"
        text_html += "".join(page_texts) + "</div>"
        
        # Sequentially stack: First Images, then Text (as user requested)
        if not page_texts and not page_imgs:
            page_html += "</div>"
        elif not page_texts:
            page_html += img_html + "</div>"
        elif not page_imgs:
            page_html += text_html + "</div>"
        else:
            page_html += img_html + text_html + "</div>"
            
        html_parts.append(page_html)
        
    pdf.close()
    full_html = "".join(html_parts)
    # Enable OCR for embedded images so they become selectable/readable
    return ocr_embedded_images(full_html)


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
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    try:
        prs = pptx.Presentation(file_path)
    except:
        return "<div class='error'>Failed to load PPTX. Try saving as PDF.</div>"

    sw = prs.slide_width
    sh = prs.slide_height

    # Convert EMUs to a base pixel width for consistent frontend rendering
    base_w = 800
    base_h = int((sh / sw) * base_w)
    aspect = (sh / sw) * 100
    
    html = f'<div class="book-content-container" style="background:transparent; padding: 20px;">'
    for i, slide in enumerate(prs.slides):
        # Create a positioned slide canvas matching the PowerPoint aspect ratio
        html += f'<div id="slide-page-{i}" class="lazy-page-container" data-original-width="{base_w}" data-original-height="{base_h}" style="width: {base_w}px; height: {base_h}px; position: relative; background: #fff; margin: 0 auto 40px auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-radius: 4px; overflow: hidden; container-type: size;">'
        html += f'<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: hidden;">'
        
        # Add a light background number
        html += f'<div style="position: absolute; bottom: 10px; right: 15px; color: #ccc; font-size: 0.8em; z-index: 0;">Slide {i+1}</div>'

        for shape in slide.shapes:
            # Calculate percentage coordinates
            t = (shape.top / sh) * 100
            l = (shape.left / sw) * 100
            w = (shape.width / sw) * 100
            h = (shape.height / sh) * 100
            
            # Skip shapes that are way off-canvas
            if l < -10 or t < -10 or l > 110 or t > 110: continue

            style = f"position: absolute; top: {t}%; left: {l}%; width: {w}%; height: {h}%;"

            if hasattr(shape, "image"):
                try:
                    b64 = base64.b64encode(shape.image.blob).decode()
                    ext = shape.image.ext or "png"
                    html += f'<div style="{style} z-index: 1;"><img src="data:image/{ext};base64,{b64}" style="width: 100%; height: 100%; object-fit: contain;" /></div>'
                except: pass
            elif hasattr(shape, "text_frame") and shape.text_frame.text.strip():
                from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
                # Extract alignment and native font size
                h_align = "left"
                v_align = "flex-start"
                
                # Try to get native font size if set
                fs_px = None
                if shape.text_frame.paragraphs:
                    p = shape.text_frame.paragraphs[0]
                    # Check paragraph alignment
                    if p.alignment == PP_ALIGN.CENTER: h_align = "center"
                    elif p.alignment == PP_ALIGN.RIGHT: h_align = "right"
                    elif p.alignment == PP_ALIGN.JUSTIFY: h_align = "justify"
                    
                    # Check font size (native PowerPoint font size)
                    if p.font.size:
                        # Convert EMUs to pixels based on our 800px base width
                        fs_px = (p.font.size / sw) * base_w

                if shape.text_frame.vertical_anchor == MSO_ANCHOR.MIDDLE: v_align = "center"
                elif shape.text_frame.vertical_anchor == MSO_ANCHOR.BOTTOM: v_align = "flex-end"

                text = shape.text_frame.text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')
                
                # Determine font size: Use native if found, otherwise fallback to a more conservative clamp
                if fs_px and fs_px > 5:
                    font_size_style = f"font-size: {round(fs_px, 1)}px;"
                else:
                    font_size_style = "font-size: clamp(8px, 1.8cqw, 36px);"

                # For text boxes, we often don't want a fixed height to prevent clipping, 
                # but we keep width fixed for wrapping.
                html += f'<div style="position: absolute; top: {t}%; left: {l}%; width: {w}%; min-height: {h}%; z-index: 2; padding: 2px; display: flex; align-items: {v_align}; line-height: 1.1; {font_size_style} color: #333; text-align: {h_align}; word-break: break-word;">'
                html += f'<div style="width: 100%;">{text}</div></div>'
            elif shape.shape_type == MSO_SHAPE_TYPE.TABLE:
                # Basic table support
                html += f'<div style="{style} z-index: 2; background: #f9f9f9; border: 1px solid #ddd; font-size: 0.6em; overflow: auto; padding: 2px;">Table Data Linked</div>'

        html += "</div></div>"
    html += "</div>"
    return html


def extract_txt_html(file_path):
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read().replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')
        return f"<div class='txt-content-wrapper' style='padding: 40px; font-family: monospace; line-height: 1.5; white-space: pre-wrap;'>{text}</div>"


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
    elif ext in [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif", ".tiff", ".svg", ".ico", ".jfif"]:
        # Professional Standalone Image Processing
        filename = os.path.basename(file_path)
        img_np = cv2.imread(file_path)
        
        if img_np is None:
             return f"<div style='background: white; padding: 40px; color: red;'>Could not read image metadata for {filename}</div>"

        # 1. Build Clickable Wrapper (For AI explanation on click)
        img_tag = f'<img src="/uploads/{filename}" style="max-width: 100%; height: auto; max-height: 900px; display: inline-block; border-radius: 12px; box-shadow: 0 6px 16px rgba(0,0,0,0.15);" />'
        clickable_html = build_clickable_img_wrapper(img_tag, img_np)
        
        # 2. Extract Plain Text (Restored for Standalone Image Uploads as requested)
        text = extract_image_text(file_path)
        clean_text_html = ""
        for line in text.split("\n"):
            line = line.strip()
            if line:
                clean_text_html += f'<p style="margin-bottom: 1.25em;">{line}</p>'
                
        final_img_area = clickable_html if clickable_html else f'<div style="text-align: center;">{img_tag}</div>'

        html = f"""
            <div id="pdf-page-0" class="lazy-page-container flex-page" data-original-width="800" style="display: flex; flex-direction: column; margin-bottom: 40px; border-bottom: 2px solid #ddd; padding: 20px 40px; gap: 30px;">
                <div class="pdf-img-top" style="text-align: center; margin-bottom: 20px; width: 100%; display: block;">
                    {final_img_area}
                </div>
                <div class="pdf-text-bottom" style="line-height: 1.8; color: var(--text-main); word-break: break-word; text-align: left; padding: 0 10px;">
                    {clean_text_html}
                </div>
            </div>
        """
        return html
    else:
        return "<div style='background: white; padding: 40px; color: red;'>Unsupported file format</div>"



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
    lang = request.args.get("lang", "en") or "en"
    gender = request.args.get("gender", "female").lower()
    
    if not text:
        return "No text", 400
    
    # Standardize language (ta-IN -> ta)
    l = lang.split('-')[0].lower() if '-' in lang else lang.lower()
    
    # Professional Neural Voice Map (Comprehensive)
    VOICE_MAP = {
        'en': { 'female': 'en-US-AriaNeural', 'male': 'en-US-GuyNeural' },
        'ta': { 'female': 'ta-IN-PallaviNeural', 'male': 'ta-IN-ValluvarNeural' },
        'hi': { 'female': 'hi-IN-SwaraNeural', 'male': 'hi-IN-MadhurNeural' },
        'kn': { 'female': 'kn-IN-SapnaNeural', 'male': 'kn-IN-GaganNeural' },
        'te': { 'female': 'te-IN-ShrutiNeural', 'male': 'te-IN-MohanNeural' },
        'ml': { 'female': 'ml-IN-SobhanaNeural', 'male': 'ml-IN-MidhunNeural' },
        'pa': { 'female': 'pa-IN-OjasNeural', 'male': 'pa-IN-GurumaNeural' },
        'gu': { 'female': 'gu-IN-DhwaniNeural', 'male': 'gu-IN-NiranjanNeural' },
        'mr': { 'female': 'mr-IN-AarohiNeural', 'male': 'mr-IN-ManoharNeural' },
        'bn': { 'female': 'bn-IN-TanishaaNeural', 'male': 'bn-IN-BashkarNeural' },
        'fr': { 'female': 'fr-FR-DeniseNeural', 'male': 'fr-FR-HenriNeural' },
        'es': { 'female': 'es-ES-ElviraNeural', 'male': 'es-ES-AlvaroNeural' },
        'de': { 'female': 'de-DE-KatjaNeural', 'male': 'de-DE-ConradNeural' },
        'it': { 'female': 'it-IT-ElsaNeural', 'male': 'it-IT-DiegoNeural' },
        'zh': { 'female': 'zh-CN-XiaoxiaoNeural', 'male': 'zh-CN-YunxiNeural' }
    }
    
    # HYBRID ENGINE: Edge Neural for major languages, gTTS for regional fallbacks
    EDGE_SUPPORTED = ['en','ta','hi','bn','kn','te','ml','gu','mr','fr','es','de','it','zh']
    
    if l in ['pa', 'or'] or l not in EDGE_SUPPORTED:
        # PURE FALLBACK FOR PUNJABI & ODIA
        try:
            from gtts import gTTS
            import io
            tts_obj = gTTS(text=text, lang=l, slow=False)
            fp = io.BytesIO()
            tts_obj.write_to_fp(fp)
            fp.seek(0)
            return send_file(fp, mimetype="audio/mpeg")
        except Exception as e:
            print(f"gTTS Fallback Failed for {l}: {e}")
            voice = 'en-US-AriaNeural' # Ultimate fallback
    else:
        voice = VOICE_MAP.get(l, {}).get(gender, 'en-US-AriaNeural')


    import edge_tts
    from flask import Response

    # HIGH-PERFORMANCE STREAMING GENERATOR
    async def stream_audio():
        communicate = edge_tts.Communicate(text, voice)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]

    try:
        # Return a streaming response for zero initial lag
        return Response(stream_audio_sync(stream_audio()), mimetype="audio/mpeg")
    except Exception as e:
        print(f"Streaming TTS failed: {e}")
        return "TTS Failure", 500

# Helper to bridge async generator to sync Flask
def stream_audio_sync(async_gen):
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        while True:
            try:
                # We fetch chunks one by one from the async stream
                chunk = loop.run_until_complete(async_gen.__anext__())
                yield chunk
            except StopAsyncIteration:
                break
    finally:
        loop.close()

@app.route("/book/<int:book_id>")
def open_book(book_id):
    import traceback
    try:
        conn = get_conn()
        cur = conn.cursor()

        cur.execute("SELECT name, path, extracted_path FROM books WHERE id = ?", (book_id,))
        book = cur.fetchone()
        conn.close()

        if not book:
            return jsonify({"error": "Book not found in database"}), 404

        name, file_path, extracted_path = book
        file_name = os.path.basename(file_path) if file_path else ""

        if not extracted_path or not os.path.exists(extracted_path):
            # Fallback: Extract again if file missing
            print(f"File missing at {extracted_path}, re-extracting...")
            html = extract_book_html(file_path)
            os.makedirs(os.path.dirname(extracted_path), exist_ok=True)
            with open(extracted_path, "w", encoding="utf-8") as f:
                f.write(html)

        with open(extracted_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()

        return jsonify({
            "name": name,
            "text": text,
            "file_name": file_name
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Server Error: {str(e)}"}), 500



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


@app.route("/delete_highlight", methods=["POST"])
def delete_highlight():
    data = request.get_json()

    book_id = data.get("book_id")
    highlighted_text = data.get("highlighted_text")

    if not book_id or not highlighted_text:
        return jsonify({"error": "Missing data"})

    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "DELETE FROM highlights WHERE book_id = ? AND highlighted_text = ?",
        (book_id, highlighted_text)
    )

    conn.commit()
    conn.close()

    return jsonify({"message": "Highlight deleted successfully"})


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

        # Parallel Translation for High Speed
        from concurrent.futures import ThreadPoolExecutor
        
        def translate_single_chunk(chunk):
            if not chunk: return []
            try:
                clean_chunk = [str(s).strip() if s and str(s).strip() else "..." for s in chunk]
                return translator.translate_batch(clean_chunk)
            except Exception as e:
                print(f"Batch translation error: {e}")
                return [translator.translate(s) if s else "" for s in chunk]

        with ThreadPoolExecutor(max_workers=8) as executor:
            translated_chunks = list(executor.map(translate_single_chunk, chunks))
            
        translated_texts = [item for sublist in translated_chunks for item in sublist]

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

@app.route("/save_note", methods=["POST"])
def save_note():
    data = request.get_json()
    book_id = data.get("book_id")
    content = data.get("content")
    if not book_id or not content:
        return jsonify({"error": "Missing data"}), 400

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("INSERT INTO notes(book_id, content) VALUES (?, ?)", (book_id, content))
    conn.commit()
    conn.close()
    return jsonify({"message": "Note saved!"})

@app.route("/notes/<int:book_id>")
def get_notes(book_id):
    lang = request.args.get("lang", "en") # Current UI language
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, content FROM notes WHERE book_id = ? ORDER BY created_at DESC", (book_id,))
    rows = cur.fetchall()
    conn.close()

    notes = []
    for row in rows:
        note_id, content = row
        # Auto-translate if not in original/english
        if lang and lang != 'en' and lang != 'orig':
            try:
                from deep_translator import GoogleTranslator
                content = GoogleTranslator(source='auto', target=lang).translate(content)
            except:
                pass # Fallback to original if translation fails
        notes.append({"id": note_id, "content": content})
        
    return jsonify(notes)

@app.route("/update_note", methods=["POST"])
def update_note():
    data = request.get_json()
    note_id = data.get("note_id")
    content = data.get("content")
    if not note_id or content is None:
        return jsonify({"error": "Missing data"}), 400

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE notes SET content = ? WHERE id = ?", (content, note_id))
    conn.commit()
    conn.close()
    return jsonify({"message": "Note updated!"})

@app.route("/delete_note/<int:note_id>", methods=["POST"])
def delete_note_endpoint(note_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Note deleted!"})

@app.route("/download_notes/<int:book_id>")
def download_notes(book_id):
    format_type = request.args.get("format", "txt").lower()
    
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT name FROM books WHERE id = ?", (book_id,))
    book_row = cur.fetchone()
    if not book_row:
        conn.close()
        return "Book not found", 404
        
    book_name = book_row[0]
    cur.execute("SELECT content FROM notes WHERE book_id = ?", (book_id,))
    notes = [row[0] for row in cur.fetchall()]
    conn.close()

    
    if not notes:
        return "No notes found to download.", 400

    from io import BytesIO, StringIO
    
    if format_type == "docx":
        from docx import Document
        doc = Document()
        doc.add_heading(f'Study Notes: {book_name}', 0)
        doc.add_paragraph('Collected using AI Book Reader').italic = True
        
        for i, note in enumerate(notes):
            doc.add_heading(f'Snippet {i+1}', level=1)
            doc.add_paragraph(note)
            
        target = BytesIO()
        doc.save(target)
        target.seek(0)
        return send_file(target, as_attachment=True, download_name=f"Notes_{book_name}.docx", mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    elif format_type == "pdf":
        from fpdf import FPDF
        class PDF(FPDF):
            def header(self):
                self.set_font('helvetica', 'B', 15)
                self.cell(0, 10, f'Study Notes: {book_name}', border=True, ln=True, align='C')
                self.ln(5)
            def footer(self):
                self.set_y(-15)
                self.set_font('helvetica', 'I', 8)
                self.cell(0, 10, f'Page {self.page_no()}', 0, 0, 'C')

        pdf = PDF()
        pdf.add_page()
        pdf.set_font("helvetica", size=11)
        
        for i, note in enumerate(notes):
            pdf.set_font("helvetica", 'B', 12)
            pdf.cell(0, 10, f"Snippet {i+1}:", ln=True)
            pdf.set_font("helvetica", size=10)
            # Remove characters that may crash basic PDF fonts or use multi_cell safely
            safe_text = note.encode('latin-1', 'replace').decode('latin-1')
            pdf.multi_cell(0, 10, safe_text)
            pdf.ln(5)

        response_bytes = pdf.output()
        target = BytesIO(response_bytes)
        return send_file(target, as_attachment=True, download_name=f"Notes_{book_name}.pdf", mimetype="application/pdf")

    else: # Default TXT
        content = f"STUDY NOTES: {book_name}\n{'='*30}\n\n"
        for i, note in enumerate(notes):
            content += f"SNIPPET {i+1}:\n{note}\n\n"
            content += "-"*20 + "\n\n"
            
        target = BytesIO(content.encode('utf-8'))
        return send_file(target, as_attachment=True, download_name=f"Notes_{book_name}.txt", mimetype="text/plain")

@app.route("/generate_revision", methods=["POST"])
def generate_revision():
    import re
    from collections import defaultdict
    try:
        data = request.get_json()
        book_id = data.get("book_id")
        
        if not book_id:
            return jsonify({"error": "No book selected"}), 400
            
        sentences = get_book_sentences(book_id)
        if not sentences:
            return jsonify({"error": "No content found in book"}), 404
            
        # Full-book scoring 
        text = " ".join(sentences).lower()
        stop_words = set(['the', 'is', 'in', 'and', 'to', 'a', 'of', 'for', 'it', 'on', 'with', 'as', 'by', 'that', 'this', 'an', 'are', 'was', 'be', 'or', 'at', 'from', 'their', 'which', 'will', 'have', 'been', 'were', 'about'])
        words = re.findall(r'\b\w{4,}\b', text)
        freq = defaultdict(int)
        for w in words:
            if w not in stop_words: freq[w] += 1
            
        # Score each sentence
        scores = []
        for i, s in enumerate(sentences):
            words_in_s = re.findall(r'\b\w+\b', s.lower())
            if len(words_in_s) < 12 or len(words_in_s) > 50: continue
            
            score = sum(freq[w] for w in words_in_s if w in freq)
            scores.append((score / len(words_in_s), i, s))
            
        # Pick top 25 diverse points
        top_points = sorted(scores, key=lambda x: x[0], reverse=True)[:30]
        # Re-sort by book order
        top_points.sort(key=lambda x: x[1])
        
        revision_points = [p[2].strip() for p in top_points]
        return jsonify({"revision_points": revision_points})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/download_revision/<book_id>", methods=["GET"])
def download_revision(book_id):
    from io import BytesIO
    import re
    from collections import defaultdict
    try:
        sentences = get_book_sentences(book_id)
        if not sentences: return "Book not found", 404
        
        # Generation Logic (Duplicated for standalone download)
        text = " ".join(sentences).lower()
        stop_words = set(['the', 'is', 'in', 'and', 'to', 'a', 'of', 'for', 'it', 'on', 'with', 'as', 'by', 'that', 'this', 'an', 'are', 'was', 'be', 'or', 'at', 'from'])
        words = re.findall(r'\b\w{4,}\b', text)
        freq = defaultdict(int)
        for w in words:
            if w not in stop_words: freq[w] += 1
        
        scores = []
        for i, s in enumerate(sentences):
            words_in_s = re.findall(r'\b\w+\b', s.lower())
            if len(words_in_s) < 12 or len(words_in_s) > 50: continue
            score = sum(freq[w] for w in words_in_s if w in freq)
            scores.append((score / len(words_in_s), i, s))
            
        top_points = sorted(scores, key=lambda x: x[0], reverse=True)[:35]
        top_points.sort(key=lambda x: x[1])
        
        book_name = next((b['name'] for b in Library.list_books() if b['id'] == book_id), "Book")
        
        content = f"REVISION GUIDE: {book_name}\n" + "="*40 + "\n\n"
        for i, p in enumerate(top_points):
            content += f"{i+1}. {p[2].strip()}\n\n"
            
        return send_file(BytesIO(content.encode('utf-8')), as_attachment=True, download_name=f"Revision_{book_name}.txt", mimetype="text/plain")
    except Exception as e:
        return str(e), 500

@app.route("/generate_quiz", methods=["POST"])

def generate_quiz():
    import traceback, random, re
    from collections import defaultdict

    try:
        data = request.get_json()
        text = data.get("text", "")
        book_id = data.get("book_id")
        quiz_type = data.get("type", "mcq") # default to mcq

        if book_id and not text:
            sentences = get_book_sentences(book_id)
            text = " ".join(sentences)

        if not text or len(text.strip()) < 100:
            return jsonify({"error": "Content too sparse to generate a quality quiz."}), 400

        # 1. CLEAN & TOKENIZE
        sentences = re.split(r'(?<=[.!?])\s+', text.strip())
        all_words = re.findall(r'\b\w{4,}\b', text.lower())
        
        # 2. KEYWORDS EXTRACTION (Frequent nouns/concepts)
        stop_words = set(['the', 'and', 'that', 'with', 'from', 'this', 'their', 'which', 'will', 'have', 'been', 'were', 'about'])
        freq = defaultdict(int)
        for w in all_words:
            if w not in stop_words: freq[w] += 1
        
        top_keywords = sorted(freq, key=freq.get, reverse=True)[:50]
        
        questions = []

        if quiz_type == "mcq":
            # Existing MCQ logic
            candidates = [s for s in sentences if re.search(r'\b(is|was|means|refers to|defined as|called|known as)\b', s, re.I)]
            random.shuffle(candidates)
            
            for s in candidates[:25]:
                words = re.findall(r'\b\w+\b', s)
                possible_masks = [w for w in words if w.lower() in top_keywords and len(w) > 3]
                if not possible_masks: continue
                mask = random.choice(possible_masks)
                distractors = [k for k in top_keywords if k.lower() != mask.lower()]
                if len(distractors) < 3: continue
                options = random.sample(distractors, 3) + [mask]
                random.shuffle(options)
                q_text = re.sub(r'\b' + re.escape(mask) + r'\b', '__________', s, count=1, flags=re.I)
                questions.append({"question": q_text, "options": options, "answer": mask, "type": "mcq"})
                if len(questions) >= 10: break

        elif quiz_type in ["short", "long"]:
            # Standard Academic Question Templates
            short_temps = [
                "Define {concept}.", 
                "What is meant by {concept}?", 
                "Write a short note on {concept}.", 
                "State the importance of {concept}.",
                "What are the primary uses of {concept}?"
            ]
            long_temps = [
                "Explain {concept} in detail based on the text.",
                "Describe the working or context of {concept}.",
                "Discuss the concept of {concept} and its implications.",
                "Elaborate on {concept} with suitable examples from the book.",
                "Analyze the importance of {concept} in modern applications."
            ]

            # High-Performance NLP Logic using TextBlob
            try:
                from textblob import TextBlob
                blob = TextBlob(text)
                # Group noun phrases and filter out junk
                concepts = [str(np).lower() for np in blob.noun_phrases if len(str(np)) > 3]
            except:
                concepts = [k for k in top_keywords if len(str(k)) > 4]

            # Better stopword and diversity filtering
            hard_stop = {'here', 'there', 'that', 'this', 'with', 'from', 'been', 'were', 'about', 'some', 'than', 'into', 'only', 'very', 'just', 'more', 'also', 'their', 'which'}
            final_concepts = []
            for c in concepts:
                if c not in hard_stop and len(c.split()) < 4 and c not in final_concepts:
                    final_concepts.append(c)
            
            random.shuffle(final_concepts)

            # Scale count based on text depth
            target_count = min(12, max(5, len(sentences) // 20))
            if quiz_type == "long": target_count = min(8, max(3, len(sentences) // 40))

            for concept in final_concepts:
                if len(questions) >= target_count: break
                
                # Find the best context for this concept
                for i, s in enumerate(sentences):
                    if concept.lower() in s.lower() and 10 < len(s.split()) < 60:
                        concept_display = concept.title()
                        if quiz_type == "short":
                            template = random.choice(short_temps)
                            questions.append({
                                "question": template.format(concept=concept_display),
                                "answer": f"💡 **Core Insight**: {s.strip()}",
                                "type": "short"
                            })
                        else:
                            # Contextual Multi-Sentence Answer
                            context = sentences[max(0, i-1):min(len(sentences), i+5)]
                            template = random.choice(long_temps)
                            formatted_answer = f"🔍 **Professional Summary: {concept_display}**\n\n"
                            formatted_answer += f"**Primary Explanation**: {context[0].strip()}\n\n"
                            formatted_answer += "**Detailed Context**:\n"
                            for line in context[1:]:
                                if len(line.strip()) > 10:
                                    formatted_answer += f"• {line.strip()}\n"
                            
                            questions.append({
                                "question": template.format(concept=concept_display),
                                "answer": formatted_answer,
                                "type": "long"
                            })
                        break

        if not questions:
            # Fallback
            for k in top_keywords[:5]:
                questions.append({
                    "question": f"Based on the text, what is a key concept identified as '{k}'?",
                    "options": random.sample(top_keywords[10:13], 3) + [k] if quiz_type == "mcq" else None,
                    "answer": f"The term '{k}' is used as a significant keyword in this context.",
                    "type": quiz_type
                })
                if quiz_type == "mcq": random.shuffle(questions[-1]["options"])

        # MULTI-LANGUAGE SUPPORT: Translate the full quiz if target_lang provided
        target_lang = data.get("target_lang", "en")
        if target_lang and target_lang not in ["en", "orig"]:
            from deep_translator import GoogleTranslator
            try:
                translator = GoogleTranslator(source='auto', target=target_lang)
                for q in questions:
                    q["question"] = translator.translate(q["question"])
                    if q.get("options"):
                        q["options"] = [translator.translate(opt) for opt in q["options"]]
                    if q.get("answer"):
                        q["answer"] = translator.translate(q["answer"])
            except Exception as e:
                print(f"Quiz translation error: {e}")

        return jsonify({"questions": questions, "type": quiz_type})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Quiz generation failed."}), 500

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
    try:
        data = request.get_json()
        word = data.get("word", "").lower()
        book_id = data.get("book_id")
        text_from_client = data.get("text", "")
        lang = data.get("lang", "en").split('-')[0].lower() # e.g. 'ta' from 'ta-IN'
        
        if not word:
            return jsonify({"answer": "Word missing."})
            
        sentences = []
        # Prioritize the text current being viewed (this handles translations)
        if text_from_client:
            soup = BeautifulSoup(text_from_client, "html.parser")
            raw_text = soup.get_text(separator=" ")
            sentences = re.split(r'(?<=[.!?])\s+', raw_text)
            sentences = [re.sub(r'\s+', ' ', s).strip() for s in sentences if len(s.strip()) > 5]
        
        # Fallback to book file if client text is sparse or missing
        if not sentences and book_id:
            sentences = get_book_sentences(book_id)

        # 1. Multilingual pattern matching for finding definitions in-context
        lang_patterns = {
            "en": [rf"\b{word}\s+is\b", rf"\b{word}\s+means\b", rf"\b{word}\s+refers\s+to\b", rf"\bdefinition\s+of\s+{word}\b"],
            "ta": [rf"{word}\s+என்பது", rf"{word}\s+என்றால்", rf"{word}\s+குறிக்கிறது"],
            "hi": [rf"{word}\s+का\s+अर्थ", rf"{word}\s+है", rf"{word}\s+मतलब"],
            "te": [rf"{word}\s+అంటే", rf"{word}\s+అనేది"],
            "ml": [rf"{word}\s+എന്നാൽ", rf"{word}\s+എന്ന്\s+പറയുന്നത്"],
            "kn": [rf"{word}\s+ಎಂದರೆ", rf"{word}\s+ಎನ್ನುವುದು"],
            "bn": [rf"{word}\s+মানে", rf"{word}\s+হল"],
            "gu": [rf"{word}\s+એટલે", rf"{word}\s+છે"]
        }
        
        patterns = lang_patterns.get(lang, lang_patterns["en"])
        
        definition_sentences = []
        if sentences:
            for s in sentences:
                s_lower = s.lower()
                if any(re.search(p, s_lower) for p in patterns):
                    definition_sentences.append(s)
        
        if definition_sentences:
            return jsonify({"answer": " ".join(definition_sentences[:2])})
            
        # 2. Try Dictionary Definitions first (High signal)
        try:
            # First try: Direct definition in the word's own language
            dict_url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={lang}&tl={lang}&dt=md&q={word}"
            res = requests.get(dict_url, timeout=5)
            if res.ok:
                dict_data = res.json()
                if len(dict_data) > 12 and dict_data[12]:
                    defs = []
                    for entry in dict_data[12]:
                        if len(entry) > 1 and entry[1]:
                            for subentry in entry[1]:
                                if subentry[0]: defs.append(subentry[0])
                    if defs: return jsonify({"answer": " 📖 Definition: " + "; ".join(defs[:2])})

            # Second try: Transliterated/English fallback
            if lang != 'en':
                detect_url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q={word}"
                res = requests.get(detect_url, timeout=3)
                if res.ok:
                    data = res.json()
                    english_word = data[0][0][0] if data[0] and data[0][0] else word
                    en_dict_url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=en&dt=md&q={english_word}"
                    res_en = requests.get(en_dict_url, timeout=3)
                    if res_en.ok:
                        en_data = res_en.json()
                        if len(en_data) > 12 and en_data[12]:
                            en_defs = [s[0] for e in en_data[12] if len(e) > 1 and e[1] for s in e[1] if s[0]]
                            if en_defs:
                                joined_en = "; ".join(en_defs[:2])
                                final_res = requests.get(f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={lang}&dt=t&q={joined_en}", timeout=3)
                                if final_res.ok:
                                    trans_back = "".join([p[0] for p in final_res.json()[0] if p[0]])
                                    return jsonify({"answer": f" 📖 Definition ({english_word}): " + trans_back})
        except Exception as e:
            print("Advanced Dict Fallback Error:", e)

        # 3. Last Resort: Use sentence context if no dictionary definition found
        matches = []
        if sentences:
            for s in sentences:
                if re.search(rf"\b{word}\b" if lang == "en" else word, s.lower()):
                    matches.append(s)
        
        if matches:
            matches.sort(key=lambda x: abs(60 - len(x)))
            return jsonify({"answer": f"💡 AI Context: {matches[0]}"})

        return jsonify({"answer": "I couldn't find a specific meaning for this word. Try a simpler word or check the context."})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/ask", methods=["POST"])
def ask_assistant():
    """Smart AI Assistant endpoint for conversational book queries."""
    try:
        data = request.get_json()
        query = data.get("query", "").lower()
        book_id = data.get("book_id")
        context_text = data.get("context", "")
        
        if not book_id and not context_text:
            return jsonify({"answer": "I need some context from a book to help you."})

        # 1. Retrieve book text if not provided in context
        if not context_text and book_id:
            sentences = get_book_sentences(book_id)
        else:
            # Tokenize context
            sentences = re.split(r'(?<=[.!?])\s+', context_text)
            sentences = [s.strip() for s in sentences if len(s.strip()) > 5]

        # 2. Intent Detection (Simple but effective for internal use)
        if "summarize" in query:
            # Summary intent: take a cluster of sentences
            summary_limit = 5
            return jsonify({"answer": f"📝 Here is a quick summary: {' '.join(sentences[:summary_limit])}..."})
            
        if "explain" in query or "meaning" in query or "what" in query:
            # Explanation intent: Find most relevant sentences
            keywords = [w for w in query.split() if len(w) > 3]
            best_match = ""
            max_hits = 0
            for s in sentences:
                hits = sum(1 for k in keywords if k in s.lower())
                if hits > max_hits:
                    max_hits = hits
                    best_match = s
            
            if best_match:
                return jsonify({"answer": f"💡 AI Explanation: {best_match}"})
            else:
                return jsonify({"answer": "I found something relevant: " + sentences[0]})

        # 3. Fallback to existing search logic for specific facts
        return jsonify({"answer": f"I'm looking into that! This part of the book mentions: {sentences[0]}"})

    except Exception as e:
        print(f"AI Assistant Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/explain_image", methods=["POST"])
def explain_image():
    import traceback
    import urllib.parse
    import io
    try:
        data = request.get_json()
        # Support both 'src' (legacy/original) and 'image' (new frontend logic)
        src = data.get("src", "") or data.get("image", "")
        context = data.get("context", "")
        
        if not src:
            return jsonify({"explanation": "No image provided."})

        # Load the image depending on its source
        img_np = None
        
        if src.startswith("data:image"):
            import base64
            # Extract base64 part safely
            if "," in src:
                encoded_data = src.split(",", 1)[1]
                # The frontend might pass URL-encoded data (like %0A for newlines)
                # Fix common URL-encoding issues where '+' becomes ' '
                encoded_data = encoded_data.replace(' ', '+')
                # Fix padding if missing
                encoded_data += "=" * ((4 - len(encoded_data) % 4) % 4)
                
                try:
                    raw = base64.b64decode(encoded_data)
                    # First try OpenCV because it's fast
                    nparr = np.frombuffer(raw, np.uint8)
                    img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    
                    # Fallback to PIL (handles more formats like GIF, some JPX, TIFF)
                    if img_np is None:
                        from PIL import Image
                        pil_img = Image.open(io.BytesIO(raw)).convert("RGB")
                        img_np = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
                except Exception as e:
                    print("Base64 Decode or Image conversion failed:", e)
                        
        elif "/uploads/" in src:
            filename = src.split("/uploads/")[-1]
            filename = filename.split("?")[0].split("#")[0]
            filepath = os.path.join(UPLOAD_FOLDER, urllib.parse.unquote(filename))
            img_np = cv2.imread(filepath)
            
        elif src.startswith("http"):
            import urllib.request
            try:
                req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    raw = resp.read()
                    nparr = np.frombuffer(raw, np.uint8)
                    img_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if img_np is None:
                        from PIL import Image
                        pil_img = Image.open(io.BytesIO(raw)).convert("RGB")
                        img_np = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            except Exception as e:
                print("HTTP Image fetch failed:", e)
            
        if img_np is None:
            return jsonify({"explanation": f"Could not read or locate the image. [Format unsupported or unreadable]\nSource preview: {src[:80]}..."})
            
        explanation = ""
        
        # --- Hybrid Explanation Strategy ---
        explanation = ""
        ocr_text = ""
        
        # 1. Run OCR (Tesseract) to find labels/data
        try:
            gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)
            # Denoise and sharpen for better OCR on small/blurry text
            gray = cv2.GaussianBlur(gray, (0,0), 3)
            gray = cv2.addWeighted(gray, 1.5, gray, -0.5, 0)
            
            ocr_text_raw = pytesseract.image_to_string(gray, config='--oem 3 --psm 6').strip()
            
            # CLEAN OCR: Remove common "garbage" characters detected in low-res or stylized text
            ocr_text = re.sub(r'[^a-zA-Z0-9\s.,!?:;@&()\"\'-]', '', ocr_text_raw)
            ocr_text = re.sub(r'\s+', ' ', ocr_text).strip()
            # If ocr_text became empty after aggressive cleaning, use raw but trimmed if it has alphabets
            if not ocr_text and re.search(r'[a-zA-Z]{3,}', ocr_text_raw):
                ocr_text = ocr_text_raw.strip()
        except:
            pass

        # 2. Run AI Captioning
        ai_caption = ""
        try:
            from transformers import pipeline
            from PIL import Image
            img_pil = Image.fromarray(cv2.cvtColor(img_np, cv2.COLOR_BGR2RGB))
            
            if not hasattr(app, "image_captioner"):
                try:
                    # USE A LIGHTER MODEL: ViT-GPT2 is ~3x smaller/faster than BLIP on CPU
                    app.image_captioner = pipeline("image-to-text", model="nlp-connect/vit-gpt2-image-captioning", device=-1)
                except:
                    app.image_captioner = None
                    
            if app.image_captioner:
                # Optimized for speed
                res = app.image_captioner(img_pil, max_new_tokens=25)
                if res and len(res) > 0 and 'generated_text' in res[0]:
                    ai_caption = res[0]['generated_text'].capitalize().strip()
                
            # --- Fallback: Advanced Heuristics if AI fails ---
            if not ai_caption:
                # 1. Face Detection (Detect if it's a person/baby)
                gray = cv2.cvtColor(img_np, cv2.COLOR_BGR2GRAY)
                face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
                faces = face_cascade.detectMultiScale(gray, 1.3, 5)
                if len(faces) > 0:
                    ai_caption = "A close-up of a person's face"
                    if "BABY" in (context or "").upper() or "LITTLE" in (context or "").upper():
                        ai_caption = "A visual of a small baby"
                
                # 2. Contextual Inference based on OCR keywords
                if "HARRY POTTER" in ocr_text.upper() or "WHO LIVED" in ocr_text.upper():
                    if len(faces) > 0 or "BABY" in (context or "").upper():
                        ai_caption = "An illustration of baby Harry Potter (The Boy Who Lived)"
                    else:
                        ai_caption = "An illustration for the Harry Potter series"

        except Exception as ai_e:
            print("AI Captioning failed:", ai_e)

        # 3. Analyze and Combine (Detailed Visual Logic)
        is_diagram = any(kw in (ocr_text + ai_caption).lower() for kw in ["diagram", "chart", "graph", "figure", "fig.", "illustration", "table", "cycle", "process", "thank you", "slide", "presentation"])
        
        # Priority 1: Visual Scene Description
        if ai_caption:
            visual_desc = f"🖼️ AI VISUAL SUMMARY: {ai_caption}."
            
            # Enrich with context to explain "what it belongs to"
            if context:
                visual_desc += f"\n\n📚 VIEWPOINT: This appears in a passage discussing: '{context[:150]}...'."
            
            if ocr_text:
                if is_diagram:
                    explanation = f"{visual_desc}\n\n🔍 KEY DETAILS: The image contains text which points to: \"{ocr_text[:300]}...\""
                else:
                    explanation = f"{visual_desc}\n\n📝 EMBEDDED TEXT: {ocr_text[:120]}..."
            else:
                explanation = visual_desc
                
        # Priority 2: Text-only images or charts where AI failed
        elif ocr_text:
            cleaned_context = re.sub(r'[:;{}[]]', '', context[:100]).strip()
            explanation = f"🔍 DOCUMENT SNAPSHOT: Based on the visual data, this contains text elements including: \"{ocr_text[:400]}...\"\n\n"
            if cleaned_context:
                explanation += f"🚀 INTEGRATION: This likely serves as a visual reference for: '{cleaned_context}'."
            else:
                explanation += "Note: Vision AI is starting up or unavailable, using high-precision OCR for internal details."
                
        # Priority 3: Fallback to Context only
        elif context:
            explanation = f"🔍 CONTEXTUAL CLUE: I can't identify the visual details clearly, but based on the book context nearby, this image illustrates concepts relevant to: \"{context[:200]}...\""
            
        else:
            explanation = "This image appears to be an illustration or decorative element. Try highlighting surrounding text to help me understand its theme!"

        return jsonify({"explanation": explanation})
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to analyze the image."}), 500


@app.route("/analyze_emotion", methods=["POST"])
def analyze_emotion():
    try:
        data = request.get_json()
        text = data.get("text", "").lower()
        if not text:
            return jsonify({"emotion": "neutral"})

        # 1. Rule-based Fast Emotion Mapping (Very stable and instant)
        emotion_rules = {
            "happy": ["happy", "joy", "wonderful", "delighted", "smile", "laugh", "cheerful", "magic", "sunshine", "hope", "love", "friend", "proud", "achieved"],
            "sad": ["sad", "cried", "tear", "unhappy", "lost", "death", "lonely", "darkness", "misery", "sorrow", "alone", "grave", "hurt", "pain", "hopeless"],
            "angry": ["angry", "rage", "hate", "fight", "shout", "mad", "fury", "annoyed", "bitter", "punch", "strike", "vengeance"],
            "fear": ["fear", "scared", "terrified", "ghost", "dark", "shadow", "unknown", "scary", "shiver", "beast", "creepy", "dangerous", "nervous"],
            "excited": ["excited", "amazing", "wow", "unbelievable", "can't wait", "next", "incredible", "thrilled", "shocked", "surprised"],
            "peaceful": ["peaceful", "calm", "relax", "quiet", "still", "serene", "comfort", "harmony", "rest", "tired"]
        }

        found_counts = {emotion: sum(1 for word in words if word in text) for emotion, words in emotion_rules.items()}
        max_emotion = max(found_counts, key=found_counts.get)
        
        if found_counts[max_emotion] > 0:
            return jsonify({"emotion": max_emotion})

        # 2. AI Fallback (using Transformers if internet/memory allows)
        try:
            analyzer = get_sentiment_analyzer()
            if analyzer:
                res = analyzer(text[:512])[0]
                if res['label'] == 'POSITIVE':
                    return jsonify({"emotion": "happy"})
                else:
                    return jsonify({"emotion": "fear"}) # Fear/Suspense is a good "negative" mood for books
            return jsonify({"emotion": "neutral"})
        except:
            return jsonify({"emotion": "neutral"})

    except Exception as e:
        print("Emotion analysis error:", e)
        return jsonify({"emotion": "neutral"})


if __name__ == "__main__":
    app.run(debug=True)