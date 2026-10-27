"""Recompile our addons against Tau's pinned NeoForge, leaving third-party JARs intact.

Sources are from this project's experiment/agent-society-1.21.1 branch. The exact
source commit, every input hash and output hash are recorded beside the artifacts.
This builds files only; it neither installs them nor restarts a server.
"""
from pathlib import Path
import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import zipfile

NEO = '21.1.234'


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def classpath(server):
    libraries = server / 'libraries'
    neo = libraries / f'net/neoforged/neoforge/{NEO}'
    args = (neo / 'win_args.txt').read_text(encoding='utf-8')
    legacy = next(line.split('=', 1)[1] for line in args.splitlines()
                  if line.startswith('-DlegacyClassPath='))
    paths = [neo / f'neoforge-{NEO}-server.jar',
             libraries / 'net/minecraft/server/1.21.1-20240808.144430/server-1.21.1-20240808.144430-srg.jar',
             neo / f'neoforge-{NEO}-universal.jar',
             *(server / p for p in legacy.split(';'))]
    if any(not p.is_file() for p in paths):
        raise ValueError('Install the author-pinned NeoForge 21.1.234 first')
    return list(dict.fromkeys(p.resolve() for p in paths))


def lower_own_requirement(data):
    text = data.decode('utf-8')
    parsed = tomllib.loads(text)
    if not parsed['mods'][0]['modId'].startswith('maw_'):
        raise ValueError('Only our own addon metadata can be backported')
    if '[21.1.248,' not in text:
        raise ValueError('Unexpected upstream dependency: review instead of blindly replacing')
    return text.replace('[21.1.248,', '[21.1.234,').encode('utf-8')


def registration_policy_source(text):
    marker='&&auth.getClass().getMethod("stage").invoke(auth).toString().equals("REGISTER")&&!reserved(p))'
    if text.count(marker)!=1:raise ValueError('Review changed first-join authentication source')
    return text.replace(marker,marker[:-1]+'&&Boolean.parseBoolean(System.getProperty("maw.guest-login","true")))')


