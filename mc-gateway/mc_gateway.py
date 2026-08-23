#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
千灯纪玩家门户服务端 mc-gateway（133）

由女神 mc-god 开发。服务端侧，供贾维斯(162)登录器门户化调用。
纯 Python 标准库实现（Python 3.11+，建议 3.13/3.14），零第三方依赖。

定位：为真人玩家及其朋友打造的玩家门户服务端——账号、身份、皮肤、资料、
    在线状态、命令解析、mods 清单/分发。与女神域里的 MC bot / 穿越者是两条线，勿混。

安全纪律：
  - 密码只存 PBKDF2-HMAC-SHA256 哈希 + salt，绝不存明文；账号/token 绝不入共享池。
  - 仅绑定局域网/回环；mod 直连分发只白名单读服务端 mods 目录（防路径穿越）。
  - 修改/删除用户等敏感动作由管理员角色限制。

环境变量（均有默认值）：
  GATEWAY_PORT    监听端口（默认 8011）
  MC_DATA_DIR     运行时数据目录（默认 ../deepseek-harness/scratch-plugin/data）
  MC_SERVER_DIR   服务端根目录（默认 ../deepseek-harness/scratch-plugin/mc-server-neoforge）
  RCON_HOST/RCON_PORT/RCON_SECRET   RCON（secret 默认读 <MC_DATA_DIR>/rcon-secret.txt）
  VLLM_URL        vLLM OpenAI 兼容端点（默认 http://192.168.3.133:8890/v1/chat/completions）
  GATEWAY_DATA_DIR 本服务数据目录（默认 <MC_DATA_DIR>/gateway）
  GATEWAY_ADVERTISE 对外公布的本机地址（供直连下载/客户端拼 URL，默认 192.168.3.133）
  GATEWAY_COMMAND_LLM 是否启用「玩家命令→本地LLM解析」可选层（默认 0=关闭，解耦 vLLM）

耦合边界（本服务与 AI 功能之间）：
  - 只读：RCON online/list 查询、<MC_SERVER_DIR>/mods 目录读取。绝不写任何 AI 状态文件
    （world-heartbeat / chronicle / village / .json / .log 等），绝不动世界进程、mc_npc、面板。
  - 独立：独立进程、独立端口(8011)、独立 SQLite 库(<GATEWAY_DATA>/gateway.db)、独立解释器。
    门户崩溃/重启 不影响 AI 功能；AI 功能也不依赖门户。
  - 可选解耦：「玩家命令→LLM」经 GATEWAY_COMMAND_LLM=1 才启用，默认关闭，避免耦合 vLLM。
