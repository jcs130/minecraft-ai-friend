import zipfile, sys, os
base = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp'
for name in ['tlm-self-talk-1.1.2-neoforge-1.21.1.jar', 'touhou-maid-affection-1.7.2.2.jar']:
    p = os.path.join(base, name)
    try:
        z = zipfile.ZipFile(p)
        bad = z.testzip()
        print(name, '| zip:', 'OK' if bad is None else 'CORRUPT:' + str(bad),
              '| entries:', len(z.namelist()),
              '| uncompressed:', sum(i.file_size for i in z.infolist()) // 1024, 'KB')
        for n in z.namelist():
            if 'mods.toml' in n:
                txt = z.read(n).decode('utf-8', 'ignore')
                for line in txt.splitlines():
                    s = line.strip()
                    if any(k in s for k in ['modId', 'version', 'displayName', 'loader', 'dependency', 'touhou']):
                        print('   ', s[:110])
    except Exception as e:
        print(name, 'FAIL', repr(e))
