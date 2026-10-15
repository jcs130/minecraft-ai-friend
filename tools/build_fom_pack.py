"""Build importable FOM derivatives from a pinned author archive, never a played instance.

The .mrpack keeps upstream download references and clean author overrides.
Only the six locked additions and explicit client-only Agent components are
eligible. No launcher state, credentials, worlds or local RPC state are read.
Format: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'docs/fom-pack-20261016.lock.json'
CONTENT_LOCK = ROOT / 'docs/fom-content-20261015.lock.json'
RECEIPT = 'client-overrides/FOM-QiandengJi/release.json'


def hashes(raw):
    return {kind: hashlib.new(kind, raw).hexdigest() for kind in ('sha1', 'sha256', 'sha512')}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def relative(name):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name or '\x00' in name:
        raise ValueError('Unsafe relative path: ' + str(name))
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or name != path.as_posix() or name.endswith('/'):
        raise ValueError('Unsafe relative path: ' + name)
    return path


def game_path(name):
    path = relative(name)
    if path.parts[0] not in ('mods', 'config', 'resourcepacks', 'shaderpacks', 'FOM-QiandengJi') and name != 'options.txt':
        raise ValueError('File outside clean pack allowlist: ' + name)
    if any(re.search(r'(?i)^(?:accounts?|credentials?|secrets?|tokens?|sessions?|usercache|usernamecache|connection)(?:\.|$)', part)
           or part == '.env' for part in path.parts):
        raise ValueError('Private state in pack: ' + name)
    if path.parts[0] == 'mods' and (len(path.parts) != 2 or not name.endswith(('.jar', '.jar.disabled'))):
        raise ValueError('Unexpected mod path: ' + name)
    return name


def index_paths(index):
    if index.get('formatVersion') != 1 or index.get('game') != 'minecraft':
        raise ValueError('Unsupported mrpack index')
    seen = set()
    for row in index['files']:
        name = game_path(row['path'])
        if name.casefold() in seen:
            raise ValueError('Duplicate game path: ' + name)
        seen.add(name.casefold())
        for kind, length in (('sha1', 40), ('sha512', 128)):
            if not re.fullmatch('[0-9a-f]{' + str(length) + '}', row.get('hashes', {}).get(kind, '')):
                raise ValueError('Missing or invalid required hash: ' + name)
        if not isinstance(row.get('fileSize'), int) or isinstance(row['fileSize'], bool) or row['fileSize'] < 0:
            raise ValueError('Invalid file size: ' + name)
        if not row.get('downloads'):
            raise ValueError('Missing official download: ' + name)
        for url in row['downloads']:
            parsed = urlsplit(url)
            if parsed.scheme != 'https' or parsed.hostname not in ('cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com') or re.search(r'\s', url):
                raise ValueError('Unsupported download URL: ' + name)
        if any(value not in ('required', 'optional', 'unsupported') for value in row.get('env', {}).values()):
            raise ValueError('Invalid side declaration: ' + name)
    return seen


def archive_files(archive):
    files = {}
    seen = set()
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            # ZipInfo normalizes backslashes on Windows. Validate the original
            # stored spelling too, before that normalization can hide a path.
            relative(entry.orig_filename.rstrip('/') if entry.is_dir() else entry.orig_filename)
            if entry.is_dir():
                relative(entry.filename.rstrip('/'))
                continue
            name = relative(entry.filename).as_posix()
            if name.casefold() in seen or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Duplicate or linked archive member: ' + name)
            seen.add(name.casefold())
            if name != 'modrinth.index.json':
                layer, separator, path = name.partition('/')
                if not separator or layer not in ('overrides', 'client-overrides'):
                    raise ValueError('Unsupported archive member: ' + name)
                game_path(path)
            files[name] = source.read(entry)  # Reading checks each ZIP member's CRC.
    return files


def effective_paths(index, entries):
    names = index_paths(index)
    for name in entries:
        if name == 'modrinth.index.json':
            continue
        path = game_path(name.split('/', 1)[1])
        if path.casefold() in names:
            # These pinned packs need no layer overwrites. Refuse silent replacement.
            raise ValueError('Conflicting game path: ' + path)
        names.add(path.casefold())
    return names


def pinned_file(folder, row):
    name = relative(row['file']).as_posix()
    path = Path(folder) / name
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(Path(folder).resolve()):
        raise ValueError('Missing or linked locked file: ' + name)
    raw = path.read_bytes()
    actual = hashes(raw)
    if any(actual[kind] != row[kind] for kind in ('sha256', 'sha512') if kind in row):
        raise ValueError('Locked file hash mismatch: ' + name)
    return raw, actual


def download_entry(row, raw, actual, client_only=False):
    game_path('mods/' + row['file'])
    return {'path': 'mods/' + row['file'], 'hashes': actual,
            'env': {'client': 'required', 'server': 'unsupported' if client_only else 'required'},
            'downloads': [row['url']], 'fileSize': len(raw)}


def write_zip(path, entries):
    # Stable order, timestamps and permissions make the release reproducible.
    with zipfile.ZipFile(path, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for name, raw in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            target.writestr(info, raw, compresslevel=6)


def verify(archive, cache=None):
    entries = archive_files(archive)
    index = json.loads(entries['modrinth.index.json'])
    receipt = json.loads(entries[RECEIPT])
    paths = effective_paths(index, entries)
    if index['dependencies'] != receipt['dependencies'] or index['versionId'] != receipt['versionId']:
        raise ValueError('Receipt and installer metadata differ')
    actual = {name: hashlib.sha256(raw).hexdigest() for name, raw in entries.items() if name != RECEIPT}
    if actual != receipt['archiveFiles']:
        raise ValueError('Archive content differs from build receipt')
    counts = {'enabledJars': sum(p.startswith('mods/') and p.endswith('.jar') for p in paths),
              'authorDisabled': sum(p.startswith('mods/') and p.endswith('.jar.disabled') for p in paths)}
    if counts != receipt['counts']:
        raise ValueError('Installed JAR counts differ from receipt')
    verified = 0
    if cache is not None:
        cache = Path(cache).resolve()
        for row in index['files']:
            path = cache / relative(row['path'])
            if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(cache):
                raise ValueError('Missing or linked cached download: ' + row['path'])
            raw = path.read_bytes()
            actual = hashes(raw)
            if len(raw) != row['fileSize'] or any(actual[k] != value for k, value in row['hashes'].items()):
                raise ValueError('Cached download differs from installer index: ' + row['path'])
            verified += 1
    return {'schemaVersion': 1, 'profile': receipt['profile'], 'versionId': index['versionId'],
            **counts, 'archiveEntries': len(entries), 'downloadReferences': len(index['files']),
            'cachedDownloadsVerified': verified, 'sha256': hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
            'size': Path(archive).stat().st_size, 'ok': True}


def build(base, downloads, output, *, profile='player', agent_bundle=None, lock=LOCK, content_lock=CONTENT_LOCK):
    output = Path(output).resolve()
    if output.exists() or output.with_suffix(output.suffix + '.building').exists():
        raise ValueError('Use a new output file; existing releases are never overwritten')
    pack = json.loads(Path(lock).read_text('utf-8-sig'))
    content = json.loads(Path(content_lock).read_text('utf-8-sig'))
    if pack.get('schemaVersion') != 1 or profile not in pack['profiles']:
        raise ValueError('Unsupported pack lock/profile')
    if content.get('schemaVersion') != 1 or content['minecraft'] != pack['dependencies']['minecraft'] or content['testedNeoForge'] != pack['dependencies']['neoforge']:
        raise ValueError('Content and base targets differ')
    raw, _ = pinned_file(Path(base).parent, {**pack['upstream'], 'file': Path(base).name})
    entries = archive_files(base)
    index = json.loads(entries['modrinth.index.json'])
    if index['versionId'] != pack['upstream']['version'] or index['dependencies'] != pack['dependencies']:
        raise ValueError('Wrong upstream pack version/loader')
    if len(index['files']) != pack['upstream']['downloadReferences']:
        raise ValueError('Wrong upstream download inventory')
    original_paths = effective_paths(index, entries)
    if sum(p.startswith('mods/') and p.endswith('.jar') for p in original_paths) != pack['upstream']['enabledJars']:
        raise ValueError('Wrong upstream mod inventory')
    index = copy.deepcopy(index)
    for row in content['mods']:
        raw, actual = pinned_file(downloads, row)
        index['files'].append(download_entry(row, raw, actual))
    if profile == 'agent':
        if agent_bundle is None:
            raise ValueError('Agent profile requires the explicit locked client bundle')
        for row in pack['agentMods']:
            raw, actual = pinned_file(agent_bundle, row)
            if 'url' in row:
                index['files'].append(download_entry(row, raw, actual, client_only=True))
            else:
                entries['client-overrides/mods/' + row['file']] = raw
    selected = pack['profiles'][profile]
    index.update(name=pack['name'] + (' · Agent' if profile == 'agent' else ' · 玩家'),
                 versionId=selected['versionId'], summary=pack['summary'])
    entries['modrinth.index.json'] = json_bytes(index)
    # Static project text only. Never read instance config, account or SDK ledgers.
    text = (ROOT / 'docs/FOM-UNIFIED-QUICKSTART.txt').read_bytes().replace(b'\r\n', b'\n')
    entries['client-overrides/FOM-QiandengJi/开始这里.txt'] = text
    entries['client-overrides/FOM-QiandengJi/content.lock.json'] = json_bytes(content)
    if profile == 'agent':
        entries['client-overrides/FOM-QiandengJi/CLIENT-BRIDGE-LICENSE.txt'] = (ROOT / 'LICENSE').read_bytes().replace(b'\r\n', b'\n')
        entries['client-overrides/FOM-QiandengJi/MINESCRIPT-COPYING.txt'] = (ROOT / 'world/third-party/minescript/COPYING').read_bytes().replace(b'\r\n', b'\n')
        entries['client-overrides/FOM-QiandengJi/MINESCRIPT-SOURCE.txt'] = (ROOT / 'world/third-party/minescript/SOURCE.txt').read_bytes().replace(b'\r\n', b'\n')
        entries['client-overrides/FOM-QiandengJi/agent-components.lock.json'] = json_bytes(pack['agentMods'])
    paths = effective_paths(index, entries)
    counts = {'enabledJars': sum(p.startswith('mods/') and p.endswith('.jar') for p in paths),
              'authorDisabled': sum(p.startswith('mods/') and p.endswith('.jar.disabled') for p in paths)}
    if counts != selected['counts']:
        raise ValueError('Final mod inventory differs from release profile')
    receipt = {'schemaVersion': 1, 'profile': profile, 'versionId': index['versionId'],
               'dependencies': pack['dependencies'], 'upstream': pack['upstream'], 'counts': counts,
               'archiveFiles': {name: hashlib.sha256(raw).hexdigest() for name, raw in entries.items()}}
    entries[RECEIPT] = json_bytes(receipt)
    output.parent.mkdir(parents=True, exist_ok=True)
    pending = output.with_suffix(output.suffix + '.building')
    try:
        write_zip(pending, entries)
        result = verify(pending)
        # On Windows rename refuses an existing target; also check on other hosts.
        if output.exists():
            raise ValueError('Output appeared during build; refusing replacement')
        pending.rename(output)
    except BaseException:
        if pending.is_file():
            pending.unlink()
        raise
    return {**result, 'output': str(output), 'installedGameChanged': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=Path, help='Verify an existing release without changing it')
    parser.add_argument('--cache', type=Path, help='Optional instance file cache for every indexed SHA1/SHA512')
    parser.add_argument('--base', type=Path)
    parser.add_argument('--downloads', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--profile', choices=('player', 'agent'), default='player')
    parser.add_argument('--agent-bundle', type=Path)
    args = parser.parse_args()
    if args.verify:
        result = verify(args.verify, args.cache)
    else:
        if not all((args.base, args.downloads, args.output)):
            parser.error('--base, --downloads and --output are required when building')
        result = build(args.base, args.downloads, args.output, profile=args.profile, agent_bundle=args.agent_bundle)
    print(json.dumps(result, ensure_ascii=False, indent=2))
