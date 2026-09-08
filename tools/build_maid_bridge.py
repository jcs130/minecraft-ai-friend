"""Compile the isolated maid bridge and run offline contracts; never deploy or call a model."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'world/maid-bridge-src'
MAID_JAR = 'touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--libraries', type=Path, default=ROOT / 'server/mc/libraries')
    parser.add_argument('--mods', type=Path, default=ROOT / 'server/mc/mods')
    parser.add_argument('--jdk-bin', type=Path, default=Path(os.environ.get(
        'JDK21_BIN', r'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot\bin')))
    args = parser.parse_args()
    suffix = '.exe' if os.name == 'nt' else ''
    javac, java = args.jdk_bin / ('javac' + suffix), args.jdk_bin / ('java' + suffix)
    if not javac.is_file() or not java.is_file():
        raise SystemExit('JDK 21 is required')
    if not (args.mods / MAID_JAR).is_file():
        raise SystemExit('Exact installed TLM 1.5.3 / NeoForge 1.21.1 dependency is required')
    spec = importlib.util.spec_from_file_location('maid_bridge_readonly_classpath', ROOT / 'world/botgate-src/build.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    libs = helper.full_cp(args.libraries).split(os.pathsep)
    mods = sorted(p for p in args.mods.glob('*.jar') if not p.name.startswith('qiandeng-maid-bridge-'))
    cp = os.pathsep.join([*libs, *(str(p) for p in mods)])
    build = (SOURCE / 'build').resolve()
    if not build.is_relative_to(SOURCE.resolve()) or build.is_symlink():
        raise SystemExit('Build output escaped owned source directory')
    classes, test_classes = build / 'classes', build / 'test-classes'
    for directory in (classes, test_classes):
        if not directory.resolve().is_relative_to(build) or directory.is_symlink():
            raise SystemExit('Invalid build output directory')
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
    sources = sorted((SOURCE / 'src').rglob('*.java'))
    tests = sorted((SOURCE / 'tests').glob('*.java'))
    quote = lambda s: '"' + str(s).replace('\\', '/').replace('"', '\\"') + '"'
    argfile = build / 'javac.args'
    argfile.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', quote(cp),
        '-d', quote(classes), *(quote(p) for p in sources)]) + '\n', encoding='utf8')
    subprocess.run([str(javac), '@' + str(argfile)], check=True, timeout=300)
    # Offline tests depend only on our pure classes and Gson, not Minecraft bootstrapping.
    gson = [p for p in libs if 'gson' in Path(p).name]
    if len(gson) != 1:
        raise SystemExit('Expected one classpath-selected Gson dependency')
    test_cp = os.pathsep.join([str(classes), *gson])
    subprocess.run([str(javac), '-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp', os.pathsep.join([str(classes), cp]),
        '-d', str(test_classes), *(str(p) for p in tests)], check=True, timeout=60)
    check = subprocess.run([str(java), '-cp', os.pathsep.join([str(test_classes), test_cp]),
        'dev.qiandeng.maid.BridgeContractTest'], check=True, capture_output=True, text=True, timeout=30)
    contract = json.loads(check.stdout)
    native = subprocess.run([str(java), '-cp', os.pathsep.join([str(test_classes), str(classes), cp]),
        'dev.qiandeng.maid.NativeCodecTest'], check=True, capture_output=True, text=True, timeout=30)
    codec_result = json.loads(native.stdout.strip().splitlines()[-1])
    result = {'ok': contract.get('ok') is True and codec_result.get('ok') is True,
        'checks': contract['checks'] + codec_result['checks'], 'suites': [contract, codec_result]}
    if result['ok'] is not True:
        raise SystemExit('Maid bridge contract tests failed')
    target = build / 'qiandeng-maid-bridge-0.1.0.jar'
    resources = sorted(p for p in (SOURCE / 'resources').rglob('*') if p.is_file())
    entries = [(p, p.relative_to(classes).as_posix()) for p in classes.rglob('*.class')]
    entries += [(p, p.relative_to(SOURCE / 'resources').as_posix()) for p in resources]
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, name in sorted(entries, key=lambda row: row[1]):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(set(archive.namelist())):
            raise SystemExit('JAR validation failed')
    record = {'ok': True, 'jar': str(target), 'sha256': sha(target), 'tests': result,
        'minecraft': '1.21.1', 'neoforge': '21.1.248', 'touhou_little_maid': '1.5.3', 'javaRelease': 21,
        'sources': {p.relative_to(ROOT).as_posix(): sha(p) for p in [*sources, *resources, *tests, Path(__file__)]},
        'dependencies': {p.name: sha(p) for p in mods}, 'deployment': 'not_performed',
        'requiresClientSerializer': True, 'liveAcceptance': 'pending'}
    (build / 'build-record.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
    print(json.dumps({k: record[k] for k in ('ok', 'jar', 'sha256', 'tests', 'deployment', 'liveAcceptance')}))


if __name__ == '__main__':
    main()
