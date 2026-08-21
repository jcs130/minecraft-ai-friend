# -*- coding: utf-8 -*-
"""提炼世界侧 agent 到 ~/.qwenpaw-agentos（容器 AgentOS 数据根，compose 挂载为 /root/.qwenpaw）。

容器是【全新安装】的 qwenpaw——无 legacy ~/.copaw 包袱，WORKING_DIR = ~/.qwenpaw（标准路径）。
故容器内 workspace_dir / media_dir 归一化到 /root/.qwenpaw/...（非 legacy /root/.copaw）。

世界侧 5 位（含 mc-god 分身）：
  mc-god          本尊分身——世界进程回退路由 + 世界复盘 + 重大裁决的落点
  mc-herald       传令官——日常祷告/提问的第一裁量者
  mc-hearth       灶火神司——村民灵魂
  mc-guard-kirito 剑侍——桐人魂
  mc-guard-naruto 影侍——鸣人魂

复制策略（白名单，只继承「神格 + 长期记忆」，不带「对话流水」）：
  复制   : AGENTS.md / SOUL.md / PROFILE.md / MEMORY.md / LESSONS.md / agent.json / skill.json
           memory/ skills/ mem_agent/ mem_metadata/ mem_session/ resource/ digest/
  排除   : history.db chats.json sessions/ checkpoints/ tool_results/ media/ .mcp/ *.tmp *.lock
           —— 对话流水含造物主私密，不进容器（服务器）。

config.json 精简：
  - agents 只留 5 位世界侧，workspace_dir -> /root/.qwenpaw/workspaces/{id}
  - 通道只启用 console；feishu 禁用并【清除 app_id/app_secret】
  - MCP：minecraft_companion -> http://autoplayer:4177/mcp；winremote -> http://host.docker.internal:8090/mcp
  - embedding -> ollama bge-m3-cpu
  - media_dir 硬路径归一化到 /root/.qwenpaw

运行：python scripts/extract-world-agents.py
"""
import json, shutil, os, sys

sys.stdout.reconfigure(encoding='utf-8')

SRC = r"C:\Users\lzl19\.copaw"
DST = r"C:\Users\lzl19\.qwenpaw-agentos"

WORLD_AGENTS = ["mc-god", "mc-herald", "mc-hearth", "mc-guard-kirito", "mc-guard-naruto"]

COPY_FILES = {"AGENTS.md", "SOUL.md", "PROFILE.md", "MEMORY.md", "LESSONS.md",
              "agent.json", "skill.json"}
COPY_DIRS = {"memory", "skills", "mem_agent", "mem_metadata", "mem_session",
             "resource", "digest"}

# 密钥字段：容器不需要，逐字清除
SECRET_KEYS = {"app_id", "app_secret", "client_id", "client_secret", "encrypt_key",
               "verification_token", "bot_token", "bot_id", "secret", "ak", "sk",
               "api_key", "access_token", "twilio_auth_token", "dashscope_api_key",
               "livekit_api_key", "livekit_api_secret", "password", "TAVILY_API_KEY",
               "app_token", "ws_url"}


def copy_agent_workspace(ag):
    s = os.path.join(SRC, "workspaces", ag)
    d = os.path.join(DST, "workspaces", ag)
    os.makedirs(d, exist_ok=True)
    copied, skipped = [], []
    # 顶层白名单文件
    for f in COPY_FILES:
        sf = os.path.join(s, f)
        if os.path.isfile(sf):
            shutil.copy2(sf, os.path.join(d, f))
            copied.append(f)
    # 白名单目录
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
    """递归清除容器 config 里的密钥字段。"""
    if isinstance(node, dict):
        for k in list(node.keys()):
            if k in SECRET_KEYS:
                node[k] = ""
            else:
                scrub_secrets(node[k])
    elif isinstance(node, list):
        for it in node:
            scrub_secrets(it)


def main():
    # ---- 1. 复制 workspace（神格 + 记忆）----
    for ag in WORLD_AGENTS:
        copied, skipped = copy_agent_workspace(ag)
        print(f"[copy] {ag}: {len(copied)} files+dirs, skipped {len(skipped)} locked")

    # ---- 2. 生成容器 config.json ----
    cfg = json.load(open(os.path.join(SRC, "config.json"), encoding='utf-8'))

    # agents 精简（5 位世界侧）
    profiles = {}
    for aid in WORLD_AGENTS:
        p = cfg['agents']['profiles'][aid].copy()
        p['workspace_dir'] = f"/root/.qwenpaw/workspaces/{aid}"
        profiles[aid] = p
    cfg['agents']['profiles'] = profiles
    cfg['agents']['agent_order'] = list(WORLD_AGENTS)
    cfg['agents']['active_agent'] = 'mc-herald'

    # 通道：只启用 console
    for ch in cfg['channels']:
        cfg['channels'][ch]['enabled'] = (ch == 'console')

    # MCP URL
    cfg['mcp']['clients']['minecraft_companion']['url'] = 'http://autoplayer:4177/mcp'
    cfg['mcp']['clients']['winremote']['url'] = 'http://host.docker.internal:8090/mcp'

    # embedding -> ollama bge-m3-cpu
    ec = cfg['agents']['running']['reme_light_memory_config']['embedding_model_config']
    ec.update({'backend': 'openai', 'api_key': 'ollama',
               'base_url': 'http://ollama:11434/v1', 'model_name': 'bge-m3-cpu'})

    # media_dir 硬路径归一化
    for ch in cfg['channels'].values():
        if isinstance(ch, dict) and ch.get('media_dir'):
            ch['media_dir'] = norm(ch['media_dir'])

    # 清除密钥
    scrub_secrets(cfg)

    out = os.path.join(DST, 'config.json')
    json.dump(cfg, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"[config] written -> {out}")
    print(f"[config] agents = {list(profiles.keys())}")
    print(f"[config] active_agent = {cfg['agents']['active_agent']}")
    print(f"[config] console.enabled = {cfg['channels']['console']['enabled']}")
    print(f"[config] feishu.enabled = {cfg['channels']['feishu']['enabled']} | app_id = {cfg['channels']['feishu'].get('app_id')!r}")


if __name__ == '__main__':
    main()
