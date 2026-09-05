import re
log = open(r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp\mc-last-boot.log', encoding='utf-8', errors='ignore').read()
print('log length:', len(log))
pats = [
    ('affection', r'.{0,90}affection.{0,60}'),
    ('self-talk', r'.{0,60}self.talk.{0,60}'),
    ('skipping-jar', r'.{0,60}Skipping jar.{0,80}'),
    ('done', r'Done \([0-9.]+s\).{0,40}'),
    ('tlm', r'.{0,50}touhou_little_maid.{0,60}'),
    ('settlements-missing', r'.{0,60}settlements.{0,50}MISSING.{0,20}'),
]
for name, pat in pats:
    ms = re.findall(pat, log, re.I)
    print('==', name, len(ms))
    for m in ms[:5]:
        print('  ', m.strip())
