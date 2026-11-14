"""Verify the import archive, Android gamepad binary and Java Sound provider."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import os
import platform
import struct
import subprocess
import tempfile
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parent


def verify_pack(pack, cache, catalog=None):
    lock = json.loads((ROOT / 'sources.lock.json').read_text(encoding='utf-8'))
    checks = []
    def require(condition, label):
        if not condition:
            raise ValueError(label)
        checks.append(label)
    with zipfile.ZipFile(pack) as outer:
        names = outer.namelist()
        require(len(names) == len(set(names)), 'no duplicate package entries')
        require(all(not n.startswith('/') and '..' not in Path(n).parts and '\\' not in n for n in names), 'safe package paths')
        index = json.loads(outer.read('modrinth.index.json'))
        require(index['formatVersion'] == 1 and index['game'] == 'minecraft', 'Modrinth import format')
        require(index['dependencies'] == {'minecraft': lock['minecraft'], 'neoforge': lock['neoforge']}, 'one matching game and loader')
        require(len(index['files']) == len(lock['files']), 'each locked game mod appears once')
        for entry, row in zip(index['files'], lock['files']):
            data = (cache / row['filename']).read_bytes()
            require(entry['downloads'] == [row['url']] and entry['path'] == 'mods/' + row['filename'], 'fixed upstream: ' + row['id'])
            require(entry['fileSize'] == len(data) == row['bytes'], 'exact size: ' + row['id'])
            require(all(hashlib.new(algorithm, data).hexdigest() == entry['hashes'][algorithm] == row[algorithm]
                        for algorithm in ('sha1', 'sha512')), 'original checksums: ' + row['id'])
            require(entry['env'] == {'client': 'required', 'server': 'unsupported'}, 'client scope: ' + row['id'])
        controller, = [row for row in lock['files'] if row['id'] == 'control-flex']
        controller_jar = cache / controller['filename']
        require(hashlib.sha256(controller_jar.read_bytes()).hexdigest() == controller['sha256'], 'original publisher Control Flex SHA256')
        with zipfile.ZipFile(controller_jar) as jar:
            meta = tomllib.loads(jar.read('META-INF/neoforge.mods.toml').decode())
            require(meta['mods'][0]['modId'] == 'controlflex' and meta['mods'][0]['version'] == controller['version'], 'pinned NeoForge controller mod')
            require('fabric.mod.json' not in jar.namelist(), 'controller jar targets NeoForge')
            native = jar.read('native/android-arm64-v8a/libgamepadjni.so')
            require(native[:5] == b'\x7fELF\x02' and struct.unpack_from('<H', native, 18)[0] == 183, 'Android ARM64 SDL JNI binary')
            require(not any(name.startswith('native/android-') and name.endswith('/libSDL3.so') for name in jar.namelist()), 'launcher owns the Android SDL3 runtime')
        options = outer.read('overrides/options.txt').decode().splitlines()
        require(not any(line.startswith('key_') for line in options), 'no launcher keyboard mapping overrides')
        host, port = lock['serverAddress'].rsplit(':', 1)
        whitelist = json.loads(outer.read('overrides/config/controlflex/analog/server-whitelist.json'))
        require(whitelist == {'version': 1, 'entries': [{'kind': 'address', 'host': host, 'port': int(port)}]}, 'analog movement enabled only for the configured remote server')
        require(len([n for n in names if n.endswith('.jar')]) == 1, 'only MIT audio bridge embedded')
        bridge_name = next(n for n in names if n.endswith('.jar'))
        bridge = outer.read(bridge_name)
        with zipfile.ZipFile(io.BytesIO(bridge)) as jar, zipfile.ZipFile(cache / lock['audioShim']['filename']) as upstream:
            require(jar.read('natives/libaudioshim.so') == upstream.read('natives/libaudioshim.so'), 'upstream Android native bytes unchanged')
            for name in upstream.namelist():
                if name.endswith('/') or name in ('de/maxhenkel/shim/NativeAudio.class', 'fabric.mod.json', 'mcmod.info', 'META-INF/MANIFEST.MF'):
                    continue
                require(jar.read(name) == upstream.read(name), 'preserved upstream entry: ' + name)
            meta = tomllib.loads(jar.read('META-INF/neoforge.mods.toml').decode())
            require(meta['modLoader'] == 'lowcodefml' and meta['mods'][0]['modId'] == 'qiandeng_android_audio', 'NeoForge SPI-only mod metadata')
            require(b'de.maxhenkel.shim.AndroidMixerProvider' in jar.read('META-INF/services/javax.sound.sampled.spi.MixerProvider'), 'Java Sound service registration')
            require(b'Copyright (c) 2026 Hhhrty2' in jar.read('META-INF/LICENSE-Android-Audio-Shim.txt'), 'upstream MIT notice retained')
            require(struct.unpack_from('>H', jar.read('de/maxhenkel/shim/NativeAudio.class'), 6)[0] == 52, 'bridge Java 8 bytecode')
            native_hash = hashlib.sha256(jar.read('natives/libaudioshim.so')).hexdigest()
        voice = dict(line.split('=', 1) for line in outer.read('overrides/config/voicechat/voicechat-client.properties').decode().splitlines() if line and not line.startswith('#'))
        require(voice['use_natives'] == 'false' and voice['java_microphone_implementation'] == 'true', 'Java Opus and microphone fallbacks selected')
        require(voice['microphone'] == 'Android AudioRecord', 'actual upstream microphone name selected')
        require(voice['muted'] == 'true' and voice['onboarding_finished'] == 'false', 'first-use microphone decision retained')
        nbt = outer.read('overrides/servers.dat')
        require(nbt.startswith(b'\x0a\x00\x00') and lock['serverAddress'].encode() in nbt and nbt.endswith(b'\x00\x00'), 'preconfigured Java server-list NBT')
        provenance = json.loads(outer.read('overrides/qiandengji-android-manifest.json'))
        require(provenance['androidDeviceVerified'] is False and provenance['voiceEndToEndVerified'] is False, 'device acceptance remains explicitly pending')
        require(provenance['gamepad']['mode'] == 'SDL_DIRECT' and provenance['gamepad']['physicalAndroidDeviceVerified'] is False, 'native mode with explicit physical-device status')
        require(not any(n.startswith(('overrides/saves/', 'overrides/logs/')) or n.endswith(('accounts.json', '.key', '.pem', '.sqlite')) for n in names), 'no game profiles, saves or credentials')
    if catalog:
        row, = [row for row in json.loads(catalog.read_text(encoding='utf-8')) if row['id'] == 'android-native-client-pack']
        require(row['filename'] == pack.name and row['bytes'] == pack.stat().st_size and row['sha256'] == hashlib.sha256(pack.read_bytes()).hexdigest(), 'website catalogue matches actual pack bytes')
    with tempfile.TemporaryDirectory(prefix='qd-spi-check-') as directory:
        directory = Path(directory)
        bridge_path = directory / 'bridge.jar'
        bridge_path.write_bytes(bridge)
        source = directory / 'AudioProbe.java'
        source.write_text('''import javax.sound.sampled.*;
public class AudioProbe {
 public static void main(String[] args) throws Exception {
  boolean found = false;
  for (Mixer.Info mixer : AudioSystem.getMixerInfo())
   if (mixer.getName().equals("Android AudioRecord")) found = true;
  if (!found) throw new AssertionError("Android SPI provider was not visible");
  if (args.length > 0) {
   Class<?> bridge = Class.forName("de.maxhenkel.shim.NativeAudio");
   if ((Boolean)bridge.getMethod("isAvailable").invoke(null))
    throw new AssertionError("A desktop fixture must not claim Android audio");
  }
 }
}
''', encoding='utf-8')
        compiler = str((cache / lock['compiler']['filename']).resolve())
        subprocess.run(['java', '-jar', compiler, '-proc:none', '-source', '8', '-target', '8', '-g:none', '-d', str(directory), str(source)], check=True)
        subprocess.run(['java', '-cp', str(directory) + os.pathsep + str(bridge_path), 'AudioProbe'], check=True)
        checks.append('real JVM classpath Java Sound discovery')
        subprocess.run(['java', '--module-path', str(bridge_path), '--add-modules', 'qiandeng.android.audio', '-cp', str(directory), 'AudioProbe'], check=True)
        checks.append('real JVM module-path Java Sound discovery')
        source = directory / 'ControllerPlatformProbe.java'
        source.write_text('''import com.ifels.gamepadjni.AndroidPlatform;
public class ControllerPlatformProbe {
 public static void main(String[] args) {
  if (!AndroidPlatform.isAndroid()
   || !"android-arm64-v8a".equals(AndroidPlatform.nativePlatformDir())
   || !"/fixture/fcl/libSDL3.so".equals(AndroidPlatform.launcherSdlPath("/fixture/fcl")))
   throw new AssertionError("Unexpected FCL platform or SDL lookup path");
 }
}
''', encoding='utf-8')
        subprocess.run(['java', '-jar', compiler, '-proc:none', '-source', '21', '-target', '21', '-classpath', str(controller_jar.resolve()),
                        '-d', str(directory), str(source)], check=True)
        subprocess.run(['java', '-Dos.version=Android-16', '-Dos.arch=aarch64',
                        '-cp', str(directory) + os.pathsep + str(controller_jar.resolve()), 'ControllerPlatformProbe'], check=True)
        checks.append('original JNI Java loader selects Android ARM64 and FCL SDL pathname')
        # Exercise FCL's extraction directory and checksum on desktop. Loading the
        # ARM Android binary here must fail; this does not simulate a microphone.
        if platform.machine().lower() in ('x86_64', 'amd64'):
            native_dir = directory / 'launcher-private'
            env = {**os.environ, 'MOD_ANDROID_RUNTIME': str(native_dir)}
            subprocess.run(['java', '-Dos.arch=aarch64', '-cp', str(directory) + os.pathsep + str(bridge_path), 'AudioProbe', 'negative-native-fixture'], env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            extracted = native_dir / ('libaudioshim-' + native_hash + '.so')
            require(extracted.is_file() and hashlib.sha256(extracted.read_bytes()).hexdigest() == native_hash, 'FCL private directory extraction and byte verification')
    return {'checks': len(checks), 'passed': checks, 'androidDeviceVerified': False, 'voiceEndToEndVerified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--catalog', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify_pack(args.pack, args.cache, args.catalog), ensure_ascii=False))
