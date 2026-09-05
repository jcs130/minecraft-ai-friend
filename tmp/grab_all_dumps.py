import sys, re
txt = sys.stdin.read()
frames = txt.split('"Server thread"')
frames = [f for f in frames[1:]]
print('total server-thread frames:', len(frames))
for f in frames[-3:]:
    head = '"Server thread"' + f[:900]
    # 提取 cpu/elapsed + 前 6 个 at 行
    m = re.search(r'cpu=([0-9.]+)ms elapsed=([0-9.]+)s', head)
    ats = re.findall(r'at ([\w.$()/<>]+)[:\s]', head)
    print('---- frame cpu=%sms elapsed=%ss' % (m.groups() if m else ('?','?')))
    for a in ats[:7]:
        print('   ', a[:120])
