#!/usr/bin/env python3
"""校验清理结果 + 补清 login_attempts（该表无 user_id 列）。"""
import sqlite3

g = sqlite3.connect("/data/gateway/gateway.db")
w = sqlite3.connect("/data/world.db")
names = ("xz_reg_0827", "xz_rb_0827", "averylongname17", "averylongname18",
         "averylongname17x", "averylongnamex17z", "ab", "user-name-ok", "cd")
ph = ",".join("?" * len(names))

cols = [r[1] for r in g.execute("PRAGMA table_info(login_attempts)")]
print("login_attempts cols:", cols)
col = "username" if "username" in cols else ("identifier" if "identifier" in cols else None)
if col:
    cur = g.execute(f"DELETE FROM login_attempts WHERE {col} IN ({ph})", names)
    g.commit()
    print("login_attempts: -" + str(cur.rowcount))

print("leftover users:", g.execute(
    f"SELECT COUNT(*) FROM users WHERE username IN ({ph})", names).fetchone()[0])
print("leftover angels:", w.execute(
    "SELECT COUNT(*) FROM guardian_angels WHERE bot_username LIKE 'sys_xz%'").fetchone()[0])
print("total users:", g.execute("SELECT COUNT(*) FROM users").fetchone()[0],
      "| angels:", w.execute("SELECT COUNT(*) FROM guardian_angels").fetchone()[0])
print("intact:", [r[0] for r in g.execute("SELECT username FROM users ORDER BY username")])
