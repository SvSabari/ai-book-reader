import sqlite3
import os
from app import extract_book_html, EXTRACTED_FOLDER

def repair():
    conn = sqlite3.connect('database.db')
    cur = conn.cursor()
    cur.execute('SELECT id, path, extracted_path, status FROM books')
    rows = cur.fetchall()

    for row_id, file_path, old_ext_path, status in rows:
        needs_repair = False
        if status != 'ready':
            needs_repair = True
            print(f"Book {row_id} has status '{status}'. Repairing...")
        elif not os.path.exists(old_ext_path):
            needs_repair = True
            print(f"Extracted file for {row_id} is missing. Repairing...")
            
        if not needs_repair:
            continue

        if not os.path.exists(file_path):
            print(f"Skipping {file_path}, source file does not exist.")
            cur.execute("UPDATE books SET status='error' WHERE id=?", (row_id,))
            continue
        
        try:
            print(f"Extracting {file_path}...")
            extracted_html = extract_book_html(file_path)
            
            with open(old_ext_path, "w", encoding="utf-8") as f:
                f.write(extracted_html)
                
            cur.execute("UPDATE books SET status='ready' WHERE id=?", (row_id,))
            conn.commit()
            print(f"✅ Repaired {file_path} -> {old_ext_path}")
            
        except Exception as e:
            print(f"❌ Error repairing {file_path}: {e}")
            cur.execute("UPDATE books SET status='error' WHERE id=?", (row_id,))
            conn.commit()

    conn.close()
    print("Repair complete.")

if __name__ == '__main__':
    repair()
