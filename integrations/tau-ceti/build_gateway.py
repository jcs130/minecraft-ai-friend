"""Snapshot the existing gateway sources and apply bounded registry readers.

No live release is edited. Every generated file is frozen by the shared builder.
"""
from pathlib import Path
import argparse, importlib.util, json, shutil, subprocess, sys


def build(source, snapshot, output, node, dependencies, registry, mods_manifest):
    source, snapshot, output = (Path(p).resolve() for p in (source, snapshot, output))
    commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Source checkout must be clean for reproducible provenance')
    if snapshot.exists() or output.exists(): raise ValueError('Use new snapshot and immutable output paths')
    (snapshot / 'tools').mkdir(parents=True)
    shutil.copy2(source / 'tools/build_fom_gateway.py', snapshot / 'tools/build_fom_gateway.py')
    shutil.copy2(Path(__file__).parent / 'language_json.py', snapshot / 'tools/language_json.py')
    builder = snapshot / 'tools/build_fom_gateway.py'; text = builder.read_text(encoding='utf-8')
    old = 'language.update(json.loads(archive.read(name)))'
    if text.count(old) != 1: raise ValueError('Upstream language parsing changed: review the override')
    text = 'from language_json import parse_language\n' + text.replace(old, "language.update(parse_language(archive.read(name), jar.name + '!' + name))")
    builder.write_text(text, encoding='utf-8')
    gate = snapshot / 'world/src/neoforge-handshake'
    shutil.copytree(source / 'world/src/neoforge-handshake', gate, ignore=shutil.ignore_patterns('node_modules', '*.class'))
    for name in ('bounded-jsonl.cjs', 'exact-state-map.cjs', 'channel-manifest.cjs'):
        shutil.copy2(Path(__file__).parent / 'gateway-overrides' / name, gate / name)
    viewer = gate / 'native-viewer-packet.cjs'; text = viewer.read_text(encoding='utf-8')
    old = "return createHash('sha256').update(fs.readFileSync(file)).digest('hex')"
    if text.count(old) != 1: raise ValueError('Upstream registry hashing changed: review the override')
    viewer.write_text(text.replace(old, "return require('./bounded-jsonl.cjs').fileHash(file)"), encoding='utf-8')
    mapping = gate / 'build-idmap.cjs'; text = mapping.read_text(encoding='utf-8')
    old = "exactStateMap(actualStates, v.blocks, require('prismarine-block')('1.21.1'))"
    if text.count(old) != 1: raise ValueError('Upstream exact-state builder changed: review the override')
    text = text.replace(old, "exactStateMap(actualStates, v.blocks, require('prismarine-block')('1.21.1'), { reportExtendedStates: true })")
    marker = 'out.reverseVanillaStates = exact.reverseVanillaStates'
    if text.count(marker) != 1: raise ValueError('Upstream reverse-state builder changed')
    text = text.replace(marker, marker + '\n  out.unrepresentableVanillaStates = exact.unrepresentableStates\n  out.report.unrepresentableVanillaStateCount = exact.unrepresentableStates.length')
    mapping.write_text(text, encoding='utf-8')
    sys.path.insert(0, str(snapshot / 'tools'))
    spec = importlib.util.spec_from_file_location('tau_gateway_builder', snapshot / 'tools/build_fom_gateway.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    result = module.build(output, Path(node), Path(dependencies), Path(registry), None, Path(mods_manifest), True)
    result['sourceCommit'] = commit
    from language_json import NORMALIZATIONS
    result['languageNormalizations'] = NORMALIZATIONS
    (output / 'tau-build-record.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'snapshot', 'output', 'node', 'dependencies', 'registry', 'mods-manifest'): p.add_argument('--' + name, type=Path, required=True)
    print(json.dumps(build(**vars(p.parse_args()))))
