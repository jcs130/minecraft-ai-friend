# -*- coding: utf-8 -*-
"""v4 性格化语音包打包：lines_v4/<voice>.json（组名→台词数组）× 141 槽位。
用法: python make_pack_v4.py ark_pepe [ark_texas ...]   # 产出 <voice>-1.3.0.zip
"""
import sys, os, json, re, urllib.request, urllib.parse, subprocess, zipfile

sys.stdout.reconfigure(encoding='utf-8')

VOICES = sys.argv[1:] or ['ark_pepe']
VER = '1.3.0'
BASE = r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\tmp'
FFMPEG = r'C:\Users\lzl19\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe'
OGL = json.load(open(os.path.join(BASE, 'pack_tpl', 'ogg_list.json'), encoding='utf-8'))

# 槽位文件名 → v4 组名映射（同 v3）
def group_for(rel):
    m = re.search(r'sounds/maid/([a-z_]+)/([a-z_]+?)(\d*)\.ogg$', rel)
    grp, slot = m.group(1), m.group(2)
    return slot if slot != 'snow' or grp == 'mode' else 'environment_snow'


AMIYA = None  # REUSE fallback


def build(voice):
    global AMIYA
    if AMIYA is None:
        AMIYA = json.load(open(os.path.join(BASE, 'lines_v4', 'ark_amiya.json'), encoding='utf-8'))
    lines = json.load(open(os.path.join(BASE, 'lines_v4', f'{voice}.json'), encoding='utf-8'))
    work = os.path.join(BASE, f'pack_v4_{voice}')
    stage = os.path.join(work, 'stage')
    os.makedirs(stage, exist_ok=True)
    ok, fail = 0, []
    for i, rel in enumerate(OGL, 1):
        key = group_for(rel)
        arr = lines.get(key)
        if arr == 'REUSE':
            arr = AMIYA.get(key)
        if not arr:
            fail.append(rel)
            continue
        m = re.search(r'(\d*)\.ogg$', rel)
        n = int(m.group(1) or 1)
        idx = (n - 1) % len(arr) if key not in ('item_get', 'idle') else n - 1
        if key in ('item_get', 'idle'):
            seq = [1, 2, 3, 4, 5, 6, 8, 9]
            idx = seq.index(n) if n in seq else 0
        zh = arr[idx % len(arr)]
        out_rel = rel.replace('ark_pepe', voice) if voice != 'ark_pepe' else rel
        dst = os.path.join(stage, out_rel.replace('/', os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            qs = urllib.parse.urlencode({'text': zh, 'voice': voice, 'format': 'wav'})
            wav = dst[:-4] + '.wav'
            done = False
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:8100/tts?{qs}', timeout=180) as r:
                        open(wav, 'wb').write(r.read())
                    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', wav,
                                    '-c:a', 'libvorbis', '-q:a', '4', dst], check=True)
                    os.remove(wav)
                    done = True
                    break
                except Exception as e:
                    if attempt == 2:
                        print('FAIL', rel, e)
            if not done:
                fail.append(rel)
                continue
        ok += 1
        if i % 30 == 0:
            print(f'[{voice}] {i}/{len(OGL)}', flush=True)
    print(f'[{voice}] synthesized {ok}, failed {len(fail)}')

    v2 = zipfile.ZipFile(os.path.join(BASE, 'tlm_packs', 'ark_pepe-1.1.0.zip'))
    zpath = os.path.join(work, f'{voice}-{VER}.zip')
    zout = zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED)
    zout.writestr('pack.mcmeta', v2.read('pack.mcmeta'))
    ms = v2.read('assets/ark_pepe/maid_sound.json').decode('utf-8').replace('1.0.0', VER)
    zout.writestr(f'assets/{voice}/maid_sound.json', ms)
    for lang in ('en_us.lang', 'zh_cn.lang'):
        zout.writestr(f'assets/{voice}/lang/{lang}', v2.read(f'assets/ark_pepe/lang/{lang}'))
    for n in v2.namelist():
        if n.endswith('.png'):
            zout.writestr(n.replace('ark_pepe', voice), v2.read(n))
    for rel in OGL:
        src = os.path.join(stage, rel.replace('ark_pepe', voice).replace('/', os.sep))
        if os.path.exists(src):
            zout.write(src, rel.replace('ark_pepe', voice))
    zout.close()
    print(f'[{voice}] packed ->', zpath)
    return len(fail)


if __name__ == '__main__':
    total_fail = 0
    for v in VOICES:
        total_fail += build(v)
    print('ALL DONE, total fail =', total_fail)
