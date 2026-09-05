import zipfile, subprocess, os, tempfile
jar = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
z = zipfile.ZipFile(jar)
targets = [
    'com/github/tartaricacid/touhoulittlemaid/ai/service/llm/DefaultLLMSite.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/llm/LLMSite.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/tts/TTSSite.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/stt/STTSite.class',
]
td = tempfile.mkdtemp()
for t in targets:
    z.extract(t, td)
    p = os.path.join(td, t)
    print('=' * 20, t.split('/')[-1], '=' * 20)
    r = subprocess.run(['javap', '-p', '-c', p], capture_output=True, text=True, timeout=30)
    out = r.stdout or r.stderr
    # 只打印字符串常量和关键签名行
    for line in out.splitlines():
        s = line.strip()
        if 'String ' in s or '// uri' in s or 'private ' in s or 'public ' in s or 'static ' in s and '(' in s:
            print(s[:160])
