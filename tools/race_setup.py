import io, sys, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, r'D:\Projects\QiandengJi\world\tools')
import ysm_assign as y
import subprocess, os

sec = y.read_secret('')
R = y.rcon
RACE_DIR = r'D:\Projects\QiandengJi\runtime\eye\race'
os.makedirs(RACE_DIR, exist_ok=True)
WHO = {'Kirito': 'd4ac9523-4962-43ed-98c5-19b49e104048', 'ag_naruto': 'b9874570-7320-3424-8934-a904426170aa'}
KIT = [('minecraft:stone_sword', 1), ('minecraft:stone_pickaxe', 1), ('minecraft:stone_axe', 1),
       ('minecraft:stone_shovel', 1), ('minecraft:torch', 16), ('minecraft:bread', 10),
       ('minecraft:crafting_table', 1), ('minecraft:furnace', 1), ('minecraft:chest', 2)]
START = (-554.5, 72, 866.5)

def rconc(cmd):
    r = R(cmd, sec)
    return (r or '').strip()[:120]

# 0) 等鸣人 spawn（重启后约需 20-40s）
for _ in range(12):
    lst = rconc('list')
    if 'ag_naruto' in lst and 'Kirito' in lst:
        break
    time.sleep(10)
print('在线:', lst)

# 1) 清空 + 发装备 + 同起点
for who in WHO:
    print(who, 'clear ->', rconc(f'clear {who}'))
    for item, n in KIT:
        rconc(f'give {who} {item} {n}')
    rconc(f'tp {who} {START[0]} {START[1]} {START[2]}')
    print(who, '装备已发, tp ->', rconc(f'data get entity @e[name={who},limit=1] Pos')[:90])
    time.sleep(0.5)

# 2) 零线：存档 stats 基线
for who, uu in WHO.items():
    txt = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'cat', f'/data/shadow/stats/{uu}.json'],
                         capture_output=True).stdout.decode('utf-8', 'replace')
    json.dump({'t0': time.strftime('%Y-%m-%d %H:%M:%S'), 'raw': json.loads(txt)},
              open(os.path.join(RACE_DIR, f'base_{who}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print(who, '零线已立')

# 3) 同一条长期目标（一次喊话，两人同闻）
GOAL = ('【神谕·竞速】桐人、ag_naruto：你们装备相同、起点相同（村广场）。长期目标——建一处安身之家：'
        '封闭房屋（墙、顶、门），屋内放1张床、点亮火把，配齐工作台、熔炉、箱子；再攒16个铁锭放进家里。'
        '明日正午天神验房定胜负，途中各自为战，互不相让！')
print('喊话 ->', rconc('say ' + GOAL)[:100])
open(os.path.join(RACE_DIR, 'goal.txt'), 'w', encoding='utf-8').write(GOAL)
print('SETUP DONE')