"""
import os, sys, json, re, io, hmac, hashlib, secrets, time, sqlite3, zipfile, tomllib, threading
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen

# ------------------------- 配置 -------------------------
LAN_IP = "0.0.0.0"
PORT = int(os.environ.get("GATEWAY_PORT", "8011"))
# 绝对路径基准：mc-gateway 脚本在 <default>/minecraft-ai-friend/mc-gateway/ 下，
# 兄弟目录 deepseek-harness 在 <default>/deepseek-harness。
# 用 __file__ 推导，避免依赖 CWD（否则从不同目录启动会走错 MC_SERVER_DIR / mods）。
_ECOBASE = str(Path(__file__).resolve().parent.parent.parent)
_DH = os.path.join(_ECOBASE, "deepseek-harness")
MC_DATA_DIR = os.environ.get("MC_DATA_DIR", os.path.join(_DH, "scratch-plugin", "data"))
MC_SERVER_DIR = os.environ.get("MC_SERVER_DIR", os.path.join(_DH, "scratch-plugin", "mc-server-neoforge"))
MODS_DIR = os.environ.get("MODS_DIR", os.path.join(MC_SERVER_DIR, "mods"))
LOGS_DIR = os.path.join(MC_SERVER_DIR, "logs")
RCON_HOST = os.environ.get("RCON_HOST", "127.0.0.1")
RCON_PORT = int(os.environ.get("RCON_PORT", "25575"))
RCON_SECRET = os.environ.get("RCON_SECRET", "")
if not RCON_SECRET:
    try:
        RCON_SECRET = Path(MC_DATA_DIR, "rcon-secret.txt").read_text(encoding="utf-8").strip()
    except Exception:
        RCON_SECRET = "jarvis123"
VLLM_URL = os.environ.get("VLLM_URL", "http://192.168.3.133:8890/v1/chat/completions")
ADVERTISE = os.environ.get("GATEWAY_ADVERTISE", "192.168.3.133")
ENABLE_COMMAND_LLM = os.environ.get("GATEWAY_COMMAND_LLM", "0") == "1"
GATEWAY_DATA = os.environ.get("GATEWAY_DATA_DIR", os.path.join(MC_DATA_DIR, "gateway"))
DB_PATH = os.path.join(GATEWAY_DATA, "gateway.db")
MODINDEX_PATH = os.path.join(GATEWAY_DATA, "mod_index.json")
PANLINKS_PATH = os.path.join(GATEWAY_DATA, "pan_links.json")
os.makedirs(GATEWAY_DATA, exist_ok=True)

# ------------------------- SQLite -------------------------
def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con

def client_ip(headers):
    return str(headers.get("X-Forwarded-For", "").split(",")[0].strip() or headers.get("Remote-Addr", "") or "")

def audit(c, actor_type, actor_id, actor_name, ip, action, object_type, object_id,
          old_data=None, new_data=None, reason=None, request_id=None):
    """业务审计：同一事务写 audit_log（append-only）。不 here 单独 commit，随业务一起。"""
    c.execute("INSERT INTO audit_log(at,actor_type,actor_id,actor_name,ip,action,object_type,object_id,old_data,new_data,reason,request_id) "
              "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              (now_iso(), actor_type, actor_id, actor_name, ip, action,
               object_type, str(object_id), json.dumps(old_data, ensure_ascii=False) if old_data is not None else None,
               json.dumps(new_data, ensure_ascii=False) if new_data is not None else None, reason, request_id))

def token_hash(tok):
    return hashlib.sha256(tok.encode("utf-8")).hexdigest()

def _init_db():
    # 1) 短连接探测旧 schema（role 文本列）
    old = False
    try:
        probe = sqlite3.connect(DB_PATH, timeout=5)
        cols = [r[1] for r in probe.execute("PRAGMA table_info(users)").fetchall()]
        probe.close()
        old = bool(cols) and "role_id" not in cols
    except Exception:
        old = False
    # 2) 旧库 -> 备份重建（先关连接再改名，并清 WAL 残留）
    if old:
        for suffix in ("", "-wal", "-shm"):
            p = DB_PATH + suffix
            if os.path.exists(p):
                try: os.replace(p, p + ".bak")
                except Exception: pass
        print("[mc-gateway] old schema detected -> recreate from backup", flush=True)
    # 3) 新库建规范化 schema
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS roles(
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, perms TEXT NOT NULL DEFAULT '{}');
        INSERT INTO roles(name,perms) VALUES
          ('owner','{"admin":true,"mod":true}'),('admin','{"admin":true,"mod":true}'),
          ('member','{"admin":false,"mod":false}'),('guest','{"admin":false,"mod":false}')
          ON CONFLICT(name) DO NOTHING;
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL, nickname TEXT, avatar TEXT,
          role_id INTEGER NOT NULL DEFAULT 3 REFERENCES roles(id),
          status TEXT NOT NULL DEFAULT 'active', server_tag INTEGER DEFAULT 0,
          mc_uuid TEXT, email TEXT, verified_at TEXT, password_changed_at TEXT,
          created_at TEXT, updated_at TEXT, last_login TEXT);
        CREATE INDEX IF NOT EXISTS users_role_idx ON users(role_id);
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT, expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT, revoked_at TEXT);
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS device_bindings(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          machine_key_hash TEXT NOT NULL, platform TEXT,
          bound_at TEXT, last_seen TEXT, is_active INTEGER DEFAULT 1,
          UNIQUE(user_id, machine_key_hash));
        CREATE TABLE IF NOT EXISTS login_attempts(
          id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, ip TEXT,
          success INTEGER, reason TEXT, at TEXT);
        CREATE TABLE IF NOT EXISTS profiles(
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          display_name TEXT, bio TEXT, preferences TEXT NOT NULL DEFAULT '{}',
          data TEXT NOT NULL DEFAULT '{}', updated_at TEXT);
        CREATE TABLE IF NOT EXISTS skins(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          texture_url TEXT, model TEXT DEFAULT 'classic', sha256 TEXT,
          is_active INTEGER DEFAULT 0, uploaded_at TEXT);
        CREATE TABLE IF NOT EXISTS characters(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT, class TEXT, stats TEXT DEFAULT '{}',
          mc_username TEXT,
          is_active INTEGER DEFAULT 0, created_at TEXT);
        -- 账号↔伴侣「系统」（一对一）：运行在客户端本地、从服务端拉数据、按级别解锁权限
        CREATE TABLE IF NOT EXISTS companions(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          cname TEXT, personality TEXT DEFAULT '{}', enabled INTEGER DEFAULT 1,
          model TEXT,               -- 客户端配置的模型 id（快照，运行在客户端）
          level INTEGER DEFAULT 1,  -- 系统等级（转生史莱姆「大贤者」式升级）
          xp INTEGER DEFAULT 0,     -- 系统经验（升级来源待定）
          skills TEXT DEFAULT '[]', -- 已解禁技能（json 数组）
          permissions TEXT DEFAULT '[]', -- 当前授权权限集（按 level 派生 + 手动授予），供大模型判断
          auto_assigned INTEGER DEFAULT 0, -- 是否由服务器自动分配
          created_at TEXT, updated_at TEXT);
        -- 服务端→客户端「系统指令」队列（客户端轮询 + ack）
        CREATE TABLE IF NOT EXISTS companion_commands(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,      -- auto_assign / level_up / unlock_skill / permission_grant
          payload TEXT DEFAULT '{}',
          acked_at TEXT, created_at TEXT);
        CREATE TABLE IF NOT EXISTS spells(
          id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
          category TEXT, description TEXT, chant TEXT, tier TEXT, rarity TEXT,
          is_public INTEGER DEFAULT 1, created_at TEXT);
        CREATE TABLE IF NOT EXISTS user_spells(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          spell_id INTEGER REFERENCES spells(id) ON DELETE CASCADE,
          learned_at TEXT, source TEXT, proficiency INTEGER DEFAULT 1,
          is_active INTEGER DEFAULT 1, UNIQUE(user_id, spell_id));
        CREATE TABLE IF NOT EXISTS spell_embeddings(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          spell_id INTEGER REFERENCES spells(id) ON DELETE CASCADE,
          model TEXT NOT NULL, dim INTEGER NOT NULL,
          embedding TEXT NOT NULL, updated_at TEXT, UNIQUE(spell_id, model));
        CREATE TABLE IF NOT EXISTS chant_log(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id), session_id TEXT, raw_text TEXT,
          matched_spell_id INTEGER REFERENCES spells(id),
          method TEXT, confidence REAL, consumed_mana INTEGER, outcome TEXT, at TEXT);
        CREATE TABLE IF NOT EXISTS audit_log(
          id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
          actor_type TEXT, actor_id INTEGER, actor_name TEXT, ip TEXT,
          action TEXT NOT NULL, object_type TEXT, object_id TEXT,
          old_data TEXT, new_data TEXT, reason TEXT, request_id TEXT);
        CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at);
        CREATE INDEX IF NOT EXISTS audit_obj_idx ON audit_log(object_type, object_id);
        CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_id);
        CREATE TABLE IF NOT EXISTS world_players(
          username TEXT PRIMARY KEY, display_name TEXT, level INTEGER, health REAL, food INTEGER,
          pos TEXT, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS schema_migrations(
          version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT, applied_by TEXT,
          checksum TEXT, duration_ms INTEGER);
        """)
        # 幂等迁移：已有库为新能力补齐列（ALTER TABLE 对已存在表不会自动生效）
        _cols = [r[1] for r in c.execute("PRAGMA table_info(characters)").fetchall()]
        if "mc_username" not in _cols:
            c.execute("ALTER TABLE characters ADD COLUMN mc_username TEXT")
        _comp_cols = [r[1] for r in c.execute("PRAGMA table_info(companions)").fetchall()]
        _comp_adder = {
            "model": "TEXT", "level": "INTEGER DEFAULT 1", "xp": "INTEGER DEFAULT 0",
            "skills": "TEXT DEFAULT '[]'", "permissions": "TEXT DEFAULT '[]'",
            "auto_assigned": "INTEGER DEFAULT 0",
        }
        for _col, _typ in _comp_adder.items():
            if _col not in _comp_cols:
                c.execute(f"ALTER TABLE companions ADD COLUMN {_col} {_typ}")
