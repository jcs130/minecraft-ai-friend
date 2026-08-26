# -*- coding: utf-8 -*-
"""
mod-assets 提取器
读取 MC mod 的 jar，抽出可供 modern-viewer 渲染的方块资源：
  - assets/<modid>/blockstates/*.json          方块状态
  - assets/<modid>/models/block/*.json         方块模型
  - assets/<modid>/textures/block/*.png(+.mcmeta) 方块贴图
  - assets/<modid>/lang/en_us.json            显示名
输出到 <out>/<modid>/... 并按 mod 生成 manifest。
仅提取，不做任何 AI 生成 — 用的是 mod 自带的真实资源。
"""
import io, sys, os, json, zipfile, posixpath, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MODS_DIR = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mods'
OUT_DIR = sys.argv[2] if len(sys.argv) > 2 else r'C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\mod-assets'

def sanitize(rel):
    # 去掉 zip 路径穿越与盘符
    rel = rel.replace('\\', '/')
    parts = [p for p in rel.split('/') if p not in ('', '.', '..')]
    return posixpath.join(*parts)

def modalias(rel):
    """把 zip 内 assets/<modid>/xxx 路径转成 <modid>:<rest>"""
    parts = rel.split('/')
    if len(parts) < 3 or parts[0] != 'assets':
        return None, None
    modid = parts[1]
    rest = '/'.join(parts[2:])
    return modid, rest

manifest = {}
stats = {'jars': 0, 'blockstates': 0, 'models': 0, 'textures': 0, 'langs': 0, 'errors': []}

for jarname in sorted(os.listdir(MODS_DIR)):
    if not jarname.lower().endswith('.jar'):
        continue
    jar = os.path.join(MODS_DIR, jarname)
    stats['jars'] += 1
    try:
        z = zipfile.ZipFile(jar)
    except Exception as e:
        stats['errors'].append(f'{jarname}: open fail {e}')
        continue
    names = z.namelist()
    # 探测 modid 集合
    modids = {}
    for n in names:
        if n.startswith('assets/') and n.count('/') >= 2:
            modids[n.split('/')[1]] = True
    # 读 mod 元数据（版本/名称）
    meta = {}
    for probe in ['fabric.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'META-INF/MANIFEST.MF']:
        if probe in names:
            try:
                raw = z.read(probe).decode('utf-8', errors='replace')
                if probe == 'fabric.mod.json':
                    d = json.loads(raw)
                    meta['id'] = d.get('id')
                    meta['name'] = d.get('name')
                    meta['version'] = d.get('version')
                elif 'mods.toml' in probe:
                    m = re.search(r'modId\s*=\s*"([^"]+)"', raw)
                    if m: meta['id'] = m.group(1)
                    m = re.search(r'version\s*=\s*"([^"]+)"', raw)
                    if m: meta['version'] = m.group(1)
                    m = re.search(r'displayName\s*=\s*"([^"]+)"', raw)
                    if m: meta['name'] = m.group(1)
            except Exception:
                pass
    for modid in sorted(modids):
        base = os.path.join(OUT_DIR, modid)
        entry = manifest.setdefault(modid, {'jar': jarname, 'id': meta.get('id') or modid, 'name': meta.get('name') or modid,
                                            'version': meta.get('version') or '', 'blockstates': [], 'models': [], 'textures': [], 'langs': []})
        for n in names:
            if not n.startswith(f'assets/{modid}/'):
                continue
            rel = n[len(f'assets/{modid}/'):]
            low = rel.lower()
            # skip if not block-relevant
            if low.startswith('blockstates/'):
                if low.endswith('.json'):
                    data = z.read(n)
                    dest = os.path.join(base, 'blockstates', sanitize(rel[len('blockstates/'):]))
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    open(dest, 'wb').write(data)
                    stats['blockstates'] += 1
                    entry['blockstates'].append(rel[len('blockstates/'):])
            elif low.startswith('models/block') or low.startswith('models/block/'):
                if low.endswith('.json'):
                    data = z.read(n)
                    dest = os.path.join(base, 'models', sanitize(rel[len('models/'):]))
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    open(dest, 'wb').write(data)
                    stats['models'] += 1
                    entry['models'].append(rel[len('models/'):])
            elif low.startswith('textures/block'):
                if low.endswith('.png') or low.endswith('.png.mcmeta'):
                    data = z.read(n)
                    dest = os.path.join(base, 'textures', sanitize(rel[len('textures/'):]))
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    open(dest, 'wb').write(data)
                    stats['textures'] += 1
                    entry['textures'].append(rel[len('textures/'):])
            elif low.startswith('lang/') and low.endswith('en_us.json'):
                data = z.read(n)
                dest = os.path.join(base, 'lang', sanitize(rel[len('lang/'):]))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                open(dest, 'wb').write(data)
                stats['langs'] += 1
                entry['langs'].append(rel[len('lang/'):])
        # prune empty
        for k in ['blockstates', 'models', 'textures', 'langs']:
            if not entry[k]:
                entry.pop(k, None)
        if not entry.get('blockstates') and not entry.get('models') and not entry.get('textures'):
            manifest.pop(modid, None)
    z.close()

# 写全局 manifest
man_path = os.path.join(OUT_DIR, 'manifest.json')
os.makedirs(OUT_DIR, exist_ok=True)
with open(man_path, 'w', encoding='utf-8') as f:
    json.dump({'minecraft': '1.21.1', 'extracted_at': 'mod-assets', 'mods': manifest, 'stats': stats}, f, ensure_ascii=False, indent=2)

print(f'jars={stats["jars"]} blockstates={stats["blockstates"]} models={stats["models"]} textures={stats["textures"]} langs={stats["langs"]}')
print('errors=', len(stats['errors']))
for e in stats['errors'][:10]:
    print('  ', e)
print('\nmods with block assets:')
for modid, e in manifest.items():
    print(f'  {modid:26} bs={len(e.get("blockstates",[])):4d} models={len(e.get("models",[])):4d} tex={len(e.get("textures",[])):4d}')
print('\nmanifest:', man_path)
