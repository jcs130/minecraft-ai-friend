"""Import a Minecraft save into a NEW project-local directory. Python 3.11+.

Only reads the source. Never removes or replaces an existing destination. The
caller must coordinate save-off/flush (or stop the source) before copying.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import time
import tomllib
import zipfile

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SECRET_KEY = re.compile(r"password|passwd|secret|credential|authorization|privatekey|apikey|accesstoken|authtoken|bottoken|refreshtoken|sessiontoken|accesskey|bearer", re.I)
TEXT_EXTENSIONS = {'.json', '.jsonl', '.toml', '.yaml', '.yml', '.properties', '.cfg', '.conf', '.json5', '.txt', '.md'}


class MigrationError(Exception):
    pass


def secret_key(key):
    normalized = re.sub(r'[^a-z0-9]', '', str(key).lower())
    return normalized in {'token', 'auth', 'pwd'} or bool(SECRET_KEY.search(normalized))


def link(path):
    return path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction())


def project_target(path):
    target = Path(path).resolve()
    if target == PROJECT_ROOT or not target.is_relative_to(PROJECT_ROOT):
        raise MigrationError('Destination must be a new directory below the project root')
    return target


def new_directory(path):
    target = project_target(path)
    if target.exists():
        raise MigrationError(f'Destination already exists: {target}')
    target.mkdir(parents=True, exist_ok=False)
    return target


def safe_name(name):
    if not re.fullmatch(r'[A-Za-z0-9_\-\u3400-\u9fff]+', name):
        raise MigrationError('Save name must contain only letters, numbers, underscores or hyphens')
    return name


def iter_files(root):
    root = Path(root)
    if link(root):
        raise MigrationError(f'Source links are not accepted: {root}')
    for base, dirs, names in os.walk(root, followlinks=False):
        dirs.sort()
        for name in dirs + names:
            if link(Path(base) / name):
                raise MigrationError(f'Source links are not accepted: {Path(base) / name}')
        for name in sorted(names):
            yield Path(base) / name


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def stable_bytes(path, attempts=4):
    for _ in range(attempts):
        before = path.stat()
        raw = path.read_bytes()
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns):
            return raw
        time.sleep(0.05)
    raise MigrationError(f'Source changed while reading: {path}')


def redact_object(value, changes, file, prefix=''):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            name = f'{prefix}.{key}' if prefix else str(key)
            if secret_key(key):
                replacement = {} if isinstance(item, dict) else [] if isinstance(item, list) else False if isinstance(item, bool) else 0 if isinstance(item, (int, float)) else ''
                if item not in ('', None, [], {}):
                    changes.append({'path': file, 'key': name, 'action': 'credential_cleared'})
                result[key] = replacement
            else:
                result[key] = redact_object(item, changes, file, name)
        return result
    if isinstance(value, list):
        return [redact_object(v, changes, file, f'{prefix}[{i}]') for i, v in enumerate(value)]
    return value


def toml_value(value):
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value).lower()
    if isinstance(value, list):
        return '[' + ', '.join(toml_value(v) for v in value) + ']'
    if isinstance(value, dict):
        return '{' + ', '.join(json.dumps(k) + ' = ' + toml_value(v) for k, v in value.items()) + '}'
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    raise MigrationError('Unsupported TOML value type')


def json_with_comments(text):
    """Parse JSONC without touching comment-like text inside JSON strings."""
    output, index, quoted, escaped = [], 0, False, False
    while index < len(text):
        ch = text[index]
        if quoted:
            output.append(ch)
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                quoted = False
            index += 1
        elif ch == '"':
            quoted = True
            output.append(ch)
            index += 1
        elif text.startswith('//', index):
            end = text.find('\n', index)
            index = len(text) if end < 0 else end
        elif text.startswith('/*', index):
            end = text.find('*/', index + 2)
            if end < 0:
                raise ValueError('Unclosed JSON comment')
            output.append(' ')
            index = end + 2
        elif ch == ',' and text[index + 1:].lstrip().startswith(('}', ']')):
            index += 1
        else:
            output.append(ch)
            index += 1
    return json.loads(''.join(output))


def redact_toml_preserving_format(raw, changes, file):
    """Change credential assignment values without changing TOML table syntax.

    Several Minecraft config libraries reject TOML inline tables, even though
    Python's parser accepts them. In particular, unchanged files must retain
    their exact bytes. Ambiguous structured credential sections fail closed.
    """
    text = raw.decode('utf-8-sig')
    original = tomllib.loads(text)
    local_changes = []
    expected = redact_object(original, local_changes, file)
    if not local_changes:
        return raw
    lines = text.splitlines(keepends=True)
    output, index = [], 0
    while index < len(lines):
        match = re.match(r'^(\s*(?:"(?:[^"\\]|\\.)*"|\'[^\']*\'|[A-Za-z0-9_.\-]+)\s*=\s*)(.*)', lines[index])
        if not match:
            output.append(lines[index])
            index += 1
            continue
        key = match.group(1).rsplit('=', 1)[0].strip().strip('"\'').split('.')[-1]
        if not secret_key(key):
            output.append(lines[index])
            index += 1
            continue
        # Locate the whole value using TOML parsing, including multiline
        # strings/arrays. Error messages are never shown with value excerpts.
        end = index
        rhs = lines[index][len(match.group(1)):]
        while True:
            try:
                value = tomllib.loads('value = ' + rhs)['value']
                break
            except (tomllib.TOMLDecodeError, KeyError):
                end += 1
                if end >= len(lines):
                    raise MigrationError(f'Cannot safely locate TOML credential assignment: {file}') from None
                rhs += lines[end]
        replacement = {} if isinstance(value, dict) else [] if isinstance(value, list) else False if isinstance(value, bool) else 0 if isinstance(value, (int, float)) else ''
        # Preserve a single-line comment and the original newline style.
        suffix = '\r\n' if lines[end].endswith('\r\n') else '\n' if lines[end].endswith('\n') else ''
        if end == index:
            quoted, escaped, quote = False, False, ''
            for pos, char in enumerate(rhs.rstrip('\r\n')):
                if quoted:
                    if escaped:
                        escaped = False
                    elif char == '\\' and quote == '"':
                        escaped = True
                    elif char == quote:
                        quoted = False
                elif char in ('"', "'"):
                    quoted, quote = True, char
                elif char == '#':
                    space = rhs[:pos][len(rhs[:pos].rstrip()):]
                    suffix = space + rhs[pos:]
                    break
        output.append(match.group(1) + toml_value(replacement) + suffix)
        index = end + 1
    rewritten = ''.join(output)
    if tomllib.loads(rewritten) != expected:
        raise MigrationError(f'Cannot preserve TOML structure while redacting credentials: {file}')
    changes.extend(local_changes)
    encoded = rewritten.encode('utf-8')
    return (b'\xef\xbb\xbf' + encoded) if raw.startswith(b'\xef\xbb\xbf') else encoded


def sanitized_text(raw, suffix, changes, file):
    try:
        text = raw.decode('utf-8-sig')
        if suffix in {'.json', '.json5'}:
            value = redact_object(json_with_comments(text), changes, file)
            return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        if suffix == '.jsonl':
            values = [redact_object(json.loads(line), changes, file) for line in text.splitlines() if line.strip()]
            return ''.join(json.dumps(v, ensure_ascii=False) + '\n' for v in values).encode('utf-8')
        if suffix == '.toml':
            return redact_toml_preserving_format(raw, changes, file)
        # For non-standard formats redact single-line assignments. Refuse
        # multiline credential values rather than copying an uncertain secret.
        out = []
        for line in text.splitlines(keepends=True):
            match = re.match(r'^(\s*["\']?([^:=\n"\']+)["\']?\s*[:=]\s*)(.*?)(\r?\n)?$', line)
            if match and secret_key(match.group(2).strip()):
                value = match.group(3).strip()
                if not value or value.startswith(('"""', "'''", '|', '>', '[', '{')) or value.endswith('\\'):
                    raise MigrationError(f'Cannot safely rewrite multiline credential at {file}')
                replacement = '' if suffix == '.properties' else '""'
                out.append(match.group(1) + replacement + ('\n' if line.endswith('\n') else ''))
                changes.append({'path': file, 'key': match.group(2).strip(), 'action': 'credential_cleared'})
            else:
                out.append(line)
        return ''.join(out).encode('utf-8')
    except (UnicodeError, ValueError, tomllib.TOMLDecodeError) as exc:
        # Deliberately do not include parser excerpts, which may contain secrets.
        raise MigrationError(f'Cannot parse configuration safely: {file}') from None


