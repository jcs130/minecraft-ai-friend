"""Snapshot the existing gateway sources and apply bounded registry readers.

No live release is edited. Every generated file is frozen by the shared builder.
"""
from pathlib import Path
import argparse, importlib.util, json, shutil, subprocess, sys


CODEC_MOD_HASHES = {
    'easy_npc-neoforge-1.21.1-7.1.1.jar': '2eb7518db972588951c29b431d24dba36477801eecdf64579e85efbbb05afdca',
    'Apotheosis-1.21.1-8.5.4.jar': '5270327a67ee411692566b140f9ec8e72246d961da1d7306e41120c695eb6ea4',
    'Placebo-1.21.1-9.9.1.jar': '42c90bc43800558b9322bd60faa9011d6694e66a87b7e6b3b9f51fa735b527ea',
    'tombstone-neoforge-1.21.1-9.5.1.jar': 'b705f17075ebc3bc5d3f6649ba567a865bf8c3c469be402014c5d3deaae1f30e',
}


def validate_codec_manifest(manifest):
    files = manifest.get('files', {})
    for name, expected in CODEC_MOD_HASHES.items():
        if files.get(name) != expected:
            raise ValueError('Native codec requires reviewed mod bytes: ' + name)


def build(source, snapshot, output, node, dependencies, registry, mods_manifest):
    source, snapshot, output = (Path(p).resolve() for p in (source, snapshot, output))
    validate_codec_manifest(json.loads(Path(mods_manifest).read_text(encoding='utf-8-sig')))
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
    for name in ('bounded-jsonl.cjs', 'exact-state-map.cjs', 'channel-manifest.cjs', 'native-easynpc-types.cjs', 'native-apotheosis-types.cjs', 'native-tombstone-types.cjs'):
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
    components = gate / 'component-protocol.cjs'; text = components.read_text(encoding='utf-8')
    text = text.replace("'use strict'", "'use strict'\nconst easyNpc = require('./native-easynpc-types.cjs')\nconst apotheosis = require('./native-apotheosis-types.cjs')\nconst tombstone = require('./native-tombstone-types.cjs')", 1)
    marker = 'const twilightCodecs = twilightComponentCodecs(fields)'
    if text.count(marker) != 1: raise ValueError('Upstream component registration changed')
    text = text.replace(marker, marker + '\n  apotheosis.install(protocol, fields)')
    text = text.replace('MOD_CODECS[name] || twilightCodecs[name]', 'MOD_CODECS[name] || twilightCodecs[name] || apotheosis.componentCodecs[name] || tombstone.componentCodecs[name]')
    marker = 'const metadata = protocol.types.entityMetadataEntry[1]'
    if text.count(marker) != 1: raise ValueError('Upstream metadata registration changed')
    text = text.replace(marker, 'easyNpc.install(protocol)\n  ' + marker)
    old = "metadataFields[name] = ENTITY_METADATA_CODECS[name] || twilightEntityCodecs[name] || 'mawUnsupportedEntityMetadata'"
    if text.count(old) != 1: raise ValueError('Upstream metadata codec selection changed')
    replacement = '''const known = ENTITY_METADATA_CODECS[name] || twilightEntityCodecs[name] || easyNpc.metadataCodecs[name]
      if (known) metadataFields[name] = known
      else {
        const type = 'mawUnsupportedNativeMetadata' + id
        metadataFields[name] = type
        const reject = () => { throw Error('UNSUPPORTED_NATIVE_ENTITY_METADATA_CODEC ' + name) }
        for (const direction of Object.keys(unsupportedNamedTypes)) unsupportedNamedTypes[direction][type] = ['native', reject]
      }'''
    text = text.replace(old, replacement)
    marker = 'compiler.addTypes(arsEntityNativeTypes)'
    if text.count(marker) != 1: raise ValueError('Upstream compiler integration changed')
    components.write_text(text.replace(marker, marker + '\n  compiler.addTypes(easyNpc.nativeTypes)\n  compiler.addTypes(apotheosis.nativeTypes)'), encoding='utf-8')
    sys.path.insert(0, str(snapshot / 'tools'))
    spec = importlib.util.spec_from_file_location('tau_gateway_builder', snapshot / 'tools/build_fom_gateway.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    result = module.build(output, Path(node), Path(dependencies), Path(registry), None, Path(mods_manifest), True)
    result['sourceCommit'] = commit
    result['nativeCodecSources'] = CODEC_MOD_HASHES
    from language_json import NORMALIZATIONS
    result['languageNormalizations'] = NORMALIZATIONS
    (output / 'tau-build-record.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'snapshot', 'output', 'node', 'dependencies', 'registry', 'mods-manifest'): p.add_argument('--' + name, type=Path, required=True)
    print(json.dumps(build(**vars(p.parse_args()))))
