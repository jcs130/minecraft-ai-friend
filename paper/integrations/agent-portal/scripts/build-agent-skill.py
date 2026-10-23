"""Build the pinned server Skill; never fetch a moving dependency while packaging."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import tarfile
import io
import re
import posixpath

ROOT = Path(__file__).resolve().parents[1]
lock = json.loads((ROOT / 'skill/runtime-lock.json').read_text(encoding='utf-8'))
args = argparse.ArgumentParser()
args.add_argument('--sdk-archive', type=Path)
args.add_argument('--output-directory', type=Path, help='Fresh release output; existing reviewed files are never overwritten')
options = args.parse_args()
old = ROOT / 'public/downloads/qiandengji-agent-1.0.0.zip'
assert hashlib.sha256(old.read_bytes()).hexdigest() == '3d1676e86f31396071866c64ce87d9e6820e1530b755c4221f04c22a15f94669'
prefix = 'qiandengji-agent/'
with zipfile.ZipFile(old) as archive:
    files = {name[len(prefix):]: archive.read(name) for name in archive.namelist() if name.startswith(prefix) and not name.endswith('/')}
files = {name: data for name,data in files.items() if not name.startswith('references/mc-core/') and not name.endswith('.tgz')}
reviewed = ROOT / ('public/downloads/qiandengji-agent-' + lock['version'] + '.zip')
target = (options.output_directory or reviewed.parent) / reviewed.name
if target.exists() or target.with_suffix('.json').exists():
    raise FileExistsError('Use a new release version or a fresh output directory')
target.parent.mkdir(parents=True, exist_ok=True)
if options.sdk_archive:
    sdk = options.sdk_archive.read_bytes()
else:
    # Rebuilds use the already reviewed release, not npm's changing latest tag.
    with zipfile.ZipFile(reviewed) as previous:
        sdk = previous.read(prefix + 'assets/runtime/' + lock['sdkArchive'])
assert len(sdk) == lock['sdkBytes'] and hashlib.sha256(sdk).hexdigest() == lock['sdkSha256'], 'SDK digest mismatch'
for file in (ROOT / 'skill').rglob('*'):
    if file.is_file() and not file.name.endswith('.tgz') and 'node_modules' not in file.parts:
        name = file.relative_to(ROOT / 'skill').as_posix()
        if not re.fullmatch(r'(SKILL\.md|runtime-lock\.json|scripts/[a-z-]+\.mjs|references/[a-z-]+\.md|assets/runtime/(package(?:-lock)?\.json|[a-z-]+\.mjs|qiandengji/[a-z-]+\.mjs))', name):
            raise ValueError('Unexpected Skill input: ' + name)
        files[name] = file.read_bytes().replace(b'\r\n',b'\n')
files['scripts/agent-register.mjs'] = (ROOT / 'public/agent-register.mjs').read_bytes().replace(b'\r\n',b'\n')
files['assets/runtime/' + lock['sdkArchive']] = sdk
with tarfile.open(fileobj=io.BytesIO(sdk), mode='r:gz') as archive:
    package = json.load(archive.extractfile('package/package.json'))
    build = json.load(archive.extractfile('package/dist/build.json'))
    assert package['name'] == 'agent-mc-world' and package['version'] == lock['sdkVersion']
    assert not build['viewer']['included'], 'This Skill explicitly provides the headless SDK'
    for entry in archive.getmembers():
        if entry.isfile() and entry.name.endswith('.md') and (entry.name.startswith('package/docs/') or entry.name.startswith('package/skills/') or entry.name == 'package/README.md'):
            files['references/mc-core/' + entry.name.removeprefix('package/')] = archive.extractfile(entry).read()
# Standalone docs keep local navigation. Source-code links not shipped beside
# those docs point to the exact SDK revision, not a missing local file or main.
link = re.compile(r'(\]\()([^\s)]+)(\))')
for name, data in list(files.items()):
    if not name.endswith('.md'):
        continue
    def resolve_link(match):
        href = match[2]
        if re.match(r'^[a-z][a-z0-9+.-]*:', href, re.I) or href.startswith('#'):
            return match[0]
        path, marker, anchor = href.partition('#')
        destination = posixpath.normpath(posixpath.join(posixpath.dirname(name), path))
        if destination in files:
            return match[0]
        if not name.startswith('references/mc-core/') or not destination.startswith('references/mc-core/'):
            raise ValueError('Missing packaged reference: ' + name + ' -> ' + href)
        source = destination.removeprefix('references/mc-core/')
        url = 'https://github.com/jcs130/minecraft-ai-friend/blob/' + lock['sdkSourceCommit'] + '/packages/agent-mc-world/' + source
        return match[1] + url + (marker + anchor if marker else '') + match[3]
    files[name] = link.sub(resolve_link, data.decode('utf-8')).encode('utf-8')
manifest = json.loads(files.pop('bundle.json'))
manifest.update(version=lock['version'], baseRevision=lock['sdkSourceCommit'])
manifest['sdk'] = {'version':lock['sdkVersion'],'flavor':'without-viewer','channel':lock['channel'],'sha256':lock['sdkSha256'],'bytes':len(sdk),'sourceUrl':lock['sourceUrl']}
manifest['onboarding'] = {'version':lock['version'],'invitationLink':True,'privateGamePasswordImport':True}
manifest['files'] = [{'path':name,'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(files.items())]
files['bundle.json'] = (json.dumps(manifest,ensure_ascii=False,indent=2) + '\n').encode()
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name,data in sorted(files.items()):
        entry=zipfile.ZipInfo(prefix + name,(2026,10,23,0,0,0))
        entry.create_system=3
        entry.compress_type=zipfile.ZIP_DEFLATED; entry.external_attr=0o100644 << 16
        archive.writestr(entry,data)
release={'version':lock['version'],'filename':target.name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),
         'url':'/downloads/' + target.name,'sdkVersion':lock['sdkVersion'],'sdkSourceCommit':lock['sdkSourceCommit'],'sourceUrl':lock['sourceUrl'],'channel':lock['channel'],'viewerIncluded':False}
(target.with_suffix('.json')).write_text(json.dumps(release,ensure_ascii=False,indent=2) + '\n',encoding='utf-8',newline='\n')
print(json.dumps(release))
