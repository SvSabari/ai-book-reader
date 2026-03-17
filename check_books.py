import sqlite3
import os

DB = "database.db"
def check_db():
    if not os.path.exists(DB):
        print(f"Database {DB} not found!")
        return
    
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT * FROM books")
    rows = cur.fetchall()
    print(f"Found {len(rows)} books in database:")
    for row in rows:
        print(row)
    conn.close()

if __name__ == "__main__":
    check_db()
