# -*- coding: utf-8 -*-
"""
build-shadow.py — 千灯纪 Phase B 影子环境构建器（幂等）
产物（均在 ops/docker/shadow/ 下，git-ignored）：
  mods/         生产 15 mod + numen_act 换装 god-channel 版（isekai 实证构建）
  data/         神使通道/world.db 卷（fresh；rcon-secret.txt 注入；atoms 由镜像 defaults 补种）
  mcdata/       NPC 生态卷（mc-data 副本；llm endpoint 打补丁指向宿主）
  copaw/        瓶中 QwenPaw 数据家（config.json 补丁版 + 两守卫 workspace）
  copaw.secret/ 钥匙串副本（.master_key 同行 → ENC 可解；vllm base_url 改 host.docker.internal）
  mc/           itzg /data（fresh 世界）
  shadow.env    RCON 密码等（首次生成，之后复用）
用法：python build-shadow.py [--fresh]  （--fresh 连 mc/ 世界一起清）
"""
import json, os, secrets, shutil, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SH = os.path.join(os.path.dirname(os.path.abspath(__file__)))
COPAW = os.path.expanduser(r"~\.copaw")
SECRET = os.path.expanduser(r"~\.copaw.secret")
GUARDS = ["mc-guard-kirito", "mc-guard-naruto"]
NUMEN_ACT_GOD = os.path.join(REPO, "ops", "docker", "data", "mods", "numen_act-neoforge-1.21.1-0.1.1.jar")


def rm(p):
    if os.path.isdir(p):
        import stat
        def force(func, path, _exc):
            os.chmod(path, stat.S_IWRITE)
            func(path)
        shutil.rmtree(p, onerror=force)


def patch_json(path, fn):
    with open(path, encoding="utf-8") as f:
        obj = json.load(f)
    fn(obj)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print("  patched", os.path.basename(path))


print("== shadow build ==")
print("REPO:", REPO)

# 0 shadow.env（密码只生成一次）
env_path = os.path.join(SH, "shadow.env")
if os.path.exists(env_path):
    pw = [l.split("=", 1)[1].strip() for l in open(env_path, encoding="utf-8")
          if l.startswith("RCON_PASSWORD=")][0]
    print("reuse RCON_PASSWORD from shadow.env")
else:
    pw = "shadow-" + secrets.token_hex(8)
    with open(env_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"RCON_PASSWORD={pw}\n")
    print("generated new RCON_PASSWORD")

fresh = "--fresh" in sys.argv

# 1 mods：生产 modpack + numen_act 换装
print("[1/6] mods ...")
rm(os.path.join(SH, "mods"))
shutil.copytree(os.path.join(REPO, "mc-server", "mods"), os.path.join(SH, "mods"))
shutil.copy2(NUMEN_ACT_GOD, os.path.join(SH, "mods", os.path.basename(NUMEN_ACT_GOD)))
print("  numen_act swapped to god-channel build")

# 2 data：fresh + rcon secret
print("[2/6] data ...")
os.makedirs(os.path.join(SH, "data"), exist_ok=True)
with open(os.path.join(SH, "data", "rcon-secret.txt"), "w", encoding="utf-8", newline="\n") as f:
    f.write(pw)

# 3 mcdata：NPC 生态副本 + endpoint 补丁
print("[3/6] mcdata ...")
rm(os.path.join(SH, "mcdata"))
shutil.copytree(os.path.join(REPO, "mc-data"), os.path.join(SH, "mcdata"))
n_ep = 0
for root, _, files in os.walk(os.path.join(SH, "mcdata")):
    for fn in files:
        if not fn.endswith((".json", ".yaml", ".yml")):
            continue
        p = os.path.join(root, fn)
        try:
            t = open(p, encoding="utf-8").read()
        except Exception:
            continue
        if "127.0.0.1:8890" in t:
            open(p, "w", encoding="utf-8", newline="\n").write(t.replace("127.0.0.1:8890", "host.docker.internal:8890"))
            n_ep += 1
print(f"  llm endpoint patched in {n_ep} file(s)")

# 4 copaw：瓶中 QwenPaw 家
print("[4/6] copaw ...")
rm(os.path.join(SH, "copaw"))
os.makedirs(os.path.join(SH, "copaw", "workspaces"), exist_ok=True)


def patch_root_cfg(cfg):
    cfg["channels"]["feishu"]["enabled"] = False          # 防 feishu 双连互踢
    for cid in ("winremote", "minecraft_companion"):
        if cid in cfg.get("mcp", {}).get("clients", {}):
            cfg["mcp"]["clients"][cid]["enabled"] = False  # 瓶内不可达的宿主 MCP
    ag = cfg["agents"]
    ag["active_agent"] = "mc-guard-kirito"
    ag["agent_order"] = list(GUARDS)
    ag["profiles"] = {
        g: {"id": g, "workspace_dir": f"/root/.copaw/workspaces/{g}", "enabled": True, "pinned": False}
        for g in GUARDS
    }