def copy_file(source, destination, records, changes=None, sanitize=False):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise MigrationError(f'Refusing to overwrite: {destination}')
    before = source.stat()
    if sanitize and source.suffix.lower() in TEXT_EXTENSIONS:
        raw = stable_bytes(source)
        raw = sanitized_text(raw, source.suffix.lower(), changes, str(source))
        with destination.open('xb') as f:
            f.write(raw)
        action = 'sanitized_copy'
    else:
        with source.open('rb') as src, destination.open('xb') as dst:
            shutil.copyfileobj(src, dst, 1024 * 1024)
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise MigrationError(f'Source changed while copying: {source}')
        action = 'copy'
    records.append({'source': str(source), 'path': str(destination.relative_to(PROJECT_ROOT)),
                    'bytes': destination.stat().st_size, 'sha256': sha256(destination), 'action': action})


def read_level(path):
    """Small bounded NBT reader for level.dat; never reads region/player NBT."""
    try:
        with gzip.open(path, 'rb') as source:
            data = source.read(32 * 1024 * 1024 + 1)
    except (OSError, EOFError):
        raise MigrationError('Cannot read level.dat as gzip NBT') from None
    if len(data) > 32 * 1024 * 1024:
        raise MigrationError('level.dat is unexpectedly large')
    buf = io.BytesIO(data)
    def read(n):
        value = buf.read(n)
        if len(value) != n:
            raise MigrationError('Truncated level.dat NBT')
        return value
    def num(fmt):
        return struct.unpack('>' + fmt, read(struct.calcsize('>' + fmt)))[0]
    def string():
        return read(num('H')).decode('utf-8', errors='replace')
    def payload(kind, depth=0):
        if depth > 64:
            raise MigrationError('Excessively nested NBT')
        if kind in {1, 2, 3, 4, 5, 6}:
            return num({1:'b', 2:'h', 3:'i', 4:'q', 5:'f', 6:'d'}[kind])
        if kind == 8:
            return string()
        if kind in {7, 11, 12}:
            length = num('i')
            if length < 0 or length > 10_000_000:
                raise MigrationError('Invalid NBT array length')
            read(length * {7:1, 11:4, 12:8}[kind])
            return {'array_length': length}
        if kind == 9:
            subtype, length = num('B'), num('i')
            if length < 0 or length > 1_000_000:
                raise MigrationError('Invalid NBT list length')
            return [payload(subtype, depth + 1) for _ in range(length)]
        if kind == 10:
            result = {}
            while (subtype := num('B')) != 0:
                key = string()
                result[key] = payload(subtype, depth + 1)
            return result
        raise MigrationError('Unknown NBT type')
    try:
        if num('B') != 10:
            raise MigrationError('level.dat root must be an NBT compound')
        string()
        root = payload(10)
        return root.get('Data', root)
    except (OSError, EOFError, struct.error, ValueError):
        raise MigrationError('Cannot read level.dat as gzip NBT') from None


