"""Freeze the optional same-body viewer; never edits a role, world or service."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GUI_SHA = '30b6712dd2209700e18ba7f6f1f625396cb35f41e5778b8474baa983dda1ad8a'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_head(path: Path) -> str:
    return subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--visual-repository', required=True, type=Path)
    parser.add_argument('--sdk-body', required=True, type=Path)
    parser.add_argument('--node', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--with-dependencies', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() or not output.parent.is_dir():
        raise RuntimeError('Output must be a new directory with an existing parent')
    visual = args.visual_repository.resolve()
    renderer = visual / 'packages/modern-viewer/renderer-src'
    packs = visual / 'packages/modern-viewer/asset-packs'
    gui = packs / 'qiandengji-gui-1.21.1'
    if digest(gui / 'catalog.json') != GUI_SHA:
        raise RuntimeError('Original GUI catalog hash mismatch')
    asset_manifest = json.loads((packs / 'vanilla-1.21.1/native-assets.json').read_text(encoding='utf-8'))
    if asset_manifest['minecraftVersion'] != '1.21.1' or not asset_manifest['assetIntegrityVerified']:
        raise RuntimeError('Matched original vanilla assets required')
    for rel, info in asset_manifest['assets'].items():
        file = (packs / 'vanilla-1.21.1' / rel).resolve()
        if not file.is_relative_to((packs / 'vanilla-1.21.1').resolve()) or file.stat().st_size != info['bytes'] or digest(file) != info['sha256']:
            raise RuntimeError('Original asset integrity mismatch')
    sdk_body = args.sdk_body.resolve()
    archive = sdk_body / 'agent-mc-world-0.4.0.tgz'
    if not archive.is_file() or not (sdk_body / 'package-lock.json').is_file():
        raise RuntimeError('Locked SDK body required')
    output.mkdir()
    shutil.copytree(renderer, output / 'renderer', ignore=shutil.ignore_patterns('node_modules', '.git', 'dist', 'test'))
    if args.with_dependencies:
        shutil.copytree(renderer / 'node_modules', output / 'renderer/node_modules')
    for name in ['vanilla-1.21.1', 'qiandengji-gui-1.21.1']:
        shutil.copytree(packs / name, output / 'assets' / name)
    body = output / 'body'
    body.mkdir()
    for name in ['package.json', 'package-lock.json', archive.name]:
        shutil.copy2(sdk_body / name, body / name)
    if args.with_dependencies:
        shutil.copytree(sdk_body / 'node_modules', body / 'node_modules')
    extension = body / 'qiandengji'
    extension.mkdir()
    for name in ['entry.mjs', 'engine.mjs', 'configuration.mjs', 'protocol.mjs', 'contract.mjs', 'viewer.mjs', 'viewer-state.mjs']:
        shutil.copy2(ROOT / 'integrations/qiandengji-harness' / name, extension / name)
    (output / 'tools').mkdir()
    shutil.copy2(ROOT / 'tools/publish_mc_spectator.mjs', output / 'tools')
    secret_helper = output / 'skills/qiandengji-agent/scripts'
    secret_helper.mkdir(parents=True)
    shutil.copy2(ROOT / 'skills/qiandengji-agent/scripts/private.mjs', secret_helper / 'private.mjs')
    write_json(output / 'viewer-config.json', {'rendererDirectory': str(output / 'renderer'),
        'serverItemCatalogFile': str(output / 'assets/qiandengji-gui-1.21.1/catalog.json'), 'serverItemCatalogSha256': GUI_SHA})
    write_json(output / 'client.json.example', {'dataDir': 'REUSE_THE_ORIGINAL_ROLE_DATA_DIR', 'timezone': 'Asia/Shanghai',
        'metricsPort': 0, 'consolePort': 0, 'world': {'host': '192.168.3.163', 'port': 25565, 'username': 'ag_ChangeMe',
        'auth': 'offline', 'version': '1.21.1', 'viewerPort': 3007, 'loginConfigFile': 'KEEP_THE_ORIGINAL_PRIVATE_LOGIN_CONFIG',
        'nativeView': {'module': (extension / 'viewer.mjs').as_uri(), 'assetsDir': str(output / 'assets/vanilla-1.21.1')},
        'local': {'startWithWorld': False}, 'client': {'enabled': False}, 'player': {'enabled': False}}})
    write_json(output / 'spectator.config.json.example', {'rendererDirectory': str(output / 'renderer'),
        'sourceUrl': 'http://127.0.0.1:3007/', 'portalUrl': 'https://mc.kangqiang.site',
        'channelId': 'REPLACE_WITH_OWN_WEBSITE_CHANNEL', 'tokenFile': 'ABSOLUTE_PRIVATE_PUBLISHER_TOKEN_FILE', 'tokenFormat': 'dpapi'})
    subprocess.run([str(args.node), str(renderer / 'tools/build-native-spectator-site.mjs'), str(output / 'portal-site')], check=True, capture_output=True)
    site = json.loads((output / 'portal-site/spectator-site.json').read_text(encoding='utf-8'))
    record = {'schemaVersion': 1, 'version': '0.1.0', 'serverSourceCommit': git_head(ROOT), 'visualSourceCommit': git_head(visual),
        'sdkArchiveSha256': digest(archive), 'minecraftVersion': '1.21.1', 'guiCatalogSha256': GUI_SHA,
        'registrySha256': asset_manifest['registryHashes']['block-states.jsonl'], 'originalAssetsVerified': len(asset_manifest['assets']),
        'consoleBundleSha256': site['files']['native-console.js']['sha256'], 'worldBundleSha256': site['files']['client.js']['sha256'],
        'readOnlyPublisher': True, 'additionalMinecraftLoginByPublisher': False, 'modelLoopIncluded': False,
        'dependenciesInstalled': args.with_dependencies, 'completeSceneParityVerified': False}
    write_json(output / 'manifest.json', record)
    shutil.copy2(ROOT / 'docs/QIANDENGJI-WEB-SPECTATOR.md', output / 'README.md')
    print(json.dumps({'output': str(output), **record}, ensure_ascii=False))


if __name__ == '__main__':
    main()