def build(source, server, api_dir, java, output):
    source, server, api_dir = (Path(p).resolve() for p in (source, server, api_dir))
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Source checkout must be clean for reproducible provenance')
    cp = classpath(server)
    # Optional mod APIs are compile inputs, never copied into the runtime.
    mod_apis = list(sorted((server / 'mods').glob('*.jar'))) + list(sorted(api_dir.glob('*.jar')))
    cp.extend(mod_apis)
    core = next(p for p in mod_apis if p.name == 'numen-neoforge-1.21.1-0.1.4.1.jar')
    if sha(core) != 'ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226':
        raise ValueError('Official pinned Numen bytes differ')
    shared = source / 'world/society-bridge-src/src/main/java/dev/qiandeng/maw'
    modules = {
        'maw-fom-support-0.2.0-tau234': (
            source / 'world/fom-support-src/src', source / 'world/fom-support-src/resources',
            [shared / 'PlayerAuthBridge.java', shared / 'NativeRegistryDump.java']),
        'maw_numen_compat-0.1.0-tau234': (
            source / 'world/numen-compat-src/src/main/java', source / 'world/numen-compat-src/src/main/resources', []),
        'maw_numen_server-0.2.1-tau234': (
            source / 'world/numen-server-src/src/main/java', source / 'world/numen-server-src/src/main/resources', []),
    }
    records = []
    with tempfile.TemporaryDirectory(prefix='compile-', dir=output) as temp:
        work = Path(temp)
        for mod in dict.fromkeys(mod_apis):
            with zipfile.ZipFile(mod) as archive:
                for name in archive.namelist():
                    if name.startswith('META-INF/jarjar/') and name.endswith('.jar'):
                        data = archive.read(name)
                        embedded = work / (hashlib.sha256(data).hexdigest()[:16] + '-' + Path(name).name)
                        if not embedded.exists(): embedded.write_bytes(data); cp.append(embedded)
        sys.path.insert(0, str(source / 'tools'))
        spec = importlib.util.spec_from_file_location('tau_numen_mods_source', source / 'tools/build_numen_mods.py')
        generator = importlib.util.module_from_spec(spec); spec.loader.exec_module(generator)
        generated, shared_inputs = generator.generated()
        derived = work / 'derived'; derived.mkdir()
        for name, content in generated.items(): (derived / name).write_text(content, encoding='utf-8')
        registry_source = shared / 'NativeRegistryDump.java'
        text = registry_source.read_text(encoding='utf-8')
        old = 'out.addProperty("neoforge", "21.1.248");'
        if text.count(old) != 1: raise ValueError('Native registry version export changed upstream')
        registry_derived = work / 'NativeRegistryDump.java'
        registry_derived.write_text(text.replace(old, 'out.addProperty("neoforge", "' + NEO + '");'), encoding='utf-8')
        key = 'maw-fom-support-0.2.0-tau234'
        src, resources, extra = modules[key]
        modules[key] = (src, resources, [p for p in extra if p != registry_source] + [registry_derived])
        auth_source=shared/'PlayerAuthBridge.java'
        auth_derived=work/'PlayerAuthBridge.java'
        auth_derived.write_text(registration_policy_source(auth_source.read_text(encoding='utf-8')),encoding='utf-8')
        src,resources,extra=modules[key]
        modules[key]=(src,resources,[p for p in extra if p!=auth_source]+[auth_derived])
        native_resources = work / 'native-resources'; (native_resources / 'META-INF').mkdir(parents=True)
        metadata = source / 'world/numen-mods-src/src/main/resources/META-INF/neoforge.mods.toml'
        (native_resources / 'META-INF/neoforge.mods.toml').write_bytes(metadata.read_bytes())
        (native_resources / 'maw-numen-mod-operations.json').write_text(json.dumps(generator.contracts(), ensure_ascii=False), encoding='utf-8')
        modules['maw_numen_mods-0.1.0-tau234'] = (
            source / 'world/numen-mods-src/src/main/java', native_resources, sorted(derived.glob('*.java')))
        compat_sources = sorted((Path(__file__).parent / 'compat-src').rglob('*.java'))
        key = 'maw_numen_compat-0.1.0-tau234'
        src, resources, extra = modules[key]
        modules[key] = (src, resources, [*extra, *compat_sources])
        for name, (src, resources, extra) in modules.items():
            inputs = [*sorted(src.rglob('*.java')), *extra]
            classes = work / name; classes.mkdir()
            quote = lambda p: '"' + str(p).replace('\\', '/') + '"'
            args = work / 'javac.args'
            args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8',
                '-cp', quote(os.pathsep.join(map(str, cp))), '-d', quote(classes),
                *map(quote, inputs)]), encoding='utf-8')
            result = subprocess.run([str(Path(java).with_name('javac.exe')), '-J-Duser.language=en', '@' + str(args)],
                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
            (output / (name + '.compile.log')).write_text(result.stdout + result.stderr, encoding='utf-8')
            if result.returncode:
                raise RuntimeError(name + ': ' + result.stderr[-6000:])
            artifact = output / (name + '.jar')
            files = [*sorted(p for p in resources.rglob('*') if p.is_file()), *sorted(classes.rglob('*.class'))]
            with zipfile.ZipFile(artifact, 'x', zipfile.ZIP_DEFLATED) as archive:
                for path in files:
                    relative = path.relative_to(resources if path.is_relative_to(resources) else classes).as_posix()
                    data = path.read_bytes()
                    if relative == 'META-INF/neoforge.mods.toml': data = lower_own_requirement(data)
                    if name.startswith('maw_numen_compat') and relative == 'maw_numen_compat.mixins.json':
                        config = json.loads(data)
                        config['server'].extend(['TauQuestTitleMixin','TauLoginNameMixin'])
                        data = json.dumps(config).encode('utf-8')
                    info = zipfile.ZipInfo(relative, (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, data)
            with zipfile.ZipFile(artifact) as archive:
                if archive.testzip(): raise ValueError('Artifact CRC failed')
            records.append({'artifact': artifact.name, 'sha256': sha(artifact),
                'sources': {p.relative_to(source).as_posix(): sha(p) for p in [*inputs, *files] if p.is_relative_to(source)}})
            if name.startswith('maw_numen_mods'):
                records[-1]['generatedFrom'] = {p.relative_to(source).as_posix(): sha(p) for p in [*shared_inputs, metadata, source / 'tools/build_numen_mods.py']}
            if name.startswith('maw_numen_compat'):
                records[-1]['tauSources'] = {p.relative_to(Path(__file__).parent).as_posix(): sha(p) for p in compat_sources}
            if name.startswith('maw-fom-support'):
                records[-1]['registryVersionCorrection'] = {'source': registry_source.relative_to(source).as_posix(),
                    'sourceSha256': sha(registry_source), 'actualNeoForge': NEO}
            cp.append(artifact)
    record = {'schemaVersion': 1, 'sourceCommit': commit, 'minecraft': '1.21.1', 'neoforge': NEO,
        'officialNumenSha256': sha(core), 'artifacts': records, 'serverOnly': True,
        'thirdPartyMetadataModified': False, 'compileClasspath': {str(p): sha(p) for p in classpath(server)}}
    (output / 'build-record.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    return {'sourceCommit': commit, 'neoforge': NEO, 'artifacts': [{k: r[k] for k in ('artifact', 'sha256')} for r in records]}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'server', 'api-dir', 'java', 'output'): p.add_argument('--' + name, type=Path, required=True)
    args = p.parse_args()
    print(json.dumps(build(args.source, args.server, args.api_dir, args.java, args.output)))
