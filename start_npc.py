"""拉 mc_npc 村民引擎（独立进程，detached）。与 start_webpanel.py 同模式。"""
import subprocess
import os
import sys

DIR = os.path.dirname(os.path.abspath(__file__))
WS = os.path.dirname(DIR)

env = dict(os.environ)
env['NPC_DATA_DIR'] = os.path.join(DIR, 'mc-data')
# VIP 重点看护名单（与 restart-world.py / bootstrap-world.mts 对齐）：注入 MC_VIP_LISTEN
# 供 mc_npc.py 读 VIP_LIST——让 VIP 真人旅人（萌萌）的公屏发言由女神独占处理、NPC 让位，
# 不再被牧羊女等村民抢答（2026-08-23 造物主谕「让女神化身重点服务」）。
env['MC_VIP_LISTEN'] = os.environ.get('MC_VIP_LISTEN') or 'mengmeng,kangqiang'
# 服务器日志（2026-08-29 修复）：容器化后裸机路径 mc-server-neoforge/logs 已不存在——
# shadow-mc 容器 /data 挂载到 ops/docker/shadow/mc，公屏感知 tail 这里的 latest.log。
env['NPC_LOG_PATH'] = os.environ.get('NPC_LOG_PATH') or os.path.join(
    DIR, 'ops', 'docker', 'shadow', 'mc', 'logs', 'latest.log')

# RCON 密码自动同步（2026-08-29 修复）：真源是 shadow/data/rcon-secret.txt（容器编排生成），
# mc-data/ 下的是副本会过期——启动前同步，防「rcon auth failed」启动即死。
_rcon_true = os.path.join(DIR, 'ops', 'docker', 'shadow', 'data', 'rcon-secret.txt')
_rcon_copy = os.path.join(DIR, 'mc-data', 'rcon-secret.txt')
if os.path.isfile(_rcon_true):
    try:
        with open(_rcon_true, encoding='utf-8-sig') as f:
            _secret = f.read().strip()
        with open(_rcon_copy, 'w', encoding='utf-8') as f:
            f.write(_secret)
    except OSError:
        pass

# 用什么 python 跑：优先 qwenpaw venv（历史权威），uv 3.12 兜底
PY = os.environ.get('NPC_PY') or r'C:\Users\lzl19\.qwenpaw\venv\Scripts\python.exe'
if not os.path.exists(PY):
    PY = r'C:\Users\lzl19\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe'

logf = open(os.path.join(DIR, 'npc-engine.out.log'), 'a', encoding='utf-8')
p = subprocess.Popen(
    [PY, os.path.join(DIR, 'sidecar', 'mc_npc.py')],
    cwd=DIR,
    env=env,
    stdout=logf,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
    close_fds=True,
)
print('started mc_npc pid', p.pid, 'NPC_DATA_DIR=', env['NPC_DATA_DIR'])