def inspect_save(source, installed_mod_ids=None):
    source = Path(source).resolve()
    if not source.is_dir() or not (source / 'level.dat').is_file():
        raise MigrationError('Source must be a save directory containing level.dat')
    data = read_level(source / 'level.dat')
    dimensions = []
    for child in sorted(source.iterdir()):
        if child.is_dir() and (child.name == 'region' or re.fullmatch(r'DIM-?\d+', child.name)):
            dimensions.append(child.name)
    custom = source / 'dimensions'
    if custom.is_dir():
        for namespace in sorted(custom.iterdir()):
            if namespace.is_dir():
                dimensions.extend(f'dimensions/{namespace.name}/{p.name}' for p in sorted(namespace.iterdir()) if p.is_dir())
    refs = sorted(set(re.findall(r'\b([a-z][a-z0-9_]*):[a-z0-9_./-]+', json.dumps(data))))
    dimension_namespaces = sorted({p.split('/')[1] for p in dimensions if p.startswith('dimensions/')})
    missing = [] if installed_mod_ids is None else sorted(set(refs + dimension_namespaces) - set(installed_mod_ids) - {'minecraft', 'neoforge'})
    return {'source': str(source), 'data_version': data.get('DataVersion'), 'version': data.get('Version'),
            'dimensions': dimensions, 'datapacks': sorted(p.name for p in (source / 'datapacks').iterdir()) if (source / 'datapacks').is_dir() else [],
            'enabled_datapacks': data.get('DataPacks', {}).get('Enabled', []),
            'player_files': len(list((source / 'playerdata').glob('*.dat'))),
            'namespace_candidates': refs, 'unmatched_namespace_candidates': missing,
            'warnings': ['Static namespace checks are not a complete block/item/entity registry audit; region files remain unmodified.',
                         'Custom datapacks may own namespaces without a matching mod ID; review unmatched candidates before launching.'],
            'runtime_load_verified': False}


