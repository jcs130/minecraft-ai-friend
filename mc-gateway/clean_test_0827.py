#!/usr/bin/env python3
"""2026-08-27 bind收口 E2E 测试数据清理（在 shadow-gateway 容器内执行）。
清理对象：本轮 + 上一轮（老代码误注册）的全部测试账号，双库齐清：
  gateway.db: users/profiles/sessions/companions/login_attempts/audit_log
  world.db  : guardian_angels
Goddess 等真实账号不受影响；结尾自检 leftover 与存量对照。"""
import sqlite3

GDB = "/data/gateway/gateway.db"
WDB = "/data/world.db"
NAMES = ("xz_reg_0827", "xz_rb_0827", "averylongname17", "averylongname18",
         "averylongname17x", "averylongnamex17z", "ab", "user-name-ok", "cd")
BOTS = ("sys_xz_reg_0827", "sys_xz_rb_0827")
PH = ",".join("?" * len(NAMES))
BH = ",".join("?" * len(BOTS))

g = sqlite3.connect(GDB)
g.row_factory = sqlite3.Row
before = g.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
ids = [r["id"] for r in g.execute(f"SELECT id FROM users WHERE username IN ({PH})", NAMES)]
print("target user ids:", ids)
IH = ",".join("?" * len(ids)) if ids else "NULL"

for table in ("sessions", "profiles", "companions", "login_attempts"):
    try:
        cur = g.execute(f"DELETE FROM {table} WHERE user_id IN ({IH})", ids)
        print(f"{table}: -{cur.rowcount}")
    except sqlite3.OperationalError as e:
        print(f"{table}: skip ({e})")

# audit_log：本主体发出/指向本主体的记录一并清（与 xz_demo_0826 先例一致）
try:
    cur = g.execute(f"DELETE FROM audit_log WHERE actor_id IN ({IH}) "
                    f"OR (object_id IN ({IH}) AND object_type IN ('user','guardian'))",
                    ids + ids)
    print(f"audit_log: -{cur.rowcount}")
except sqlite3.OperationalError as e:
    print(f"audit_log: skip ({e})")

cur = g.execute(f"DELETE FROM users WHERE id IN ({IH})", ids)
print(f"users: -{cur.rowcount}")
g.commit()

w = sqlite3.connect(WDB)
cur = w.execute(f"DELETE FROM guardian_angels WHERE bot_username IN ({BH})", BOTS)
print(f"guardian_angels: -{cur.rowcount}")
w.commit()

# 自检
left_g = g.execute(f"SELECT COUNT(*) c FROM users WHERE username IN ({PH})", NAMES).fetchone()["c"]
left_w = w.execute(f"SELECT COUNT(*) c FROM guardian_angels WHERE bot_username IN ({BH})", BOTS).fetchone()["c"]
after = g.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
angels = w.execute("SELECT COUNT(*) c FROM guardian_angels").fetchone()["c"]
print(f"leftover: users={left_g} angels={left_w} | total users {before}->{after}, angels now={angels}")
print("intact sample:", [r["username"] for r in g.execute(
    "SELECT username FROM users WHERE username IN ('Goddess','Kirito','Naruto','Edward') ORDER BY username")])
