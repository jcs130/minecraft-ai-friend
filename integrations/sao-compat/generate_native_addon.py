"""Backport the existing native-player contract without changing the live addon."""
import argparse
import json
from pathlib import Path
import shutil

from prepare_pack import digest


def generate(root):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8')).get('scope')!='isolated_testing':
        raise ValueError('Only marked lab output is supported')
    here=Path(__file__).resolve().parent
    native=here.parent/'tau-ceti/native-bridge'
    source=native/'src/dev/qiandeng/maw/taunative/NativeBridge.java'
    text=source.read_text('utf-8')
    begin=text.index('    private record Query(')
    end=text.index('    private static JsonObject base(',begin)
    networking='''    public NativeBridge() {
        try(var in=NativeBridge.class.getResourceAsStream("/native-operations.json")) {
            if(in==null)throw new IllegalStateException("Missing native contract");
            policy=new NativePolicy(JsonParser.parseString(new String(in.readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject());
            try{dataSlots=net.minecraftforge.fml.util.ObfuscationReflectionHelper.findField(AbstractContainerMenu.class,"f_38842_");}catch(RuntimeException ignored){dataSlots=null;}
        }catch(java.io.IOException error){throw new IllegalStateException(error);}
        register("maw_agent:world_query",QUERY_BYTES,false);
        register("maw_agent:menu_action",ACTION_BYTES,true);
        net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener((net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent e)->{LAST_READ.remove(e.getEntity().getUUID());SUBSCRIPTIONS.remove(e.getEntity().getUUID());ACTION_RATES.remove(e.getEntity().getUUID());});
        net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener((net.minecraftforge.event.server.ServerStartedEvent e)->RegistryExport.write(e.getServer(),EPOCH));
        net.minecraftforge.common.MinecraftForge.EVENT_BUS.addListener((net.minecraftforge.event.TickEvent.ServerTickEvent e)->{
            if(e.phase!=net.minecraftforge.event.TickEvent.Phase.END)return;
            var server=net.minecraftforge.server.ServerLifecycleHooks.getCurrentServer();
            if(server==null||server.getTickCount()%10!=0)return;
            LEDGERS.entrySet().removeIf(entry->entry.getValue().empty(System.currentTimeMillis()));
            for(var p:server.getPlayerList().getPlayers())if(SUBSCRIPTIONS.containsKey(p.getUUID())&&loggedIn(p))publish(p);
        });
    }
    private static boolean loggedIn(ServerPlayer p){return p.getServer()!=null&&p.getServer().getPlayerList().getPlayer(p.getUUID())==p;}
    private static void register(String name,int limit,boolean mutation) {
        var channel=net.minecraftforge.network.NetworkRegistry.newEventChannel(new ResourceLocation(name),()->"1",v->true,v->true);
        // Forge names payload events by their source side: CLIENT is C -> S.
        channel.addListener((net.minecraftforge.network.NetworkEvent.ClientCustomPayloadEvent event)->{
            var context=event.getSource().get();var player=context.getSender();
            if(player==null||context.getDirection()!=net.minecraftforge.network.NetworkDirection.PLAY_TO_SERVER)return;
            var buffer=event.getPayload();
            org.slf4j.LoggerFactory.getLogger("maw-sao").debug("[maw-sao] native ingress channel={} player={} bytes={}",name,player.getUUID(),buffer.readableBytes());
            if(buffer.readableBytes()>limit){context.setPacketHandled(true);return;}
            byte[] bytes=new byte[buffer.readableBytes()];buffer.readBytes(bytes);
            final String raw;
            try{raw=StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString();}
            catch(java.nio.charset.CharacterCodingException malformed){context.setPacketHandled(true);return;}
            context.enqueueWork(()->{if(mutation)click(player,raw);else query(player,raw);});context.setPacketHandled(true);
        });
    }
'''
    text=text[:begin]+networking+text[end:]
    text=text.replace('package dev.qiandeng.maw.taunative;','package dev.qiandeng.maw.saoforge;')
    lines=[]
    for line in text.splitlines():
        if line.startswith('import net.neoforged.') or line.startswith('import dev.qiandeng.maw.PlayerAuthBridge') or line.startswith('import net.minecraft.core.component.') or line.startswith('import net.minecraft.network.RegistryFriendlyByteBuf') or line.startswith('import net.minecraft.network.chat.ComponentSerialization') or line.startswith('import net.minecraft.network.codec.StreamCodec') or line.startswith('import net.minecraft.network.protocol.common.custom.') or line.startswith('import net.minecraft.resources.RegistryOps'):
            continue
        if line.startswith('@Mod('):line='@net.minecraftforge.fml.common.Mod("maw_sao_native")'
        lines.append(line)
    text='\n'.join(lines)+'\n'
    text=text.replace('PlayerAuthBridge.authenticated(p)','loggedIn(p)')
    text=text.replace('stack.saveOptional(p.registryAccess()).toString()','stack.save(new net.minecraft.nbt.CompoundTag()).toString()')
    text=text.replace('ComponentSerialization.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE,p.registryAccess()),stack.getHoverName()).getOrThrow()','JsonParser.parseString(net.minecraft.network.chat.Component.Serializer.toJson(stack.getHoverName()))')
    text=text.replace('stack.get(DataComponents.FOOD)','stack.getFoodProperties(p)').replace('food.nutrition()','food.getNutrition()').replace('food.saturation()','food.getSaturationModifier()')
    start=text.index('    private static void sendWorld(');end=text.index('    private static void publish(',start)
    text=text[:start]+'''    private static void send(ServerPlayer p,String channel,JsonObject out){if(p.connection!=null){byte[] raw=NativePolicy.bounded(out,STATE_BYTES).toString().getBytes(StandardCharsets.UTF_8);p.connection.send(new net.minecraft.network.protocol.game.ClientboundCustomPayloadPacket(new ResourceLocation(channel),new net.minecraft.network.FriendlyByteBuf(io.netty.buffer.Unpooled.wrappedBuffer(raw))));}}
    private static void sendWorld(ServerPlayer p,JsonObject out){send(p,"maw_agent:world_state",out);}
    private static void sendMenu(ServerPlayer p,JsonObject out){send(p,"maw_agent:menu_state",out);}
'''+text[end:]
    start=text.index('    private static boolean recipeAvailable()');end=text.index('\n',start)
    text=text[:start]+'    private static boolean recipeAvailable(){return false;}'+text[end:]
    start=text.index('                case "recipes" -> {');end=text.index('                case "action_status" -> {',start)
    text=text[:start]+'                case "recipes" -> {error(out,"forge_recipe_adapter_not_yet_available","blocked");}\n'+text[end:]
    destination=root/'native-addon-build'
    destination.mkdir(exist_ok=True)
    shutil.copytree(here/'forge-addon',destination,dirs_exist_ok=True)
    package=destination/'src/main/java/dev/qiandeng/maw/saoforge'
    package.mkdir(parents=True,exist_ok=True)
    (package/'NativeBridge.java').write_text(text,encoding='utf-8')
    policy=native/'src/dev/qiandeng/maw/taunative/NativePolicy.java'
    (package/'NativePolicy.java').write_text(policy.read_text('utf-8').replace('package dev.qiandeng.maw.taunative;','package dev.qiandeng.maw.saoforge;'),encoding='utf-8')
    shutil.copyfile(native/'operations.json',destination/'src/main/resources/native-operations.json')
    record={'shared_source':{str(p.relative_to(here.parent.parent)):digest(p) for p in (source,policy,native/'operations.json')},'generator_sha256':digest(Path(__file__)),'minecraft':'1.20.1','forge':'47.4.10','recipe_provider':False,'game_login_identity_only':True,'source_destination':str(destination)}
    (root/'native-generation.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    print(json.dumps(record,indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True)
    generate(parser.parse_args().root)
