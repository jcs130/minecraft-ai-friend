import io, sys, json, time, os, re, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, r'D:\Projects\QiandengJi\world\tools')
import ysm_assign as y

sec = y.read_secret('')
R = y.rcon
RACE_DIR = r'D:\Projects\QiandengJi\runtime\eye\race'
os.makedirs(RACE_DIR, exist_ok=True)
WHO = {'Kirito': 'd4ac9523-4962-43ed-98c5-19b49e104048', 'ag_naruto': 'b9874570-7320-3424-8934-a904426170aa'}
HOLD = ['minecraft:iron_ingot', 'minecraft:raw_iron', 'minecraft:oak_log', 'minecraft:white_bed',
        'minecraft:wooden_door', 'minecraft:furnace', 'minecraft:chest', 'minecraft:crafting_table',
        'minecraft:iron_sword', 'minecraft:iron_pickaxe', 'minecraft:iron_helmet',
        'minecraft:iron_chestplate', 'minecraft:iron_leggings', 'minecraft:iron_boots']
PLACE_USED = ['minecraft:crafting_table', 'minecraft:furnace', 'minecraft:chest', 'minecraft:torch',
              'minecraft:wooden_door', 'minecraft:bread']

def stat_custom(s):
    return s.get('minecraft:custom', {})

def read_stats(uu):
    txt = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'cat', f'/data/shadow/stats/{uu}.json'],
                         capture_output=True).stdout.decode('utf-8', 'replace')
    return json.loads(txt).get('stats', {})

def move_m(s):
    m = stat_custom(s)
    return sum(m.get(k, 0) for k in ('minecraft:walk_one_cm', 'minecraft:sprint_one_cm',
                                     'minecraft:walk_under_water_one_cm', 'minecraft:swim_one_cm',
                                     'minecraft:fly_one_cm')) / 100.0

snap = {'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'players': {}}
for who, uu in WHO.items():
    try:
        base = json.load(open(os.path.join(RACE_DIR, f'base_{who}.json'), encoding='utf-8'))['raw']['stats']
    except Exception:
        snap['players'][who] = {'error': 'no-base'}
        continue
    cur = read_stats(uu)
    pos = (R(f'data get entity @e[name={who},limit=1] Pos', sec) or '')
    mp = re.search(r'\[([-\d.,df ]+)\]', pos)
    try:
        coords = [round(float(x.strip().rstrip('df')), 1) for x in mp.group(1).split(',')[:3]] if mp else None
    except Exception:
        coords = None
    hold = {}
    for it in HOLD:
        r = R(f'clear {who} {it} 0', sec) or ''
        m = re.search(r'Found (\d+) matching', r)
        if m:
            hold[it.split(':')[1]] = int(m.group(1))
        elif 'no matching' in r.lower() or 'not found' in r.lower() or 'no items' in r.lower():
            hold[it.split(':')[1]] = 0
        else:
            hold[it.split(':')[1]] = -1
    used_cur = cur.get('minecraft:used', {})
    used_base = base.get('minecraft:used', {})
    place = {it.split(':')[1]: used_cur.get(it, 0) - used_base.get(it, 0) for it in PLACE_USED}
    cm_c, cm_b = stat_custom(cur), stat_custom(base)
    snap['players'][who] = {
        'pos': coords,
        'online_h': round((cm_c.get('minecraft:play_time', 0) - cm_b.get('minecraft:play_time', 0)) / 72000, 2),
        'move_m': round(move_m(cur) - move_m(base)),
        'mined': sum(cur.get('minecraft:mined', {}).values()) - sum(base.get('minecraft:mined', {}).values()),
        'crafted': sum(cur.get('minecraft:crafted', {}).values()) - sum(base.get('minecraft:crafted', {}).values()),
        'kills': sum(cur.get('minecraft:killed', {}).values()) - sum(base.get('minecraft:killed', {}).values()),
        'deaths': cm_c.get('minecraft:deaths', 0) - cm_b.get('minecraft:deaths', 0),
        'sleep': cm_c.get('minecraft:sleep_in_bed', 0) - cm_b.get('minecraft:sleep_in_bed', 0),
        'hold': hold, 'place_delta': place,
    }
with open(os.path.join(RACE_DIR, 'snap-' + time.strftime('%Y%m%d') + '.jsonl'), 'a', encoding='utf-8') as f:
    f.write(json.dumps(snap, ensure_ascii=False) + '\n')
with open(os.path.join(RACE_DIR, 'snap.log'), 'a', encoding='utf-8') as f:
    def gear(p):
        h = p.get('hold', {})
        armor = sum(max(0, h.get(k, 0)) for k in ('iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'))
        wp = ''.join([('剑' if h.get('iron_sword', 0) > 0 else ''), ('镐' if h.get('iron_pickaxe', 0) > 0 else '')])
        return f"甲{armor}/4 兵[{wp or '无'}]"
    f.write(snap['ts'] + ' | ' + ' || '.join(
        f"{w}: move={p.get('move_m')}m mined={p.get('mined')} kills={p.get('kills')} deaths={p.get('deaths')} "
        f"铁锭={p.get('hold', {}).get('iron_ingot')} {gear(p)} 床={p.get('hold', {}).get('white_bed')} "
        f"睡={p.get('sleep')} pos={p.get('pos')}"
        for w, p in snap['players'].items()) + '\n')
print(open(os.path.join(RACE_DIR, 'snap.log'), encoding='utf-8').read().splitlines()[-1])