def jar_metadata(path):
    with zipfile.ZipFile(path) as jar:
        for descriptor in ('META-INF/neoforge.mods.toml', 'META-INF/mods.toml'):
            if descriptor in jar.namelist():
                try:
                    meta = tomllib.loads(jar.read(descriptor).decode('utf-8-sig'))
                except Exception:
                    raise MigrationError(f'Cannot parse mod descriptor: {path.name}') from None
                mods = meta.get('mods', [])
                return {'filename': path.name, 'sha256': sha256(path), 'bytes': path.stat().st_size,
                        'mods': [{'id': m['modId'], 'version': m.get('version', '')} for m in mods],
                        'dependencies': meta.get('dependencies', {}), 'descriptor': descriptor}
    raise MigrationError(f'No Forge/NeoForge descriptor found: {path.name}')


def mod_plan(mods_dir):
    kept, duplicates, ids, hashes = [], [], {}, {}
    # Retain the canonical versioned Better Combat filename over its alias.
    for path in sorted(Path(mods_dir).glob('*.jar'), key=lambda p: (p.name == 'bc232-rebuilt.jar', p.name.lower())):
        if link(path):
            raise MigrationError(f'Mod links are not accepted: {path}')
        meta = jar_metadata(path)
        if meta['sha256'] in hashes:
            duplicates.append({'filename': path.name, 'same_as': hashes[meta['sha256']], 'reason': 'identical_sha256'})
            continue
        for mod in meta['mods']:
            if mod['id'] in ids:
                raise MigrationError(f'Different jars declare duplicate mod ID {mod["id"]}: {ids[mod["id"]]} / {path.name}; no mod was silently removed')
        for mod in meta['mods']:
            ids[mod['id']] = path.name
        hashes[meta['sha256']] = path.name
        kept.append(meta)
    return {'kept': kept, 'duplicates_removed': duplicates, 'mod_ids': sorted(ids)}


def copy_save(source, destination, records, changes):
    destination.mkdir(parents=True, exist_ok=False)
    # Empty registered dimensions and datapack directories are meaningful too.
    for base, dirs, _ in os.walk(source, followlinks=False):
        for name in dirs:
            child = Path(base) / name
            if link(child):
                raise MigrationError(f'Source links are not accepted: {child}')
            (destination / child.relative_to(source)).mkdir(parents=True, exist_ok=True)
    for path in iter_files(source):
        rel = path.relative_to(source)
        if rel.as_posix() == 'session.lock':
            continue
        copy_file(path, destination / rel, records, changes, sanitize='serverconfig' in rel.parts)


def write_json(path, value):
    with path.open('x', encoding='utf-8') as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write('\n')


def import_save(source, destination_root, name, *, source_quiesced=False, mods_dir=None):
    if not source_quiesced:
        raise MigrationError('Coordinate a stopped source or save-off + save-all flush first; pass --source-quiesced only after that')
    source = Path(source).resolve()
    destination = project_target(Path(destination_root) / safe_name(name))
    if destination.exists():
        raise MigrationError(f'Destination already exists: {destination}')
    if destination.is_relative_to(source) or source.is_relative_to(destination):
        raise MigrationError('Source and destination must not overlap')
    mods = mod_plan(mods_dir) if mods_dir else None
    report = inspect_save(source, mods['mod_ids'] if mods else None)
    records, changes = [], []
    copy_save(source, destination, records, changes)
    report.update({'destination': str(destination), 'files': records, 'redactions': changes,
                   'source_quiesced_asserted_by_caller': True, 'mods': mods})
    write_json(destination / 'qiandengji-import-report.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination-root', type=Path, default=PROJECT_ROOT / 'client' / 'saves')
    parser.add_argument('--name', required=True)
    parser.add_argument('--mods', type=Path)
    parser.add_argument('--source-quiesced', action='store_true')
    args = parser.parse_args()
    try:
        report = import_save(args.source, args.destination_root, args.name, source_quiesced=args.source_quiesced, mods_dir=args.mods)
        print(json.dumps({'destination': report['destination'], 'files': len(report['files']), 'redactions': len(report['redactions']), 'runtime_load_verified': False}, ensure_ascii=False))
    except MigrationError as exc:
        parser.exit(2, f'{exc}\n')


if __name__ == '__main__':
    main()
