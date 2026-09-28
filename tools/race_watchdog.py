# 引擎外哨兵 v2：盯「轮次推进」+「输出是否停滞」+「supervisor死了直接重拉」
# 2026-09-28 晨检升级：桐人 t101 in_flight 死锁空转10h（轮龄闸拦不住）、鸣人 supervisor
# 随会话注销被 CTRL+C 带走（杀node等重拉成了空话）。每 10 分钟一跑。
import os, sys, json, time, subprocess, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

LOG = r'D:\Projects\QiandengJi\runtime\eye\race\watchdog.log'
CONTROLLER = r'D:\Projects\QiandengJi\server\survival-agent-state\survival\controller.json'
NRUN = r'D:\Projects\QiandengJi\runtime\eye\mindcraft-naruto-run.log'
STATE = r'D:\Projects\QiandengJi\runtime\eye\race\watchdog_state.json'
STATS_K = r'D:\Projects\QiandengJi\server\mc\shadow\stats\d4ac9523-4962-43ed-98c5-19b49e104048.json'
STATS_N = r'D:\Projects\QiandengJi\server\mc\shadow\stats\b9874570-7320-3424-8934-a904426170aa.json'
TURN_STALE_MIN = 40      # 轮次不翻页
OUT_STALE_MIN = 40       # 终局收紧：轮在翻但输出(move+mined)40分钟纹丝不动=电机死锁
NLOG_STALE_MIN = 40      # mindcraft 日志40分钟一字不写


def log(msg):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(time.strftime('%m-%d %H:%M:%S ') + msg + '\n')


def sh(c):
    subprocess.run(c, shell=True, capture_output=True)


def ps(cmd):
    return subprocess.run(['powershell', '-NoProfile', '-Command', cmd], capture_output=True).stdout.decode('utf-8', 'replace').strip()


def move_mined(p):
    try:
        s = json.load(open(p, encoding='utf-8')).get('stats', {})
        cm = s.get('minecraft:custom', {})
        mv = sum(cm.get(k, 0) for k in ('minecraft:walk_one_cm', 'minecraft:sprint_one_cm',
                                        'minecraft:walk_under_water_one_cm', 'minecraft:swim_one_cm',
                                        'minecraft:fly_one_cm')) + sum(s.get('minecraft:mined', {}).values()) * 100000
        return int(mv)
    except Exception:
        return None


def node_alive(needle):
    return bool(ps("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object {$_.CommandLine -match '" + needle + "'} | Select-Object -ExpandProperty ProcessId"))


st = {}
try:
    st = json.load(open(STATE, encoding='utf-8'))
except Exception:
    pass
now = time.time()

# --- 桐人 ---
try:
    d = json.load(open(CONTROLLER, encoding='utf-8'))
    dec = d.get('decisions') or []
    last_turn = max([x.get('startedAt', 0) for x in dec[-3:]] or [0])
    turn_age = (now - last_turn) / 60
    mm = move_mined(STATS_K)
    if st.get('k_sig') == mm:
        out_age = (now - st['k_sig_ts']) / 60
    else:
        st['k_sig'], st['k_sig_ts'] = mm, now
        out_age = 0
    if turn_age > TURN_STALE_MIN:
        log(f'kirito TURN-STALE {int(turn_age)}m -> restart survivor')
        sh('docker restart qiandengji-survivor-1')
        st['k_sig'] = None
    elif mm is not None and out_age > OUT_STALE_MIN:
        log(f'kirito OUTPUT-STALL {int(out_age)}m (turns fresh but move+mined frozen) -> restart survivor')
        sh('docker restart qiandengji-survivor-1')
        st['k_sig'] = None
    else:
        log(f'kirito ok turn={int(turn_age)}m outstall={int(out_age)}m status={d.get("status")}')
except Exception as e:
    log(f'kirito probe fail: {e}')

# --- 鸣人 ---
try:
    log_age = (now - os.path.getmtime(NRUN)) / 60
    if not node_alive('main.js'):
        log(f'naruto NO-NODE (supervisor dead, log-age {int(log_age)}m) -> schtasks /run')
        sh('schtasks /run /tn qiandengji-mindcraft-naruto')
        st['n_sig'] = None
    elif log_age > NLOG_STALE_MIN:
        mm = move_mined(STATS_N)
        log(f'naruto LOG-STALE {int(log_age)}m -> kill node (loop relaunch)')
        ps("Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object {$_.CommandLine -match 'main.js'} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }")
        if st.get('n_sig') == mm and mm is not None and (now - st.get('n_sig_ts', now)) / 60 > 90:
            log('naruto 复活后仍无输出 -> 整链 /run 重开')
            sh('schtasks /run /tn qiandengji-mindcraft-naruto')
    else:
        log(f'naruto ok log-age={int(log_age)}m')
    st['n_sig'] = move_mined(STATS_N)
    st['n_sig_ts'] = now
except Exception as e:
    log(f'naruto probe fail: {e}')

json.dump(st, open(STATE, 'w', encoding='utf-8'))

