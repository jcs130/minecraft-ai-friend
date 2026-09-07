"""Prepare the existing packs, correcting copied display labels without changing audio.

Use --packs-only to leave runtime URLs and other configuration completely untouched.
The same metadata repair is applied in both modes, always from the read-only source.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend")

# Names verified against the original make_tlm_packs.py / import_new_voices.py.
# ark_golding is the original project's identifier for 澄闪, not a translation.
CHARACTERS = {
    'ark_amiya': '阿米娅', 'ark_bena': '贝娜', 'ark_durin': '杜林',
    'ark_golding': '澄闪', 'ark_kroos': '克洛丝', 'ark_luo_xiaohei': '罗小黑',
    'ark_magallan': '麦哲伦', 'ark_myrtle': '桃金娘', 'ark_paopao': '泡泡',
    'ark_texas': '德克萨斯', 'ark_yueyue': '跃跃',
}
PACK_DIRECTORIES = ('client/tlm_custom_pack', 'server/mc/tlm_custom_pack', 'server/public/packs')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def audio_fingerprint(archive):
    """Digest every audio path and its uncompressed bytes, independent of ZIP encoding."""
    entries = []
    for name in sorted(archive.namelist()):
        if name.lower().endswith('.ogg'):
            data = archive.read(name)
            if not data.startswith(b'OggS'):
                raise ValueError('Invalid OGG header: ' + name)
            entries.append([name, sha256(data)])
    encoded = json.dumps(entries, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return {'file_count': len(entries), 'paths_and_content_sha256': sha256(encoded)}


def prepare_archive(name, source_bytes):
    """Return a deterministic archive and a public validation record; never write sources."""
    namespace = name.split('-', 1)[0]
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as original:
        if original.testzip() is not None:
            raise ValueError('Corrupt archive: ' + name)
        names = original.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate ZIP entries: ' + name)
        if not any(n.startswith('assets/') and n.endswith('.json') for n in names):
            raise ValueError('Missing voice pack metadata: ' + name)
        audio = audio_fingerprint(original)
        if namespace not in CHARACTERS:
            return source_bytes, {'metadata_repaired': False, 'audio': audio}
        character = CHARACTERS[namespace]
        meta_path = f'assets/{namespace}/maid_sound.json'
        icon_path = f'assets/{namespace}/textures/sound_icon.png'
        if icon_path not in names:
            raise ValueError('Cannot reference a missing own-pack icon: ' + name)
        old_meta_text = original.read(meta_path).decode('utf-8')
        old_meta = json.loads(old_meta_text)
        expected_old = {
            'pack_name': '{sound_pack.ark_pepe.name}',
            'description': '{sound_pack.ark_pepe.desc}',
            'icon': 'ark_pepe:textures/sound_icon.png',
        }
        if any(old_meta.get(key) != value for key, value in expected_old.items()):
            raise ValueError('Source metadata changed; review repair before importing: ' + name)
        # Substitute only the three known references. All other metadata bytes stay intact.
        new_meta_text = old_meta_text
        new_fields = {}
        for key, value in expected_old.items():
            replacement = value.replace('ark_pepe', namespace)
            new_meta_text = new_meta_text.replace(json.dumps(value), json.dumps(replacement))
            new_fields[key] = replacement
        new_meta = json.loads(new_meta_text)
        if new_meta != {**old_meta, **new_fields}:
            raise ValueError('Unexpected metadata mutation: ' + name)
        changed = {meta_path: new_meta_text.encode('utf-8')}
        for locale in ('zh_cn', 'en_us'):
            path = f'assets/{namespace}/lang/{locale}.lang'
            text = original.read(path).decode('utf-8')
            values = {
                'name': character + ('声音包' if locale == 'zh_cn' else ' Voice'),
                'desc': ('配音：明日方舟官方中文CV；' + character + '角色语音'
                         if locale == 'zh_cn' else 'Arknights official CN voice; ' + character),
            }
            for key, value in values.items():
                pattern = rf'^sound_pack\.ark_pepe\.{key}=[^\r\n]*'
                text, count = re.subn(pattern, f'sound_pack.{namespace}.{key}={value}', text, flags=re.M)
                if count != 1:
                    raise ValueError('Unexpected language entries: ' + path)
            changed[path] = text.encode('utf-8')
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as rebuilt:
            rebuilt.comment = original.comment
            for info in original.infolist():
                rebuilt.writestr(copy.copy(info), changed.get(info.filename, original.read(info.filename)))
        prepared_bytes = output.getvalue()
        with zipfile.ZipFile(io.BytesIO(prepared_bytes)) as prepared:
            if prepared.testzip() is not None or prepared.namelist() != names:
                raise ValueError('Rebuilt ZIP validation failed: ' + name)
            actual_changes = [n for n in names if original.read(n) != prepared.read(n)]
            if set(actual_changes) != set(changed):
                raise ValueError('Unexpected changed ZIP entries: ' + name)
            if audio_fingerprint(prepared) != audio:
                raise ValueError('Audio changed: ' + name)
            # Stronger than aggregate hashes: compare every non-metadata entry byte for byte.
            for path in names:
                if path not in changed and original.read(path) != prepared.read(path):
                    raise ValueError('Unrelated resource changed: ' + path)
        return prepared_bytes, {
            'metadata_repaired': True, 'character_zh_cn': character,
            'changed_entries': actual_changes,
            'before': expected_old, 'after': new_fields,
            'author_credit_preserved': new_meta.get('author') == old_meta.get('author'),
            'icon': {'path': icon_path, 'sha256': sha256(original.read(icon_path)),
                     'bytes_unchanged': True, 'existing_shared_artwork_preserved': True},
            'audio': audio, 'all_audio_bytes_unchanged': True,
            'all_other_entries_bytes_unchanged': True,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--packs-only', action='store_true', help='Only prepare ZIPs and the public lock manifest')
    args = parser.parse_args()
    config = ROOT / 'server/mc/config/touhou_little_maid-server.toml'
    text = config.read_text(encoding='utf-8')
    raw = re.search(r'^ClientPackDownloadUrls\s*=\s*(\[.*\])$', text, re.M)
    if not raw:
        raise ValueError('Expected the existing ClientPackDownloadUrls array')
    urls = tomllib.loads('urls = ' + raw.group(1))['urls']
    selected = []
    for url in urls:
        name = url.rsplit('/', 1)[-1]
        if not re.fullmatch(r'[a-z0-9_.-]+\.zip', name):
            raise ValueError('Unexpected pack filename')
        matches = sorted((SOURCE / 'tmp').rglob(name))
        if not matches:
            raise FileNotFoundError(name)
        source = next((p for p in matches if p.parent.name == 'official_packs'), matches[0])
        source_bytes = source.read_bytes()
        prepared_bytes, validation = prepare_archive(name, source_bytes)
        selected.append((name, source, source_bytes, prepared_bytes, validation))
    files = []
    for name, source, source_bytes, prepared_bytes, validation in selected:
        for directory in PACK_DIRECTORIES:
            target = ROOT / directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists() or target.read_bytes() != prepared_bytes:
                temporary = target.with_suffix('.zip.tmp')
                temporary.write_bytes(prepared_bytes)
                temporary.replace(target)
            if target.read_bytes() != prepared_bytes:
                raise ValueError('Installed pack differs: ' + str(target))
        if source.read_bytes() != source_bytes:
            raise ValueError('Source changed while preparing pack: ' + name)
        files.append({'path': 'tlm_custom_pack/' + name, 'source': str(source),
                      'size': len(prepared_bytes), 'sha256': sha256(prepared_bytes),
                      'source_sha256': sha256(source_bytes), 'validation': validation})
    if not args.packs_only:
        local_urls = ['http://127.0.0.1:19090/packs/' + item[0] for item in selected]
        text = text[:raw.start(1)] + json.dumps(local_urls) + text[raw.end(1):]
        tomllib.loads(text)
        config.write_text(text, encoding='utf-8')
        svc = ROOT / 'server/mc/config/voicechat/voicechat-server.properties'
        svc.write_text(re.sub(r'^voice_host=.*$', 'voice_host=127.0.0.1:24455',
                             svc.read_text(encoding='utf-8'), flags=re.M), encoding='utf-8')
        tts = ROOT / 'server/mc/config/touhou_little_maid/sites/tts.json'
        data = json.loads(tts.read_text(encoding='utf-8'))
        data['gpt-sovits']['url'] = 'http://host.docker.internal:8100/tts'
        tts.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = {'count': len(files), 'files': files, 'download_base': 'http://127.0.0.1:19090/packs/',
              'preinstalled_in_client': True, 'server_restart_required': True,
              'voice_host': '127.0.0.1:24455', 'tts_uses_existing_local_inference': True,
              'metadata_repair': {'policy': 'ark-character-labels-v1',
                                  'count': sum(f['validation']['metadata_repaired'] for f in files),
                                  'source_archives_read_only': True,
                                  'unrelated_resources_and_audio_unchanged': True}}
    (ROOT / 'manifests/voice-packs.lock.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'files'}))


if __name__ == '__main__':
    main()
