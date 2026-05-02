import sqlite3
c = sqlite3.connect("database.db")
cur = c.cursor()
cur.execute("SELECT id, username, email, full_name FROM users")
rows = cur.fetchall()
for r in rows:
    print(f"ID: {r[0]} | Username: {r[1]} | Email: {r[2]} | Full Name: {r[3]}")
c.close()
