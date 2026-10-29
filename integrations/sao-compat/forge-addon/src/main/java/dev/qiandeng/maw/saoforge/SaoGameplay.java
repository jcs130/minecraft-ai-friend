package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.protocol.game.ClientboundCustomPayloadPacket;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.network.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** One scoped native SDK for ordinary connections and owner-controlled Numen bodies. */
public final class SaoGameplay {
    private static final String EPOCH=UUID.randomUUID().toString();
    private static final JsonObject CONTRACT=load();
    private static final NativePolicy POLICY=new NativePolicy(CONTRACT);
    private static Path directory;
    private static String worldId;
    private static final Map<UUID,long[]> rates=new HashMap<>();
    private static JsonObject load(){try(var in=SaoGameplay.class.getResourceAsStream("/sao-operations.json")){if(in==null)throw new IllegalStateException("missing_sao_contract");return JsonParser.parseString(new String(in.readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();}catch(java.io.IOException e){throw new IllegalStateException(e);}}
    public static JsonObject catalog(String operation){
        var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("provider","sao_native");
        if(operation!=null&&!operation.isBlank()){var spec=POLICY.operation(operation);if(spec==null)throw new IllegalArgumentException("unknown_operation");out.add("operation",spec.deepCopy());}
        else {var index=new JsonArray();for(var entry:CONTRACT.getAsJsonArray("operations")){var spec=entry.getAsJsonObject();var row=new JsonObject();row.add("id",spec.get("id"));row.add("readOnly",spec.get("readOnly"));index.add(row);}out.add("operations",index);out.add("limits",CONTRACT.get("limits").deepCopy());}
        return out;
    }
    public static void install(){
        var bus=MinecraftForge.EVENT_BUS;
        bus.addListener((net.minecraftforge.event.server.ServerStartedEvent e)->{
            try{Path root=e.getServer().getServerDirectory().toPath().resolve("maw-sao");directory=root.resolve("gameplay-actions");Files.createDirectories(directory);Path identity=root.resolve("world-id.txt");if(!Files.exists(identity))Files.writeString(identity,UUID.randomUUID().toString(),StandardCharsets.UTF_8,StandardOpenOption.CREATE_NEW);worldId=Files.readString(identity).strip();}catch(java.io.IOException failure){throw new IllegalStateException("sao_ledger_unavailable",failure);}
        });
        bus.addListener((net.minecraftforge.event.server.ServerStoppingEvent e)->{directory=null;rates.clear();});
        bus.addListener((net.minecraftforge.event.RegisterCommandsEvent e)->{
            var c=net.minecraft.commands.Commands.literal("saoagent").requires(s->s.getEntity() instanceof ServerPlayer);
            c.then(net.minecraft.commands.Commands.literal("do").then(net.minecraft.commands.Commands.argument("request",com.mojang.brigadier.arguments.StringArgumentType.word()).then(net.minecraft.commands.Commands.argument("operation",com.mojang.brigadier.arguments.StringArgumentType.word()).then(net.minecraft.commands.Commands.argument("payload",com.mojang.brigadier.arguments.StringArgumentType.word()).executes(ctx->{
                var p=ctx.getSource().getPlayerOrException();String request=com.mojang.brigadier.arguments.StringArgumentType.getString(ctx,"request");String operation=com.mojang.brigadier.arguments.StringArgumentType.getString(ctx,"operation");String payload=com.mojang.brigadier.arguments.StringArgumentType.getString(ctx,"payload");
                JsonObject out;try{if(payload.length()>6000)throw new IllegalArgumentException("payload_budget");var args=JsonParser.parseString(new String(Base64.getUrlDecoder().decode(payload),StandardCharsets.UTF_8)).getAsJsonObject();out=invoke(p,operation,args,false,request);}catch(RuntimeException failure){out=base(p,operation,request,false);fail(out,"invalid_command_payload",true);}
                send(p,out);return out.has("ok")&&out.get("ok").getAsBoolean()?1:0;
            })))));e.getDispatcher().register(c);
        });
        var channel=NetworkRegistry.newEventChannel(new ResourceLocation("maw_agent:sao_query"),()->"1",v->true,v->true);
        channel.addListener((NetworkEvent.ClientCustomPayloadEvent event)->{
            var context=event.getSource().get();var player=context.getSender();if(player==null||context.getDirection()!=NetworkDirection.PLAY_TO_SERVER)return;
            var buf=event.getPayload();if(buf.readableBytes()>4096){context.setPacketHandled(true);return;}byte[] bytes=new byte[buf.readableBytes()];buf.readBytes(bytes);
            context.enqueueWork(()->{try{var q=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();send(player,invoke(player,q.get("operation").getAsString(),q.getAsJsonObject("arguments"),true,q.get("requestId").getAsString()));}catch(RuntimeException bad){/* No guessed operation and no chat error copy. */}});context.setPacketHandled(true);
        });
    }
    private static JsonObject base(ServerPlayer p,String op,String id,boolean read){var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("provider","sao_native");out.addProperty("operation",op);out.addProperty("requestId",id);out.addProperty("bodyId",p.getUUID().toString());out.addProperty("playerUuid",p.getUUID().toString());out.addProperty("serverEpoch",EPOCH);out.addProperty("worldId",worldId);out.addProperty("observedAt",Instant.now().toString());out.addProperty("readOnly",read);out.addProperty("retryAutomatically",false);return out;}
    private static void fail(JsonObject out,String reason,boolean known){out.addProperty("ok",false);out.addProperty("status",known?"blocked":"unknown");out.addProperty("reason",reason);out.addProperty("outcomeKnown",known);if(known)out.addProperty("changed",false);else out.add("changed",JsonNull.INSTANCE);out.addProperty("goalCompleted",false);}
    public static JsonObject invoke(ServerPlayer p,String operation,JsonObject args,boolean readOnly,String requestId){
        var out=base(p,operation,requestId,readOnly);if(requestId==null||!requestId.matches("[A-Za-z0-9:_-]{1,64}")){fail(out,"request_id_required",true);return out;}
        var spec=POLICY.operation(operation);if(spec==null){fail(out,"unknown_operation_read_capabilities",true);return out;}
        if(spec.get("readOnly").getAsBoolean()!=readOnly){fail(out,"read_write_channel_mismatch",true);return out;}
        var problem=NativePolicy.validate(args,spec.getAsJsonObject("parameters"),"arguments");if(problem!=null){fail(out,"invalid_arguments",true);var bad=new JsonObject();bad.addProperty("field",problem.field());bad.addProperty("expected",problem.expected());bad.addProperty("issue",problem.issue());out.add("diagnostic",bad);out.add("example",spec.get("example").deepCopy());return out;}
        if(directory==null){fail(out,"server_not_ready",true);return out;}
        if(readOnly){try{out.add("data",query(p,operation,args));out.addProperty("ok",true);out.addProperty("status","ok");out.addProperty("outcomeKnown",true);}catch(RuntimeException failure){fail(out,safe(failure),true);org.slf4j.LoggerFactory.getLogger("maw-sao").error("SAO read failed op={} request={}",operation,requestId,failure);}return bounded(out);}
        Path file=directory.resolve(p.getUUID().toString()).resolve(NativePolicy.sha(requestId)+".json");String fingerprint=NativePolicy.sha(operation+":"+NativePolicy.canonical(args));
        try{
            if(Files.isRegularFile(file)){JsonObject old=JsonParser.parseString(Files.readString(file)).getAsJsonObject();if(!fingerprint.equals(old.get("fingerprint").getAsString())){fail(out,"request_id_conflict",true);return out;}old.addProperty("replayed",true);old.addProperty("historical",true);return bounded(old);}
            if(!p.isAlive()||p.isSpectator()){fail(out,"body_dead_or_spectator",true);return out;}
            if(p.containerMenu!=p.inventoryMenu||!p.containerMenu.getCarried().isEmpty()){fail(out,"close_menu_and_clear_cursor_first",true);return out;}
            long second=System.currentTimeMillis()/1000;long[] rate=rates.computeIfAbsent(p.getUUID(),id->new long[]{second,0});if(rate[0]!=second){rate[0]=second;rate[1]=0;}if(++rate[1]>10){fail(out,"action_rate_limit",true);out.addProperty("retryAfterMs",1000);return out;}
            ItemStack[] before=new ItemStack[p.inventoryMenu.slots.size()];for(int i=0;i<before.length;i++)before[i]=p.inventoryMenu.getSlot(i).getItem().copy();
            out.addProperty("fingerprint",fingerprint);fail(out,"execution_started_outcome_unconfirmed",false);write(file,out);
            JsonObject outcome=operation.startsWith("sao.quest.")||operation.equals("sao.task.submit")||operation.equals("sao.reward.claim")?SaoQuests.mutate(p,operation,args):SaoRpg.mutate(p,operation,args);
            boolean ok=outcome.has("ok")&&outcome.get("ok").getAsBoolean();out.addProperty("ok",ok);out.addProperty("status",ok?"completed":"blocked");out.addProperty("reason",outcome.has("reason")?outcome.get("reason").getAsString():"native_result");out.addProperty("outcomeKnown",true);out.addProperty("changed",outcome.has("changed")&&outcome.get("changed").getAsBoolean());out.add("data",outcome);
            var changes=new JsonArray();for(int i=0;i<before.length;i++){var after=p.inventoryMenu.getSlot(i).getItem();if(!ItemStack.matches(before[i],after)){var delta=new JsonObject();delta.addProperty("slot",i);delta.add("before",item(before[i]));delta.add("after",item(after));changes.add(delta);}}
            out.addProperty("inventorySlotScheme","vanilla_player_menu_0_45");out.add("inventoryChanges",changes);if(changes.size()>0)out.addProperty("changed",true);write(file,out);return bounded(out);
        }catch(IllegalArgumentException failure){fail(out,safe(failure),true);try{write(file,out);}catch(Exception ignored){}return out;}
        catch(Exception failure){fail(out,"native_operation_interrupted_query_original_request",false);try{write(file,out);}catch(Exception ignored){}org.slf4j.LoggerFactory.getLogger("maw-sao").error("SAO operation failed op={} request={} class={}",operation,requestId,failure.getClass().getName(),failure);return bounded(out);}
    }
    private static JsonObject query(ServerPlayer p,String op,JsonObject args){return switch(op){
        case "sao.capabilities"->{if(args.has("operation"))yield catalog(args.get("operation").getAsString());var out=new JsonObject();var index=new JsonArray();for(var entry:CONTRACT.getAsJsonArray("operations")){var full=entry.getAsJsonObject();var row=new JsonObject();row.add("id",full.get("id"));row.add("readOnly",full.get("readOnly"));index.add(row);}out.add("operations",index);out.addProperty("details","Request capabilities with operation for that one schema/example. No book or profession tables are loaded automatically.");yield out;}
        case "sao.status"->SaoRpg.status(p);
        case "sao.quests.list"->SaoQuests.list(p,args);
        case "sao.quest.show"->SaoQuests.show(p,args);
        case "sao.professions"->SaoRpg.catalog(p,args);
        case "sao.talents"->SaoRpg.talents(p,args);
        case "sao.attributes"->SaoRpg.attributes(p);
        case "sao.action_status"->{Path file=directory.resolve(p.getUUID().toString()).resolve(NativePolicy.sha(args.get("action_request_id").getAsString())+".json");try{if(Files.isRegularFile(file)){var old=JsonParser.parseString(Files.readString(file)).getAsJsonObject();old.addProperty("historical",true);yield old;}}catch(java.io.IOException e){throw new IllegalStateException("receipt_read_unavailable",e);}var unknown=new JsonObject();unknown.addProperty("status","unknown");unknown.addProperty("outcomeKnown",false);unknown.addProperty("reason","request_not_observed_never_auto_replay");yield unknown;}
        default->throw new IllegalArgumentException("unknown_read_operation");};}
    private static JsonElement item(ItemStack stack){if(stack.isEmpty())return JsonNull.INSTANCE;var out=new JsonObject();out.addProperty("id",BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());out.addProperty("count",stack.getCount());String snbt=stack.save(new CompoundTag()).toString();out.addProperty("componentFingerprint",NativePolicy.sha(snbt));if(snbt.length()<=4096){out.addProperty("snbt",snbt);out.addProperty("componentsComplete",true);}else{out.add("snbt",JsonNull.INSTANCE);out.addProperty("componentsComplete",false);}return out;}
    private static String safe(Exception failure){String message=failure.getMessage();return message!=null&&message.matches("[a-zA-Z0-9_.:-]{1,180}")?message:"native_api_failure_inspect_server_receipt";}
    private static void write(Path file,JsonObject value)throws java.io.IOException{Files.createDirectories(file.getParent());Path tmp=file.resolveSibling(file.getFileName()+".tmp");Files.writeString(tmp,value.toString(),StandardCharsets.UTF_8);try{Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}catch(AtomicMoveNotSupportedException e){Files.move(tmp,file,StandardCopyOption.REPLACE_EXISTING);}}
    private static JsonObject bounded(JsonObject out){if(out.toString().getBytes(StandardCharsets.UTF_8).length<=16384)return out;var limited=out.deepCopy();limited.remove("data");limited.remove("inventoryChanges");limited.addProperty("complete",false);limited.addProperty("partialReason","reply_byte_budget_read_a_narrower_page");if(limited.has("readOnly")&&limited.get("readOnly").getAsBoolean())limited.addProperty("status","partial");return limited;}
    private static void send(ServerPlayer p,JsonObject out){if(p.connection!=null)p.connection.send(new ClientboundCustomPayloadPacket(new ResourceLocation("maw_agent:sao_state"),new FriendlyByteBuf(io.netty.buffer.Unpooled.wrappedBuffer(bounded(out).toString().getBytes(StandardCharsets.UTF_8)))));}
}
