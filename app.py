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

app = Flask(__name__)

UPLOAD_FOLDER = "uploads"
EXTRACTED_FOLDER = "extracted"
DB = "database.db"

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(EXTRACTED_FOLDER, exist_ok=True)

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
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

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

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)[1]
    text = pytesseract.image_to_string(gray, config='--oem 3 --psm 6')
    return text.strip()


def ocr_embedded_images(html):
    soup = BeautifulSoup(html, "html.parser")
    imgs = soup.find_all("img")
    
    def process_img(img):
        src = img.get("src")
        text = ""
        if src and src.startswith("data:image/"):
            try:
                header, encoded = src.split(",", 1)
                data = base64.b64decode(encoded)
                nparr = np.frombuffer(data, np.uint8)
                img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img_cv is not None:
                     h, w = img_cv.shape[:2]
                     if h < 20 or w < 20:
                         return img, ""
                     gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
                     gray = cv2.threshold(gray, 150, 255, cv2.THRESH_BINARY)[1]
                     text = pytesseract.image_to_string(gray, config='--oem 3 --psm 6').strip()
            except Exception as e:
                pass
        return img, text

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(process_img, imgs))

    for img, text in results:
        if text:
            ocr_span = soup.new_tag("span")
            ocr_span["style"] = "font-size: 1px; color: rgba(0,0,0,0.01); display: inline-block; width: 1px; height: 1px; overflow: hidden;"
            ocr_span.string = text
            img.insert_after(ocr_span)

    return str(soup)


def extract_pdf_html(file_path):
    html = "<div style='background: white; padding: 40px; font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; color: black;'>"
    pdf = fitz.open(file_path)
    import re
    for page_num in range(len(pdf)):
        page = pdf[page_num]
        raw_html = page.get_text("html")
        soup = BeautifulSoup(raw_html, "html.parser")
        
        for tag in soup.find_all(True):
            if tag.has_attr("style"):
                style_str = tag["style"]
                # Safely scrub absolute positioning rules without destroying the HTML tag itself
                style_str = re.sub(r'(?i)(position|top|left|right|bottom|width|height):\s*[^;]+;?', '', style_str)
                tag["style"] = style_str
        
        html += str(soup)
    pdf.close()
    html += "</div>"
    return html


def extract_docx_html(file_path):
    with open(file_path, "rb") as docx_file:
        result = mammoth.convert_to_html(docx_file)
        html = result.value
    return f"<div style='background: white; padding: 40px; font-family: Calibri, sans-serif; line-height: 1.5; color: black; max-width: 800px; margin: 0 auto;'>{html}</div>"


def extract_epub_html(file_path):
    book = epub.read_epub(file_path)
    
    images = {}
    for item in book.get_items():
        if item.get_type() == ITEM_IMAGE:
            images[item.get_name().split('/')[-1]] = item.get_content()

    html_content = "<div style='background: white; padding: 40px; font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; color: black;'>"
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
    html = "<div style='background: #f0f0f0; padding: 20px; font-family: sans-serif;'>"
    for i, slide in enumerate(prs.slides):
        html += f"<div style='background: white; border: 1px solid #ccc; margin-bottom: 20px; padding: 40px; aspect-ratio: 16/9; position: relative;'><h3 style='color: #888; font-size: 14px;'>Slide {i+1}</h3>"
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
        return f"<div style='background: white; padding: 40px; font-family: monospace; line-height: 1.5; color: black;'>{text}</div>"


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

    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)

    extracted_html = extract_book_html(filepath)

    extracted_filename = file.filename + ".html"
    extracted_path = os.path.join(EXTRACTED_FOLDER, extracted_filename)

    with open(extracted_path, "w", encoding="utf-8") as f:
        f.write(extracted_html)

    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "INSERT INTO books(name, path, extracted_path) VALUES (?, ?, ?)",
        (file.filename, filepath, extracted_path)
    )

    conn.commit()
    conn.close()

    return "Uploaded successfully"


@app.route("/books")
def books():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name, uploaded_at FROM books ORDER BY id DESC")
    data = cur.fetchall()
    conn.close()
    return jsonify(data)


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
        text = data.get("text", "")
        
        if not question or not text:
            return jsonify({"answer": "Please provide a question and ensure a book is open."})
            
        import re
        import math
        from collections import defaultdict
        
        # 1. Tokenize book into sentences
        sentences = re.split(r'(?<=[.!?])\s+', text)
        if len(sentences) == 0:
            return jsonify({"answer": "Could not read book text."})
            
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

@app.route("/tts")
def stream_tts():
    text = request.args.get("text", "")
    lang = request.args.get("lang", "en")
    if not text:
        return "No text provided", 400
    try:
        from gtts import gTTS
        import io
        tts_obj = gTTS(text=text, lang=lang)
        fp = io.BytesIO()
        tts_obj.write_to_fp(fp)
        fp.seek(0)
        return send_file(fp, mimetype="audio/mpeg")
    except Exception as e:
        print(f"TTS Error: {e}")
        return str(e), 500

if __name__ == "__main__":
    app.run(debug=True)