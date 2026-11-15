"""Build the desktop Modrinth import pack from verified client releases."""
import argparse
import importlib.util
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parent
ANDROID = ROOT.parent / 'android-client'
PACK_VERSION = '1.1.0'
NEOFORGE = '21.1.252'
SHARED_CLIENT_MODS = ('touhou-little-maid', 'yes-steve-model', 'simple-voice-chat')

# Reuse the download, checksum, NBT and reproducible ZIP routines used by the phone pack.
spec = importlib.util.spec_from_file_location('client_pack', ANDROID / 'build.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)


def build(cache, output, catalog=None):
    baseline = json.loads((ANDROID / 'sources.lock.json').read_bytes())
    android_mods = {mod['id']: mod for mod in baseline['files']}
    mods = [android_mods[mod_id] for mod_id in SHARED_CLIENT_MODS]
    mods += json.loads((ROOT / 'controller.lock.json').read_bytes())
    cache.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda row: common.load_input(row, cache), mods))

    filename = f'qiandengji-java-{baseline["minecraft"]}-neoforge-{PACK_VERSION}.mrpack'
    index = {
        'formatVersion': 1, 'game': 'minecraft', 'versionId': PACK_VERSION,
        'name': '千灯纪 · 桌面 Java 整合包',
        'summary': '主世界 1.21.1，包含原生女仆、YSM、附近语音和手柄支持。',
        'dependencies': {'minecraft': baseline['minecraft'], 'neoforge': NEOFORGE},
        'files': [
            {'path': 'mods/' + mod['filename'], 'fileSize': mod['bytes'],
             'hashes': {key: mod[key] for key in ('sha1', 'sha512')},
             'env': {'client': 'required', 'server': 'unsupported'}, 'downloads': [mod['url']]}
            for mod in mods
        ],
    }
    guide = (ROOT / 'README.md').read_text(encoding='utf-8').encode('utf-8')
    data = common.archive({
        'modrinth.index.json': common.encoded(index),
        'overrides/servers.dat': common.server_list(baseline['serverAddress']),
        'overrides/README-Qiandengji.md': guide,
        'overrides/LICENSES/UPSTREAM-SOURCES.json': common.encoded(mods),
    })
    row = {
        'id': 'desktop-client-pack', 'framework': 'minecraft', 'category': 'desktop-client',
        'name': '千灯纪桌面 Java 整合包', 'version': PACK_VERSION, 'filename': filename,
        'bytes': len(data), 'sha256': common.digest(data), 'channel': 'website-bundle',
        'platform': f'Windows / macOS / Linux · Minecraft {baseline["minecraft"]} · Java 21 · NeoForge {NEOFORGE}',
        'license': '模组保留各自许可，由启动器从作者官方 CDN 下载',
        'sourceUrl': 'https://github.com/jcs130/minecraft-ai-friend/tree/main/paper/integrations/desktop-client',
        'install': '导入 .mrpack 并用 Java 21 启动。连接手柄后，在选项 → 控制设置中打开 Controlify 并校准。',
        'includes': '预置千灯纪主世界地址，包含原生女仆 1.5.3、YSM 2.6.5、附近语音 2.6.27 和 Controlify 3.0.1 LTS。首次导入需联网。',
    }
    rows = [row]
    if catalog and json.loads(catalog.read_bytes()) != rows:
        raise ValueError('The website catalog does not match the reproduced pack')
    output.mkdir(parents=True, exist_ok=True)
    for name, content in [(filename, data), ('desktop-client-downloads.json', common.encoded(rows))]:
        target = output / name
        if target.exists() and target.read_bytes() != content:
            raise ValueError('Refusing to overwrite an existing release: ' + name)
        if not target.exists():
            target.write_bytes(content)
    return row


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--catalog', type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.cache, args.output, args.catalog), ensure_ascii=False))
