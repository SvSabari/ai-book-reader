import sqlite3
import os

db_path = 'database.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, username, password FROM users")
        users = cursor.fetchall()
        for user in users:
            print(f"ID: {user[0]} | Username: {user[1]} | Password: {user[2]}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        conn.close()
else:
    print("Database not found.")
