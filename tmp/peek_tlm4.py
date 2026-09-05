import zipfile, subprocess, os, tempfile
jar = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mc\mods\touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'
z = zipfile.ZipFile(jar)
td = tempfile.mkdtemp()
targets = [
    'com/github/tartaricacid/touhoulittlemaid/ai/service/tts/gptsovits/TTSGptSovitsClient.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/tts/gptsovits/TTSGptSovitsSite.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/tts/gptsovits/TTSGptSovitsRequest.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/SerializerRegister.class',
    'com/github/tartaricacid/touhoulittlemaid/ai/service/SystemServices.class',
]
for t in targets:
    if t not in z.namelist():
        print('MISSING', t); continue
    z.extract(t, td)
    p = os.path.join(td, t)
    print('=' * 18, t.split('/')[-1], '=' * 18)
    r = subprocess.run(['javap', '-p', '-c', p], capture_output=True, text=True, timeout=30)
    for line in (r.stdout or '').splitlines():
        s = line.strip()
        if 'String ' in s or 'ldc' in s or ('public' in s and '(' in s) or ('private' in s and '(' in s):
            print(s[:150])
