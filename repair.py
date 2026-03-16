import sqlite3
import os
from app import extract_book_html, EXTRACTED_FOLDER

def repair():
    conn = sqlite3.connect('database.db')
    cur = conn.cursor()
    cur.execute('SELECT id, path, extracted_path FROM books')
    rows = cur.fetchall()

    for row_id, file_path, old_ext_path in rows:
        if not os.path.exists(file_path):
            print(f"Skipping {file_path}, does not exist.")
            continue
        
        try:
            extracted_html = extract_book_html(file_path)
            filename = os.path.basename(file_path)
            new_extracted_filename = filename + ".html"
            new_extracted_path = os.path.join(EXTRACTED_FOLDER, new_extracted_filename)
            
            with open(new_extracted_path, "w", encoding="utf-8") as f:
                f.write(extracted_html)
                
            cur.execute('UPDATE books SET extracted_path = ? WHERE id = ?', (new_extracted_path, row_id))
            print(f"Repaired {file_path} -> {new_extracted_path}")
            
            # Clean up old extraction if it's different and exists
            if os.path.exists(old_ext_path) and os.path.normpath(old_ext_path) != os.path.normpath(new_extracted_path):
                try: 
                    os.remove(old_ext_path)
                    print(f"Deleted old extraction {old_ext_path}")
                except Exception as e: 
                    print(f"Failed to delete {old_ext_path}: {e}")
        except Exception as e:
            print(f"Error repairing {file_path}: {e}")

    conn.commit()
    conn.close()
    print("Repair complete.")

if __name__ == '__main__':
    repair()
