import zipfile, subprocess, os, tempfile
jar = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
z = zipfile.ZipFile(jar)
names = z.namelist()

td = tempfile.mkdtemp()
# 1) tts/stt/llm 包下全部类名（看 api_type 家族）
pkgs = [n for n in names if n.endswith('.class') and ('/ai/service/' in n)]
print('=== ai/service classes ===')
for n in sorted(pkgs):
    print(n.split('touhoulittlemaid/')[-1])

# 2) 找路径常量：抽所有含 path/config 字样的关键类，javap 搜字符串 'chat' 'site' '.json' 'touhoulittlemaid/'
cand = [n for n in names if n.endswith('.class') and any(k in n for k in ['AIChatCommand', 'SerializerRegister', 'ConfigLoader', 'ModConfig', 'TouhouLittleMaid.class'])]
cand += ['com/github/tartaricacid/touhoulittlemaid/TouhouLittleMaid.class']
print('\n=== path constants ===')
seen = set()
for t in cand:
    if t not in names:
        continue
    z.extract(t, td)
    p = os.path.join(td, t)
    r = subprocess.run(['javap', '-p', '-c', p], capture_output=True, text=True, timeout=30)
    for line in (r.stdout or '').splitlines():
        s = line.strip()
        if 'String ' in s and any(k in s for k in ['chat', 'site', '.json', 'config', 'ai']):
            frag = s.split('// String ')[-1] if '// String ' in s else s
            if frag not in seen:
                seen.add(frag)
                print(t.split('/')[-1], '->', frag[:120])
