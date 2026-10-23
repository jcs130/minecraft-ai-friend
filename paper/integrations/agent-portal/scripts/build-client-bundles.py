"""Build reviewed offline plugin bundles and lossless shared components.

Inputs are public releases, never a maintainer deployment. npm is used only in a
new build directory; final packages include game dependencies and server data.
This tool neither publishes artifacts nor starts hosts, games or models.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
ORIGINALS = {
    'cortico': ('cortico-world-qiandengji-0.4.1-rc.14.tgz', 'c242e6c879c809ee15b010c3bba4783fbad4d2c5404c8f1ce0bc3cf5b55b275e'),
    'dsh': ('jcs130-dsh-minecraft-agent-0.3.0-rc.12.tgz', '2beb51ba045226cd6802620063964b03fcaecfb405ff781a998803a4ab497184'),
    'neko': ('Minecraft-Autonomous-0.6.70-Windows-x64-offline.zip', '411116155dbc91af50acd1a50953080227222e3f0cb2332ec273af294c54ffd8'),
}
PINS = {'cortico': ('0.5.7-rc.69', '0.5.0-rc.13'), 'dsh': ('0.5.7-rc.64', '0.5.0-rc.10')}


def sha(file: Path) -> str:
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_relative(name: str) -> str:
    if not name or '\\' in name or PurePosixPath(name).is_absolute() or any(p in {'', '.', '..'} for p in name.split('/')):
        raise ValueError('Unsafe archive member')
    if ':' in name or '\x00' in name:
        raise ValueError('Unsafe archive member')
    return name


def checked_original(inputs: Path, framework: str) -> Path:
    filename, expected = ORIGINALS[framework]
    target = inputs / filename
    if not target.is_file() or target.is_symlink() or sha(target) != expected:
        raise ValueError('Original release hash differs: ' + framework)
    return target


def registry_release(name: str, version: str) -> dict:
    url = 'https://registry.npmjs.org/' + name.replace('/', '%2f') + '/' + version
    with urllib.request.urlopen(url, timeout=30) as response:
        value = json.load(response)
    if value['name'] != name or value['version'] != version or not value['dist']['integrity'].startswith('sha512-'):
        raise ValueError('Registry identity mismatch')
    return {key: value[key] for key in ('name', 'version', 'dist')}


def run(command: list[str], directory: Path, log: Path) -> str:
    result = subprocess.run(command, cwd=directory, capture_output=True, text=True, encoding='utf-8', errors='replace',
                            env={**os.environ, 'npm_config_audit': 'false', 'npm_config_fund': 'false'}, timeout=900)
    log.write_text(result.stdout + result.stderr, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('Build command failed; see ' + log.name)
    return result.stdout


def bundle_plugin(framework: str, inputs: Path, work: Path, output: Path, node: Path, npm: Path, skill: Path) -> tuple[dict, dict]:
    stage = work / framework
    stage.mkdir()
    with tarfile.open(checked_original(inputs, framework), 'r:gz') as archive:
        for member in archive.getmembers():
            safe_relative(member.name.rstrip('/'))
            if not member.name.startswith('package/') or not (member.isfile() or member.isdir()):
                raise ValueError('Unsupported original plugin archive member')
        archive.extractall(stage, filter='data')
    package = stage / 'package'
    info = json.loads((package / 'package.json').read_bytes())
    core_version, pack_version = PINS[framework]
    upstream = {name: registry_release(name, version) for name, version in [('agent-mc-world', core_version), ('agent-mc-qiandengji', pack_version)]}
    info['dependencies']['agent-mc-world'] = core_version
    info['dependencies']['agent-mc-qiandengji'] = pack_version
    info.get('optionalDependencies', {}).pop('agent-mc-qiandengji', None)
    info.pop('devDependencies', None)
    info['bundleDependencies'] = sorted(info['dependencies'])
    info['qiandengjiDistribution'] = {'schema': 'qiandengji-plugin-bundle/v1', 'revision': '20261023.1',
                                    'originalSha256': ORIGINALS[framework][1], 'gameDependenciesBundled': True,
                                    'viewerIncluded': True, 'serverPackIncluded': True, 'hostIncluded': False}
    info.setdefault('bin', {})[framework + '-minecraft-offline'] = 'bin/qiandengji-offline-prepare.mjs'
    for member in ['bin/qiandengji-offline-prepare.mjs', 'qiandengji', 'bundle-provenance.json']:
        if member not in info.setdefault('files', []):
            info['files'].append(member)
    (package / 'package.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (package / 'bin').mkdir(exist_ok=True)
    shutil.copyfile(HERE / 'offline-prepare.mjs', package / 'bin/qiandengji-offline-prepare.mjs')
    material = package / 'qiandengji'
    material.mkdir()
    shutil.copyfile(skill, material / skill.name)
    (material / 'README.txt').write_text('千灯纪资料按需阅读：解压随包 Skill，入口为 SKILL.md；游戏中从 /mycli help、status 开始。\n'
                                       '选择宿主中的千灯纪资料包才启用服务器扩展；不附作者账号或模型 Key。\n', encoding='utf-8')
    print(json.dumps({'phase': 'dependencies', 'framework': framework}), flush=True)
    run([str(node), str(npm), 'install', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--fund=false'],
        package, stage / 'install.log')
    installed = package / 'node_modules'
    core = installed / 'agent-mc-world'
    server_pack = installed / 'agent-mc-qiandengji'
    if json.loads((core / 'package.json').read_bytes())['version'] != core_version or json.loads((server_pack / 'package.json').read_bytes())['version'] != pack_version:
        raise ValueError('Installed dependency version differs')
    receipt = json.loads((core / 'dist/build.json').read_bytes())
    if not receipt['viewer'].get('included'):
        raise ValueError('A headless core cannot be advertised as a visual bundle')
    viewer = core / 'dist/runtime/dist/viewer'
    audio = json.loads((viewer / 'audio-downloads.json').read_bytes())
    if audio.get('schema') != 'agent-mc-viewer-audio/v1' or not audio.get('files'):
        raise ValueError('Missing complete deferred audio inventory')
    lock = json.loads((package / 'package-lock.json').read_bytes())
    for name, release in upstream.items():
        if lock['packages']['node_modules/' + name]['integrity'] != release['dist']['integrity']:
            raise ValueError('npm integrity differs from the reviewed release')
    provenance = {'schema': 'qiandengji-plugin-bundle/v1', 'framework': framework, 'originalFile': ORIGINALS[framework][0],
                  'originalSha256': ORIGINALS[framework][1], 'upstream': upstream, 'viewer': receipt['viewer'],
                  'skillVersion': '1.2.1', 'skillSha256': sha(skill), 'dependencyLockSha256': sha(package / 'package-lock.json'),
                  'privateConfigurationIncluded': False, 'hostIncluded': False}
    (package / 'bundle-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
    result = json.loads(run([str(node), str(npm), 'pack', '--ignore-scripts', '--json', '--pack-destination', str(stage)], package, stage / 'pack.log'))[0]
    source = stage / result['filename']
    filename = ('qiandengji-' + framework + '-' + info['version'] + '-with-viewer-data.tgz')
    target = output / filename
    shutil.copyfile(source, target)
    with tarfile.open(target, 'r:gz') as archive:
        names = {m.name for m in archive.getmembers()}
        required = ['package/node_modules/agent-mc-world/dist/build.json', 'package/node_modules/agent-mc-world/dist/runtime/dist/viewer/audio-downloads.json',
                    'package/node_modules/agent-mc-qiandengji/package.json', 'package/qiandengji/' + skill.name]
        if any(name not in names for name in required):
            raise ValueError('Bundled package omitted runtime or server data')
        if any('/.env' in name or '/.npmrc' in name or '/config.local.json' in name for name in names):
            raise ValueError('Private configuration in archive')
    row = {'id': framework + '-bundle', 'framework': framework, 'version': info['version'], 'filename': filename,
           'bytes': target.stat().st_size, 'sha256': sha(target), 'viewerIncluded': True, 'serverPackIncluded': True,
           'gameDependenciesBundled': True, 'audioSeparate': True, 'browserSeparate': True}
    (stage / 'bundle.json').write_text(json.dumps({**row, 'provenance': provenance}, indent=2) + '\n')
    print(json.dumps({'phase': 'bundled', **row}), flush=True)
    return row, audio


def split_resources(inputs: Path, output: Path, skill: Path, audio_catalogs: list[dict]) -> list[dict]:
    source = checked_original(inputs, 'neko')
    paths = {'neko-base': output / 'qiandengji-neko-0.6.70-base-with-viewer-data.zip',
             'shared-audio': output / 'qiandengji-original-audio-20261023.1.zip',
             'shared-browser': output / 'qiandengji-browser-win-x64-1243.zip'}
    objects: dict[str, dict] = {}
    browser_files: dict[str, dict] = {}
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(paths['neko-base'], 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as base, \
            zipfile.ZipFile(paths['shared-audio'], 'x', compression=zipfile.ZIP_STORED) as audio, \
            zipfile.ZipFile(paths['shared-browser'], 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as browser:
        for index, entry in enumerate(original.infolist()):
            if entry.is_dir():
                continue
            safe_relative(entry.filename)
            raw = original.read(entry.filename)
            if entry.filename.startswith('runtime/resources/vanilla-1.21.1/public/sounds/') and entry.filename.endswith('.ogg'):
                sha1 = hashlib.sha1(raw).hexdigest()
                row = {'file': entry.filename, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                if sha1 in objects and (objects[sha1]['bytes'], objects[sha1]['sha256']) != (row['bytes'], row['sha256']):
                    raise ValueError('Conflicting audio source')
                objects.setdefault(sha1, row)
                audio.writestr(entry.filename, raw)
            elif entry.filename.startswith('runtime/browser/'):
                browser.writestr(entry.filename, raw)
                browser_files[entry.filename] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
            else:
                base.writestr(entry.filename, raw)
            if index % 15000 == 0:
                print(json.dumps({'phase': 'split-neko', 'files': index}), flush=True)
        for catalog in audio_catalogs:
            for entry in catalog['files']:
                key = entry['sha1']
                if key in objects:
                    if (objects[key]['bytes'], objects[key]['sha256']) != (entry['bytes'], entry['sha256']):
                        raise ValueError('Audio differs between declared viewer versions')
                    continue
                url = 'https://resources.download.minecraft.net/' + key[:2] + '/' + key
                with urllib.request.urlopen(url, timeout=45) as response:
                    raw = response.read(entry['bytes'] + 1)
                if len(raw) != entry['bytes'] or hashlib.sha1(raw).hexdigest() != key or hashlib.sha256(raw).hexdigest() != entry['sha256']:
                    raise ValueError('Original audio checksum mismatch')
                name = 'audio-extra/' + key + '.ogg'
                audio.writestr(name, raw)
                objects[key] = {'file': name, 'bytes': len(raw), 'sha256': entry['sha256']}
        audio.writestr('shared-audio.json', json.dumps({'schema': 'qiandengji-offline-audio/v1', 'objects': objects}, sort_keys=True))
        audio.writestr('AUDIO-NOTICES.txt', original.read('runtime/licenses/THIRD-PARTY-NOTICES.txt'))
        audio.writestr('README-公共音频.txt', '原版音频来自 Mojang 内容寻址资源，保留来源与原有权利。\n'
                       '将本包与所选宿主包、配套浏览器包解压到同一目录。Cortico/DSH 使用随插件提供的离线准备命令；NEKO 使用原一键安装。\n')
        executable = 'runtime/browser/chrome-headless-shell-win64/chrome-headless-shell.exe'
        browser.writestr('shared-browser.json', json.dumps({'schema': 'qiandengji-offline-browser/v1', 'platform': 'win32-x64', 'revision': '1243',
                                                          'playwrightCore': '1.63.0', 'executable': {'file': executable, **browser_files[executable]}, 'files': browser_files}))
        base.writestr('qiandengji/' + skill.name, skill.read_bytes())
        base.writestr('准备千灯纪离线包.cmd', '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n'
                       'if not exist "shared-audio.json" (echo 请将配套公共音频包解压到本目录。& exit /b 2)\r\n'
                       'if not exist "shared-browser.json" (echo 请将配套 Windows 截图浏览器包解压到本目录。& exit /b 2)\r\n'
                       'call "一键安装.cmd"\r\n', compress_type=zipfile.ZIP_DEFLATED)
        base.writestr('README-分包安装.txt', '先将 NEKO 基础包、公共音频包、Windows 截图浏览器包解压到同一目录，再运行原“一键安装.cmd”。\n'
                       '三部分可完全离线准备；缺少组件时原校验会拒绝安装，不会静默下载或启动游戏。\n'
                       '基础包保留原 Node、引擎、现代可视化、贴图、Windows 插件及字节校验的千灯纪物品展示扩展。\n'
                       'qiandengji 目录另附千灯纪 Skill 1.2.1，供按需读取基础说明；玩法通过游戏内 /mycli 学习。\n', compress_type=zipfile.ZIP_DEFLATED)
        base.writestr('bundle-provenance.json', json.dumps({'schema': 'qiandengji-neko-split/v1', 'originalSha256': ORIGINALS['neko'][1],
                       'originalRuntimeAndPluginBytesUnchanged': True, 'requiredComponents': ['shared-audio', 'shared-browser'],
                       'skillVersion': '1.2.1', 'skillSha256': sha(skill), 'privateConfigurationIncluded': False}, indent=2))
    rows = []
    for identity, file in paths.items():
        rows.append({'id': identity, 'filename': file.name, 'bytes': file.stat().st_size, 'sha256': sha(file)})
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['inputs', 'output', 'work', 'node', 'npm-cli', 'skill']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    for root in [args.output, args.work]:
        if not root.is_absolute() or root.exists():
            raise ValueError('Choose a new absolute output and work directory')
        root.mkdir(parents=True)
    rows, catalogs = [], []
    for framework in PINS:
        row, audio = bundle_plugin(framework, args.inputs, args.work, args.output, args.node, args.npm_cli, args.skill)
        rows.append(row)
        catalogs.append(audio)
    rows.extend(split_resources(args.inputs, args.output, args.skill, catalogs))
    (args.output / 'manifest.json').write_text(json.dumps({'schema': 'qiandengji-offline-downloads/v1', 'packages': rows}, indent=2) + '\n')
    print(json.dumps({'complete': True, 'packages': rows}), flush=True)


if __name__ == '__main__':
    main()
