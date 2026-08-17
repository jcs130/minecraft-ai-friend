import subprocess
import os

DIR = r'C:\Users\lzl19\.copaw\workspaces\default\deepseek-harness\scratch-plugin'
logf = open(os.path.join(DIR, 'web-panel.log'), 'w', encoding='utf-8')
p = subprocess.Popen(
    ['node', 'web-panel.mjs'],
    cwd=DIR,
    stdout=logf,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
    close_fds=True,
)
print('started web-panel pid', p.pid)
