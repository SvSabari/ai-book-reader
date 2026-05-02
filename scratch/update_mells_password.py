import sqlite3
from werkzeug.security import generate_password_hash

c = sqlite3.connect("database.db")
cur = c.cursor()
hashed = generate_password_hash("123456")
cur.execute("UPDATE users SET password=? WHERE username=?", (hashed, "mells"))
c.commit()
print("Updated password for 'mells' to '123456'")
c.close()
