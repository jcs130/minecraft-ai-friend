package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule;
import com.google.gson.*;
import java.util.*;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.ai.behavior.BehaviorUtils;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.phys.Vec3;
import org.bukkit.Bukkit;

/** Native world operations, main thread only. No fake players, OP, commands or fabricated inventory. */
final class NativeMaidBodyActions {
    private static final String ANCHOR="qiandengji_native_body_walk";
    private record Walk(UUID owner,String request,Vec3 target,Vec3 start,String dimension,long until){}
    private final HybridMaidPlugin plugin;
    private final MaidBodyControl control;
    private final Map<UUID,Walk> walks=new HashMap<>();
    private final Set<UUID> follows=new HashSet<>();
    private final Set<UUID> companions=new HashSet<>();
    private final Set<UUID> guards=new HashSet<>();
    private final Map<UUID,String> resumeGuards=new HashMap<>();
    private int receiptTick;
    NativeMaidBodyActions(HybridMaidPlugin plugin,MaidBodyControl control){this.plugin=plugin;this.control=control;}
    boolean following(UUID id){return follows.contains(id);}
    boolean companion(UUID id){return companions.contains(id);}
    boolean guarding(UUID id){return guards.contains(id);}
    JsonObject call(UUID owner,UUID id,JsonObject input)throws Exception {
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main_thread_required");
        String action=MaidBodyControl.string(input,"action");MaidBodyControl.validateShape(input);
        if(MaidBodyControl.READS.contains(action))return read(owner,id,action,input);
        String request=MaidBodyControl.request(input,"requestId");
        var previous=control.read(id,request);
        if(previous!=null){control.reserve(owner,id,request,input);return reply(true,receipt(owner,id,request),null);}
        if(plugin.nativeLegacyReceipt(owner,id,request)!=null)throw new MaidBodyControl.Fault(409,"REQUEST_CONFLICT_LEGACY_QUERY_ORIGINAL");
        EntityMaid maid;
        try{maid=plugin.ownedLoaded(owner,id);}catch(CompatibilityException unavailable){return blocked(owner,id,input,unavailable.code());}
        // Validate the whole action before reserving or changing the world.
        Vec3 target=null;String value=null;
        if(walks.containsKey(id)&&!Set.of("stop","stay").contains(action))return blocked(owner,id,input,"maid_busy");
        if(!Set.of("stop","stay").contains(action)&&(plugin.editingMaidInventory(maid)||plugin.workshops().busy(id)||maid.isNoAi()||maid.isPassenger()||maid.isVehicle()))return blocked(owner,id,input,"maid_busy");
        switch(action){
            case "companion"->{if(!plugin.sharedDialogueEnabled(maid))return blocked(owner,id,input,"original_brain_not_configured");}
            case "cast"->{value=MaidBodyControl.string(input,"spellId");if(!value.matches("[a-z0-9][a-z0-9_-]{0,47}"))throw new MaidBodyControl.Fault(400,"INVALID_spellId");}
            case "walk"->{
                if(input.has("dimension")&&!MaidBodyControl.string(input,"dimension").equals(maid.level().dimension().location().toString()))throw new MaidBodyControl.Fault(400,"DIMENSION_MISMATCH");
                target=new Vec3(number(input,"x"),number(input,"y"),number(input,"z"));
                if(maid.position().distanceTo(target)>96||target.y<maid.level().getMinBuildHeight()||target.y>=maid.level().getMaxBuildHeight())return blocked(owner,id,input,"walk_out_of_range");
                var pos=BlockPos.containing(target);if(!maid.level().hasChunkAt(pos))return blocked(owner,id,input,"destination_unloaded");
                var path=maid.getNavigation().createPath(pos,0);
                if(!maid.level().getWorldBorder().isWithinBounds(pos)||!maid.getNavigation().isStableDestination(pos)||path==null||!path.canReach())return blocked(owner,id,input,"path_blocked");
            }
            case "equip"->{int slot=integer(input,"slot");String hand=MaidBodyControl.string(input,"hand");if(!Set.of("main","off","head","chest","legs","feet").contains(hand))throw new MaidBodyControl.Fault(400,"INVALID_hand");value=hand+" "+slot;
                try{plugin.nativeEquipmentValidate(maid,value);}catch(CompatibilityException refused){return blocked(owner,id,input,refused.code());}}
            case "task"->{value=MaidBodyControl.string(input,"taskId");var key=ResourceLocation.tryParse(value);if(key==null)throw new MaidBodyControl.Fault(400,"INVALID_taskId");
                var task=TaskManager.getTaskMap().get(key);if(task==null||!task.isEnable(maid))return blocked(owner,id,input,"task_requirements");}
            case "schedule"->{value=MaidBodyControl.string(input,"schedule");try{MaidSchedule.valueOf(value);}catch(IllegalArgumentException e){throw new MaidBodyControl.Fault(400,"INVALID_schedule");}}
            case "pickup"->{if(!input.has("enabled")||!input.get("enabled").isJsonPrimitive()||!input.getAsJsonPrimitive("enabled").isBoolean())throw new MaidBodyControl.Fault(400,"INVALID_enabled");}
            case "speak"->{value=MaidBodyControl.string(input,"text");if(value.isBlank()||value.codePointCount(0,value.length())>140||value.codePoints().anyMatch(x->Character.isISOControl(x)||x==0xA7))throw new MaidBodyControl.Fault(400,"INVALID_text");}
            case "ack"->{value=MaidBodyControl.string(input,"eventId");if(!value.matches("[A-Za-z0-9_:-]{1,128}"))throw new MaidBodyControl.Fault(400,"INVALID_eventId");}
        }
        // The delegated native brain keeps its original history. External physical writes
        // must wait for that turn, then fence all older callbacks before touching the body.
        boolean physical=!Set.of("ack","speak").contains(action);
        boolean resumeCompanion=companions.contains(id)&&Set.of("cast","equip","schedule","pickup").contains(action);
        boolean resumeGuard=guards.contains(id)&&Set.of("cast","equip","schedule","pickup").contains(action);
        if(physical&&companions.contains(id)&&!Set.of("stop","stay","sit").contains(action))try{plugin.nativeReady(owner,id);}catch(CompatibilityException busy){return blocked(owner,id,input,busy.code());}
        control.reserve(owner,id,request,input);
        try{
            if(physical){plugin.nativeQuiesce(maid);companions.remove(id);guards.remove(id);resumeGuards.remove(id);control.invalidateCallbacks(id);}
            var observed=new JsonObject();observed.addProperty("effectsApplied",false);
            switch(action){
                case "walk"->{
                    restore(maid);var saved=new CompoundTag();maid.getSchedulePos().save(saved);saved.putBoolean("bodyHome",maid.isHomeModeEnable());saved.putBoolean("bodySitting",maid.isMaidInSittingPose());saved.putString("bodySchedule",maid.getSchedule().name());saved.putString("bodyTask",maid.getTask().getUid().toString());
                    maid.getPersistentData().put(ANCHOR,saved);stop(maid);maid.setHomeModeEnable(true);maid.setInSittingPose(false);maid.setSchedule(MaidSchedule.ALL);maid.setTask(TaskManager.getIdleTask());
                    var pos=BlockPos.containing(target);var schedule=maid.getSchedulePos();schedule.setDimension(maid.level().dimension().location());schedule.setWorkPos(pos);schedule.setIdlePos(pos);schedule.setSleepPos(pos);schedule.setConfigured(true);schedule.restrictTo(maid);
                    follows.remove(id);walks.put(id,new Walk(owner,request,target,maid.position(),maid.level().dimension().location().toString(),System.currentTimeMillis()+30_000));
                    BehaviorUtils.setWalkAndLookTargetMemories(maid,pos,.7f,0);observed.addProperty("effectsApplied",true);observed.addProperty("arrived",false);observed.add("actualPosition",position(maid));
                    return reply(true,control.finish(id,request,"running",observed),null);
                }
                case "stop","stay","sit"->{cancel(id,"stopped");stop(maid);maid.setInSittingPose(true);follows.remove(id);observed.addProperty("meaning","mode setting; native movement stopped");}
                case "follow"->{restore(maid);MaidCompanionActions.follow(maid);follows.add(id);observed.addProperty("meaning","follow mode set; arrival requires observation; offline owner cannot be followed");}
                case "guard"->{restore(maid);maid.setInSittingPose(false);guards.add(id);
                    if(local.qdj.maids.brain.ResidentBodyAccess.external(id))local.qdj.maids.brain.ResidentBodyAccess.externalGuard(id,true);
                    else{MaidCompanionActions.follow(maid);follows.add(id);}
                    observed.addProperty("meaning","native defensive execution enabled; dialogue remains with the unified controller; hits require observation");}
                case "companion"->{restore(maid);MaidCompanionActions.follow(maid);follows.add(id);companions.add(id);observed.addProperty("meaning","Original native follow/guard and selected dialogue brain delegated under this controller; no goal completion or new memory scope");}
                case "cast"->{observed=plugin.nativeCast(maid,value,request);observed.add("actualPosition",position(maid));boolean applied=observed.has("effectsApplied")&&observed.get("effectsApplied").getAsBoolean();String state=observed.has("status")?observed.get("status").getAsString():"unknown";boolean pending=Set.of("accepted","pending","running").contains(state);boolean uncertain=state.equals("unknown");var result=reply(applied||pending,control.finish(id,request,pending?"running":uncertain?"unknown":applied?"applied":"rejected",observed),applied||pending?null:uncertain?"spell_result_unknown_query_original":"spell_not_applied");if(resumeCompanion)companions.add(id);if(resumeGuard){if(pending||uncertain)resumeGuards.put(id,request);else resumeGuard(maid);}return result;}
                case "task"->{restore(maid);maid.setTask(TaskManager.getTaskMap().get(ResourceLocation.parse(value)));maid.setInSittingPose(false);follows.remove(id);observed.addProperty("meaning","native task selected; work result requires observation");}
                case "equip"->observed=plugin.nativeEquip(maid,value);
                case "schedule"->maid.setSchedule(MaidSchedule.valueOf(value));
                case "pickup"->maid.setPickup(input.get("enabled").getAsBoolean());
                case "speak"->{
                    Set<UUID> audience=new HashSet<>();for(var player:maid.getBukkitEntity().getLocation().getNearbyPlayers(16))if(player.canSee(maid.getBukkitEntity())){player.sendMessage(net.kyori.adventure.text.Component.text("<"+maid.getName().getString()+"> "+value));audience.add(player.getUniqueId());}
                    plugin.publishPublicSpeech(maid,request,value,audience.size());plugin.speakPublicReply(maid,request,value,audience);
                    maid.getChatBubbleManager().addTextChatBubble(value);
                    observed.addProperty("deliveredPlayers",audience.size());observed.add("voice",plugin.nativeSpeechState(maid));observed.addProperty("hearingVerified",false);
                }
                case "ack"->plugin.nativeAck(id,value);
            }
            observed.addProperty("effectsApplied",true);observed.add("actualPosition",position(maid));var result=reply(true,control.finish(id,request,"applied",observed),null);if(resumeCompanion)companions.add(id);if(resumeGuard)resumeGuard(maid);return result;
        }catch(Exception failure){var info=new JsonObject();info.addProperty("reason","execution_uncertain_query_original_request");
            try{return reply(false,control.finish(id,request,"unknown",info),"execution_uncertain_query_original_request");}catch(Exception journal){throw new MaidBodyControl.Fault(503,"RESULT_UNKNOWN");}}
    }
    private JsonObject read(UUID owner,UUID id,String action,JsonObject input)throws Exception {
        JsonObject data;
        switch(action){
            case "list"->{data=new JsonObject();var maids=new JsonArray();var row=plugin.context(owner,null,id);maids.add(row);data.add("maids",maids);}
            case "context"->data=plugin.context(owner,null,id);
            case "inventory"->{data=plugin.inventory(owner,id);data.addProperty("nextStep","Use equip hand=main|off|head|chest|legs|feet and slot from usableSlotIndexes. Only items already in this maid's native inventory can be equipped; transfer is not exposed on this port.");}
            case "tasks"->data=plugin.catalog(owner,id);
            case "brain"->{var context=plugin.context(owner,null,id);data=context.has("brain")?context.getAsJsonObject("brain"):new JsonObject();}
            case "inbox"->data=plugin.nativeInbox(owner,id);
            case "spells"->{if(local.qdj.maids.brain.ResidentBodyAccess.external(id)){data=JsonParser.parseString(local.qdj.maids.brain.ResidentBodyAccess.rpg(id)).getAsJsonObject();data.addProperty("stateSource","native_resident_vortex");data.addProperty("residentRpgAccount",true);}
                else{var scene=plugin.companionScene(plugin.ownedLoaded(owner,id));data=scene.has("rpg")?scene.getAsJsonObject("rpg").deepCopy():new JsonObject();data.addProperty("stateSource","original_private_companion_magic");data.addProperty("residentRpgAccount",false);}}
            case "receipt"->data=receipt(owner,id,MaidBodyControl.request(input,"operationId"));
            default->throw new MaidBodyControl.Fault(400,"UNSUPPORTED_ACTION");
        }
        data.addProperty("maidId",id.toString());data.addProperty("ownerId",owner.toString());data.addProperty("sampledAt",java.time.Instant.now().toString());
        if(action.equals("context")){data.addProperty("nativeGuardDelegated",guarding(id));
            if(local.qdj.maids.brain.ResidentBodyAccess.external(id))data.add("resident",JsonParser.parseString(local.qdj.maids.brain.ResidentBodyAccess.status(id)));
            else data.add("scene",plugin.companionScene(plugin.ownedLoaded(owner,id)));}
        if(action.equals("context")){data.addProperty("physicalController","native_body");data.addProperty("nativeCompanionDelegated",companion(id));var caps=new JsonArray();MaidBodyControl.READS.stream().sorted().forEach(caps::add);MaidBodyControl.WRITES.stream().sorted().forEach(caps::add);data.add("capabilities",caps);if(data.has("brain"))externalBrain(data.getAsJsonObject("brain"),id);}
        if(action.equals("brain"))externalBrain(data,id);
        return reply(true,data,null);
    }
    private void externalBrain(JsonObject brain,UUID id){brain.addProperty("physicalController","native_body");brain.addProperty("readOnly",true);brain.addProperty("originalDialogueControllerActive",!plugin.unifiedBody(id)&&companion(id));brain.addProperty("memoryOwner",plugin.unifiedBody(id)?"unified_character_store":"original_tlm");brain.addProperty("meaning",plugin.unifiedBody(id)?"Unified NPC controller owns decisions and character memory. Original native history is retained read-only for migration; native task execution is separate from a model loop.":companion(id)?"Original selected brain/history and native companion behaviours are delegated by this lease. No shadow dialogue model or new memory scope.":"Original configured brain selection is retained; dialogue queues in inbox while exclusive control is active. Brain choice cannot be changed on this port.");}
    private JsonObject receipt(UUID owner,UUID id,String request)throws Exception {
        var value=control.read(id,request);
        if(value==null){value=plugin.nativeLegacyReceipt(owner,id,request);if(value==null)throw new CompatibilityException("receipt_missing","Query the original namespace; never replay");
            value=value.deepCopy();value.addProperty("namespace","legacy");value.addProperty("operationId",request);return value;}
        if("cast".equals(value.get("action").getAsString())&&Set.of("accepted","running","unknown").contains(value.get("status").getAsString())&&local.qdj.maids.brain.ResidentBodyAccess.external(id)){
            var original=JsonParser.parseString(local.qdj.maids.brain.ResidentBodyAccess.castReceipt(id,request)).getAsJsonObject();
            String state=original.has("status")?original.get("status").getAsString():"unknown";
            if(state.equals("completed")||Set.of("blocked","rejected","cancelled","failed").contains(state)){
                original.addProperty("effectsApplied",state.equals("completed"));var result=control.finish(id,request,state.equals("completed")?"applied":"rejected",original);
                if(request.equals(resumeGuards.get(id))&&control.active(id)){var body=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));if(body!=null)resumeGuard(body);}return result;
            }
            if(Set.of("accepted","pending","running").contains(state))return control.finish(id,request,"running",original);
        }
        if(Set.of("accepted","running").contains(value.get("status").getAsString())&&(!walks.containsKey(id)||!walks.get(id).request.equals(request))){
            var reason=new JsonObject();reason.addProperty("reason","restart_or_execution_interrupted_query_original_request");value=control.finish(id,request,"unknown",reason);
        }
        return value;
    }
    void tick(){
        if(++receiptTick%10==0)for(var id:new ArrayList<>(resumeGuards.keySet()))try{var body=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));if(body!=null&&control.active(id))receipt(body.getOwnerUUID(),id,resumeGuards.get(id));}catch(Exception ignored){/* Original request remains unresolved; do not resume work. */}
        for(var id:new ArrayList<>(walks.keySet())){
            var walk=walks.get(id);EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));String failure=null;
            if(maid==null||!maid.isAlive()||maid.isRemoved())failure="body_unavailable";
            else if(!walk.owner.equals(maid.getOwnerUUID()))failure="owner_changed";
            else if(!control.active(id))failure="control_changed";
            else if(!walk.dimension.equals(maid.level().dimension().location().toString()))failure="dimension_changed";
            else if(plugin.editingMaidInventory(maid))failure="inventory_opened";
            boolean arrived=failure==null&&maid.position().distanceTo(walk.target)<=.9;
            if(failure==null&&!arrived&&System.currentTimeMillis()>walk.until)failure="walk_timeout";
            try{
                if(failure!=null||arrived){finishWalk(id,maid,arrived?"completed":"failed",failure==null?"arrived":failure,arrived);continue;}
                if(maid.getNavigation().isDone()||!maid.getBrain().hasMemoryValue(MemoryModuleType.WALK_TARGET))BehaviorUtils.setWalkAndLookTargetMemories(maid,BlockPos.containing(walk.target),.7f,0);
            }catch(Exception error){walks.remove(id);if(maid!=null){stop(maid);restore(maid);}plugin.getLogger().warning("Native body walk result uncertain; query original request");}
        }
        // Recover only our temporary navigation anchor after a normal or abnormal server restart.
        for(var id:control.ids())if(!walks.containsKey(id)){var maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));if(maid!=null&&maid.getPersistentData().contains(ANCHOR)){stop(maid);restore(maid);}}
    }
    private void resumeGuard(EntityMaid maid){var id=maid.getUUID();resumeGuards.remove(id);if(!control.active(id)||!maid.isAlive())return;guards.add(id);if(local.qdj.maids.brain.ResidentBodyAccess.external(id))local.qdj.maids.brain.ResidentBodyAccess.externalGuard(id,true);else{MaidCompanionActions.follow(maid);follows.add(id);}}
    void cancel(UUID id,String reason)throws Exception {var maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));companions.remove(id);guards.remove(id);resumeGuards.remove(id);if(maid!=null)plugin.nativeQuiesce(maid);if(walks.containsKey(id))finishWalk(id,maid,"cancelled",reason,false);else if(maid!=null){stop(maid);restore(maid);}follows.remove(id);}
    private void finishWalk(UUID id,EntityMaid maid,String status,String reason,boolean arrived)throws Exception {
        var walk=walks.remove(id);var observed=new JsonObject();observed.addProperty("reason",reason);observed.addProperty("arrived",arrived);
        if(maid!=null){stop(maid);restore(maid);observed.add("actualPosition",position(maid));observed.addProperty("distanceMoved",maid.position().distanceTo(walk.start));observed.addProperty("remainingDistance",maid.position().distanceTo(walk.target));}
        control.finish(id,walk.request,status,observed);
    }
    private static void stop(EntityMaid maid){maid.getNavigation().stop();maid.setTarget(null);maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);maid.getBrain().eraseMemory(MemoryModuleType.PATH);maid.getBrain().eraseMemory(MemoryModuleType.ATTACK_TARGET);}
    private static void restore(EntityMaid maid){if(!maid.getPersistentData().contains(ANCHOR))return;var saved=maid.getPersistentData().getCompound(ANCHOR);
        maid.getSchedulePos().load(saved,maid);maid.setHomeModeEnable(saved.getBoolean("bodyHome"));maid.setInSittingPose(saved.getBoolean("bodySitting"));
        maid.setSchedule(MaidSchedule.valueOf(saved.getString("bodySchedule")));var task=TaskManager.getTaskMap().get(ResourceLocation.parse(saved.getString("bodyTask")));if(task!=null)maid.setTask(task);maid.getPersistentData().remove(ANCHOR);}
    private static double number(JsonObject input,String key){try{if(!input.get(key).isJsonPrimitive()||!input.getAsJsonPrimitive(key).isNumber())throw new IllegalArgumentException();double n=input.get(key).getAsDouble();if(!Double.isFinite(n))throw new IllegalArgumentException();return n;}catch(Exception e){throw new MaidBodyControl.Fault(400,"INVALID_"+key);}}
    private static int integer(JsonObject input,String key){double n=number(input,key);if(n<0||n>Integer.MAX_VALUE||n!=Math.floor(n))throw new MaidBodyControl.Fault(400,"INVALID_"+key);return (int)n;}
    private static JsonObject position(EntityMaid maid){var p=new JsonObject();p.addProperty("x",maid.getX());p.addProperty("y",maid.getY());p.addProperty("z",maid.getZ());p.addProperty("dimension",maid.level().dimension().location().toString());return p;}
    private JsonObject blocked(UUID owner,UUID id,JsonObject input,String reason)throws Exception {String request=MaidBodyControl.request(input,"requestId");control.reserve(owner,id,request,input);var info=new JsonObject();info.addProperty("reason",reason);info.addProperty("effectsApplied",false);return reply(false,control.finish(id,request,"rejected",info),reason);}
    private static JsonObject reply(boolean ok,JsonObject data,String reason){var body=new JsonObject();body.addProperty("protocol","qiandengji-maids/v1");body.addProperty("ok",ok);body.addProperty("status",data.has("status")?data.get("status").getAsString():"completed");body.add("data",data);
        if(reason!=null)body.addProperty("reason",reason);var item=new JsonObject();item.addProperty("type","text");item.addProperty("text",body.toString());var content=new JsonArray();content.add(item);var result=new JsonObject();result.add("content",content);result.addProperty("isError",false);return result;}
}
