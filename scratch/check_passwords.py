import sqlite3
from werkzeug.security import check_password_hash

c = sqlite3.connect("database.db")
cur = c.cursor()
cur.execute("SELECT username, password FROM users")
rows = cur.fetchall()
for r in rows:
    is_123456 = check_password_hash(r[1], "123456")
    print(f"Username: {r[0]} | Correct for '123456': {is_123456}")
c.close()
