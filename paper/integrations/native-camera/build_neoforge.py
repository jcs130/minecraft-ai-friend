"""Build the NeoForge camera from the existing camera/MC observation sources.

No gameplay bridge is installed. Official installed mappings are inputs, not
redistributed artifacts; unrecognized or ambiguous symbols fail the build.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile


def mappings(mojang, intermediary):
    lines=mojang.read_text(encoding='utf-8').splitlines()
    classes={}
    for line in lines:
        if line and not line[0].isspace() and ' -> ' in line and line.endswith(':'):
            name, obfuscated=line[:-1].split(' -> ');classes[name]=obfuscated
    def descriptor(name):
        arrays=0
        while name.endswith('[]'):arrays+=1;name=name[:-2]
        primitives={'void':'V','boolean':'Z','byte':'B','char':'C','short':'S','int':'I','long':'J','float':'F','double':'D'}
        return '['*arrays+(primitives[name] if name in primitives else 'L'+classes.get(name,name).replace('.','/')+';')
    members={};owner=None
    for line in lines:
        if line and not line[0].isspace() and ' -> ' in line and line.endswith(':'):
            owner=line[:-1].split(' -> ')[1];continue
        if not line.startswith('    ') or ' -> ' not in line:continue
        lhs, obfuscated=line.strip().split(' -> ')
        lhs=re.sub(r'^\d+:\d+:','',lhs);lhs=re.sub(r':\d+(?::\d+)?$','',lhs)
        match=re.fullmatch(r'(\S+) (\S+)\((.*?)\)',lhs)
        if match:
            ret,name,params=match.groups();desc='('+''.join(descriptor(x) for x in params.split(',') if x)+')'+descriptor(ret);kind='METHOD'
        else:
            value,name=lhs.split(' ',1);desc=descriptor(value);kind='FIELD'
        members[kind,owner,desc,obfuscated]=name
    reverse={v:k for k,v in classes.items()};symbols=defaultdict(set)
    with zipfile.ZipFile(intermediary) as archive:
        tiny=archive.read('mappings/mappings.tiny').decode().splitlines()
    if tiny[0]!='v1\tofficial\tintermediary':raise ValueError('Unsupported installed intermediary mapping')
    for line in tiny[1:]:
        row=line.split('\t')
        if row[0]=='CLASS' and row[1] in reverse:symbols[row[2].split('/')[-1]].add(reverse[row[1]].replace('$','.'))
        elif row[0] in ('FIELD','METHOD'):
            named=members.get(tuple(row[:4]))
            if named:symbols[row[4]].add(named)
    def remap(source):
        def replace(match):
            token=match.group(0).removeprefix('net.minecraft.')
            names=symbols.get(token,set())
            if len(names)!=1:raise ValueError(f'Unreviewed mapping {token}: {sorted(names)}')
            return next(iter(names))
        return re.sub(r'(?:net\.minecraft\.)?(?:class_\d+(?:\$class_\d+)?|method_\d+|field_\d+|comp_\d+)\b',replace,source)
    return remap


def replace_once(source,old,new):
    if source.count(old)!=1:raise ValueError('Shared source contract changed: '+old[:100])
    return source.replace(old,new)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('game','jdk','out','classpath-file','mappings','intermediary'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();root=Path(__file__).resolve().parent;repo=root.parents[2];out=args.out.resolve()
    if out.exists() or out.is_relative_to(repo):raise SystemExit('Use a new external build directory')
    out.mkdir(parents=True);generated=out/'source';generated.mkdir();classes=out/'classes';classes.mkdir()
    inputs={
        'ysm-2.6.5-neoforge+mc1.21.1-release.jar':'b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb',
        'touhoulittlemaid-1.5.3-neoforge+mc1.21.1.jar':'f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27',
    }
    for filename,digest in inputs.items():
        if hashlib.sha256((args.game/'mods'/filename).read_bytes()).hexdigest()!=digest:raise ValueError('Unreviewed native artifact: '+filename)
    remap=mappings(args.mappings,args.intermediary)
    shared=repo/'packages/agent-mc-java-bridge/src/main/java/org/agentmc/bridge'
    sources={p.name:p.read_text(encoding='utf-8') for p in (root/'client').glob('*.java')}
    # One source for render geometry, lease validation, HUD and resource budgets.
    for name in list(sources):
        if name=='NativeCameraClient.java':continue
        text=remap(sources[name])
        text=text.replace('import net.fabricmc.loader.api.FabricLoader;','import net.neoforged.fml.loading.FMLPaths;')
        text=text.replace('FabricLoader.getInstance().getGameDir()','FMLPaths.GAMEDIR.get()')
        text=text.replace('org.agentmc.bridge.ClientBridge','org.qiandeng.camera.bridge.NativeCameraBridge').replace('ClientBridge.hasController()','NativeCameraBridge.hasController()')
        if name=='CameraWindowMixin.java':text=replace_once(text,'Lorg/lwjgl/glfw/GLFW;glfwCreateWindow(IILjava/lang/CharSequence;JJ)J','Lnet/neoforged/fml/loading/ImmediateWindowHandler;setupMinecraftWindow(Ljava/util/function/IntSupplier;Ljava/util/function/IntSupplier;Ljava/util/function/Supplier;Ljava/util/function/LongSupplier;)J')
        sources[name]=text
    text=sources['NativeCameraClient.java'];start=text.index('    @Override public void onInitializeClient()');end=text.index('    private void sample(')
    initialization=re.search(r'ClientLifecycleEvents.CLIENT_STARTED.register\(client->\{(.*?)\n        \}\);',text,re.S).group(1)
    text=text[:start]+'''    private boolean initialized;
    public NativeCameraClient() {
        if(Boolean.getBoolean("qiandeng.camera.enabled")) net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::tick);
    }
    private void tick(net.neoforged.neoforge.client.event.ClientTickEvent.Post event) {
        var client=net.minecraft.class_310.method_1551();
        if(!initialized){initialize(client);initialized=true;org.qiandeng.camera.bridge.NativeCameraBridge.start();}
        CameraPose.refresh(client,instance);if(++ticks%5==0)sample(client);
    }
    private void initialize(net.minecraft.class_310 client) {'''+initialization+'\n    }\n'+text[end:]
    text=re.sub(r'import net\.fabricmc\..*;\n','',text)
    text=text.replace('public final class NativeCameraClient implements ClientModInitializer {','@net.neoforged.fml.common.Mod(value="qiandeng_native_camera",dist=net.neoforged.api.distmarker.Dist.CLIENT)\npublic final class NativeCameraClient {')
    text=text.replace('FabricLoader.getInstance().getGameDir()','net.neoforged.fml.loading.FMLPaths.GAMEDIR.get()')
    text=text.replace('com.elfmcys.yesstevemodel.OOOoo0000OooO0000O0OO00o','com.elfmcys.yesstevemodel.o0ooOoOO0Oo0OoOO00oo0ooo').replace('"OO0ooo0OooOoO0OoO0ooOO0o"','"oOo0OO0O0o000OO0O000oo0o"')
    a=text.index('            for(String query:List.of("getReceived"');b=text.index('            // The 2.6.5 index',a);text=text[:a]+text[b:]
    text=text.replace('com.elfmcys.yesstevemodel.O0o00oo000oo0OO0OoO0oo0o','com.elfmcys.yesstevemodel.oo0o0Oooo0OOO00OOo0OO000').replace('"ooOoOOO00Oo0o0oO0Ooo0oO0"','"OO000o0ooOooooOOOOO0Ooo0"')
    text=replace_once(text,'data.put("players",players);','data.put("players",players);NativeMaidObservation.append(client,data);')
    sources['NativeCameraClient.java']=remap(text)
    visual=(shared/'VisualExport.java').read_text()
    visual=visual.replace('package org.agentmc.bridge;','package org.qiandeng.camera.bridge;').replace('import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientChunkEvents;','')
    visual=replace_once(visual,'ClientChunkEvents.CHUNK_LOAD.register((w, chunk) -> changed(w, chunk.method_12004().field_9181, chunk.method_12004().field_9180));','net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.level.ChunkEvent.Load event) -> { if(event.getLevel() instanceof net.minecraft.class_638 w) changed(w,event.getChunk().method_12004().field_9181,event.getChunk().method_12004().field_9180); });')
    visual=replace_once(visual,'ClientChunkEvents.CHUNK_UNLOAD.register((w, chunk) -> { if (w == world) revisions.remove(key(chunk.method_12004().field_9181, chunk.method_12004().field_9180)); });','net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.event.level.ChunkEvent.Unload event) -> { if(event.getLevel()==world) revisions.remove(key(event.getChunk().method_12004().field_9181,event.getChunk().method_12004().field_9180)); });')
    visual=visual.replace('ClientBridge.MINECRAFT_VERSION','NativeCameraBridge.MINECRAFT_VERSION')
    visual=replace_once(visual,'out.addProperty("pose",e.method_18376().name());','org.qiandeng.camera.NativeMaidObservation.appendEntity(e,out);\n        out.addProperty("pose",e.method_18376().name());')
    sources['VisualExport.java']=remap(visual)
    sources['ControlLedger.java']=(shared/'ControlLedger.java').read_text()
    for name in ('VisualBlockMixin.java','VisualLightMixin.java'):
        sources[name]=remap((shared/'mixin'/name).read_text().replace('org.agentmc.bridge','org.qiandeng.camera.bridge'))
    sources.update({p.name:p.read_text() for p in (root/'neoforge').glob('*.java')})
    for name,text in sources.items():
        if 'net.fabricmc.' in text:raise ValueError('Unexpected Fabric dependency: '+name)
        (generated/name).write_text(text,encoding='utf-8')
    cp=args.classpath_file.read_text(encoding='utf-8').strip().strip('"')+';'+ ';'.join(str(args.game/'mods'/name) for name in inputs)
    values=['--release','21','-encoding','UTF-8','-proc:none','-classpath',cp,'-d',str(classes),*map(str,generated.glob('*.java'))]
    arguments=out/'compile.args';arguments.write_text('\n'.join('"'+x.replace('\\','/')+'"' for x in values),encoding='utf-8')
    result=subprocess.run([str(args.jdk/'bin/javac.exe'),'@'+str(arguments)],capture_output=True)
    (out/'compile.log').write_bytes(result.stdout+result.stderr)
    if result.returncode:raise SystemExit(result.stderr.decode(errors='replace'))
    mixins=json.loads((root/'client/qiandeng-camera.mixins.json').read_text());mixins['refmap']='';
    bridge_mixins={'required':True,'package':'org.qiandeng.camera.bridge.mixin','compatibilityLevel':'JAVA_21','client':['VisualBlockMixin','VisualLightMixin'],'injectors':{'defaultRequire':1}}
    target=out/'qiandeng-native-camera-0.2.0-neoforge.jar'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
        for path in classes.rglob('*.class'):archive.write(path,path.relative_to(classes).as_posix())
        archive.writestr('qiandeng-camera.mixins.json',json.dumps(mixins))
        archive.writestr('qiandeng-camera-visual.mixins.json',json.dumps(bridge_mixins))
        archive.writestr('META-INF/neoforge.mods.toml',(root/'neoforge/neoforge.mods.toml').read_text())
    receipt={'loader':'neoforge','minecraft':'1.21.1','sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'sharedSources':{str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [shared/'VisualExport.java',shared/'ControlLedger.java',*(root/'client').glob('*.java')]},'artifacts':inputs}
    (out/'build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'built':str(target),'sha256':receipt['sha256']}))

if __name__=='__main__':main()