shutil.copy2(os.path.join(COPAW, "config.json"), os.path.join(SH, "copaw", "config.json"))
patch_json(os.path.join(SH, "copaw", "config.json"), patch_root_cfg)
chats = os.path.join(COPAW, "chats.json")
if os.path.exists(chats):
    shutil.copy2(chats, os.path.join(SH, "copaw", "chats.json"))


def patch_agent(g):
    def fn(aj):
        aj["workspace_dir"] = f"/root/.copaw/workspaces/{g}"
        num = aj.get("mcp", {}).get("clients", {}).get("numen")
        if num:
            num["command"] = "/usr/local/bin/python3"   # 绝对路径：env 字典替换整个环境，裸名无 PATH 会 ENOENT
            num["args"] = ["/opt/sidecar/guard/mcp_numen.py"]
            num["cwd"] = "/root"  # 空串/null 都不行：null 过不了 pydantic、空串 spawn ENOENT
            e = dict(num.get("env") or {})
            e.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
            e.setdefault("HOME", "/root")
            num["env"] = e
    return fn


for g in GUARDS:
    src = os.path.join(COPAW, "workspaces", g)
    dst = os.path.join(SH, "copaw", "workspaces", g)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", "__pycache__", ".git"))
    patch_json(os.path.join(dst, "agent.json"), patch_agent(g))
    # drivers/mcp/numen.yaml 才是 Driver 正身（agent.json 只是登记残留），一并打补丁
    ny = os.path.join(dst, "drivers", "mcp", "numen.yaml")
    if os.path.exists(ny):
        t = open(ny, encoding="utf-8").read()
        t = t.replace(r"C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe", "/usr/local/bin/python3")
        t = t.replace(os.path.join(REPO, "sidecar", "guard", "mcp_numen.py").replace("\\", "\\"),
                      "/opt/sidecar/guard/mcp_numen.py")
        t = t.replace(REPO, "/root")
        if "  env:\n" in t:
            t = t.replace(
                "  env:\n",
                "  env:\n    PATH: /usr/local/bin:/usr/bin:/bin\n    HOME: /root\n"
                "    MC_RCON_HOST: mc\n    MC_RCON_PORT: \"25575\"\n"
                f"    RCON_PASSWORD: \"{pw}\"\n    MC_DATA_DIR: /data\n",
                1,
            )
            # env dict 会整体替换容器环境，必须自带 RCON/通道指向（god-inbox.jsonl 与 world 容器共享 /data 卷）
            # NUMEN_COMPANION/DISPLAY 的 credential 引用（ENC 加密）在无 master_key 的瓶中解不开 → 换明文名（非敏感）
            import re as _re
            t = _re.sub(
                r"    NUMEN_COMPANION:\n(?:      .*\n)+    NUMEN_DISPLAY:\n(?:      .*\n)+",
                f"    NUMEN_COMPANION: {'Kirito' if g.endswith('kirito') else 'Naruto'}\n"
                f"    NUMEN_DISPLAY: {'桐人' if g.endswith('kirito') else '鸣人'}\n",
                t,
            )
        open(ny, "w", encoding="utf-8", newline="\n").write(t)
        print(f"  workspace {g} copied (agent.json + numen.yaml patched)")
    else:
        print(f"  workspace {g} copied (agent.json patched; numen.yaml absent)")

