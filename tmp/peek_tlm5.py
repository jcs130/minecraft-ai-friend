import zipfile, subprocess, os, tempfile
jar = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
z = zipfile.ZipFile(jar)
names = z.namelist()
td = tempfile.mkdtemp()

# 找调用 readSites/writeSites 的类（谁决定 Path）
cands = [n for n in names if n.endswith('.class') and any(k in n for k in ['AIChatCommand', 'SystemServices', 'SaveLLMSitePacket', 'SyncAISitesPacket'])]
for t in cands:
    z.extract(t, td)
    p = os.path.join(td, t)
    r = subprocess.run(['javap', '-p', '-c', p], capture_output=True, text=True, timeout=30)
    out = r.stdout or ''
    if 'readSites' not in out and 'writeSites' not in out:
        continue
    print('=' * 15, t.split('/')[-1], '=' * 15)
    lines = out.splitlines()
    for i, line in enumerate(lines):
        if 'readSites' in line or 'writeSites' in line:
            ctx = lines[max(0, i-12):i+2]
            print('\n'.join(x.strip()[:140] for x in ctx))
            print('---')
