"""拉 mc_npc 村民引擎（独立进程，detached）。与 start_webpanel.py 同模式。"""
import subprocess
import os
import sys

DIR = os.path.dirname(os.path.abspath(__file__))
WS = os.path.dirname(DIR)
SCRATCH = os.path.join(WS, 'deepseek-harness', 'scratch-plugin')

env = dict(os.environ)
env['NPC_DATA_DIR'] = os.path.join(SCRATCH, 'data')

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
