"""live_spectate.py — 直播机位「附身观战」开关（官方 /spectate 版）

★2026-09-20 定谳：Java 版 1.21 有官方观战命令，服务端直接把观战者的镜头锁到目标实体上
（`/help spectate` → `/spectate [<target>] [<player>]`）。所以这里【不需要】外部跟随循环 ——
之前那版每 0.5s 发一次 tp 是土办法，会跟服务端镜头锁打架，也已经废弃 ✗。

用法：
    python live_spectate.py start NekoX     # 让直播机位附身观战 NekoX
    python live_spectate.py switch Kirito   # 换人（等价于再 start 一次，不必先 stop）
    python live_spectate.py stop            # 取消观战，机位归回生存
    python live_spectate.py status          # 看机位/目标状态
    python live_spectate.py list            # 列出可附身的在线玩家

★直播中更快的切人办法（零权限、原版机制，不用跑本脚本）✓：
    旁观模式下按【鼠标中键】打开观战菜单 → "Teleport to Player" → 选中要看的人 ✓
    （键位出处：客户端 options.txt 的 key.spectatorHotbar = mouse.middle ✓）
    另：F4 = 观战时切换光影效果（toggleSpectatorShaderEffects ✓）

前提与注意（都是官方行为，不是本脚本的限制）：
  * 观战者必须在旁观模式 —— start 会自动切 ✓
  * 观战者【自己一动】镜头就脱离锁定（原版设定 ✓）；要重新锁上再 start / 或中键菜单选一次 ✓
  * 一个名字只能一个客户端 ✓，所以 live 由直播端真实客户端登录，本脚本只下命令不登录 ✓
"""
import subprocess
import sys

CAMERA = 'live'                       # 直播机位账号（B 站直播端的真实客户端）
ALLOWED_TARGETS = {'NekoX', 'Kirito', 'Naruto', 'Edward', 'Steve', 'Alex', 'MengMeng',
                   'Goddess', 'live'}
RCON_HOST, RCON_PORT = '127.0.0.1', 25577      # compose 把容器 25575 只映射到宿主回环


def _password():
    r = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'sh', '-c',
                        "grep -E '^rcon.password' /data/server.properties | cut -d= -f2"],
                       capture_output=True, text=True, timeout=30,
                       encoding='utf-8', errors='replace')
    pw = (r.stdout or '').strip()
    if not pw:
        raise RuntimeError('rcon password unavailable')
    return pw


def rcon(cmd):
    """一条命令一个连接：观战是低频操作，不值得维护长连接。"""
    import socket
    import struct
    s = socket.create_connection((RCON_HOST, RCON_PORT), timeout=10)

    def send(i, t, b):
        p = struct.pack('<ii', i, t) + b.encode('utf-8') + b'\x00\x00'
        s.sendall(struct.pack('<i', len(p)) + p)

    def recv():
        hdr = s.recv(4)
        if len(hdr) < 4:
            return ''
        ln = struct.unpack('<i', hdr)[0]
        d = b''
        while len(d) < ln:
            chunk = s.recv(ln - len(d))
            if not chunk:
                break
            d += chunk
        return d[8:-2].decode('utf-8', 'replace').strip() if len(d) > 10 else ''

    try:
        send(99, 3, _password())
        recv()
        send(100, 2, cmd)
        return recv()
    finally:
        s.close()


def _clean(text):
    return ' '.join((text or '').split())


def do_start(target):
    if target not in ALLOWED_TARGETS:
        print('refused: %r 不在可附身名册里（ALLOWED_TARGETS 加一下再来）' % target)
        return 2
    print('  1) %s' % _clean(rcon('gamemode spectator %s' % CAMERA)))
    # 官方语法：/spectate <target> <player> —— 第二个参数才是要当镜头的那个号。
    print('  2) %s' % _clean(rcon('spectate %s %s' % (target, CAMERA))))
    print('  机位 %s 已锁定观战 %s；若你手动一动镜头会脱锁（原版行为），再跑一次 start 即可。' % (CAMERA, target))
    return 0


def do_stop():
    # 裸 `spectate stop` 在控制台没有执行者上下文 → 用 execute as 把身份给对。
    print('  1) %s' % (_clean(rcon('execute as %s run spectate stop' % CAMERA)) or '（已停止观战）'))
    print('  2) %s' % _clean(rcon('gamemode survival %s' % CAMERA)))
    return 0


def do_status():
    for who in (CAMERA, 'NekoX'):
        pos = _clean(rcon('data get entity %s Pos' % who))
        hp = _clean(rcon('data get entity %s Health' % who))
        gm = _clean(rcon('data get entity %s playerGameType' % who))
        print('  %-6s pos=%s | health=%s | gameType=%s' % (
            who, pos[pos.find('['):] if '[' in pos else '?', hp[-6:] if hp else '?', gm[-4:] if gm else '?'))
    print('  在线:', _clean(rcon('list'))[-120:])
    return 0


def do_list():
    print(' ', _clean(rcon('list'))[-200:])
    print('  可附身目标:', ', '.join(sorted(t for t in ALLOWED_TARGETS if t != CAMERA)))
    return 0


def main(argv):
    action = argv[1] if len(argv) > 1 else 'status'
    # switch 就是再 start 一次：/spectate 可以直接换目标，不必先 stop（实测 ✓）。
    if action in ('start', 'switch') and len(argv) > 2:
        return do_start(argv[2])
    if action == 'stop':
        return do_stop()
    if action == 'status':
        return do_status()
    if action == 'list':
        return do_list()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
