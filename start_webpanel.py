import subprocess
import os

DIR = os.path.dirname(os.path.abspath(__file__))  # 脚本所在目录即部署目录：repo 正本拷到现场即现场运行
WS = os.path.dirname(DIR)  # workspaces/default
SCRATCH = os.path.join(WS, 'deepseek-harness', 'scratch-plugin')

# 面板数据源必须指向 A 仓 scratch-plugin/data（status-*.json + screenshots + mc-brain.log）
# 否则 DATA_DIR 落到 B 仓空 data，/shot/ 404、面板显示「暂无截图」（2026-08-21 定位）
env = dict(os.environ)
env['MC_DATA_DIR'] = os.path.join(SCRATCH, 'data')
env['MC_SERVER_DIR'] = os.path.join(SCRATCH, 'mc-server-neoforge')

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
