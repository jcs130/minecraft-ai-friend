# -*- coding: utf-8 -*-
"""召唤三位讲述者 NPC 到初始集市广场（NoAI/无敌/持久化）"""
import socket, struct, io, sys, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

HOST, PORT = "127.0.0.1", 25575
PASS = open("deepseek-harness/scratch-plugin/data/rcon-secret.txt", encoding="utf-8-sig").read().strip()

def pkt(pid, ptype, body):
    d = struct.pack("<ii", pid, ptype) + body.encode("utf-8") + b"\x00\x00"
    return struct.pack("<i", len(d)) + d

def rp(s):
    raw = b""
    while len(raw) < 4:
        raw += s.recv(4 - len(raw))
    (ln,) = struct.unpack("<i", raw)
    d = b""
    while len(d) < ln:
        d += s.recv(ln - len(d))
    return d[8:-2].decode("utf-8", "replace")

def esc(t):
    """中文 -> \\uXXXX 转义，JSON 字符串安全"""
    out = []
    for ch in t:
        o = ord(ch)
        out.append(ch if 32 <= o < 127 and ch not in '"\\' else "\\u%04x" % o)
    return "".join(out)

def cmd(s, c):
    s.sendall(pkt(2, 2, c))
    return rp(s)

s = socket.create_connection((HOST, PORT), timeout=5)
s.sendall(pkt(1, 3, PASS)); rp(s)

# (名字, 职业, 颜色, 候选坐标列表)
NPCS = [
    ("吟游诗人·风临", "librarian", "aqua",        [(-105, 66, 167), (-105, 67, 167), (-104, 66, 167)]),
    ("守夜人·烛九",   "toolsmith", "gray",        [(-102, 66, 171), (-102, 67, 171), (-101, 66, 171)]),
    ("神官·静水",     "cleric",    "light_purple", [(-99, 66, 167), (-99, 67, 167), (-98, 66, 167)]),
]

def block_ok(s, x, y, z):
    """feet+head 空气 且 ground 实心"""
    a1 = cmd(s, f"execute if block {x} {y} {z} minecraft:air if block {x} {y+1} {z} minecraft:air run scoreboard players set #chk 1")
    # if 链失败时无输出；改用分别查询
    f = cmd(s, f"execute if block {x} {y} {z} minecraft:air run say A").strip()
    return f

def check(s, x, y, z):
    r1 = cmd(s, f"execute if block {x} {y} {z} air run say _OK1")
    time.sleep(0.05)
    r2 = cmd(s, f"execute if block {x} {y+1} {z} air run say _OK2")
    time.sleep(0.05)
    r3 = cmd(s, f"execute unless block {x} {y-1} {z} air run say _OK3")
    return ("_OK1" in r1) and ("_OK2" in r2) and ("_OK3" in r3)

placed = []
for name, prof, color, cands in NPCS:
    spot = None
    for (x, y, z) in cands:
        if check(s, x, y, z):
            spot = (x, y, z)
            break
        time.sleep(0.05)
    if not spot:
        x, y, z = cands[0]
        print(f"[WARN] {name} 无理想落点，强制 y+1 于 {x},{y+1},{z}")
        spot = (x, y + 1, z)
    x, y, z = spot
    nbt = ("{NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,"
           f"CustomName:'{{\"text\":\"{esc(name)}\",\"color\":\"{color}\"}}',CustomNameVisible:1b,"
           f"VillagerData:{{profession:\"minecraft:{prof}\",level:4,type:\"minecraft:plains\"}}}}")
    r = cmd(s, f"summon minecraft:villager {x} {y} {z} {nbt}")
    print(f"[SUMMON] {name} @ {x},{y},{z} -> {r[:80]}")
    placed.append(name)
    time.sleep(0.1)

# 验证
cnt = cmd(s, 'execute if entity @e[type=villager,name="' + esc("吟游诗人·风临") + '"] run say _F1')
print("验证·风临:", "_F1" in cnt)
cnt = cmd(s, 'execute if entity @e[type=villager,name="' + esc("守夜人·烛九") + '"] run say _F2')
print("验证·烛九:", "_F2" in cnt)
cnt = cmd(s, 'execute if entity @e[type=villager,name="' + esc("神官·静水") + '"] run say _F3')
print("验证·静水:", "_F3" in cnt)

# 全服公告
pub = "三位讲述者入驻初始集市广场——吟游诗人·风临、守夜人·烛九、神官·静水。走近他们，在聊天栏呼唤名字即可攀谈（如：诗人 编年史）。"
tell = '{"text":"' + esc("【女神公告】") + '","color":"gold","extra":[{"text":"' + esc(pub) + '","color":"yellow"}]}'
r = cmd(s, "tellraw @a " + tell)
print("公告:", r[:60] or "(sent)")
s.close()
print("DONE")
