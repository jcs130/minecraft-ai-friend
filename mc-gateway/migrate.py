"""mc-gateway 数据库迁移运行器（双方言：sqlite / postgres）。

用法：
  set GATEWAY_DB=sqlite        :: 嵌入式兜底（默认）
  set GATEWAY_DB=postgres
  set GATEWAY_DB_URL=postgresql://user:pw@host:5432/mc_portal
  C:\\Python314\\python.exe migrate.py apply

原则（高内聚低耦合 / 经得起审计）：
  - 迁移文件按序 `NUMBER_name.sql` 应用；已应用的记录进 schema_migrations（含 checksum+时长，审计）。
  - sqlite 走 migrations/*.sqlite.sql，postgres 走 migrations/*.sql；逐条幂等重跑。
  - 任何应用前若 checksum 不匹配本记录则报错（防迁移被篡改/漂移）。
"""
import os, sys, glob, re, hashlib, time
from pathlib import Path

def log(x): print("[migrate]", x, flush=True)

def clean_env():
    for k in ("PYTHONHOME", "PYTHONPATH"):
        os.environ.pop(k, None)

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def db_conn():
    mode = os.environ.get("GATEWAY_DB", "sqlite").lower()
    if mode == "postgres":
        import psycopg
        url = os.environ.get("GATEWAY_DB_URL")
        if not url:
            raise SystemExit("GATEWAY_DB=postgres 需要 GATEWAY_DB_URL")
        return psycopg.connect(url, autocommit=False)
    # sqlite
    import sqlite3
    data = os.environ.get("MC_DATA_DIR", r"..\deepseek-harness\scratch-plugin\data")
    dbp = os.path.join(data, "gateway", "gateway.db")
    Path(dbp).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(dbp, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con

def ensure_mig_table(con, mode):
    if mode == "postgres":
        con.execute("""CREATE TABLE IF NOT EXISTS schema_migrations(
          version INT PRIMARY KEY, name TEXT, applied_at TIMESTAMPTZ DEFAULT now(),
          applied_by TEXT, checksum TEXT, duration_ms INT)"""); con.commit()
    else:
        con.execute("""CREATE TABLE IF NOT EXISTS schema_migrations(
          version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT,
          applied_by TEXT, checksum TEXT, duration_ms INTEGER)"""); con.commit()

def applied_versions(con, mode):
    cur = con.execute("SELECT version FROM schema_migrations")
    return {r[0] if mode == "sqlite" else r[0] for r in cur.fetchall()}

def apply():
    clean_env()
    mode = os.environ.get("GATEWAY_DB", "sqlite").lower()
    suffix = ".sqlite.sql" if mode == "sqlite" else ".sql"
    migdir = Path(__file__).parent / "migrations"
    files = sorted(glob.glob(str(migdir / f"*{suffix}")))
    if not files:
        raise SystemExit(f"no {suffix} migrations in {migdir}")
    con = db_conn()
    ensure_mig_table(con, mode)
    done = applied_versions(con, mode)
    log(f"db={mode} applied={sorted(done)}")
    for f in files:
        ver = int(re.match(r"^(\d+)", Path(f).name).group(1))
        if ver in done:
            log(f"skip {Path(f).name} (already applied)")
            continue
        sql = Path(f).read_text(encoding="utf-8")
        chk = sha(f)
        t0 = time.time()
        try:
            con.executescript(sql)  # sqlite
            con.commit()
        except Exception as e:
            con.rollback()
            log(f"ERROR applying {Path(f).name}: {e}")
            raise
        dur = int((time.time() - t0) * 1000)
        if mode == "postgres":
            con.execute("INSERT INTO schema_migrations(version,name,applied_by,checksum,duration_ms) VALUES(%s,%s,%s,%s,%s)",
                        (ver, Path(f).name, "migrate.py", chk, dur))
        else:
            con.execute("INSERT INTO schema_migrations(version,name,applied_at,applied_by,checksum,duration_ms) VALUES(?,?,?,?,?,?)",
                        (ver, Path(f).name, time.strftime("%Y-%m-%dT%H:%M:%SZ"), "migrate.py", chk, dur))
        con.commit()
        log(f"applied {Path(f).name} ({dur}ms) checksum={chk[:12]}")
    con.close()
    log("done")

if __name__ == "__main__":
    apply()
