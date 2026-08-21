# -*- coding: utf-8 -*-
"""提炼世界侧 agent 到 ~/.qwenpaw-agentos（容器 AgentOS 数据根，compose 挂载为 /root/.qwenpaw）。

容器是【全新安装】的 qwenpaw——无 legacy ~/.copaw 包袱，WORKING_DIR = ~/.qwenpaw（标准路径）。
故容器内 workspace_dir / media_dir 归一化到 /root/.qwenpaw/...（非 legacy /root/.copaw）。

世界侧 5 位（含 mc-god 分身）：
  mc-god          本尊分身——世界进程回退路由 + 世界复盘 + 重大裁决 + 技能生成(mc-saga) + 进化审核
  mc-herald       传令官——日常祷告/提问的第一裁量者
  mc-hearth       灶火神司——村民灵魂
  mc-guard-kirito 剑侍——桐人魂
  mc-guard-naruto 影侍——鸣人魂

模型策略（造物主 2026-08-21 定）：
  - 现在本地拉起的 Docker【用本地 qwen3.8】（宿主 vLLM 8890，容器经 host.docker.internal 访问）。
  - 之后分发云端再换成云端模型。故世界侧 5 位全部切本地 qwen3.8：
      mc-god 分身 -> qwen38-27b-god-local（女神专用，reasoning_effort=medium）
      其余 4 位  -> qwen38-27b-unc-local（熔融版，快速日常）—— 它们原本已是，无需改。

复制策略（白名单，只继承「神格 + 长期记忆」，不带「对话流水」）：
  复制   : AGENTS.md / SOUL.md / PROFILE.md / MEMORY.md / LESSONS.md / agent.json / skill.json
           memory/ skills/ mem_agent/ mem_metadata/ mem_session/ resource/ digest/
  排除   : history.db chats.json sessions/ checkpoints/ tool_results/ media/ .mcp/ *.tmp *.lock
           —— 对话流水含造物主私密，不进容器（服务器）。

provider 配置：
  - 复制本地 qwen3.8 的 custom provider 到容器 SECRET_DIR(/root/.qwenpaw/secret/providers/custom/)，
    base_url 127.0.0.1:8890 -> host.docker.internal:8890（容器访问宿主 vLLM）。

config.json / agent.json 精简：
  - 通道只启用 console；其余禁用并【清除密钥】(app_id/app_secret/api_key 等)。
  - MCP：minecraft_companion -> http://autoplayer:4177/mcp；winremote -> http://host.docker.internal:8090/mcp
  - embedding -> ollama bge-m3-cpu
  - media_dir 硬路径归一化到 /root/.qwenpaw

运行：python scripts/extract-world-agents.py
"""
import json, shutil, os, sys

sys.stdout.reconfigure(encoding='utf-8')

SRC = r"C:\Users\lzl19\.copaw"
SECRET_SRC = r"C:\Users\lzl19\.copaw.secret"
DST = r"C:\Users\lzl19\.qwenpaw-agentos"

WORLD_AGENTS = ["mc-god", "mc-herald", "mc-hearth", "mc-guard-kirito", "mc-guard-naruto"]

# 本地 qwen3.8 custom provider（相对 SECRET_SRC/providers 的路径）
LOCAL_PROVIDERS = [
    "custom/qwen38-27b-god-local.json",
    "custom/qwen38-27b-unc-local.json",
]
# 容器内访问宿主 vLLM 8890 的地址（Windows Docker 用 host.docker.internal）
VLLM_BASE_URL = "http://host.docker.internal:8890/v1"
# mc-god 分身切本地女神专用（medium 思考）
MC_GOD_AVATAR_MODEL = {"provider_id": "qwen38-27b-god-local",
                       "model": "qwen3.8-27b-uncensored"}

COPY_FILES = {"AGENTS.md", "SOUL.md", "PROFILE.md", "MEMORY.md", "LESSONS.md",
              "agent.json", "skill.json"}
COPY_DIRS = {"memory", "skills", "mem_agent", "mem_metadata", "mem_session",
             "resource", "digest"}

# 密钥字段：容器不需要，逐字清除
SECRET_KEYS = {"app_id", "app_secret", "client_id", "client_secret", "encrypt_key",
               "verification_token", "bot_token", "bot_id", "secret", "ak", "sk",
               "api_key", "access_token", "twilio_auth_token", "dashscope_api_key",
               "livekit_api_key", "livekit_api_secret", "password", "TAVILY_API_KEY",
               "app_token", "ws_url", "mqtt_password"}


def copy_agent_workspace(ag):
    s = os.path.join(SRC, "workspaces", ag)
    d = os.path.join(DST, "workspaces", ag)
    os.makedirs(d, exist_ok=True)
    copied, skipped = [], []
    for f in COPY_FILES:
        sf = os.path.join(s, f)
        if os.path.isfile(sf):
            shutil.copy2(sf, os.path.join(d, f))
            copied.append(f)
    for sub in COPY_DIRS:
        sd = os.path.join(s, sub)
        if os.path.isdir(sd):
            td = os.path.join(d, sub)
            for root, dirs, files in os.walk(sd):
                rel = os.path.relpath(root, sd)
                tt = td if rel == '.' else os.path.join(td, rel)
                os.makedirs(tt, exist_ok=True)
                for f in files:
                    sf = os.path.join(root, f)
                    tf = os.path.join(tt, f)
                    try:
                        shutil.copy2(sf, tf)
                    except Exception as e:
                        skipped.append((sf, str(e)[:60]))
    return copied, skipped


