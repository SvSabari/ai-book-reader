import sqlite3
from werkzeug.security import generate_password_hash

db_path = 'database.db'
new_password = '123456'
username = 'mells'

if True:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        new_hash = generate_password_hash(new_password)
        cursor.execute("UPDATE users SET password = ? WHERE username = ?", (new_hash, username))
        conn.commit()
        if cursor.rowcount > 0:
            print(f"✅ Success: Password for '{username}' has been reset to '{new_password}'.")
        else:
            print(f"❌ Error: User '{username}' not found.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()
