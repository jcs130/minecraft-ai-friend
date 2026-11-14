"""Build the Android client import pack; never read a game profile or credentials."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
import tempfile
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
LOCK = ROOT / 'sources.lock.json'
STAMP = (2026, 11, 9, 0, 0, 0)
BRIDGE_NAME = 'qiandengji-android-audio-1.0.1-qiandengji.1.jar'
NATIVE_CLASS = 'de/maxhenkel/shim/NativeAudio.class'
FCL_RELEASE = '1.3.4.6'
NATIVE_PACK_ID = 'android-native-client-pack'


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def digest(data, algorithm='sha256'):
    return hashlib.new(algorithm, data).hexdigest()


def text_input(name):
    return (ROOT / name).read_text(encoding='utf-8').encode('utf-8')


def archive(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', compression=zipfile.ZIP_STORED) as output:
        for name, data in sorted(files.items()):
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name:
                raise ValueError('Unsafe archive member')
            info = zipfile.ZipInfo(name, STAMP)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            output.writestr(info, data)
    return result.getvalue()


def verify(data, row):
    if len(data) != row['bytes']:
        raise ValueError('Reviewed input size mismatch: ' + row['filename'])
    for algorithm in ('sha1', 'sha512'):
        if digest(data, algorithm) != row[algorithm]:
            raise ValueError('Reviewed input checksum mismatch: ' + row['filename'])
    if 'sha256' in row and digest(data) != row['sha256']:
        raise ValueError('Publisher SHA256 mismatch: ' + row['filename'])
    return data


def load_input(row, cache):
    name = row['filename']
    if PurePosixPath(name).name != name or '\\' in name:
        raise ValueError('Unsafe input filename')
    url = urllib.parse.urlsplit(row['url'])
    allowed_hosts = (url.netloc,)
    if url.netloc == 'github.com' and row.get('id') == 'control-flex':
        release_path = f"/ControlFlexMC/control-flex/releases/download/v{row['version']}/{name}"
        if url.path != release_path or 'sha256' not in row:
            raise ValueError('Expected a checksum-pinned Control Flex release asset')
        allowed_hosts += ('release-assets.githubusercontent.com',)
    elif url.netloc not in ('cdn.modrinth.com', 'repo.maven.apache.org'):
        raise ValueError('Unexpected input host')
    if url.scheme != 'https' or url.query or url.fragment:
        raise ValueError('Expected a clean public HTTPS input URL')
    target = cache / name
    if target.exists():
        if target.is_symlink():
            raise ValueError('Input cache cannot contain symlinks')
        return verify(target.read_bytes(), row)
    request = urllib.request.Request(row['url'], headers={
        'User-Agent': 'Qiandengji-Android-Client/1.0 (github.com/jcs130/minecraft-ai-friend)'})
    with urllib.request.urlopen(request, timeout=60) as response:
        final_url = urllib.parse.urlsplit(response.geturl())
        if final_url.scheme != 'https' or final_url.netloc not in allowed_hosts:
            raise ValueError('Unexpected download redirect')
        chunks, length = [], 0
        while chunk := response.read(1024 * 1024):
            length += len(chunk)
            if length > row['bytes']:
                raise ValueError('Input exceeded its reviewed size')
            chunks.append(chunk)
    data = verify(b''.join(chunks), row)
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as temporary:
        temporary.write(data)
        temporary_path = Path(temporary.name)
    try:
        try:
            os.link(temporary_path, target)
        except FileExistsError:
            verify(target.read_bytes(), row)
    finally:
        temporary_path.unlink()
    return data


def build_bridge(upstream, shim, compiler, java='java'):
    verify(upstream, shim)
    with zipfile.ZipFile(io.BytesIO(upstream)) as original:
        if len(original.namelist()) != len(set(original.namelist())):
            raise ValueError('Duplicate upstream JAR entries')
        files = {name: original.read(name) for name in original.namelist() if not name.endswith('/')}
    native = files['natives/libaudioshim.so']
    if native[:5] != b'\x7fELF\x02' or struct.unpack_from('<H', native, 18)[0] != 183:
        raise ValueError('Expected the reviewed arm64 native library')
    if NATIVE_CLASS not in files:
        raise ValueError('Expected upstream NativeAudio class')
    source = (ROOT / 'NativeAudio.java').read_text(encoding='utf-8').replace('@NATIVE_SHA256@', digest(native))
    with tempfile.TemporaryDirectory(prefix='qiandengji-audio-') as directory:
        directory = Path(directory)
        (directory / 'NativeAudio.java').write_text(source, encoding='utf-8', newline='\n')
        subprocess.run([java, '-jar', str(compiler), '-proc:none', '-source', '8', '-target', '8', '-encoding', 'UTF-8', '-g:none',
                        '-d', str(directory), str(directory / 'NativeAudio.java')], check=True)
        files[NATIVE_CLASS] = (directory / NATIVE_CLASS).read_bytes()
    for name in ('fabric.mod.json', 'mcmod.info', 'META-INF/MANIFEST.MF'):
        files.pop(name, None)
    files['META-INF/MANIFEST.MF'] = b'Manifest-Version: 1.0\r\nAutomatic-Module-Name: qiandeng.android.audio\r\n\r\n'
    files['META-INF/neoforge.mods.toml'] = text_input('neoforge.mods.toml')
    files['META-INF/LICENSE-Android-Audio-Shim.txt'] = text_input('LICENSE.upstream.txt')
    files['META-INF/qiandengji-audio-source.json'] = encoded({
        'source': shim['source'], 'upstreamSha512': shim['sha512'], 'license': 'MIT',
        'nativeSha256': digest(native), 'nativeBytesUnchanged': True,
        'modified': [NATIVE_CLASS, 'loader metadata'],
        'androidDeviceVerified': False})
    return archive(files)


def server_list(address):
    def string(value):
        data = value.encode('utf-8')
        return struct.pack('>H', len(data)) + data
    def tag(kind, name, value):
        return bytes([kind]) + string(name) + value
    server = tag(8, 'name', string('千灯纪 · 主世界')) + tag(8, 'ip', string(address))
    server += tag(1, 'acceptTextures', b'\x01') + b'\x00'
    return b'\x0a\x00\x00' + tag(9, 'servers', b'\x0a' + struct.pack('>i', 1) + server) + b'\x00'


def make_pack(lock, bridge):
    version = lock['version']
    filename = f'qiandengji-android-1.21.1-neoforge-{version}.mrpack'
    index = {
        'formatVersion': 1, 'game': 'minecraft', 'versionId': version,
        'name': '千灯纪 · FCL 原生手柄预览',
        'summary': 'Control Flex 通过 FCL 的 SDL 直通读取手柄。包含主世界、女仆、YSM 和附近语音。',
        'dependencies': {'minecraft': lock['minecraft'], 'neoforge': lock['neoforge']},
        'files': [{'path': 'mods/' + row['filename'],
                   'hashes': {key: row[key] for key in ('sha1', 'sha512')},
                   'env': {'client': 'required', 'server': 'unsupported'},
                   'downloads': [row['url']], 'fileSize': row['bytes']} for row in lock['files']]}
    voice = '''# Qiandengji Android compatibility preview. Microphone starts muted.
use_natives=false
java_microphone_implementation=true
microphone=Android AudioRecord
speaker=
onboarding_finished=false
microphone_activation_type=PTT
muted=true
disabled=false
denoiser=false
audio_type=NORMAL
voice_chat_volume=1.0
'''.encode()
    options = b'lang:zh_cn\nrenderDistance:6\nsimulationDistance:5\nmaxFps:60\nguiScale:3\n'
    host, port = lock['serverAddress'].rsplit(':', 1)
    analog_servers = encoded({'version': 1, 'entries': [{'kind': 'address', 'host': host, 'port': int(port)}]})
    provenance = {
        'schema': 1, 'version': version, 'java': 21,
        'serverAddress': lock['serverAddress'], 'source': 'https://github.com/jcs130/minecraft-ai-friend',
        'channel': 'android-native-gamepad-preview', 'androidDeviceVerified': False,
        'gamepad': {'mode': 'SDL_DIRECT', 'mod': 'controlflex', 'recommendedFcl': FCL_RELEASE,
                    'physicalAndroidDeviceVerified': False},
        'voiceEndToEndVerified': False, 'officialGameModsModified': False,
        'audioBridgeModified': True, 'audioBridgeSha256': digest(bridge),
        'contents': [row['id'] + ' ' + row['version'] for row in lock['files']],
        'limitations': ['Android arm64, Android 8+; use FCL ' + FCL_RELEASE + ' with SDL Direct.',
                        'Native sticks, buttons and reconnection must be checked on device.',
                        'Microphone permission, input/output and public UDP must be checked on device.',
                        'Native denoising, automatic gain and SVC recording are disabled in Java fallback.']}
    files = {'modrinth.index.json': encoded(index),
             'overrides/mods/' + BRIDGE_NAME: bridge,
             'overrides/config/voicechat/voicechat-client.properties': voice,
             'overrides/config/controlflex/analog/server-whitelist.json': analog_servers,
             'overrides/options.txt': options,
             'overrides/servers.dat': server_list(lock['serverAddress']),
             'overrides/README-Qiandengji-Android.md': text_input('PLAYER_GUIDE.md'),
             'overrides/qiandengji-android-manifest.json': encoded(provenance),
             'overrides/LICENSES/Android-Audio-Shim-MIT.txt': text_input('LICENSE.upstream.txt'),
             'overrides/LICENSES/UPSTREAM-SOURCES.json': encoded(lock)}
    data = archive(files)
    row = {
        'id': NATIVE_PACK_ID, 'framework': 'minecraft', 'category': 'android-client',
        'name': '千灯纪手机版 · 原生手柄预览', 'version': version, 'filename': filename,
        'bytes': len(data), 'sha256': digest(data), 'channel': 'website-bundle',
        'platform': f'安卓 8+ / arm64 / FCL {FCL_RELEASE} / Minecraft 1.21.1 / Java 21',
        'license': '音频适配 MIT；其余模组由启动器从原作者下载',
        'sourceUrl': 'https://github.com/jcs130/minecraft-ai-friend/tree/main/paper/integrations/android-client',
        'install': 'FCL 导入为独立实例，运行时选 Java 21。连接手柄后在游戏侧栏启用「手柄控制」，输入模式选「SDL 直通」。',
        'includes': 'Control Flex 0.8.9-beta.3、女仆 1.5.3、YSM 2.6.5、附近语音与主世界地址。',
        'compatibilityNote': '兼容预览。手机上的摇杆、按键和语音仍待实机验证。',
        'androidDeviceVerified': False}
    return filename, data, row


def build(cache, output, java='java'):
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    cache.mkdir(parents=True, exist_ok=True)
    rows = [*lock['files'], lock['audioShim'], lock['compiler']]
    with ThreadPoolExecutor(max_workers=4) as pool:
        inputs = list(pool.map(lambda row: load_input(row, cache), rows))
    bridge = build_bridge(inputs[-2], lock['audioShim'], cache / lock['compiler']['filename'], java)
    filename, data, row = make_pack(lock, bridge)
    output.mkdir(parents=True, exist_ok=True)
    results = {filename: data, 'android-client-downloads.json': encoded([row]),
               'release.json': encoded({'schema': 1, 'version': lock['version'], 'artifacts': [row],
                                        'verifiedUpstreamBytes': True, 'androidDeviceVerified': False})}
    for name, content in results.items():
        path = output / name
        if path.exists() and path.read_bytes() != content:
            raise ValueError('Immutable output already exists with different bytes: ' + name)
        if not path.exists():
            path.write_bytes(content)
    return row


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--java', default=shutil.which('java') or 'java')
    args = parser.parse_args()
    print(json.dumps(build(args.cache, args.output, args.java), ensure_ascii=False))
