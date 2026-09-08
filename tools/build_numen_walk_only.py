"""Build a verified task-local walking patch, preserving the installed Numen fork.

Copies tracked source into ignored runtime storage and overlays compiled class
families on the exact original JAR. Does not deploy, restart, or touch C source.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PATCH_DIR = ROOT / 'world/numen-patches'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def normalized(path):
    return path.read_text(encoding='utf8').encode('utf8')


def verify_sources(source, manifest):
    for name, expected in manifest['preimages'].items():
        target = (source / name).resolve()
        if not target.is_relative_to(source.resolve()) or target.is_symlink():
            raise ValueError('source_path_invalid')
        if expected is None:
            if target.exists():
                raise ValueError('new_source_already_exists')
        elif not target.is_file() or sha(normalized(target)) != expected:
            raise ValueError('source_baseline_mismatch: ' + name)


def overlay_jar(baseline, classes, destination, families):
    additions = {path.relative_to(classes).as_posix(): path.read_bytes()
                 for path in classes.rglob('*.class')}
    if not additions:
        raise ValueError('empty_compilation')
    for name in additions:
        family = name[:-6].split('$', 1)[0]
        if family not in families:
            raise ValueError('unexpected_compiled_class: ' + name)
    preserved = {}
    with zipfile.ZipFile(baseline) as old, zipfile.ZipFile(destination, 'w') as new:
        for entry in old.infolist():
            family = entry.filename[:-6].split('$', 1)[0] if entry.filename.endswith('.class') else None
            if family in families:
                continue
            data = old.read(entry.filename)
            new.writestr(entry, data)
            preserved[entry.filename] = sha(data)
        for name, data in sorted(additions.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            new.writestr(entry, data)
    with zipfile.ZipFile(destination) as result:
        if result.testzip() is not None:
            raise ValueError('jar_crc_failed')
        if any(sha(result.read(name)) != digest for name, digest in preserved.items()):
            raise ValueError('unrelated_jar_entry_changed')
    return {'compiledClasses': len(additions), 'preservedEntries': len(preserved),
            'preservedEntryHashes': preserved}


def embedded_dependencies(jar, output):
    """Extract bounded nested dependency JARs by content hash, never archive paths."""
    pending, seen, result = [(jar, 0)], set(), []
    output.mkdir(exist_ok=True)
    while pending:
        path, depth = pending.pop()
        if depth > 4:
            raise ValueError('embedded_dependency_depth')
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if not info.filename.endswith('.jar'):
                    continue
                if info.file_size > 67108864 or len(seen) >= 32:
                    raise ValueError('embedded_dependency_limit')
                data = archive.read(info.filename)
                digest = sha(data)
                if digest in seen:
                    continue
                seen.add(digest)
                target = output / (digest + '.jar')
                target.write_bytes(data)
                result.append(target)
                pending.append((target, depth + 1))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_source = json.loads((ROOT / 'manifests/ai-components.lock.json').read_text(encoding='utf-8-sig'))['source_locations']['numen_source']
    parser.add_argument('--source', type=Path, default=Path(default_source))
    parser.add_argument('--baseline-jar', type=Path, default=ROOT/'server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get(
        'JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    source = args.source.resolve()
    manifest = json.loads((PATCH_DIR/'walk-only-v1.json').read_text(encoding='utf8'))
    patch = PATCH_DIR/'walk-only-v1.patch'
    if sha(patch.read_bytes()) != manifest['patchSha256']:
        raise SystemExit('Patch hash does not match manifest')
    if sha(args.baseline_jar.read_bytes()) != manifest['baselineJarSha256']:
        raise SystemExit('Exact original Numen JAR required; do not overwrite another fork')
    actuator = ROOT/'server/mc/mods/numen_act-neoforge-1.21.1-0.1.1.jar'
    if sha(actuator.read_bytes()) != manifest['actuatorJarSha256']:
        raise SystemExit('Actuator changed; re-audit compatibility before rebuilding')
    head = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if head != manifest['sourceCommit']:
        raise SystemExit('Source commit differs from verified local fork')
    verify_sources(source, manifest)
    sources_jar = source/'core/neoforge/build/libs/numen-neoforge-1.21.1-0.1.1-sources.jar'
    with zipfile.ZipFile(sources_jar) as archive:
        for name, expected in manifest['preimages'].items():
            if expected and sha(archive.read(name.split('/src/main/java/', 1)[1]).decode('utf8').replace('\r\n', '\n').encode()) != expected:
                raise SystemExit('Published source JAR differs: ' + name)
    build = ROOT/'runtime/numen-walk-only-build'/uuid.uuid4().hex
    build.mkdir(parents=True)
    local = build/'source'
    names = subprocess.check_output(['git', '-C', str(source), 'ls-files', '-z']).decode('utf8').split('\0')
    for name in filter(None, names):
        origin, destination = source/name, local/name
        if origin.is_symlink() or not origin.resolve().is_relative_to(source) or not destination.resolve().is_relative_to(local.resolve()):
            raise SystemExit('Source copy path escaped its directory')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, destination)
    for name, expected in manifest['preimages'].items():
        if expected:
            (local/name).write_bytes(normalized(local/name))
    subprocess.run(['git', 'init', '-q', str(local)], check=True)
    subprocess.run(['git', '-C', str(local), 'apply', '--check', str(patch)], check=True)
    subprocess.run(['git', '-C', str(local), 'apply', str(patch)], check=True)
    for name, expected in manifest['postimages'].items():
        if sha(normalized(local/name)) != expected:
            raise SystemExit('Patched source hash differs: ' + name)
    baseline = build/'baseline-numen.jar'
    shutil.copy2(args.baseline_jar, baseline)
    dependencies = embedded_dependencies(baseline, build/'dependencies')
    spec = importlib.util.spec_from_file_location('numen_build_cp', ROOT/'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    cp = os.pathsep.join([str(baseline), *(str(p) for p in dependencies), helper.full_cp(ROOT/'server/mc/libraries')])
    classes = build/'classes'
    classes.mkdir()
    quote = lambda value: '"' + str(value).replace('\\', '/').replace('"', '\\"') + '"'
    java_sources = [local/name for name in manifest['postimages']]
    argfile = build/'javac.args'
    argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp),
        '-d', quote(classes), *(quote(p) for p in java_sources)])+'\n', encoding='utf8')
    suffix = '.exe' if os.name == 'nt' else ''
    subprocess.run([str(args.jdk_bin/('javac'+suffix)), '@'+str(argfile)], check=True, timeout=300)
    tests = build/'test-classes'
    tests.mkdir()
    subprocess.run([str(args.jdk_bin/('javac'+suffix)), '-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp',
        os.pathsep.join([str(classes), cp]), '-d', str(tests), str(PATCH_DIR/'tests/WalkOnlyContractTest.java')],
        check=True, timeout=60)
    test = subprocess.run([str(args.jdk_bin/('java'+suffix)), '-cp', os.pathsep.join([str(tests), str(classes), cp]),
        'WalkOnlyContractTest'], check=True, capture_output=True, text=True, timeout=60)
    target = build/'numen-neoforge-1.21.1-0.1.1-walk-only-v1.jar'
    families = {name.split('/src/main/java/', 1)[1][:-5] for name in manifest['postimages']}
    preservation = overlay_jar(baseline, classes, target, families)
    report = {'ok': True, 'capability': 'walk_only_v1', 'sourceCommit': head,
        'baselineJarSha256': manifest['baselineJarSha256'], 'jar': str(target), 'sha256': sha(target.read_bytes()),
        'patchSha256': manifest['patchSha256'], 'source': str(local), 'tests': json.loads(test.stdout),
        'deployment': 'not performed', **preservation}
    (build/'build-record.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    latest = ROOT/'runtime/numen-walk-only-build/latest.json'
    latest.write_text(json.dumps(report, indent=2)+'\n', encoding='utf8')
    print(json.dumps({k:report[k] for k in ('ok','jar','sha256','tests','compiledClasses','preservedEntries','deployment')}))


if __name__ == '__main__':
    main()
