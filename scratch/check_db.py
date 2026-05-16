import sqlite3
import os

DB = "database.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()
cur.execute("SELECT id, name, path, extracted_path FROM books LIMIT 5")
rows = cur.fetchall()
for row in rows:
    print(row)
conn.close()
