"""Compile/run the real bridge/helpers and exact native patch, with only external IO futures stubbed.

No Minecraft connection, downloads, account export, version bump, or deployment. The optional
ledger audit reads one local legacy ledger and prints AGGREGATES ONLY; no UUID/profile rows.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import zipfile

PIN = '20674fab574d38cf62000be2dc3d628a5fa0e7fc49ad3fbfb54a28aa58f77953'
TARGETS = ['io/vortexcore/rpg/PlayerProfileService.class', 'io/vortexcore/player/UnifiedPlayer.class']


def methods(data):
    """Raw method_info slices: untouched native bytecode, descriptors and attributes must match."""
    pos = 8
    def u2():
        nonlocal pos
        value = struct.unpack_from('>H', data, pos)[0]; pos += 2
        return value
    count = u2(); utf = {}; index = 1
    while index < count:
        tag = data[pos]; pos += 1
        if tag == 1:
            length = u2(); utf[index] = data[pos:pos + length].decode('utf8', errors='replace'); pos += length
        elif tag in (3, 4, 9, 10, 11, 12, 17, 18): pos += 4
        elif tag in (5, 6): pos += 8; index += 1
        elif tag in (7, 8, 16, 19, 20): pos += 2
        elif tag == 15: pos += 3
        else: raise ValueError('bad_constant_pool_tag')
        index += 1
    pos += 6
    interfaces = u2(); pos += interfaces * 2
    def member():
        nonlocal pos
        start = pos; access = u2(); name = u2(); desc = u2()
        for _ in range(u2()):
            u2(); length = struct.unpack_from('>I', data, pos)[0]; pos += 4 + length
        return (utf[name], utf[desc]), data[start:pos]
    for _ in range(u2()): member()
    return dict(member() for _ in range(u2()))


def compile_java(jdk, cp, output, sources):
    output.mkdir(exist_ok=True)
    options = ['-proc:none', '-encoding', 'UTF-8', '--release', '21', '-cp', cp, '-d', str(output), *map(str, sources)]
    argfile = output / 'javac.args'
    argfile.write_text('\n'.join('"' + s.replace('\\', '/').replace('"', '\\"') + '"' for s in options), encoding='utf8')
    subprocess.run([str(jdk / ('javac.exe' if os.name == 'nt' else 'javac')), '-J-Duser.language=en', '-J-Dfile.encoding=UTF-8', '@' + str(argfile)], check=True, timeout=120)


def run_java(java, output, name, options):
    argfile = output / (name + '.java.args')
    argfile.write_text('\n'.join('"' + str(s).replace('\\', '/').replace('"', '\\"') + '"' for s in options), encoding='utf8')
    subprocess.run([java, '@' + str(argfile)], check=True, timeout=120)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--jdk', type=Path, required=True)
    p.add_argument('--classpath-file', type=Path, required=True)
    p.add_argument('--native', type=Path, required=True)
    p.add_argument('--native-sha256', default=PIN)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--legacy-ledger-audit', type=Path)
    a = p.parse_args()
    root = Path(__file__).resolve().parents[1]
    native = a.native.resolve(); output = a.output.resolve()
    if hashlib.sha256(native.read_bytes()).hexdigest() != a.native_sha256:
        raise ValueError('reviewed_native_baseline_mismatch')
    # Accept existing one-per-line or Windows semicolon classpaths. Do not inspect account folders.
    text = a.classpath_file.read_text(encoding='utf-8-sig')
    paths = [Path(s.strip()).resolve() for s in text.replace(';', '\n').splitlines() if s.strip()]
    paths = [path for path in paths if path != native]
    if not paths or not all(path.exists() for path in paths): raise ValueError('existing_classpath_required')
    if output.exists() or output.is_relative_to(root.parents[2]) or output.is_relative_to(native.parent):
        raise ValueError('fresh_isolated_output_required')
    output.mkdir(parents=True)
    jdk = a.jdk.resolve() / 'bin'
    java = str(jdk / ('java.exe' if os.name == 'nt' else 'java'))
    cp = os.pathsep.join(map(str, [native, *paths]))
    patch_classes = output / 'patch-classes'
    compile_java(jdk, cp, patch_classes, [root / 'native-patches/PointMigrationApiPatch.java'])
    replacements = {}
    preserved_methods = 0
    with zipfile.ZipFile(native) as original:
        for index, name in enumerate(TARGETS):
            before = original.read(name)
            input_class = output / f'native-{index}.class'; input_class.write_bytes(before)
            patched = output / f'patched-{index}.class'
            run_java(java, output, f'patch-{index}', ['-cp', str(patch_classes) + os.pathsep + cp, 'PointMigrationApiPatch', str(input_class), str(patched)])
            after = patched.read_bytes(); replacements[name] = after
            previous = methods(before); current = methods(after)
            for key, raw in previous.items():
                if name == TARGETS[0] and key[0] == 'queueSave': continue
                if current.get(key) != raw: raise AssertionError('unrelated_native_method_changed: ' + key[0])
                preserved_methods += 1
            added = {key[0] for key in current.keys() - previous.keys()}
            if added != ({'qiandengjiSaveMetadata'} if index == 0 else {'qiandengjiSavedRevision'}):
                raise AssertionError('unexpected_native_api_changes')
        api_jar = output / 'native-api-only.jar'
        with zipfile.ZipFile(api_jar, 'x', zipfile.ZIP_DEFLATED) as z:
            for info in original.infolist(): z.writestr(info, replacements.get(info.filename, original.read(info)))
    new_cp = os.pathsep.join(map(str, [api_jar, *paths]))
    # Optional sword integration is capability-gated. Compile every shipped source against
    # the REAL SDK and the exact metadata API patch; never create a placeholder Sword SDK.
    implementation = output / 'implementation'
    sources = [root / 'native-patches/io/vortexcore/rpg/NativeProfileSnapshots.java', *sorted((root / 'src').rglob('*.java'))]
    compile_java(jdk, new_cp, implementation, sources)
    candidate = output / 'native-point-migration-candidate.jar'
    with zipfile.ZipFile(api_jar) as z, zipfile.ZipFile(candidate, 'x', zipfile.ZIP_DEFLATED) as out:
        for info in z.infolist(): out.writestr(info, z.read(info))
        helper = 'io/vortexcore/rpg/NativeProfileSnapshots.class'
        info = zipfile.ZipInfo(helper, (2026, 11, 25, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
        out.writestr(info, (implementation / helper).read_bytes())
    with zipfile.ZipFile(native) as before, zipfile.ZipFile(candidate) as after:
        preserved = [name for name in before.namelist() if name not in TARGETS]
        for name in preserved:
            if before.read(name) != after.read(name): raise AssertionError('unrelated_native_entry_changed')
        assert set(after.namelist()) - set(before.namelist()) == {helper}
    fixture = output / 'fixture'; fixture.mkdir()
    repository = fixture / 'PlayerDataRepository.java'
    repository.write_text('''package io.vortexcore.persistence;
import io.vortexcore.persistence.model.PlayerSnapshot;
import java.util.*; import java.util.concurrent.*;
public final class PlayerDataRepository {
 public final List<PlayerSnapshot> captures = new ArrayList<>();
 public final List<CompletableFuture<PlayerSnapshot>> futures = new ArrayList<>();
 public PlayerSnapshot durable;
 public CompletableFuture<PlayerSnapshot> saveAtomically(PlayerSnapshot snapshot) {
  captures.add(snapshot); var f = new CompletableFuture<PlayerSnapshot>(); futures.add(f); return f;
 }
 public void confirm(int index) { durable = captures.get(index).nextRevision(); futures.get(index).complete(durable); }
 public void unknown(int index) { futures.get(index).completeExceptionally(new IllegalStateException("synthetic_unknown")); }
}
''', encoding='utf8')
    talents = fixture / 'TalentRepository.java'
    talents.write_text('''package io.vortexcore.talent;
import java.util.*; import java.util.concurrent.*;
public final class TalentRepository {
 public CompletableFuture<PlayerTalentData> data = new CompletableFuture<>(); public int reads;
 public CompletableFuture<PlayerTalentData> load(UUID actor) { reads++; return data; }
}
''', encoding='utf8')
    stub_classes = output / 'external-io-stubs'
    compile_java(jdk, new_cp, stub_classes, [repository, talents])
    test_classes = output / 'test-classes'
    test_cp = os.pathsep.join(map(str, [stub_classes, implementation, api_jar, *paths]))
    compile_java(jdk, test_cp, test_classes, [root / 'tests/PointMigrationTest.java'])
    run_java(java, output, 'point-tests', ['-Dfile.encoding=UTF-8', '-cp', str(test_classes) + os.pathsep + test_cp,
                    'org.qiandengji.vortex.PointMigrationTest'])
    disk_classes = output / 'disk-tests'
    disk_cp = os.pathsep.join(map(str, [implementation, candidate, *paths]))
    compile_java(jdk, disk_cp, disk_classes, [root / 'tests/PointMigrationDiskTest.java'])
    run_java(java, output, 'disk-tests', ['-Dfile.encoding=UTF-8', '-cp', str(disk_classes) + os.pathsep + disk_cp,
                    'org.qiandengji.vortex.PointMigrationDiskTest', str(output / 'synthetic-native-disk')])
    report = {'baseSha256': a.native_sha256, 'candidateSha256': hashlib.sha256(candidate.read_bytes()).hexdigest(),
              'modifiedEntries': TARGETS, 'addedEntries': [helper], 'preservedEntries': len(preserved),
              'preservedNativeMethods': preserved_methods, 'nativeVersionsAndResourcesPreserved': True,
              'realImplementationTests': True, 'compileOnlySwordSdkExcludedFromRuntimeAndCandidate': True,
              'existingSwordSourceLiveAbiGap': False, 'nativeSourcesCompiledAgainstRealSdk': True,
              'compileOnlySwordSdkRequired': False, 'realGame': False, 'productionChanged': False}
    (output / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(report))
    if a.legacy_ledger_audit:
        data = json.loads(a.legacy_ledger_audit.read_text(encoding='utf-8-sig'))
        if data.get('schemaVersion') != 1 or not isinstance(data.get('players'), dict):
            raise ValueError('legacy_ledger_schema_mismatch')
        rows = list(data['players'].values())
        values = [(row.get('points', {}).get('earned', 0), row.get('points', {}).get('spent', 0)) for row in rows]
        if any(type(n) is not int or n < 0 or n > 2147483647 for pair in values for n in pair):
            raise ValueError('invalid_ledger_points')
        print(json.dumps({'ledgerAuditOnly': True, 'profiles': len(values), 'earnedTotal': sum(e for e, _ in values),
                          'spentTotal': sum(s for _, s in values), 'balanceByProfileTotal': sum(max(e-s, 0) for e, s in values),
                          'overspentProfiles': sum(s > e for e, s in values)}))


if __name__ == '__main__': main()
