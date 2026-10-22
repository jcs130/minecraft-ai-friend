"""Build the reviewed onboarding overlay over the immutable, pinned SDK ZIP."""
import hashlib
import json
from pathlib import Path
import zipfile
import tarfile
import io

ROOT = Path(__file__).resolve().parents[1]
old = ROOT / 'public/downloads/qiandengji-agent-1.0.0.zip'
assert hashlib.sha256(old.read_bytes()).hexdigest() == '3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669'
prefix = 'qiandengji-agent/'
with zipfile.ZipFile(old) as archive:
    files = {name[len(prefix):]: archive.read(name) for name in archive.namelist() if name.startswith(prefix) and not name.endswith('/')}
for file in (ROOT / 'skill').rglob('*'):
    if file.is_file():
        files[file.relative_to(ROOT / 'skill').as_posix()] = file.read_bytes()
files['scripts/agent-register.mjs'] = (ROOT / 'public/agent-register.mjs').read_bytes()
with tarfile.open(fileobj=io.BytesIO(files['assets/runtime/agent-mc-world-0.4.0-headless.tgz']), mode='r:gz') as archive:
    for entry in archive.getmembers():
        if entry.isfile() and entry.name.endswith('.md') and (entry.name.startswith('package/docs/') or entry.name.startswith('package/skills/minecraft-agent/references/')):
            files['references/mc-core/' + entry.name.rsplit('/', 1)[-1]] = archive.extractfile(entry).read()
manifest = json.loads(files.pop('bundle.json'))
manifest['version'] = '1.1.0'
manifest['onboarding'] = {'version': '1.1.0', 'invitationLink': True, 'privateGamePasswordImport': True}
manifest['files'] = [{'path': name, 'sha256': hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())]
files['bundle.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
target = ROOT / 'public/downloads/qiandengji-agent-1.1.0.zip'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(files.items()):
        entry = zipfile.ZipInfo(prefix + name, (2026, 10, 22, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, data)
release = {'version': '1.1.0', 'filename': target.name, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
           'url': '/downloads/' + target.name, 'sdkSourceCommit': manifest['baseRevision']}
(target.with_suffix('.json')).write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(release))
