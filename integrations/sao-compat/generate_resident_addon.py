"""Port our existing Numen resident controller to the exact Forge 1.20.1 API.

No production configuration, accounts, bodies or model keys are copied.
The optional GUI integrations are explicitly unavailable in this acceptance port.
"""
import argparse
import json
from pathlib import Path
import shutil
import zipfile
from prepare_pack import digest
from generate_native_addon import generate

def resident(root, source):
    root=Path(root).resolve(strict=True);source=Path(source).resolve(strict=True)
    generate(root)
    output=root/'native-addon-build'
    java=source/'src/main/java/dev/qiandeng/maw/numenserver'
    package=output/'src/main/java/dev/qiandeng/maw/numenserver'
    package.mkdir(parents=True,exist_ok=True)
    names=['HeadlessAuth.java','HeadlessRuntime.java','HeadlessBrain.java','HeadlessHttp.java','PrivateStore.java','SafeAnchor.java','NativeModBridge.java','NativeReturnContracts.java']
    hashes={}
    for name in names:
        original=java/name;hashes[name]=digest(original);text=original.read_text('utf-8')
        text=text.replace('net.neoforged.fml.ModList','net.minecraftforge.fml.ModList')
        text=text.replace('net.neoforged.neoforge.event.entity.player.PlayerEvent','net.minecraftforge.event.entity.player.PlayerEvent')
        text=text.replace('server.getServerDirectory().resolve(', 'server.getServerDirectory().toPath().resolve(')
        text=text.replace('s.save(server.registryAccess())','s.save(new net.minecraft.nbt.CompoundTag())')
        text=text.replace('body.connection.getConnection()','body.connection.connection')
        text=text.replace('this.maids=net.minecraftforge.fml.ModList.get().isLoaded("touhou_little_maid")?new MaidConfigBridge(this):null;','this.maids=null; // Dedicated Forge acceptance: GUI configuration not ported.')
        text=text.replace('"bedrockVisualMenus",true','"bedrockVisualMenus",false')
        text=text.replace('for(var msg:ProtocolView.forWire(request.messages()))switch(msg){','for(var msg:ProtocolView.forWire(request.messages())){')
        text=text.replace('case ConvoState.Msg.User u->','if(msg instanceof ConvoState.Msg.User u) ')
        text=text.replace('case ConvoState.Msg.Assistant a->','else if(msg instanceof ConvoState.Msg.Assistant a) ')
        text=text.replace('case ConvoState.Msg.Tool t->','else if(msg instanceof ConvoState.Msg.Tool t) ')
        text=text.replace('default->throw new IllegalStateException("invalid_protocol_view");','else throw new IllegalStateException("invalid_protocol_view");')
        if name=='HeadlessRuntime.java':
            old='net.minecraftforge.fml.ModList.get().isLoaded("maw_agent_bridge")?new NativeModBridge():null'
            if text.count(old)!=1:raise ValueError('review_changed_mod_provider_selection')
            text=text.replace(old,'net.minecraftforge.fml.ModList.get().isLoaded("maw_sao_native")?new NativeModBridge("dev.qiandeng.maw.saoforge.SaoGameplay"):null')
            # Other mods (notably FTB Teams/Quests) finish their own started
            # listeners after ours. Restore bodies on the next server tick,
            # after the entire lifecycle event, not inside our started callback.
            startup='r.http=new HeadlessHttp(r);r.http.start();r.restoreAll();'
            if text.count(startup)!=1:raise ValueError('review_changed_resident_start_order')
            text=text.replace(startup,'r.http=new HeadlessHttp(r);r.http.start();r.requests.add(r::restoreAll);')
            original='catch(RuntimeException failure){bodies.get(id).addProperty("blocked",safeCode(failure));save(id);}'
            replacement='''catch(RuntimeException failure){
                JsonObject b=bodies.get(id);b.addProperty("blocked",safeCode(failure));
                b.addProperty("failureClass",failure.getClass().getName());b.addProperty("failureFrames",Arrays.toString(Arrays.copyOf(failure.getStackTrace(),Math.min(8,failure.getStackTrace().length))));save(id);
                org.slf4j.LoggerFactory.getLogger("maw-numen-server").error("Automatic body restore failed body={} class={} frames={}",id,failure.getClass().getName(),b.get("failureFrames"));
            }'''
            if text.count(original)!=1:raise ValueError('review_changed_restore_failure_handling')
            text=text.replace(original,replacement)
            marker='    public static boolean managed(UUID id)'
            audit='''    // Console-only, lab-only diagnostic recovery after an administrator has
    // checked every durable action is terminal. Never retries a game program.
    public static JsonObject auditRestore(UUID id) {
        HeadlessRuntime r=INSTANCE;if(r==null)throw new IllegalStateException("runtime_offline");
        JsonObject b=r.bodies.get(id);if(b==null)throw new IllegalArgumentException("unknown_body");
        if(!b.has("blocked")||!b.get("blocked").getAsString().equals("operation_failed_inspect_server_receipt")||b.has("activeAction")||NumenPlayer.findByUuid(r.server,id)!=null)throw new IllegalStateException("audit_requires_offline_known_failure_no_active_action");
        try {
            Path actions=r.directory.resolve("actions").resolve(id.toString());
            if(Files.isDirectory(actions))try(var paths=Files.list(actions)){for(var file:paths.filter(p->p.getFileName().toString().endsWith(".json")).toList())if(!read(file).get("phase").getAsString().equals("terminal"))throw new IllegalStateException("unresolved_action_no_restore");}
            write(r.directory.resolve("restore-audit").resolve(id+"-"+System.currentTimeMillis()+".json"),b.deepCopy());
        }catch(java.io.IOException failed){throw new IllegalStateException("restore_audit_not_persisted",failed);}
        b.remove("blocked");r.save(id);
        try {r.restore(id);return r.snapshot(id,true);}
        catch(RuntimeException failed){
            b.addProperty("blocked",safeCode(failed));b.addProperty("failureClass",failed.getClass().getName());
            b.addProperty("failureFrames",Arrays.toString(Arrays.copyOf(failed.getStackTrace(),Math.min(8,failed.getStackTrace().length))));r.save(id);
            org.slf4j.LoggerFactory.getLogger("maw-numen-server").error("Body restore failed body={} class={} frames={}",id,failed.getClass().getName(),b.get("failureFrames"));
            JsonObject out=r.denied("audit_restore",safeCode(failed));out.add("failureClass",b.get("failureClass"));out.add("failureFrames",b.get("failureFrames"));return out;
        }
    }
'''
            if marker not in text:raise ValueError('review_changed_resident_runtime')
            text=text.replace(marker,audit+marker)
        (package/name).write_text(text,encoding='utf-8')
    for original in (java/'mixin').glob('*.java'):
        hashes['mixin/'+original.name]=digest(original)
        target=package/'mixin'/original.name;target.parent.mkdir(exist_ok=True);shutil.copyfile(original,target)
    mixins=json.loads((source/'src/main/resources/maw_numen_server.mixins.json').read_text('utf-8'))
    mixins['compatibilityLevel']='JAVA_17'
    mixins['minVersion']='0.8'
    optional=Path(__file__).with_name('resident-forge')/'mixin/OptionalNetworkMixin.java'
    shutil.copyfile(optional,package/'mixin/OptionalNetworkMixin.java')
    mixins['server'].append('OptionalNetworkMixin')
    (output/'src/main/resources/maw_numen_server.mixins.json').write_text(json.dumps(mixins,indent=2),encoding='utf-8')
    (package/'HeadlessMod.java').write_text('''package dev.qiandeng.maw.numenserver;
@net.minecraftforge.fml.common.Mod("maw_numen_server")
public final class HeadlessMod {
  public HeadlessMod() {
    var bus=net.minecraftforge.common.MinecraftForge.EVENT_BUS;
    bus.addListener(net.minecraftforge.eventbus.api.EventPriority.HIGHEST,HeadlessAuth::join);
    bus.addListener((net.minecraftforge.event.server.ServerStartedEvent e)->{
      try{HeadlessRuntime.start(e.getServer());}
      catch(Exception failed){org.slf4j.LoggerFactory.getLogger("maw-numen-server").error("Resident start failed",failed);}
    });
    bus.addListener((net.minecraftforge.event.TickEvent.ServerTickEvent e)->{
      if(e.phase==net.minecraftforge.event.TickEvent.Phase.END){var s=net.minecraftforge.server.ServerLifecycleHooks.getCurrentServer();if(s!=null)HeadlessRuntime.tick(s);}
    });
    bus.addListener((net.minecraftforge.event.server.ServerStoppingEvent e)->HeadlessRuntime.stop());
    bus.addListener((net.minecraftforge.event.RegisterCommandsEvent e)->{
      e.getDispatcher().register(net.minecraft.commands.Commands.literal("mawsao")
        .requires(s->s.getEntity()==null&&s.hasPermission(4))
        .then(net.minecraft.commands.Commands.literal("audit_restore")
          .then(net.minecraft.commands.Commands.argument("body",com.mojang.brigadier.arguments.StringArgumentType.word())
            .executes(c->{
              try {
                var marker=c.getSource().getServer().getServerDirectory().toPath().resolve("../pack-source.json").normalize();
                if(!java.nio.file.Files.isRegularFile(marker)||!PrivateStore.read(marker).get("scope").getAsString().equals("isolated_testing"))throw new IllegalStateException("isolated_lab_required");
                var out=HeadlessRuntime.auditRestore(java.util.UUID.fromString(com.mojang.brigadier.arguments.StringArgumentType.getString(c,"body")));
                c.getSource().sendSuccess(()->net.minecraft.network.chat.Component.literal(out.toString()),false);return out.get("ok").getAsBoolean()?1:0;
              }catch(RuntimeException failed){c.getSource().sendFailure(net.minecraft.network.chat.Component.literal("restore audit refused: "+failed.getClass().getSimpleName()));return 0;}
            }))));
    });
  }
}
''',encoding='utf-8')
    for name in ['MaidConfigBridge','BedrockMenus']:
        (package/(name+'.java')).write_text('''package dev.qiandeng.maw.numenserver;
// Explicit unavailable adapter, not a substitute game action or success receipt.
final class CLASS {
  CLASS(HeadlessRuntime unused){}
  void prune(long at){}
  com.google.gson.JsonObject invoke(net.minecraft.server.level.ServerPlayer p,String action,com.google.gson.JsonObject args){throw new IllegalArgumentException("forge_1_20_gui_adapter_unavailable");}
}
'''.replace('CLASS',name),encoding='utf-8')
    artifacts=output/'numen-deps';artifacts.mkdir(exist_ok=True)
    jar=root/'artifacts/numen-forge-1.20.1-0.1.4.1-all.jar';shutil.copyfile(jar,artifacts/jar.name)
    with zipfile.ZipFile(jar)as z:
        (artifacts/'numen_api-forge-1.20.1-0.1.4.1.jar').write_bytes(z.read('META-INF/jarjar/numen_api-forge-1.20.1-0.1.4.1.jar'))
    gradle=output/'build.gradle'
    gradle.write_text(gradle.read_text('utf-8')+'''
repositories { flatDir { dirs 'numen-deps' } }
dependencies {
    compileOnly fg.deobf('dev.qiandeng.vendor:numen-forge-1.20.1:0.1.4.1:all')
    compileOnly fg.deobf('dev.qiandeng.vendor:numen_api-forge-1.20.1:0.1.4.1')
}
jar { manifest { attributes('MixinConfigs': 'maw_numen_server.mixins.json') } }
tasks.withType(JavaCompile).configureEach { options.compilerArgs += ['-proc:none'] }
''',encoding='utf-8')
    toml=output/'src/main/resources/META-INF/mods.toml'
    toml.write_text(toml.read_text('utf-8')+'''
[[mods]]
modId="maw_numen_server"
version="0.1.0"
displayName="Agent MC World SAO Numen Resident"
displayTest="IGNORE_SERVER_VERSION"
description="Owner-scoped external controller for persistent native Numen bodies. GUI adapters unavailable."
''',encoding='utf-8')
    record={'resident_source':str(source),'source_sha256':hashes,'generator_sha256':digest(Path(__file__)),'optional_network_mixin_sha256':digest(optional),'minecraft':'1.20.1','gui_adapters':False,'native_mod_adapter':True,'native_mod_provider':'sao_native','owner_scoped':True,'original_source_preserved':True,'numen_client_optional':True}
    (root/'resident-generation.json').write_text(json.dumps(record,indent=2),encoding='utf-8');print(json.dumps(record))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--source',default=str(Path(__file__).with_name('resident-reference')));a=p.parse_args();resident(a.root,a.source)