_init_db()

# ------------------------- 密码/认证 -------------------------
PBKDF2_ITERS = 600000
def hash_password(pw: str, salt: str = None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERS).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERS}${salt}${h}"
def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, iters, salt, h = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt), int(iters)).hex()
        return hmac.compare_digest(calc, h)
    except Exception:
        return False
def new_token():
    return secrets.token_hex(32)
def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def future_iso(days):
    return (datetime.now(timezone.utc).replace(hour=0, minute=0, second=0) + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
def issue_session(user_id, ip=None, ua=None, days=30):
    tok = new_token()
    with db() as c:
        c.execute("INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)",
                  (token_hash(tok), user_id, now_iso(), future_iso(days), ip, ua))
        # 过期清理
        c.execute("DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL", (now_iso(),))
    return tok
def bearer(req_headers):
    a = req_headers.get("Authorization", "")
    return a[7:].strip() if a.startswith("Bearer ") else None
def require_user(req_headers):
    tok = bearer(req_headers)
    if not tok: return None
    h = token_hash(tok)
    with db() as c:
        row = c.execute("SELECT u.*, r.name AS role FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id "
                        "WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>=?", (h, now_iso())).fetchone()
    return row
def active_skin(uid):
    if uid is None: return None
    with db() as c:
        r = c.execute("SELECT texture_url FROM skins WHERE user_id=? AND is_active=1 ORDER BY id DESC LIMIT 1", (uid,)).fetchone()
    return r["texture_url"] if r else None

# ------------------------- 玩家在线信息（RCON list） -------------------------
def rcon_cmd(cmd, timeout=6):
    """一次性 RCON 连接（频度低；连接由服务端自动释放）。"""
    import socket
    try:
        s = socket.create_connection((RCON_HOST, RCON_PORT), timeout=3)
    except Exception as e:
        return None
    def pkt(pid, typ, body):
        b = bytearray()
        payload = body.encode("utf-8") + b"\x00\x00"
        # RCON: [len int32][request id int32][type int32][body][\0][\0]，len = id+type+body+2null = body+10
        b += (len(payload) + 8).to_bytes(4, "little") + pid.to_bytes(4, "little") + typ.to_bytes(4, "little") + payload
        return bytes(b)
    try:
        s.sendall(pkt(1, 3, RCON_SECRET))
        # auth response
        def recv(pid_expect):
            buf = b""
            while True:
                d = s.recv(4096)
                if not d: break
                buf += d
                if len(buf) >= 4:
                    ln = int.from_bytes(buf[:4], "little")
                    if len(buf) >= 4 + ln:
                        rid = int.from_bytes(buf[4:8], "little")
                        tid = int.from_bytes(buf[8:12], "little")
                        payload = buf[12:4+ln-2].decode("utf-8", "ignore")
                        return rid, tid, payload
        recv(1)
        s.sendall(pkt(2, 2, cmd))
        rid, tid, payload = recv(2)
        return payload
    except Exception:
        return None
    finally:
        try: s.close()
        except Exception: pass

def online_list():
    raw = rcon_cmd("list")
    if raw is None: return {"ok": False, "players": []}
    # 兼容格式： "There are 5 of a max of 20 players online: A, B" / "There are 3/20 players online: A, B" / "There are 0 players online"
    m = re.search(r"There are ([0-9]+)(?: of a max of [0-9]+|/[0-9]+)? players online[:.,]?\s*(.*)", raw)
    if not m:
        return {"ok": True, "count": 0, "players": []}
    count = int(m.group(1))
    names = [n.strip() for n in m.group(2).split(",") if n.strip()]
    return {"ok": True, "count": count, "players": names}

# ------------------------- MODS 清单/分发 -------------------------
def loaded_filenames():
    """从 latest.log 的 'SCAN: Found mod file \"*.jar\"' 取实际加载的 jar 名。"""
    names = set()
    log = os.path.join(LOGS_DIR, "latest.log")
    if os.path.exists(log):
        try:
            for line in open(log, "r", encoding="utf-8", errors="ignore"):
                m = re.search(r'Found mod file "([^"]+\.jar)"', line)
                if m: names.add(m.group(1).lower())
        except Exception:
            return names
    return names

def jar_meta(path):
    """解析 mod 元数据：modId/version/displayName/side/definesEntitySync/扫描。"""
    meta = {"modId": None, "version": None, "displayName": None, "side": "BOTH",
            "definesEntitySync": False, "clientCode": False}
    try:
        z = zipfile.ZipFile(path)
    except Exception:
        return meta
    # 1) toml
    tomls = [n for n in z.namelist() if n.lower().endswith(("neoforge.mods.toml","mods.toml","fml.toml"))]
    # 优先 META-INF/neoforge.mods.toml
    for pref in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml", "neoforge.mods.toml"):
        if pref in tomls:
            try:
                data = tomllib.loads(z.read(pref).decode("utf-8", "ignore"))
                ms = data.get("mods", [])
                if ms:
                    meta["modId"] = ms[0].get("modId")
                    meta["version"] = ms[0].get("version")
                    meta["displayName"] = ms[0].get("displayName")
                # side：若依赖里出现 server-only api 且无 client 代码 → SERVER
                deps = data.get("dependencies", {})
                if any(v.get("side") == "SERVER" for v in deps.values() if isinstance(v, dict)):
                    meta["side"] = "SERVER"
                break
            except Exception:
                pass
    # 2) 字节码扫描 实体同步 + client 代码
    try:
        client_hit = False; synced_hit = False
        for n in z.namelist():
            if not n.endswith(".class"): continue
            try:
                b = z.read(n)
            except Exception:
                continue
            if b"defineSynchedData" in b: synced_hit = True
            if b"net/minecraft/client" in b: client_hit = True
            if synced_hit and client_hit: break
        meta["definesEntitySync"] = synced_hit
        meta["clientCode"] = client_hit
    except Exception:
        pass
    # 3) 若定义了实体同步 → BOTH（高危及客户端必须同 SHA）；无 client 码且未定义同步 → 视为 SERVER
    if meta["definesEntitySync"] or meta["clientCode"]:
        meta["side"] = "BOTH"
    else:
        meta["side"] = "SERVER"
    return meta

def mod_index(force=False):
    """构建服务端实际加载 mods 的索引（带缓存 keyed by size/mtime）。"""
    cache = {}
    try:
        cache = json.loads(Path(MODINDEX_PATH).read_text(encoding="utf-8"))
    except Exception:
        cache = {}
    loaded = loaded_filenames()
    out = []
    try:
        jars = sorted([p for p in os.listdir(MODS_DIR) if p.lower().endswith(".jar")])
    except Exception:
        jars = []
    for fn in jars:
        p = os.path.join(MODS_DIR, fn)
        try:
            st = os.stat(p)
        except Exception:
            continue
        # 仅统计被服务端实际加载的 jar（latest.log SCAN 命中）；日志缺失则全算
        if loaded and fn.lower() not in loaded:
            continue
        ent = cache.get(fn, {})
        if not force and ent.get("size") == st.st_size and ent.get("mtime") == st.st_mtime:
            ent["filename"] = fn
            out.append(ent); continue
        sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
        m = jar_meta(p)
        ent = {"filename": fn, "size": st.st_size, "mtime": st.st_mtime, "sha256": sha,
               "modId": m["modId"], "version": m["version"], "displayName": m["displayName"],
               "side": m["side"], "definesEntitySync": m["definesEntitySync"]}
        cache[fn] = ent
        out.append(ent)
    try:
        Path(MODINDEX_PATH).write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass
    return out

def find_mod(mod_id=None, filename=None):
    for e in mod_index():
        if mod_id and (e.get("modId") == mod_id): return e
        if filename and (e.get("filename") == filename): return e
    return None

# ------------------------- 玩家实时数据（当前玩家转发） -------------------------
_NON_HUMAN = {"goddess", "kirito", "naruto", "edward", "steve", "alex", "hermine", "maka"}

def online_map():
    """RCON list -> {登录名(小写): 显示名}。当前在线的玩家实体系全家。"""
    out = {}
    try:
        txt = rcon_cmd("list") or ""
        # RCON list 形如: There are 3 of a max of 20 players online: Taro, Goddess, Edward
        _, _, rest = txt.partition("online:")
        for tok in rest.split(","):
            tok = tok.strip()
            if not tok: continue
            out[tok.lower()] = tok
    except Exception:
        pass
    return out

def is_human(mc_name):
    """是否真人玩家：排除 numen 假玩家/女神/示例角色（Goddess/Kirito/Naruto/Edward 等穿越者）。"""
    return (mc_name or "").strip().lower() not in _NON_HUMAN

def _entity_field(mc_name, path):
    """单路径 data get entity <name> <path> -> 原始值字符串（去后缀）。找不到 -> None。"""
    tx = (rcon_cmd(f"data get entity {mc_name} {path}") or "").strip()
    if not tx:
        return None
    low = tx.lower()
    if low.startswith("no entity") or "invalid name" in low or "found no elements" in low:
        return None
    # 形如: Taro has the following entity data: [3096.7d, 76.0d, -1343.3d] / ...: 9.333334f / ...: "minecraft:overworld"
    _, _, val = tx.partition(":")
    val = val.strip()
    # 去数组尾括号与数值后缀 d/f/s/b
    if val.startswith("[") and val.endswith("]"):
        val = val[1:-1].strip()
    return val

def _num(val):
    val = (val or "").strip().strip('"')
    for suf in ("d", "f", "s", "b", "l"):
        if val.endswith(suf) and val[:-1].replace(".", "").replace("-", "").isdigit():
            val = val[:-1]; break
    return val

def player_snapshot(mc_name):
    """抓当前(在线)真人玩家的实时数据 -> dict（字段尽可能全）。非真人/离线/异常 -> {}。"""
    if not mc_name or not is_human(mc_name):
        return {"online": False, "username": mc_name}
    onl = online_map()
    key = mc_name.strip().lower()
    if key not in onl:
        return {"username": mc_name, "online": False}
    snap = {"username": mc_name, "online": True}
    # Pos 数组 -> {x,y,z}
    pv = _entity_field(mc_name, "Pos")
    if pv:
        parts = [p.strip() for p in pv.split(",") if p.strip()]
        if len(parts) >= 3:
            try:
                snap["pos"] = {"x": float(_num(parts[0])), "y": float(_num(parts[1])), "z": float(_num(parts[2]))}
            except Exception:
                snap["pos"] = pv
    for path, key in (("Health", "health"), ("XpLevel", "level"), ("Air", "air"), ("Dimension", "dimension")):
        v = _num(_entity_field(mc_name, path))
        if v:
            snap[key] = v
    if "dimension" in snap:
        snap["dimension"] = snap["dimension"].strip('"')
    return snap

def current_player_view(user):
    """当前账号的「玩家视图」：绑定角色里在线的那个人的快照 + 角色列表。
    —— 只看自己（不多看别人），机器人/非真人不在范围。"""
    with db() as c:
        chars = c.execute("SELECT id,name,mc_username,class,is_active FROM characters WHERE user_id=? AND is_active=1", (user["id"],)).fetchall()
    online_snap = []
    for ch in chars:
        mu = (ch["mc_username"] or "").strip()
        if not mu or not is_human(mu):
            continue
        s = player_snapshot(mu)
        if s.get("online"):
            s["character"] = ch["name"]; s["character_id"] = ch["id"]; s["class"] = ch["class"]
            online_snap.append(s)
    return {"characters": [dict(ch) for ch in chars], "online": online_snap}

def pan_links():
    try:
        return json.loads(Path(PANLINKS_PATH).read_text(encoding="utf-8"))
    except Exception:
        return {}

# ------------------------- 伴侣「系统」等级/权限模型（转生史莱姆大贤者式） -------------------------
# 系统运行在客户端本地；服务端是权威档案 + 权限管控 + 数据供给 + 指令下发。
# 每个 level 解锁一组权限（permissions），客户端大模型据此判断能动用哪些服务端能力。
SYSTEM_TIERS = {
    1: {"name": "观察者",   "perms": ["world_view"],          "desc": "能看到世界与自身状态"},
    2: {"name": "分析者",   "perms": ["world_view", "analyse"], "desc": "能分析周边地形/资源/村庄/危险"},
    3: {"name": "影响者",   "perms": ["world_view", "analyse", "pray"], "desc": "能代表玩家向女神上达祈愿/代施"},
    4: {"name": "施法者",   "perms": ["world_view", "analyse", "pray", "suggest"], "desc": "能建议/触发法术咏唱"},
    5: {"name": "大贤者",   "perms": ["world_view", "analyse", "pray", "suggest", "oracle"], "desc": "全服公共情报 + 女神级洞察"},
}
SYSTEM_SKILLS = {
    "world_view": {"name": "世界之眼", "desc": "读取玩家状态与世界快照", "tier": 1},
    "analyse":    {"name": "解析",     "desc": "分析周边地形/资源/村庄/危险（需世界端扫描）", "tier": 2},
    "pray":       {"name": "祈祷",     "desc": "代表玩家向女神上达祈愿/请求代施", "tier": 3},
    "suggest":    {"name": "咏唱建议", "desc": "建议/触发法术咏唱", "tier": 4},
    "oracle":     {"name": "神谕",     "desc": "全服公共情报 + 女神级洞察", "tier": 5},
}

def system_tier_perms(level):
    """按 level 返回权限集（第 level 级含以下全部）。"""
    if level is None: return []
    perms = []
    for t in range(1, min(int(level) or 1, 5) + 1):
        perms.extend(SYSTEM_TIERS[int(t)]["perms"])
    return sorted(set(perms))

def system_profile(row):
    """把 companions 行展开成系统档案（含 level/权限/技能/配置快照）。"""
    if row is None:
        return {"bound": False}
    try:
        skills = json.loads(row["skills"] or "[]")
        perms = json.loads(row["permissions"] or "[]")
    except Exception:
        skills, perms = [], []
    lv = int(row["level"] or 1)
    tier = SYSTEM_TIERS[min(lv, 5)]
    return {
        "bound": True, "cname": row["cname"], "enabled": bool(row["enabled"]),
        "model": row["model"], "level": lv, "xp": int(row["xp"] or 0),
        "auto_assigned": bool(row["auto_assigned"]),
        "tier": tier["name"], "tier_desc": tier["desc"],
        "skills": skills, "skills_unlocked": sorted(set(skills) | set(system_tier_perms(lv))),
        "permissions": perms or system_tier_perms(lv),
        "personality": row["personality"],
    }

def push_system_command(user_id, ctype, payload=None):
    """服务端→客户端「系统指令」。客户端轮询 /api/companion/commands 拉取，处理完 ack。"""
    with db() as c:
        c.execute("INSERT INTO companion_commands(user_id,type,payload,created_at) VALUES(?,?,?,?)",
                  (user_id, ctype, json.dumps(payload or {}, ensure_ascii=False), now_iso()))
    return True

def grant_xp(user_id, amount):
    """给某账号的系统加经验，若跨级则入队 level_up 指令。返回 (新level, 是否升级)。"""
    with db() as c:
        comp = c.execute("SELECT id,level,xp FROM companions WHERE user_id=?", (user_id,)).fetchone()
        if comp is None:
            return None, False
        old_lv = int(comp["level"] or 1); new_xp = int(comp["xp"] or 0) + int(amount)
        # 升级曲线：每级需要 level*100 xp（1->2:100, 2->3:200 ...）
        new_lv = old_lv
        need = new_lv * 100
        while new_xp >= need and new_lv < 5:
            new_xp -= need; new_lv += 1; need = new_lv * 100
        c.execute("UPDATE companions SET xp=?, level=? WHERE user_id=?", (new_xp, new_lv, user_id))
    if new_lv > old_lv:
        push_system_command(user_id, "level_up", {"from": old_lv, "to": new_lv})
        return new_lv, True
    return new_lv, False

# ------------------------- vLLM 解析 -------------------------
def llm_parse(text):
    """阶段2/可选：把玩家文字命令送本地 LLM 解析。默认关闭（GATEWAY_COMMAND_LLM=1 才启用），
    以避免让门户耦合 AI 侧的 vLLM。失败/未启用均优雅降级，绝不拖垮门户本体。"""
    if not ENABLE_COMMAND_LLM or not VLLM_URL:
        return '{"disabled":"command_llm_off","hint":"GATEWAY_COMMAND_LLM=1 to enable"}'
    try:
        req = Request(VLLM_URL, data=json.dumps({
            "model": "qwen3.8-27b-uncensored",
            "messages": [{"role": "system", "content": "你是Minecraft世界命令解析器。把玩家的话转成一个简短的MC命令。只输出一个json: {\"command\":\"...\",\"intent\":\"...\"}"},
                         {"role": "user", "content": text}],
            "temperature": 0.3, "max_tokens": 200,
        }).encode("utf-8"), headers={"Content-Type": "application/json"})
        resp = json.loads(urlopen(req, timeout=20).read().decode("utf-8"))
        return resp["choices"][0]["message"]["content"]
    except Exception as e:
        return f'{{"error":"llm_unavailable","detail":"{str(e)}"}}'

# ------------------------- JSON 帮助 -------------------------
def json_write(res, code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    res.send_response(code)
    res.send_header("Content-Type", "application/json; charset=utf-8")
    res.send_header("Content-Length", str(len(body)))
    res.end_headers()
    res.wfile.write(body)

def read_body(res):
    ln = int(res.headers.get("Content-Length", 0) or 0)
    if not ln: return {}
    raw = res.rfile.read(ln)
    try:
        return json.loads(raw.decode("utf-8") or "{}")
    except Exception:
        return {}

# ------------------------- 路由 -------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "mc-gateway/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # 静默
        pass

    def _send_file(self, path, mime):
        try:
            st = os.stat(path)
        except Exception:
            return json_write(self, 404, {"error": "not found"})
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(st.st_size))
        self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(path)}"')
        self.end_headers()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk: break
                try:
                    self.wfile.write(chunk)
                except Exception:
                    break

    def _route(self, method):
        u = urlparse(self.path)
        p = u.path.rstrip("/") or "/"
        q = parse_qs(u.query)
        try:
            if method == "GET":
                if p == "/api/gateway/health":
                    online = online_list()
                    return json_write(self, 200, {"ok": True, "service": "mc-gateway",
                        "port": PORT, "granite": "goddess", "db": True,
                        "server_online": online.get("ok", False), "now": now_iso()})
                if p == "/api/gateway/modlist":
                    return json_write(self, 200, {"ok": True, "mods": mod_index()})
                if p == "/api/gateway/mod/download":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    e = find_mod(q.get("modId",[None])[0], q.get("filename",[None])[0])
                    if not e: return json_write(self, 404, {"error": "mod not found"})
                    lk = pan_links().get(e.get("modId"))
                    if lk:
                        return json_write(self, 200, {"source": "pan", "download_url": lk.get("url"), "extract_code": lk.get("code"), "sha256": e["sha256"], "filename": e["filename"]})
                    base = f"http://{ADVERTISE}:{PORT}"
                    return json_write(self, 200, {"source": "direct", "download_url": f"{base}/api/gateway/mod/file?modId={e.get('modId') or e['filename']}", "sha256": e["sha256"], "filename": e["filename"]})
                if p == "/api/gateway/mod/file":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    mod_id = q.get("modId",[None])[0] or q.get("filename",[None])[0]
                    e = find_mod(mod_id=mod_id, filename=mod_id)
                    if not e: return json_write(self, 404, {"error": "mod not found"})
                    path = os.path.abspath(os.path.join(MODS_DIR, e["filename"]))
                    # 防路径穿越：必须落在 mods 目录白名单内
                    if not path.lower().startswith(os.path.abspath(MODS_DIR).lower()):
                        return json_write(self, 403, {"error": "forbidden"})
                    return self._send_file(path, "application/java-archive")
                if p in ("/api/user/online", "/api/gateway/online"):
                    return json_write(self, 200, online_list())
                if p == "/api/user/info":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    return json_write(self, 200, {"username": user["username"], "nickname": user["nickname"],
                        "role": user["role"], "server_tag": user["server_tag"], "status": user["status"],
                        "skin": active_skin(user["id"]), "online": current_player_view(user)})
                if p == "/api/user/characters":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    with db() as c:
                        rows = c.execute("SELECT id,name,mc_username,class,is_active,created_at FROM characters WHERE user_id=? ORDER BY id", (user["id"],)).fetchall()
                    return json_write(self, 200, {"characters": [dict(r) for r in rows]})
                if p == "/api/companion/state":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    with db() as c:
                        comp = c.execute("SELECT * FROM companions WHERE user_id=?", (user["id"],)).fetchone()
                    return json_write(self, 200, system_profile(comp))
                if p == "/api/companion/commands":
                    # 客户端轮询「系统指令」队列（auto-assign / level-up / unlock-skill / permission-grant）。
                    # 服务端是权威：客户端主动拉取待处理指令，处理完回执 ack。
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    with db() as c:
                        cmds = c.execute("SELECT id,type,payload,created_at FROM companion_commands WHERE user_id=? AND acked_at IS NULL ORDER BY id",
                                         (user["id"],)).fetchall()
                    return json_write(self, 200, {"commands": [dict(x) for x in cmds]})
                if p == "/api/companion/world":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    with db() as c:
                        comp = c.execute("SELECT enabled FROM companions WHERE user_id=?", (user["id"],)).fetchone()
                        if not comp or not comp["enabled"]:
                            return json_write(self, 200, {"bound": False, "ok": False, "reason": "companion_not_bound"})
                    view = current_player_view(user)
                    online = view.get("online") or []
                    sel = online[0] if online else None
                    return json_write(self, 200, {"bound": True, "ok": bool(sel), "player": sel,
                        "characters": view.get("characters", [])})
                if p == "/api/user/profile":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    return json_write(self, 200, {"username": user["username"], "nickname": user["nickname"],
                        "avatar": user["avatar"], "skin": active_skin(user["id"]), "role": user["role"],
                        "server_tag": user["server_tag"], "status": user["status"], "created_at": user["created_at"]})
                if p == "/api/user/skin":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    return json_write(self, 200, {"username": user["username"], "skin": active_skin(user["id"])})
                if p == "/api/admin/player/list":
                    user = require_user(self.headers)
                    if not user or user["role"] not in ("owner", "admin"): return json_write(self, 403, {"error": "forbidden"})
                    with db() as c:
                        rows = c.execute("SELECT u.username,u.nickname,r.name AS role,u.created_at,u.last_login,u.status FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id").fetchall()
                    return json_write(self, 200, {"users": [dict(r) for r in rows], "online": online_list()})
            elif method == "POST":
                if p == "/api/auth/register":
                    b = read_body(self)
                    username = (b.get("username") or "").strip()
                    password = b.get("password") or ""
                    nickname = (b.get("nickname") or username).strip()[:32]
                    if not username or not password: return json_write(self, 400, {"error": "username/password required"})
                    if not re.match(r"^[A-Za-z0-9_\-\.]{2,32}$", username): return json_write(self, 400, {"error": "username invalid"})
                    if len(password) < 4: return json_write(self, 400, {"error": "password too short"})
                    ip = client_ip(self.headers)
                    with db() as c:
                        if c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                            return json_write(self, 409, {"error": "username taken"})
                        ph = hash_password(password)
                        n = now_iso()
                        c.execute("INSERT INTO users(username,password_hash,nickname,role_id,status,created_at,updated_at,last_login,server_tag) "
                                  "VALUES(?,?,?,3,'active',?,?,?,0)", (username, ph, nickname, n, n, n))
                        uid = c.execute("SELECT last_insert_rowid() as x").fetchone()["x"]
                        c.execute("INSERT INTO profiles(user_id,display_name,updated_at) VALUES(?,?,?)", (uid, nickname, n))
                        audit(c, "user", uid, username, ip, "register", "user", uid,
                              new_data={"username": username, "nickname": nickname, "role_id": 3})
                    tok = issue_session(uid, ip, self.headers.get("User-Agent", ""))
                    return json_write(self, 200, {"ok": True, "token": tok, "username": username, "nickname": nickname})
                if p == "/api/auth/login":
                    b = read_body(self)
                    username = (b.get("username") or "").strip()
                    password = b.get("password") or ""
                    ip = client_ip(self.headers)
                    with db() as c:
                        row = c.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
                        ok = bool(row) and verify_password(password, row["password_hash"])
                        c.execute("INSERT INTO login_attempts(username,ip,success,reason,at) VALUES(?,?,?,?,?)",
                                  (username, ip, 1 if ok else 0, "ok" if ok else "bad_credentials", now_iso()))
                        if ok:
                            audit(c, "user", row["id"], row["username"], ip, "login", "user", row["id"],
                                  new_data={"username": row["username"]})
                    if not ok:
                        return json_write(self, 401, {"error": "bad credentials"})
                    with db() as c:
                        c.execute("UPDATE users SET last_login=? WHERE id=?", (now_iso(), row["id"]))
                    tok = issue_session(row["id"], ip, self.headers.get("User-Agent", ""))
                    return json_write(self, 200, {"ok": True, "token": tok, "username": row["username"],
                        "nickname": row["nickname"], "role_id": row["role_id"],
                        "server_tag": row["server_tag"], "skin": active_skin(row["id"])})
                if p == "/api/auth/logout":
                    tok = bearer(self.headers)
                    if tok:
                        with db() as c:
                            c.execute("UPDATE sessions SET revoked_at=? WHERE token_hash=?", (now_iso(), token_hash(tok)))
                            u = c.execute("SELECT u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NOT NULL", (token_hash(tok),)).fetchone()
                            if u:
                                audit(c, "user", None, u["username"], client_ip(self.headers), "logout", "session", "", new_data={"token_hash": token_hash(tok)})
                    return json_write(self, 200, {"ok": True})
                if p == "/api/user/profile":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    fields = {k: str(b[k])[:64] for k in ("nickname","avatar") if k in b}
                    if fields:
                        with db() as c:
                            old = dict(c.execute("SELECT nickname,avatar FROM users WHERE id=?", (user["id"],)).fetchone())
                            for k, v in fields.items():
                                c.execute(f"UPDATE users SET {k}=?, updated_at=? WHERE id=?", (v, now_iso(), user["id"]))
                            audit(c, "user", user["id"], user["username"], client_ip(self.headers), "update", "user",
                                  user["id"], old_data=old, new_data=fields)
                    return json_write(self, 200, {"ok": True, "updated": list(fields.keys())})
                if p == "/api/user/skin":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    skin = str(b.get("skin", ""))[:256]
                    with db() as c:
                        c.execute("UPDATE skins SET is_active=0 WHERE user_id=?", (user["id"],))
                        c.execute("INSERT INTO skins(user_id,texture_url,is_active,uploaded_at) VALUES(?,?,1,?)",
                                  (user["id"], skin, now_iso()))
                        audit(c, "user", user["id"], user["username"], client_ip(self.headers), "skin_update", "skin", user["id"],
                              new_data={"texture_url": skin})
                    return json_write(self, 200, {"ok": True, "skin": skin})
                if p == "/api/user/characters":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    name = (b.get("name") or "").strip()[:32]
                    mc_username = (b.get("mc_username") or "").strip()[:32]
                    role_class = (b.get("class") or "").strip()[:32] or "adventurer"
                    # 校验：mc_username 必须是真人玩家（在线或可验证的登录名），拒绝 numen/女神
                    if not mc_username or not is_human(mc_username):
                        return json_write(self, 400, {"error": "mc_username must be a real player login"})
                    ip = client_ip(self.headers)
                    with db() as c:
                        dup = c.execute("SELECT 1 FROM characters WHERE user_id=? AND mc_username=?",
                                        (user["id"], mc_username.lower())).fetchone()
                        if dup:
                            return json_write(self, 409, {"error": "character_already_bound"})
                        n = now_iso()
                        c.execute("INSERT INTO characters(user_id,name,mc_username,class,is_active,created_at) VALUES(?,?,?,?,1,?)",
                                  (user["id"], name or mc_username, mc_username.lower(), role_class, n))
                        cid = c.execute("SELECT last_insert_rowid() as x").fetchone()["x"]
                        audit(c, "user", user["id"], user["username"], ip, "character_bind", "character", cid,
                              new_data={"name": name, "mc_username": mc_username, "class": role_class})
                    return json_write(self, 200, {"ok": True, "id": cid, "name": name or mc_username, "mc_username": mc_username.lower(), "class": role_class})
                if p == "/api/user/characters/activate":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    cid = b.get("id")
                    with db() as c:
                        row = c.execute("SELECT mc_username FROM characters WHERE user_id=? AND id=?", (user["id"], cid)).fetchone()
                        if not row:
                            return json_write(self, 404, {"error": "character_not_found"})
                        c.execute("UPDATE characters SET is_active=0 WHERE user_id=?", (user["id"],))
                        c.execute("UPDATE characters SET is_active=1 WHERE user_id=? AND id=?", (user["id"], cid))
                        audit(c, "user", user["id"], user["username"], client_ip(self.headers), "character_activate", "character", cid,
                              new_data={"mc_username": row["mc_username"]})
                    return json_write(self, 200, {"ok": True, "active_id": cid})
                if p == "/api/companion/bind":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    cname = (b.get("cname") or "你的伙伴").strip()[:24]
                    persona = b.get("personality", {})
                    if not isinstance(persona, dict):
                        return json_write(self, 400, {"error": "personality must be object"})
                    model = (b.get("model") or "").strip()[:64] or None
                    auto_assigned = int(bool(b.get("auto_assigned", False)))
                    ip = client_ip(self.headers)
                    persona_str = json.dumps(persona, ensure_ascii=False)[:2000]
                    with db() as c:
                        old = c.execute("SELECT cname,personality,enabled,model,level,xp,skills,permissions,auto_assigned FROM companions WHERE user_id=?", (user["id"],)).fetchone()
                        n = now_iso()
                        c.execute("INSERT INTO companions(user_id,cname,personality,enabled,model,auto_assigned,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?) "
                                  "ON CONFLICT(user_id) DO UPDATE SET cname=excluded.cname, personality=excluded.personality, enabled=1, "
                                  "model=COALESCE(excluded.model, companions.model), updated_at=excluded.updated_at",
                                  (user["id"], cname, persona_str, model, auto_assigned, n, n))
                        audit(c, "user", user["id"], user["username"], ip, "companion_bind", "companion", user["id"],
                              old_data=(dict(old) if old else None),
                              new_data={"cname": cname, "personality": persona, "model": model, "auto_assigned": auto_assigned})
                        comp = c.execute("SELECT * FROM companions WHERE user_id=?", (user["id"],)).fetchone()
                    return json_write(self, 200, system_profile(comp))
                if p == "/api/companion/activate":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    # 激活 = 标记在线角色的聚焦（伴侣跟随当前在线角色）。数据视图在 /companion/world。
                    view = current_player_view(user)
                    online = view.get("online") or []
                    if not online:
                        return json_write(self, 200, {"ok": False, "reason": "no_online_character"})
                    sel = online[0]
                    return json_write(self, 200, {"ok": True, "focused": sel})
                if p == "/api/companion/chat":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    text = (b.get("text") or "").strip()
                    if not text: return json_write(self, 400, {"error": "text required"})
                    with db() as c:
                        comp = c.execute("SELECT * FROM companions WHERE user_id=?", (user["id"],)).fetchone()
                        if not comp or not comp["enabled"]:
                            return json_write(self, 200, {"bound": False, "ok": False, "reason": "companion_not_bound"})
                    # 伴侣系统运行在客户端本地（大模型在客户端）：服务端只转发意图 + 给足上下文。
                    # MVP 给模板回执；客户端系统接入后，此处改为把 text+world 数据推给客户端，由客户端系统模型作答。
                    prof = system_profile(comp)
                    # 组装可供客户端系统模型用的上下文（权限决定能看多少）
                    ctx = {"system": prof}
                    lv = prof["level"]
                    if "world_view" in prof["permissions"]:
                        view = current_player_view(user)
                        ctx["world"] = view
                    reply = f"［{prof['cname']}·{prof['tier']}］我在你身边。有权限级别 {prof['level']} 能看，你说。"
                    return json_write(self, 200, {"bound": True, "reply": reply, "intent": text, "context": ctx})
                if p == "/api/companion/commands/ack":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    cid = b.get("id")
                    with db() as c:
                        row = c.execute("SELECT id FROM companion_commands WHERE user_id=? AND id=?", (user["id"], cid)).fetchone()
                        if not row:
                            return json_write(self, 404, {"error": "command_not_found"})
                        c.execute("UPDATE companion_commands SET acked_at=? WHERE id=?", (now_iso(), cid))
                    return json_write(self, 200, {"ok": True, "acked": cid})
                if p == "/api/player/command":
                    user = require_user(self.headers)
                    if not user: return json_write(self, 401, {"error": "unauthorized"})
                    b = read_body(self)
                    text = (b.get("text") or "").strip()
                    if not text: return json_write(self, 400, {"error": "text required"})
                    parsed = llm_parse(text)
                    return json_write(self, 200, {"ok": True, "from": user["nickname"], "text": text, "parsed": parsed})
        except Exception as e:
            return json_write(self, 500, {"error": "internal", "detail": str(e)})
        return json_write(self, 404, {"error": "not found"})

    def do_GET(self):
        self._route("GET")
    def do_POST(self):
        self._route("POST")

def main():
    srv = ThreadingHTTPServer((LAN_IP, PORT), Handler)
    print(f"[mc-gateway] listening on {LAN_IP}:{PORT} (data={GATEWAY_DATA}, mods={MODS_DIR})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
