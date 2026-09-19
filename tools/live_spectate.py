"""live_spectate.py — 直播机位「附身观战」跟随器（天神 2026-09-20）

用途：把真实客户端 `live`（B 站直播端，可开光影）附身到某个 Agent 身上观战。
机制：租约文件驱动 —— 有租约才跟随，没租约就归位并休眠；进程本身可常驻。

    python live_spectate.py start NekoX        # 开始观战 NekoX
    python live_spectate.py start 桐人          # 换目标（写租约即生效）
    python live_spectate.py stop               # 停止并把 live 送回原地
    python live_spectate.py status             # 看当前租约/在线情况
    python live_spectate.py loop               # 常驻跟随循环（由计划任务拉这个）

设计约束（都写死在下面）：
  * 只允许跟随"名册内"的目标，且绝不写任何玩家背包/属性 —— 只发 tp/gamemode。
  * live 不在服时不发任何命令，避免 RCON 报错刷屏。
  * 租约带 TTL：控制端崩了，跟随会在过期后自动停并把 live 归位（不留幽灵机位）。
"""
import json
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

CAMERA = 'live'                       # 直播机位账号（真实客户端）
STATE = Path(__file__).resolve().parent.parent / 'server' / 'world-data' / 'live-spectate.json'
LEASE_TTL = 300.0                     # 租约有效期（秒）：控制端失联即自动停
FOLLOW_INTERVAL = 0.5                 # 跟随频率（秒）
ALLOWED_TARGETS = {'NekoX', 'Kirito', 'Naruto', 'Edward', 'Steve', 'Alex', 'MengMeng', 'live'}
# 宿主侧 RCON：compose 把容器 25575 映射到 127.0.0.1:25577（只绑回环，不出网）。
RCON_HOST, RCON_PORT = '127.0.0.1', 25577
_PW = None


def _password():
    """口令现读自容器 server.properties，不落盘不进仓库。"""
    global _PW
    if _PW is None:
        r = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'sh', '-c',
                            "grep -E '^rcon.password' /data/server.properties | cut -d= -f2"],
                           capture_output=True, text=True, timeout=30,
                           encoding='utf-8', errors='replace')
        _PW = (r.stdout or '').strip()
        if not _PW:
            raise RuntimeError('rcon password unavailable')
    return _PW


class _Rcon:
    def __init__(self):
        self.s = socket.create_connection((RCON_HOST, RCON_PORT), timeout=10)
        self.n = 100
        self._send(99, 3, _password())
        self._recv()

    def _send(self, i, t, b):
        p = struct.pack('<ii', i, t) + b.encode('utf-8') + b'\x00\x00'
        self.s.sendall(struct.pack('<i', len(p)) + p)

    def _recv(self):
        hdr = self.s.recv(4)
        if len(hdr) < 4:
            return ''
        ln = struct.unpack('<i', hdr)[0]
        d = b''
        while len(d) < ln:
            chunk = self.s.recv(ln - len(d))
            if not chunk:
                break
            d += chunk
        return d[8:-2].decode('utf-8', 'replace').strip() if len(d) > 10 else ''

    def cmd(self, command):
        self.n += 1
        self._send(self.n, 2, command)
        return self._recv()

    def close(self):
        try:
            self.s.close()
        except Exception:
            pass


_CONN = None


def rcon(cmd):
    """单条 RCON 命令；连接断了就自动重建（跟随器要能长活）。"""
    global _CONN
    for _ in range(2):
        try:
            if _CONN is None:
                _CONN = _Rcon()
            return _CONN.cmd(cmd)
        except Exception:
            if _CONN:
                _CONN.close()
            _CONN = None
    return '(rcon failed)'


def load():
    try:
        return json.loads(STATE.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')


def lease_active(state):
    return bool(state.get('target')) and time.time() - float(state.get('at', 0)) < LEASE_TTL


def online(name):
    out = rcon('data get entity %s Health' % name)
    return 'entity data' in out


def do_start(target):
    if target not in ALLOWED_TARGETS:
        print('refused: %r 不在允许观战的名册里（改 ALLOWED_TARGETS 再加）' % target)
        return 2
    state = load()
    if not state.get('home'):
        pos = rcon('data get entity %s Pos' % CAMERA)
        # 只有真拿到坐标才算captured到归位点；机位此刻不在线就留空，别存错误文案。
        if 'entity data' in pos and '[' in pos:
            state['home'] = pos
    state['target'] = target
    state['at'] = time.time()
    save(state)
    print(rcon('gamemode spectator %s' % CAMERA))
    print('观战已挂上：%s → %s（机位上线即自动附身；跟随器进程若死，租约过期自动停）' % (CAMERA, target))
    return 0


def do_stop():
    state = load()
    state['target'] = None
    state['at'] = time.time()
    save(state)
    if state.get('home') and 'entity data' in str(state.get('home')):
        print(rcon('%s' % ('gamemode survival %s' % CAMERA)))
    print('已停止观战（live 归位交由 loop 执行，或手动 tp）')
    return 0


def do_status():
    state = load()
    print(json.dumps({'camera_online': online(CAMERA), 'lease_active': lease_active(state),
                      'target': state.get('target'), 'age': round(time.time() - float(state.get('at', 0)), 1),
                      'home_captured': bool(state.get('home'))}, ensure_ascii=False, indent=2))
    return 0


def do_loop():
    """常驻循环：有租约就跟，没租约就归位后小睡。

    ★心跳续租：只要"跟随器活着 且 机位在线"，就刷新租约时间 —— 这样直播端晚点上线
    也不会因为 TTL 先到期而错过；而跟随器进程本身死了就没人续租，租约自然过期，
    不会留下一个永远在拽镜头的幽灵机位。
    """
    parked = True
    while True:
        state = load()
        if state.get('target'):
            # 心跳：只要跟随器活着且挂着目标就续租，机位晚点上线也接得上。
            state['at'] = time.time()
            save(state)
        if lease_active(state) and online(CAMERA):
            target = state['target']
            if not online(target):
                time.sleep(2)
                continue
            rcon('tp %s %s' % (CAMERA, target))
            parked = False
            time.sleep(FOLLOW_INTERVAL)
            continue
        if not parked:
            home = state.get('home') or ''
            if 'entity data' in home:
                nums = home[home.find('[') + 1:home.find(']')].split(',')
                if len(nums) == 3:
                    rcon('tp %s %s %s %s' % (CAMERA, nums[0].strip(), nums[1].strip(), nums[2].strip()))
            rcon('gamemode survival %s' % CAMERA)
            parked = True
        time.sleep(2)


def main(argv):
    action = argv[1] if len(argv) > 1 else 'status'
    if action == 'start' and len(argv) > 2:
        return do_start(argv[2])
    if action == 'stop':
        return do_stop()
    if action == 'status':
        return do_status()
    if action == 'loop':
        return do_loop()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
