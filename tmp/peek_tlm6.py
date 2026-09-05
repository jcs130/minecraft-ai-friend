import zipfile, re, os, tempfile
jar = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
z = zipfile.ZipFile(jar)
pat = re.compile(rb'[ -~]{4,120}')  # 可打印 ASCII 串
keys = ['site', 'ai_chat', 'aichat', 'chat_site']
hits = {}
for n in z.namelist():
    if not n.endswith('.class'):
        continue
    data = z.read(n)
    for m in pat.finditer(data):
        s = m.group().decode('ascii', 'ignore')
        if any(k in s.lower() for k in keys) and ('/' in s or s.endswith('.json')):
            hits.setdefault(s, set()).add(n.split('/')[-1])
for s, cls in sorted(hits.items()):
    print(repr(s), '<-', list(cls)[0])
