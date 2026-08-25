import subprocess
import os

DIR = os.path.dirname(os.path.abspath(__file__))  # 脚本所在目录即部署目录：repo 正本拷到现场即现场运行
# 2026-08-26 清 A 仓残留：数据源自持 B 仓 mc-data / mc-server（与世界进程同源，
# status-*.json + screenshots 均在 mc-data，不再跨仓借 A 仓目录）
env = dict(os.environ)
env['MC_DATA_DIR'] = os.path.join(DIR, 'mc-data')
env['MC_SERVER_DIR'] = os.path.join(DIR, 'mc-server')

logf = open(os.path.join(DIR, 'web-panel.log'), 'w', encoding='utf-8')
p = subprocess.Popen(
    ['node', 'web-panel.mjs'],
    cwd=DIR,
    env=env,
    stdout=logf,
    stderr=subprocess.STDOUT,
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
    close_fds=True,
)
print('started web-panel pid', p.pid, 'MC_DATA_DIR=', env['MC_DATA_DIR'])