# 4.5 瓶中运营双 agent（灯语女神/灶火祭司）——生成式创建（无宿主 workspace 源，保留既有 history）
OPS_AGENTS = [
    ("mc-herald", "灯语女神",
     "世界运营之神：主动发现问题（坑洞/玩家危险/天象异常）并修复、播报、记档，守护玩家游戏体验。"),
    ("mc-priest", "灶火祭司",
     "世界策划之神：世界观播报、进程书写、任务活动构思，让村庄有烟火气。"),
]
OPS_TPL = os.path.join(REPO, "ops", "docker", "ops-agents")
GOD_CLIENT = {
    "name": "god",
    "description": "神使通道工具箱（世界状态/管理命令/编年史/数据只读），零密钥文件 IPC",
    "enabled": True, "transport": "stdio", "url": "", "headers": {},
    "command": "/usr/local/bin/python3",
    "args": ["/opt/sidecar/god-channel/mcp_god.py"],
    "env": {"GOD_CHANNEL_DIR": "/god-channel", "DATA_DIR": "/data",
            "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/root"},
    "cwd": "/root",
}
GOD_YAML = """name: god
protocol: mcp
endpoint:
  args:
  - /opt/sidecar/god-channel/mcp_god.py
  command: /usr/local/bin/python3
  cwd: /root
  env:
    PATH: /usr/local/bin:/usr/bin:/bin
    HOME: /root
    GOD_CHANNEL_DIR: /god-channel
    DATA_DIR: /data
  transport: stdio
config:
  description: 神使通道工具箱（世界状态/管理命令/编年史/数据只读），零密钥文件 IPC
  display_name: god
enabled: true
policy:
  default_effect: deny
  rules:
  - subject: '*'
    effect: allow
    target:
      kind: tool
      name: '*'
    principal:
      source_type: '*'
      source_value: '*'
      subject_type: '*'
      subject_value: '*'
    condition: null
"""
for aid, aname, adesc in OPS_AGENTS:
    dst = os.path.join(SH, "copaw", "workspaces", aid)
    os.makedirs(os.path.join(dst, "drivers", "mcp"), exist_ok=True)
    # agent.json：以 kirito 副本为底本（保留既有 history.db 等运行痕迹）
    aj_path = os.path.join(dst, "agent.json")
    base = aj_path if os.path.exists(aj_path) else os.path.join(
        SH, "copaw", "workspaces", "mc-guard-kirito", "agent.json")
    aj = json.load(open(base, encoding="utf-8"))
    aj["id"] = aid
    aj["name"] = aname
    aj["description"] = adesc
    aj["workspace_dir"] = f"/root/.copaw/workspaces/{aid}"
    aj["mcp"]["clients"] = {"god": GOD_CLIENT}
    aj.pop("last_dispatch", None)
    json.dump(aj, open(aj_path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
    for fn in ("AGENTS.md", "SOUL.md", "PROFILE.md"):
        shutil.copyfile(os.path.join(OPS_TPL, aid, fn), os.path.join(dst, fn))
    open(os.path.join(dst, "drivers", "mcp", "god.yaml"), "w", encoding="utf-8", newline="\n").write(GOD_YAML)
    print(f"  ops agent {aid}（{aname}） ready")

# 4.6 注册进 config.json agents.profiles（否则 console/chat X-Agent-Id 404）
cfg_path = os.path.join(SH, "copaw", "config.json")
cfg = json.load(open(cfg_path, encoding="utf-8"))
profs = cfg.setdefault("agents", {}).setdefault("profiles", {})
order = cfg["agents"].setdefault("agent_order", [])
for aid, _aname, _adesc in OPS_AGENTS:
    profs[aid] = {"id": aid, "workspace_dir": f"/root/.copaw/workspaces/{aid}",
                  "enabled": True, "pinned": False}
    if aid not in order:
        order.append(aid)
json.dump(cfg, open(cfg_path, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)
print("  config.json: ops agents registered")

# 5 copaw.secret：只手写本地 vllm provider（api_key: None），任何真实密钥/master_key 不入瓶
print("[5/6] copaw.secret (local-only, no secrets) ...")
rm(os.path.join(SH, "copaw.secret"))
PCUST = os.path.join(SH, "copaw.secret", "providers", "custom")
os.makedirs(PCUST, exist_ok=True)
SRC_CUST = os.path.join(SECRET, "providers", "custom")
n_bu = 0
for fn in os.listdir(SRC_CUST):
    if not fn.endswith(".json"):
        continue
    try:
        j = json.load(open(os.path.join(SRC_CUST, fn), encoding="utf-8"))
    except Exception:
        continue
    if not str(j.get("base_url", "")).endswith(":8890/v1"):
        continue  # 只带本地 vllm，其余一概不入瓶
    j["base_url"] = "http://host.docker.internal:8890/v1"
    j["api_key"] = ""  # vllm 免鉴权；置空串（None 过不了 pydantic string 校验）
    with open(os.path.join(PCUST, fn), "w", encoding="utf-8", newline="\n") as f:
        json.dump(j, f, ensure_ascii=False, indent=2)
    n_bu += 1
print(f"  {n_bu} local-only provider(s) written (no master_key, no builtin, no cloud keys)")

# 6 mc：fresh world 目录
print("[6/6] mc ...")
if fresh:
    rm(os.path.join(SH, "mc"))
os.makedirs(os.path.join(SH, "mc"), exist_ok=True)
# settlements SIS 对齐生产（fresh 首启前无此文件——首启后无参重跑 build-shadow.py 即补上）
inf = os.path.join(SH, "mc", "config", "settlements", "inference.toml")
if os.path.exists(inf):
    t = open(inf, encoding="utf-8").read()
    t2 = (t.replace("enabled = false", "enabled = true")
          .replace('endpoint_base_url = ""', 'endpoint_base_url = "http://oracle:9001"')
          .replace('locale = "en_us"', 'locale = "zh_cn"')
          .replace('mode = "HEURISTIC"', 'mode = "LLM"'))
    gen = os.path.join(SH, "mc", "config", "settlements", "general.toml")
    if os.path.exists(gen):
        gt = open(gen, encoding="utf-8").read()
        gt2 = gt.replace("scripted_chatter = true", "scripted_chatter = false")
        if gt2 != gt:
            open(gen, "w", encoding="utf-8", newline="\n").write(gt2)
            print("  settlements general.toml aligned (scripted_chatter=false)")
    if t2 != t:
        open(inf, "w", encoding="utf-8", newline="\n").write(t2)
        print("  settlements SIS aligned (enabled+LLM+zh_cn+oracle:9001)")

print("== done. compose: cd ops/docker/shadow && docker compose --env-file shadow.env up -d ==")