def norm(p):
    if isinstance(p, str):
        return (p.replace(r'C:\Users\lzl19\.copaw', '/root/.qwenpaw')
                 .replace('C:/Users/lzl19/.copaw', '/root/.qwenpaw'))
    return p


def scrub_secrets(node):
    if isinstance(node, dict):
        for k in list(node.keys()):
            if k in SECRET_KEYS:
                node[k] = ""
            else:
                scrub_secrets(node[k])
    elif isinstance(node, list):
        for it in node:
            scrub_secrets(it)


def copy_providers():
    """复制本地 qwen3.8 custom provider 到容器 SECRET_DIR，base_url 改 host.docker.internal。"""
    dst_root = os.path.join(DST, "secret", "providers")
    for rel in LOCAL_PROVIDERS:
        sf = os.path.join(SECRET_SRC, "providers", rel)
        tf = os.path.join(dst_root, rel)
        os.makedirs(os.path.dirname(tf), exist_ok=True)
        data = json.load(open(sf, encoding='utf-8'))
        data['base_url'] = VLLM_BASE_URL
        json.dump(data, open(tf, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(f"[provider] {rel} base_url -> {VLLM_BASE_URL}")
    # 容器级全局默认模型 -> 本地 qwen3.8（新建 agent / 未指定时的回退）
    am = {"provider_id": "qwen38-27b-unc-local", "model": "qwen3.8-27b-uncensored"}
    json.dump(am, open(os.path.join(dst_root, "active_model.json"), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print(f"[provider] active_model.json -> {am['provider_id']}/{am['model']}")


def process_agent_json(ag):
    """清理每个 agent.json 的通道（只留 console，清密钥）+ mc-god 分身切本地模型。"""
    path = os.path.join(DST, "workspaces", ag, "agent.json")
    if not os.path.isfile(path):
        return
    d = json.load(open(path, encoding='utf-8'))
    # 通道：只启用 console，清密钥
    ch = d.get('channels', {})
    for cname, ccfg in ch.items():
        if isinstance(ccfg, dict):
            ccfg['enabled'] = (cname == 'console')
            for sk in SECRET_KEYS:
                if sk in ccfg:
                    ccfg[sk] = ''
    # mc-god 分身切本地 qwen3.8（女神专用）
    if ag == 'mc-god':
        d['active_model'] = dict(MC_GOD_AVATAR_MODEL)
        print(f"[model] mc-god 分身 active_model -> {MC_GOD_AVATAR_MODEL['provider_id']}/{MC_GOD_AVATAR_MODEL['model']}")
    json.dump(d, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


def main():
    # ---- 1. 复制 workspace（神格 + 记忆）----
    for ag in WORLD_AGENTS:
        copied, skipped = copy_agent_workspace(ag)
        print(f"[copy] {ag}: {len(copied)} files+dirs, skipped {len(skipped)} locked")

    # ---- 1.5 复制本地 qwen3.8 provider（容器 SECRET_DIR）----
    copy_providers()

    # ---- 1.6 agent.json 清理 + mc-god 分身切模型 ----
    for ag in WORLD_AGENTS:
        process_agent_json(ag)

    # ---- 2. 生成容器 config.json ----
    cfg = json.load(open(os.path.join(SRC, "config.json"), encoding='utf-8'))

    profiles = {}
    for aid in WORLD_AGENTS:
        p = cfg['agents']['profiles'][aid].copy()
        p['workspace_dir'] = f"/root/.qwenpaw/workspaces/{aid}"
        profiles[aid] = p
    cfg['agents']['profiles'] = profiles
    cfg['agents']['agent_order'] = list(WORLD_AGENTS)
    cfg['agents']['active_agent'] = 'mc-herald'

    for ch in cfg['channels']:
        cfg['channels'][ch]['enabled'] = (ch == 'console')

    cfg['mcp']['clients']['minecraft_companion']['url'] = 'http://autoplayer:4177/mcp'
    cfg['mcp']['clients']['winremote']['url'] = 'http://host.docker.internal:8090/mcp'

    ec = cfg['agents']['running']['reme_light_memory_config']['embedding_model_config']
    ec.update({'backend': 'openai', 'api_key': 'ollama',
               'base_url': 'http://ollama:11434/v1', 'model_name': 'bge-m3-cpu'})

    for ch in cfg['channels'].values():
        if isinstance(ch, dict) and ch.get('media_dir'):
            ch['media_dir'] = norm(ch['media_dir'])

    scrub_secrets(cfg)

    out = os.path.join(DST, 'config.json')
    json.dump(cfg, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"[config] written -> {out}")
    print(f"[config] agents = {list(profiles.keys())}")
    print(f"[config] active_agent = {cfg['agents']['active_agent']}")
    print(f"[config] console.enabled = {cfg['channels']['console']['enabled']}")
    print(f"[config] feishu.enabled = {cfg['channels']['feishu']['enabled']}")


if __name__ == '__main__':
    main()
