import subprocess
import os

DIR = os.path.dirname(os.path.abspath(__file__))  # 脚本所在目录即部署目录：repo 正本拷到现场即现场运行
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
