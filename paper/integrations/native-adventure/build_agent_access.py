"""Build the owned native-data/registry adapter and generic Numen compatibility.

Only builds fresh artifacts. No install, public listener, permission change or LLM.
The separately locked official Numen and existing headless addon are not rewritten.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
NEO = '21.1.252'
NUMEN_SHA = 'ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226'


def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def verify_shared(shared):
    lock=json.loads((HERE/'agent-access/shared-sources.lock.json').read_bytes())
    compat=shared/'world/numen-compat-src/src/main'
    files=[shared/'world/society-bridge-src/src/main/java/dev/qiandeng/maw/NativeRegistryDump.java',
           *(p for p in compat.rglob('*') if p.is_file())]
    if {p.relative_to(shared).as_posix() for p in files}!=set(lock['files']):
        raise ValueError('Shared source set differs from reviewed commit')
    for p in files:
        # git archive honors text eol attributes; only that formatting difference
        # is equivalent. Code, resources and extra mixins must match the pin.
        actual=hashlib.sha256(p.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
        if actual!=lock['files'][p.relative_to(shared).as_posix()]:
            raise ValueError('Shared source differs from reviewed commit: '+p.name)
    return lock


def compile_jar(name, inputs, resources, cp, java, output):
    work = output / name
    classes = work / 'classes'
    classes.mkdir(parents=True, exist_ok=False)
    quote = lambda p: '"' + str(p).replace('\\', '/') + '"'
    args = work / 'compile.args'
    args.write_text('\n'.join(['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-cp',
        quote(os.pathsep.join(map(str, cp))), '-d', quote(classes), *map(quote, inputs)]), encoding='utf-8')
    r = subprocess.run([str(java.with_name('javac.exe')), '-J-Duser.language=en', '@' + str(args)],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
    (work / 'compile.log').write_text(r.stdout + r.stderr, encoding='utf-8')
    if r.returncode:
        raise RuntimeError(r.stderr[-10000:])
    files = {p.relative_to(classes).as_posix(): p.read_bytes() for p in classes.rglob('*.class')}
    files.update(resources)
    target = output / (name + '.jar')
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as z:
        for key, content in sorted(files.items()):
            info = zipfile.ZipInfo(key, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, content)
    return {'artifact': target.name, 'sha256': sha(target), 'sources': {str(p): sha(p) for p in inputs}}


def build(shared, server, numen, java, output):
    if sha(numen) != NUMEN_SHA:
        raise ValueError('Official Numen input differs; review API and mixins first')
    lock=verify_shared(shared)
    output.mkdir(exist_ok=False, parents=True)
    lib = server / 'libraries'
    neo = lib / f'net/neoforged/neoforge/{NEO}'
    cp = [neo / f'neoforge-{NEO}-server.jar',
          lib / 'net/minecraft/server/1.21.1-20240808.144430/server-1.21.1-20240808.144430-srg.jar',
          neo / f'neoforge-{NEO}-universal.jar']
    cp += sorted(p for p in lib.rglob('*.jar') if p not in cp and 'net/minecraft/server/' not in p.as_posix())
    cp += [numen]
    # NeoForge itself embeds the exact MixinExtras used by this JVM. Compile
    # against those bytes; do not download or add a second runtime copy.
    with zipfile.ZipFile(neo/f'neoforge-{NEO}-universal.jar') as z:
        name='META-INF/jarjar/mixinextras-neoforge-0.5.3.jar'
        dep=output/'mixinextras-neoforge-0.5.3.jar';dep.write_bytes(z.read(name));cp.append(dep)
    with zipfile.ZipFile(numen) as z:
        for name in z.namelist():
            if name.startswith('META-INF/jarjar/') and name.endswith('.jar'):
                p = output / Path(name).name; p.write_bytes(z.read(name)); cp.append(p)
                with zipfile.ZipFile(p) as child:
                    for n in child.namelist():
                        if n.startswith('META-INF/jarjar/') and n.endswith('.jar'):
                            dep=output/Path(n).name;dep.write_bytes(child.read(n));cp.append(dep)
    derived = output / 'derived'; derived.mkdir()
    old = REPO / 'integrations/tau-ceti/native-bridge'
    shared_java = shared / 'world/society-bridge-src/src/main/java/dev/qiandeng/maw'
    inputs = [HERE / 'agent-access/PlayerAuthBridge.java', HERE / 'agent-access/SessionPolicy.java',
              HERE / 'agent-access/NativeRecipes.java', old / 'src/dev/qiandeng/maw/taunative/NativePolicy.java']
    for file in ['NativeRegistryDump.java']:
        text = (shared_java / file).read_text(encoding='utf-8')
        text = text.replace('package dev.qiandeng.maw;', 'package dev.qiandeng.maw.taunative;', 1)
        if file == 'NativeRegistryDump.java':
            text = text.replace('out.addProperty("neoforge", "21.1.248");',
                'out.addProperty("neoforge", net.neoforged.fml.ModList.get().getModContainerById("neoforge").orElseThrow().getModInfo().getVersion().toString());')
            marker='                    row.addProperty("hasOffsetFunction", state.hasOffsetFunction());'
            if text.count(marker)!=1: raise ValueError('Registry shape export changed')
            text=text.replace(marker,marker+'''
                    row.addProperty("blockId", BuiltInRegistries.BLOCK.getId(block));
                    row.addProperty("collisionContext", "empty_block_getter_no_entity");
                    row.addProperty("requiresCorrectTool", state.requiresCorrectToolForDrops());
                    try { row.addProperty("destroySpeed", state.getDestroySpeed(net.minecraft.world.level.EmptyBlockGetter.INSTANCE, net.minecraft.core.BlockPos.ZERO)); }
                    catch(RuntimeException unavailable) { row.add("destroySpeed", com.google.gson.JsonNull.INSTANCE); }
                    if (!block.hasDynamicShape() && !state.hasOffsetFunction()) {
                        try {
                            var collision=state.getCollisionShape(net.minecraft.world.level.EmptyBlockGetter.INSTANCE,net.minecraft.core.BlockPos.ZERO);
                            var boxes=new com.google.gson.JsonArray();
                            for(var box:collision.toAabbs()) {
                                var coordinates=new com.google.gson.JsonArray();
                                for(double v:new double[]{box.minX,box.minY,box.minZ,box.maxX,box.maxY,box.maxZ})coordinates.add(v);
                                boxes.add(coordinates);
                            }
                            row.add("collisionBoxes",boxes);
                        }catch(RuntimeException unavailable){row.add("collisionBoxes",com.google.gson.JsonNull.INSTANCE);}
                    } else row.add("collisionBoxes",com.google.gson.JsonNull.INSTANCE);
''')
        p = derived / file; p.write_text(text, encoding='utf-8'); inputs.append(p)
    text = (old / 'src/dev/qiandeng/maw/taunative/NativeBridge.java').read_text(encoding='utf-8')
    text = text.replace('import dev.qiandeng.maw.PlayerAuthBridge;', '')
    text = text.replace('private static boolean recipeAvailable(){return ModList.get().isLoaded("create")&&ModList.get().isLoaded("farmersdelight");}',
                        'private static boolean recipeAvailable(){return true;}')
    text = text.replace('PlayerRecipeCatalog.query(p,args,out);', 'NativeRecipes.query(p,args,out);')
    marker = '    public NativeBridge(IEventBus bus) {'
    if text.count(marker) != 1: raise ValueError('Native constructor changed')
    text = text.replace(marker, marker + '\n        PlayerAuthBridge.register(); NativeRegistryDump.register();')
    p = derived / 'NativeBridge.java'; p.write_text(text, encoding='utf-8'); inputs.append(p)
    metadata = (old / 'resources/META-INF/neoforge.mods.toml').read_text(encoding='utf-8')
    metadata = metadata.split('[[dependencies.maw_tau_native]]\nmodId="maw_fom_support"')[0]
    metadata = metadata.replace('version="0.1.0"', 'version="0.1.1"').replace('[21.1.234,21.2)', '[21.1.252,21.2)')
    contract=json.loads((old / 'operations.json').read_bytes());contract['version']='0.1.1'
    for op in contract['operations']:
        if op['id']=='native.recipes':
            op['description']='Read this JVM recipe manager using native serializer codecs. At most 12 rows, 16 KiB per response, with nextOffset for partial results. nativeDefinition is original data, not verified machine execution. outputId searches display outputs only; probabilistic byproducts are outside that filter.'
            op['example']={'recipeType':'minecraft:crafting','limit':3}
    records = [compile_jar('maw-native-adventure-access-0.1.1', inputs,
        {'META-INF/neoforge.mods.toml': metadata.encode(), 'native-operations.json': json.dumps(contract).encode()}, cp, java, output)]
    compat = shared / 'world/numen-compat-src/src/main'
    resources = {p.relative_to(compat / 'resources').as_posix(): p.read_bytes() for p in (compat / 'resources').rglob('*') if p.is_file()}
    metadata=resources['META-INF/neoforge.mods.toml'].decode().replace('version="0.1.0"','version="0.1.1"').replace('[21.1.248,)','[21.1.252,21.1.253)')
    resources['META-INF/neoforge.mods.toml']=metadata.encode()
    mixins=json.loads(resources['maw_numen_compat.mixins.json']);mixins['server'] += ['RegistrySnapshotAccessor','OptionalTlmRegistryMixin','OptionalTlmSyncMixin']
    resources['maw_numen_compat.mixins.json']=json.dumps(mixins).encode()
    compat_inputs=[*sorted((compat/'java').rglob('*.java')),*sorted((HERE/'agent-access/numen-compat').glob('*.java'))]
    records.append(compile_jar('maw-numen-compat-0.1.1-youer252', compat_inputs, resources, cp, java, output))
    record = {'schemaVersion': 1, 'minecraft': '1.21.1', 'neoforge': NEO, 'officialNumenSha256': sha(numen),
        'reusedSourceCommit': '78ec7abb4745f0f5e4a840af03a2fbe3166265cc', 'artifacts': records,
        'compileClasspath': {str(p): sha(p) for p in cp}, 'installed': False, 'thirdPartyModified': False,
        'builderSha256': sha(Path(__file__)), 'sharedSourceLock': lock,
        'nativeContractSha256': hashlib.sha256(json.dumps(contract).encode()).hexdigest(),
        'authentication': 'existing MixAuth, online-mode, or explicit whitelisted loopback QA; otherwise denied'}
    (output / 'build-record.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    return {k: record[k] for k in ['minecraft', 'neoforge', 'artifacts', 'installed']}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['shared','server','numen','java','output']: p.add_argument('--'+name, type=Path, required=True)
    a=p.parse_args(); print(json.dumps(build(a.shared.resolve(),a.server.resolve(),a.numen.resolve(),a.java.resolve(),a.output.resolve())))
