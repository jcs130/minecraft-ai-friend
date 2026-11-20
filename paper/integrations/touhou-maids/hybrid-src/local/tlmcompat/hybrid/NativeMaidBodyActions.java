package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskFishing;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule;
import com.google.gson.*;
import java.util.*;
import java.util.function.Predicate;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.ai.behavior.BehaviorUtils;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.phys.Vec3;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Native world operations, main thread only. No fake players, OP, commands or fabricated inventory. */
final class NativeMaidBodyActions {
    private static final String ANCHOR="qiandengji_native_body_walk";
    private static final String FISH_REQUEST="qiandengji_native_body_fish";
    private record Walk(UUID owner,String request,Vec3 target,Vec3 start,String dimension,long until,
                        long deadline,double bestRemaining,UUID character){
        Walk progress(double remaining,long now) {
            if(character==null || remaining+.75>bestRemaining)return this;
            return new Walk(owner,request,target,start,dimension,Math.min(deadline,now+30_000),
                    deadline,remaining,character);
        }
    }
    private record Fishing(UUID owner, String request, String dimension, long until, long revision, boolean guard) {}
    private final HybridMaidPlugin plugin;
    private final MaidBodyControl control;
    private final Map<UUID,Walk> walks=new HashMap<>();
    private final Map<UUID,Fishing> fishing=new HashMap<>();
    private final Set<UUID> follows=new HashSet<>();
    private final Set<UUID> companions=new HashSet<>();
    private final Set<UUID> guards=new HashSet<>();
    private final Map<UUID,String> resumeGuards=new HashMap<>();
    private int receiptTick;
    private final Predicate<Player> socialParticipant;
    NativeMaidBodyActions(HybridMaidPlugin plugin,MaidBodyControl control){
        this.plugin=plugin;
        this.control=control;
        this.socialParticipant=participantFilter(plugin);
    }
    boolean following(UUID id){return follows.contains(id);}
    boolean companion(UUID id){return companions.contains(id);}
    boolean guarding(UUID id){return guards.contains(id);}
    boolean busy(UUID id){return walks.containsKey(id)||resumeGuards.containsKey(id)||fishing.containsKey(id);}
    JsonObject call(UUID owner,UUID id,JsonObject input)throws Exception {
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main_thread_required");
        String action=MaidBodyControl.string(input,"action");MaidBodyControl.validateShape(input);
        if(MaidBodyControl.READS.contains(action))return read(owner,id,action,input);
        String request=MaidBodyControl.request(input,"requestId");
        var previous=control.read(id,request);
        if(previous!=null){control.reserve(owner,id,request,input);return reply(true,receipt(owner,id,request),null);}
        if (action.equals(NativeMaidWorkshop.ACTION)) {
            var order = new JsonObject();
            order.add("workshop", input.get("workshopId"));
            order.add("recipe", input.get("recipeId"));
            order.add("inventory", input.get("inventory"));
            if (input.has("quantity")) order.add("quantity", input.get("quantity"));
            final String value;
            try { value = NativeMaidWorkshop.modelOrder(order); }
            catch (CompatibilityException invalid) { throw new MaidBodyControl.Fault(400, "INVALID_WORKSHOP_ORDER"); }
            final JsonObject result;
            try { result = plugin.workshopOrder(owner, id, request, value, control.epoch(id), busy(id)); }
            catch (CompatibilityException error) {
                if ("request_conflict".equals(error.code())) throw new MaidBodyControl.Fault(409, "REQUEST_CONFLICT");
                throw error;
            }
            var status = result.get("status").getAsString();
            var detail = result.getAsJsonObject("observation");
            var error = detail == null || !detail.has("error") ? null : detail.get("error").getAsString();
            return reply(Set.of("pending","completed").contains(status), result, error);
        }
        if(plugin.nativeLegacyReceipt(owner,id,request)!=null)throw new MaidBodyControl.Fault(409,"REQUEST_CONFLICT_LEGACY_QUERY_ORIGINAL");
        EntityMaid maid;
        try{maid=plugin.ownedLoaded(owner,id);}catch(CompatibilityException unavailable){return blocked(owner,id,input,unavailable.code());}
        // Validate the whole action before reserving or changing the world.
        Vec3 target=null;String value=null;
        UUID socialTarget = input.has("targetUuid") ? MaidBodyControl.uuid(input, "targetUuid") : null;
        if (action.equals("release_rendezvous")) {
            control.reserve(owner,id,request,input);
            UUID heldTarget = selectedCompanion(maid);
            boolean held = heldTarget != null && heldTarget.equals(socialTarget);
            if (held && walks.containsKey(id)) finishWalk(id, maid, "cancelled", "companion_released", false);
            else if (held) { stop(maid); restore(maid); }
            var result = new JsonObject();
            result.addProperty("effectsApplied", held);
            result.addProperty("selectionReleased", held || heldTarget == null);
            return reply(true,control.finish(id,request,"applied",result),null);
        }
        boolean physical=!Set.of("ack","speak").contains(action);
        if(physical&&(walks.containsKey(id)||fishing.containsKey(id))&&!Set.of("stop","stay","sit","follow").contains(action))return blocked(owner,id,input,"maid_busy");
        if(physical&&!Set.of("stop","stay").contains(action)){
            if(plugin.editingMaidInventory(maid)||plugin.workshops().busy(id)||maid.isNoAi()||maid.isVehicle())return blocked(owner,id,input,"maid_busy");
            if(maid.isPassenger()&&!action.equals("dismount")&&!(MaidCompanionActions.fishingSeat(maid)&&Set.of("fish","follow","sit").contains(action)))return blocked(owner,id,input,"dismount_required");
        }
        switch(action){
            case "companion"->{if(!plugin.sharedDialogueEnabled(maid))return blocked(owner,id,input,"original_brain_not_configured");}
            case "cast"->{value=MaidBodyControl.string(input,"spellId");if(!value.matches("[a-z0-9][a-z0-9_-]{0,47}"))throw new MaidBodyControl.Fault(400,"INVALID_spellId");}
            case "walk"->{
                if(input.has("dimension")&&!MaidBodyControl.string(input,"dimension").equals(maid.level().dimension().location().toString()))throw new MaidBodyControl.Fault(400,"DIMENSION_MISMATCH");
                target=new Vec3(number(input,"x"),number(input,"y"),number(input,"z"));
                if (socialTarget != null && !NativeMaidRendezvous.walkingNear(id, socialTarget,maid.getBukkitEntity().getLocation(),
                        new org.bukkit.Location(maid.getBukkitEntity().getWorld(),target.x,target.y,target.z)))
                    return blocked(owner,id,input,"team_target_moved_or_unavailable");
                if(maid.position().distanceTo(target)>96||target.y<maid.level().getMinBuildHeight()||target.y>=maid.level().getMaxBuildHeight())return blocked(owner,id,input,"walk_out_of_range");
                var pos=BlockPos.containing(target);if(!maid.level().hasChunkAt(pos))return blocked(owner,id,input,"destination_unloaded");
                if(!maid.level().getWorldBorder().isWithinBounds(pos)||!canWalkTo(maid,pos))return blocked(owner,id,input,"path_blocked");
            }
            case "equip"->{int slot=integer(input,"slot");String hand=MaidBodyControl.string(input,"hand");if(!Set.of("main","off","head","chest","legs","feet").contains(hand))throw new MaidBodyControl.Fault(400,"INVALID_hand");value=hand+" "+slot;
                try{plugin.nativeEquipmentValidate(maid,value);}catch(CompatibilityException refused){return blocked(owner,id,input,refused.code());}}
            case "fish"->{
                String reason = fishingContextBlock(maid, owner);
                if (reason == null) reason = MaidCompanionActions.boundedFishingBlock(maid);
                if (reason != null) return blocked(owner,id,input,reason);
            }
            case "task"->{value=MaidBodyControl.string(input,"taskId");var key=ResourceLocation.tryParse(value);if(key==null)throw new MaidBodyControl.Fault(400,"INVALID_taskId");
                var task=TaskManager.getTaskMap().get(key);if(task==null||!task.isEnable(maid))return blocked(owner,id,input,"task_requirements");}
            case "schedule"->{value=MaidBodyControl.string(input,"schedule");try{MaidSchedule.valueOf(value);}catch(IllegalArgumentException e){throw new MaidBodyControl.Fault(400,"INVALID_schedule");}}
            case "pickup"->{if(!input.has("enabled")||!input.get("enabled").isJsonPrimitive()||!input.getAsJsonPrimitive("enabled").isBoolean())throw new MaidBodyControl.Fault(400,"INVALID_enabled");}
            case "speak"->{value=MaidBodyControl.string(input,"text");if(value.isBlank()||value.codePointCount(0,value.length())>140||value.codePoints().anyMatch(x->Character.isISOControl(x)||x==0xA7))throw new MaidBodyControl.Fault(400,"INVALID_text");}
            case "ack"->{value=MaidBodyControl.string(input,"eventId");if(!value.matches("[A-Za-z0-9_:-]{1,128}"))throw new MaidBodyControl.Fault(400,"INVALID_eventId");}
        }
        if (action.equals("rendezvous")) {
            UUID targetId = MaidBodyControl.uuid(input, "targetUuid");
            if (!socialWalkAvailable(maid)) return blocked(owner,id,input,"maid_busy");
            control.reserve(owner,id,request,input);
            try {
                var result = NativeMaidRendezvous.cast(plugin, maid, targetId);
                boolean arrived = result.get("arrived").getAsBoolean();
                if (arrived) {
                    var rebound = plugin.ownedLoaded(owner,id);
                    plugin.nativeQuiesce(rebound);
                    restore(rebound);
                    if (!targetId.equals(owner)) anchor(rebound, rebound.blockPosition(), targetId);
                    guards.remove(id); companions.remove(id); resumeGuards.remove(id); follows.remove(id);
                    control.invalidateCallbacks(id);
                }
                return reply(arrived, control.finish(id, request, arrived ? "completed" : "rejected", result),
                        arrived ? null : result.get("reason").getAsString());
            } catch (Exception | LinkageError uncertain) {
                var info = new JsonObject();
                info.addProperty("reason", "rendezvous_unconfirmed_query_original");
                return reply(false, control.finish(id, request, "unknown", info), "rendezvous_unconfirmed_query_original");
            }
        }
        if (MaidBodyControl.BAG_ACTIONS.contains(action)) {
            if (!local.qdj.maids.brain.ResidentBodyAccess.external(id)) return blocked(owner,id,input,"resident_account_required");
            control.reserve(owner,id,request,input);
            try {
                var result = bagReceipt(id,request,input,true);
                boolean ok = result.get("status").getAsString().equals("completed");
                return reply(ok,result,ok ? null : result.get("observation").getAsJsonObject().get("reason").getAsString());
            } catch (Exception unknown) {
                var evidence=new JsonObject();evidence.addProperty("reason","inventory_transfer_unverified");
                return reply(false,control.finish(id,request,"unknown",evidence),"inventory_transfer_unverified");
            }
        }
        // The delegated native brain keeps its original history. External physical writes
        // must wait for that turn, then fence all older callbacks before touching the body.
        boolean resumeCompanion=companions.contains(id)&&Set.of("cast","equip","schedule","pickup","dismount").contains(action);
        boolean resumeGuard=guards.contains(id)&&Set.of("cast","equip","schedule","pickup","dismount","follow").contains(action);
        boolean beforeFishingGuard = guards.contains(id);
        if(physical&&companions.contains(id)&&!Set.of("stop","stay","sit").contains(action))try{plugin.nativeReady(owner,id);}catch(CompatibilityException busy){return blocked(owner,id,input,busy.code());}
        control.reserve(owner,id,request,input);
        try{
            if(action.equals("guard")&&guarding(id)&&!maid.isMaidInSittingPose()){
                var unchanged=new JsonObject();
                unchanged.addProperty("effectsApplied",false);
                unchanged.addProperty("meaning","native guard already active");
                unchanged.add("actualPosition",position(maid));
                return reply(true,control.finish(id,request,"applied",unchanged),null);
            }
            if(physical){
                if(fishing.containsKey(id))finishFishing(maid,id,"cancelled","mode_changed",null,false);
                if(walks.containsKey(id)&&action.equals("follow"))finishWalk(id,maid,"cancelled","mode_changed",false);
                if (!walks.containsKey(id) && selectedCompanion(maid) != null) restore(maid);
                plugin.nativeQuiesce(maid);companions.remove(id);guards.remove(id);resumeGuards.remove(id);control.invalidateCallbacks(id);
            }
            var observed=new JsonObject();observed.addProperty("effectsApplied",false);
            switch(action){
                case "dismount"->{
                    observed.addProperty("passengerBefore",maid.isPassenger());maid.stopRiding();
                    observed.addProperty("passengerAfter",maid.isPassenger());
                    if(maid.isPassenger())return reply(false,control.finish(id,request,"rejected",observed),"dismount_not_applied");
                    observed.addProperty("meaning","original body left its vehicle; no vehicle or inventory was removed");
                }
                case "walk"->{
                    restore(maid);
                    var pos=BlockPos.containing(target);
                    anchor(maid, pos, owner.equals(socialTarget) ? null : socialTarget);
                    long now=System.currentTimeMillis();
                    follows.remove(id);walks.put(id,new Walk(owner,request,target,maid.position(),maid.level().dimension().location().toString(),
                            now+30_000,now+120_000,maid.position().distanceTo(target),socialTarget));
                    BehaviorUtils.setWalkAndLookTargetMemories(maid,pos,walkSpeed(maid),0);observed.addProperty("effectsApplied",true);observed.addProperty("arrived",false);observed.add("actualPosition",position(maid));
                    return reply(true,control.finish(id,request,"running",observed),null);
                }
                case "stop","stay","sit"->{cancel(id,"stopped");stop(maid);maid.setInSittingPose(true);follows.remove(id);observed.addProperty("meaning","mode setting; native movement stopped");}
                case "follow"->{restore(maid);MaidCompanionActions.follow(maid);follows.add(id);observed.addProperty("meaning","follow mode set; arrival requires observation; offline owner cannot be followed");}
                case "guard"->{restore(maid);maid.setInSittingPose(false);guards.add(id);
                    if(local.qdj.maids.brain.ResidentBodyAccess.external(id))local.qdj.maids.brain.ResidentBodyAccess.externalGuard(id,true);
                    else{MaidCompanionActions.follow(maid);follows.add(id);}
                    observed.addProperty("meaning","native defensive execution enabled; dialogue remains with the unified controller; hits require observation");}
                case "fish"->{
                    maid.getPersistentData().putString(FISH_REQUEST,request);
                    maid.setTask(TaskManager.getTaskMap().get(TaskFishing.UID));
                    follows.remove(id);
                    fishing.put(id,new Fishing(owner,request,maid.level().dimension().location().toString(),
                            System.currentTimeMillis()+75_000,MaidCompanionActions.revision(maid),beforeFishingGuard));
                    observed.addProperty("phase","waiting_for_native_catch");
                    return reply(true,control.finish(id,request,"running",observed),null);
                }
                case "companion"->{restore(maid);MaidCompanionActions.follow(maid);follows.add(id);companions.add(id);observed.addProperty("meaning","Original native follow/guard and selected dialogue brain delegated under this controller; no goal completion or new memory scope");}
                case "cast"->{observed=plugin.nativeCast(maid,value,request);observed.add("actualPosition",position(maid));boolean applied=observed.has("effectsApplied")&&observed.get("effectsApplied").getAsBoolean();String state=observed.has("status")?observed.get("status").getAsString():"unknown";boolean pending=Set.of("accepted","pending","running").contains(state);boolean uncertain=state.equals("unknown");var result=reply(applied||pending,control.finish(id,request,pending?"running":uncertain?"unknown":applied?"applied":"rejected",observed),applied||pending?null:uncertain?"spell_result_unknown_query_original":"spell_not_applied");if(resumeCompanion)companions.add(id);if(resumeGuard){if(pending||uncertain)resumeGuards.put(id,request);else resumeGuard(maid);}return result;}
                case "task"->{restore(maid);maid.setTask(TaskManager.getTaskMap().get(ResourceLocation.parse(value)));maid.setInSittingPose(false);follows.remove(id);observed.addProperty("meaning","native task selected; work result requires observation");}
                case "equip"->observed=plugin.nativeEquip(maid,value);
                case "schedule"->maid.setSchedule(MaidSchedule.valueOf(value));
                case "pickup"->maid.setPickup(input.get("enabled").getAsBoolean());
                case "speak"->{
                    plugin.publishNativeSpeech(maid,request,value);
                    Set<UUID> audience=new HashSet<>();for(var player:maid.getBukkitEntity().getLocation().getNearbyPlayers(16))if(player.canSee(maid.getBukkitEntity())){player.sendMessage(net.kyori.adventure.text.Component.text("<"+maid.getName().getString()+"> "+value));audience.add(player.getUniqueId());}
                    if(!plugin.presentPublicSpeech(maid,request,value,audience.size()))maid.getChatBubbleManager().addTextChatBubble(value);
                    plugin.speakPublicReply(maid,request,value,audience);
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
            case "inventory"->{data=plugin.inventory(owner,id);data.addProperty("nextStep","Use equip hand=main|off|head|chest|legs|feet and slot from usableSlotIndexes. Only items already in this maid's native inventory can be equipped; Use bag_store, bag_clean or bag_donate for your own surplus; dryRun=true previews.");}
            case "tasks"->data=plugin.catalog(owner,id);
            case "brain"->{var context=plugin.context(owner,null,id);data=context.has("brain")?context.getAsJsonObject("brain"):new JsonObject();}
            case "inbox"->data=plugin.nativeInbox(owner,id);
            case "workshop"->{plugin.owned(owner,id);data=plugin.workshops().describe(id,owner);}
            case "spells"->{if(local.qdj.maids.brain.ResidentBodyAccess.external(id)){data=JsonParser.parseString(local.qdj.maids.brain.ResidentBodyAccess.rpg(id)).getAsJsonObject();data.addProperty("stateSource","native_resident_vortex");data.addProperty("residentRpgAccount",true);}
                else{var scene=plugin.companionScene(plugin.ownedLoaded(owner,id));data=scene.has("rpg")?scene.getAsJsonObject("rpg").deepCopy():new JsonObject();data.addProperty("stateSource","original_private_companion_magic");data.addProperty("residentRpgAccount",false);}}
            case "receipt"->data=receipt(owner,id,MaidBodyControl.request(input,"operationId"));
            default->throw new MaidBodyControl.Fault(400,"UNSUPPORTED_ACTION");
        }
        data.addProperty("maidId",id.toString());data.addProperty("ownerId",owner.toString());data.addProperty("sampledAt",java.time.Instant.now().toString());
        if(action.equals("context")){data.addProperty("nativeGuardDelegated",guarding(id));
            var loaded=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
            if(loaded!=null){data.addProperty("passenger",loaded.isPassenger());if(loaded.getVehicle()!=null)data.addProperty("vehicleType",net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(loaded.getVehicle().getType()).toString());}
            if(local.qdj.maids.brain.ResidentBodyAccess.external(id))data.add("resident",JsonParser.parseString(local.qdj.maids.brain.ResidentBodyAccess.status(id)));
            else if(data.get("loaded").getAsBoolean())data.add("scene",plugin.companionScene(loaded));}
        if(action.equals("context")){
            data.addProperty("physicalController","native_body");
            data.addProperty("nativeCompanionDelegated",companion(id));
            if(plugin.unifiedBody(id))data.addProperty("inferenceOwner","unified_npc_host");
            var maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
            data.addProperty("socialWalkAvailable", maid != null && socialWalkAvailable(maid));
            if(maid!=null){
                UUID selected = selectedCompanion(maid);
                data.addProperty("socialNavigationTargetUuid", selected == null ? "" : selected.toString());
                data.add("nearbyPlayers", nearbyPlayers(maid));
                NativeMaidRendezvous.describe(id, data);
                var fishingState=data.has("fishing") ? data.getAsJsonObject("fishing") : MaidCompanionActions.fishing(maid);
                String block = busy(id) || plugin.workshops().busy(id) || plugin.editingMaidInventory(maid)
                        ? "maid_busy" : fishingContextBlock(maid,owner);
                if(block==null)block=MaidCompanionActions.boundedFishingBlock(maid);
                fishingState.addProperty("canStartNativeCatch",block==null);
                if(block!=null)fishingState.addProperty("nextCondition",block);
                data.add("fishing",fishingState);
            }
            var caps=new JsonArray();
            MaidBodyControl.READS.stream().sorted().forEach(caps::add);
            MaidBodyControl.WRITES.stream().sorted().forEach(caps::add);
            data.add("capabilities",caps);
            if(data.has("brain"))externalBrain(data.getAsJsonObject("brain"),id);
        }
        if(action.equals("brain"))externalBrain(data,id);
        return reply(true,data,null);
    }
    private boolean socialWalkAvailable(EntityMaid maid) {
        UUID id = maid.getUUID();
        String task = maid.getTask().getUid().toString();
        return maid.isAlive() && !maid.isRemoved() && !maid.isSleeping() && !maid.isMaidInSittingPose()
                && !maid.isPassenger() && !maid.isVehicle() && !maid.isNoAi() && maid.canBrainMoving()
                && (maid.getTarget() == null || !maid.getTarget().isAlive())
                && (MaidCompanionActions.IDLE.equals(task) || task.equals(maid.getPersistentData().getString("qiandengji_auto_defence_task")))
                && !busy(id) && !plugin.workshops().busy(id) && !plugin.editingMaidInventory(maid);
    }

    private static Predicate<Player> participantFilter(HybridMaidPlugin plugin) {
        var agentFriend = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (agentFriend == null) return player -> true;
        // The game owns the changing Eye registrations and photo service identity.
        try {
            var observer = agentFriend.getClass().getDeclaredMethod("isObserver", Player.class);
            if (observer.trySetAccessible()) return player -> {
                try { return !Boolean.TRUE.equals(observer.invoke(agentFriend, player)); }
                catch (ReflectiveOperationException unavailable) { return false; }
            };
        } catch (ReflectiveOperationException unavailable) {
            plugin.getLogger().warning("AgentFriend observer roster unavailable for social navigation");
        }
        return player -> false;
    }

    private JsonArray nearbyPlayers(EntityMaid maid) {
        double range = 24;
        var result = new JsonArray();
        var players = maid.level().getEntitiesOfClass(ServerPlayer.class, maid.getBoundingBox().inflate(range),
                player -> player.isAlive() && !player.isSpectator() && !player.isInvisible()
                        && maid.distanceToSqr(player) <= range * range && player.getBukkitEntity().isVisibleByDefault()
                        && player.getBukkitEntity().getMetadata("vanished").stream().noneMatch(value -> value.asBoolean())
                        && socialParticipant.test(player.getBukkitEntity()));
        players.stream().sorted(Comparator.comparingDouble(maid::distanceToSqr))
                .filter(maid::hasLineOfSight).limit(16).forEach(player -> {
                    var row = new JsonObject();
                    row.addProperty("uuid", player.getStringUUID());
                    row.addProperty("name", player.getGameProfile().getName());
                    row.addProperty("dimension", maid.level().dimension().location().toString());
                    var position = new JsonObject();
                    position.addProperty("x", player.getX());
                    position.addProperty("y", player.getY());
                    position.addProperty("z", player.getZ());
                    row.add("position", position);
                    result.add(row);
                });
        return result;
    }

    private void externalBrain(JsonObject brain,UUID id){
        boolean unified=plugin.unifiedBody(id);
        brain.addProperty("physicalController","native_body");
        brain.addProperty("readOnly",true);
        brain.addProperty("originalDialogueControllerActive",!unified&&companion(id));
        brain.addProperty("memoryOwner",unified?"unified_character_store":"original_tlm");
        if(unified)brain.addProperty("conversationOwner","unified_npc_host");
        brain.addProperty("meaning",unified?"Unified NPC controller owns decisions and character memory. Original native history is retained read-only for migration; native task execution is separate from a model loop.":companion(id)?"Original selected brain/history and native companion behaviours are delegated by this lease. No shadow dialogue model or new memory scope.":"Original configured brain selection is retained; dialogue queues in inbox while exclusive control is active. Brain choice cannot be changed on this port.");
    }
    private JsonObject bagReceipt(UUID id,String request,JsonObject args,boolean submit) throws Exception {
        String action=args.get("action").getAsString().substring("bag_".length());
        boolean preview=args.has("dryRun")&&args.get("dryRun").getAsBoolean();
        UUID key=UUID.nameUUIDFromBytes(("unified-bag:"+id+":"+request).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        var af=Bukkit.getPluginManager().getPlugin("AgentFriend");
        if(af==null||!af.isEnabled())throw new IllegalStateException("inventory_service_unavailable");
        var service=af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentCli");
        var raw=submit ? service.getMethod("run",UUID.class,UUID.class,String.class).invoke(null,id,key,"inventory "+action+(preview?" --dry-run":""))
                :service.getMethod("query",UUID.class,UUID.class).invoke(null,id,key);
        var serviceResult=JsonParser.parseString((String)raw).getAsJsonObject();
        var entry=serviceResult.getAsJsonObject("serviceReceipt");var evidence=new JsonObject();
        evidence.addProperty("serviceRequestId",key.toString());evidence.addProperty("reason","inventory_transfer_unverified");
        String status="unknown";
        if(entry!=null && entry.has("action") && entry.has("playerUuid") && action.equals(entry.get("action").getAsString())
                && id.toString().equals(entry.get("playerUuid").getAsString())){
            evidence.add("inventoryReceipt",entry);evidence.addProperty("reason",entry.get("reason").getAsString());
            if(serviceResult.get("status").getAsString().equals("completed")&&entry.get("success").getAsBoolean()
                    && entry.has("dryRun")&&entry.get("dryRun").getAsBoolean()==preview){
                status="completed";
                evidence.addProperty("allHandled",!preview && Set.of("completed","unchanged","nothing_to_move").contains(entry.get("reason").getAsString()));
                evidence.addProperty("effectsApplied",!preview && (entry.has("moved")?entry.get("moved").getAsInt()>0:entry.get("changed").getAsBoolean()));
            } else if(serviceResult.get("status").getAsString().equals("blocked")) status="rejected";
        }
        return control.finish(id,request,status,evidence);
    }
    JsonObject receipt(UUID owner,UUID id,String request)throws Exception {
        var value=control.read(id,request);
        if(value==null){value=plugin.nativeLegacyReceipt(owner,id,request);if(value==null)throw new CompatibilityException("receipt_missing","Query the original namespace; never replay");
            if(NativeMaidWorkshop.ACTION.equals(value.get("action").getAsString()))value=plugin.workshops().reconcile(value);
            value=value.deepCopy();value.addProperty("namespace","legacy");value.addProperty("operationId",request);value.addProperty("ownerId",owner.toString());return value;}
        if(MaidBodyControl.BAG_ACTIONS.contains(value.get("action").getAsString())&&Set.of("accepted","unknown").contains(value.get("status").getAsString())){
            var input=JsonParser.parseString(value.get("arguments").getAsString()).getAsJsonObject();
            return bagReceipt(id,request,input,false);
        }
        if("cast".equals(value.get("action").getAsString())&&Set.of("accepted","running","unknown").contains(value.get("status").getAsString())&&local.qdj.maids.brain.ResidentBodyAccess.external(id)){
            var original=JsonParser.parseString(local.qdj.maids.brain.ResidentBodyAccess.castReceipt(id,request)).getAsJsonObject();
            String state=original.has("status")?original.get("status").getAsString():"unknown";
            if(state.equals("completed")||Set.of("blocked","rejected","cancelled","failed").contains(state)){
                original.addProperty("effectsApplied",state.equals("completed"));var result=control.finish(id,request,state.equals("completed")?"applied":"rejected",original);
                if(request.equals(resumeGuards.get(id))&&control.active(id)){var body=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));if(body!=null)resumeGuard(body);}return result;
            }
            if(Set.of("accepted","pending","running").contains(state))return control.finish(id,request,"running",original);
        }
        boolean inProgress = walks.containsKey(id)&&walks.get(id).request.equals(request)
                || fishing.containsKey(id)&&fishing.get(id).request.equals(request);
        if(Set.of("accepted","running").contains(value.get("status").getAsString())&&!inProgress){
            var reason=new JsonObject();reason.addProperty("reason","restart_or_execution_interrupted_query_original_request");value=control.finish(id,request,"unknown",reason);
        }
        return value;
    }
    void tick(){
        tickFishing();
        if(++receiptTick%10==0)for(var id:new ArrayList<>(resumeGuards.keySet()))try{var body=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));if(body!=null&&control.active(id))receipt(body.getOwnerUUID(),id,resumeGuards.get(id));}catch(Exception ignored){/* Original request remains unresolved; do not resume work. */}
        for(var id:new ArrayList<>(walks.keySet())){
            var walk=walks.get(id);EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));String failure=null;
            if(maid==null||!maid.isAlive()||maid.isRemoved())failure="body_unavailable";
            else if(!walk.owner.equals(maid.getOwnerUUID()))failure="owner_changed";
            else if(!control.active(id))failure="control_changed";
            else if(!walk.dimension.equals(maid.level().dimension().location().toString()))failure="dimension_changed";
            else if(plugin.editingMaidInventory(maid))failure="inventory_opened";
            long now=System.currentTimeMillis();
            double remaining=failure==null ? maid.position().distanceTo(walk.target) : Double.POSITIVE_INFINITY;
            boolean arrived=failure==null&&remaining<=.9;
            if(failure==null&&!arrived){
                var progress=walk.progress(remaining,now);
                if(progress!=walk){walk=progress;walks.put(id,walk);}
                if(now>walk.until)failure="walk_timeout";
            }
            try{
                if(failure==null && walk.character!=null && (arrived || receiptTick%10==0)) {
                    var world=maid.getBukkitEntity().getWorld();
                    var from=new org.bukkit.Location(world, walk.start.x, walk.start.y, walk.start.z);
                    var to=new org.bukkit.Location(world, walk.target.x, walk.target.y, walk.target.z);
                    if(!NativeMaidRendezvous.walkingNear(id,walk.character,from,to)) {
                        finishWalk(id,maid,"cancelled","team_target_moved_or_unavailable",false);
                        continue;
                    }
                }
                if(failure!=null||arrived){finishWalk(id,maid,arrived?"completed":"failed",failure==null?"arrived":failure,arrived);continue;}
                var goal=BlockPos.containing(walk.target);
                var navigation=maid.getNavigation();
                var memory=maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET).orElse(null);
                // The idle AI can overwrite any issued walk, including a walk with no companion target.
                // Hold the verified path until its receipt settles and the previous schedule is restored.
                int radius = (int)Math.ceil(remaining) + 4;
                if (maid.getRestrictRadius() < radius) maid.restrictTo(goal, radius);
                float speed = walkSpeed(maid);
                if (memory == null || !goal.equals(memory.getTarget().currentBlockPosition()) || memory.getSpeedModifier() != speed)
                    BehaviorUtils.setWalkAndLookTargetMemories(maid, goal, speed, 0);
                var path = navigation.getPath();
                if (navigation.isDone() || path == null || !goal.equals(path.getTarget())) {
                    var next = navigation.createPath(goal, 0);
                    if (next != null && next.canReach()) navigation.moveTo(next, speed);
                }
            }catch(Exception error){walks.remove(id);if(maid!=null){stop(maid);restore(maid);}plugin.getLogger().warning("Native body walk result uncertain; query original request");}
        }
        // Recover only our temporary navigation anchor after a normal or abnormal server restart.
        for(var id:control.ids())if(!walks.containsKey(id)){var maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));if(maid!=null&&maid.getPersistentData().contains(ANCHOR)&&(!control.active(id)||selectedCompanion(maid)==null)){stop(maid);restore(maid);}}
    }

    private String fishingContextBlock(EntityMaid maid, UUID owner) {
        var partner = Bukkit.getPlayer(owner);
        if (partner == null || !partner.isOnline() || partner.isDead()
                || !partner.getWorld().equals(maid.getBukkitEntity().getWorld())) return "fishing_partner_unavailable";
        double radius = NativeMaidFollowSupport.limits(maid).walkBeyond();
        if (partner.getLocation().distanceSquared(maid.getBukkitEntity().getLocation()) > radius * radius)
            return "fishing_partner_leaving";
        if (plugin.companionVisibleThreat(maid, partner) != null || plugin.companionPartnerThreat(maid, partner))
            return "fishing_threat_nearby";
        return null;
    }

    void caught(EntityMaid maid, JsonArray loot) {
        UUID id = maid.getUUID();
        if (loot.isEmpty() || !fishing.containsKey(id)) return;
        try { finishFishing(maid,id,"completed","native_catch",loot,true); }
        catch (Exception error) { plugin.getLogger().warning("Native catch receipt uncertain; query the original request"); }
    }

    private void tickFishing() {
        if (receiptTick % 10 != 0) return;
        for (UUID id : control.ids()) {
            var job = fishing.get(id);
            var maid = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
            if (job == null) {
                if (maid != null && maid.getPersistentData().contains(FISH_REQUEST)) clearFishing(maid);
                continue;
            }
            String reason = null;
            if (maid == null || !maid.isAlive() || maid.isRemoved()) reason = "body_unavailable";
            else if (!control.active(id) || !job.owner.equals(maid.getOwnerUUID())) reason = "control_changed";
            else if (!job.dimension.equals(maid.level().dimension().location().toString())) reason = "dimension_changed";
            else if (MaidCompanionActions.revision(maid) != job.revision || !(maid.getTask() instanceof TaskFishing)
                    || plugin.editingMaidInventory(maid) || !MaidCompanionActions.fishingRod(maid)) reason = "fishing_context_changed";
            else if (System.currentTimeMillis() > job.until) reason = "catch_timeout";
            else reason = fishingContextBlock(maid, job.owner);
            if (reason != null) {
                try { finishFishing(maid,id,"cancelled",reason,null,true); }
                catch (Exception error) { plugin.getLogger().warning("Native fishing stop receipt uncertain; query the original request"); }
            }
        }
    }

    private void finishFishing(EntityMaid maid, UUID id, String status, String reason, JsonArray loot, boolean resume)
            throws Exception {
        Fishing job = fishing.remove(id);
        if (job == null) return;
        var observed = new JsonObject();
        observed.addProperty("reason", reason);
        observed.addProperty("verifiedCatch", loot != null);
        if (loot != null) {
            observed.addProperty("effectsApplied", true);
            observed.add("nativeLoot", loot);
        }
        if (maid != null && maid.getPersistentData().getString(FISH_REQUEST).equals(job.request)) {
            boolean originalTask = MaidCompanionActions.revision(maid) == job.revision
                    && maid.isAlive() && maid.getTask() instanceof TaskFishing;
            if (originalTask) {
                clearFishing(maid);
                if (resume && job.guard) resumeGuard(maid);
                if (resume && control.active(id)) follows.add(id);
            } else maid.getPersistentData().remove(FISH_REQUEST);
            observed.add("actualPosition", position(maid));
        }
        control.finish(id, job.request, status, observed);
    }

    private static void clearFishing(EntityMaid maid) {
        maid.getPersistentData().remove(FISH_REQUEST);
        if (!(maid.getTask() instanceof TaskFishing)) return;
        if (maid.fishing != null && maid.fishing.getMaidOwner() == maid) maid.fishing.discard();
        MaidCompanionActions.follow(maid);
    }
    private void resumeGuard(EntityMaid maid){var id=maid.getUUID();resumeGuards.remove(id);if(!control.active(id)||!maid.isAlive())return;guards.add(id);if(local.qdj.maids.brain.ResidentBodyAccess.external(id))local.qdj.maids.brain.ResidentBodyAccess.externalGuard(id,true);else{MaidCompanionActions.follow(maid);follows.add(id);}}
    void cancel(UUID id,String reason)throws Exception {var maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));companions.remove(id);guards.remove(id);resumeGuards.remove(id);if(fishing.containsKey(id))finishFishing(maid,id,"cancelled",reason,null,false);if(maid!=null)plugin.nativeQuiesce(maid);if(walks.containsKey(id))finishWalk(id,maid,"cancelled",reason,false);else if(maid!=null){stop(maid);restore(maid);}follows.remove(id);}
    private void finishWalk(UUID id,EntityMaid maid,String status,String reason,boolean arrived)throws Exception {
        var walk=walks.remove(id);var observed=new JsonObject();observed.addProperty("reason",reason);observed.addProperty("arrived",arrived);
        if(maid!=null){stop(maid);if(!arrived||!control.active(id)||selectedCompanion(maid)==null)restore(maid);else maid.getSchedulePos().restrictTo(maid);observed.add("actualPosition",position(maid));observed.addProperty("distanceMoved",maid.position().distanceTo(walk.start));observed.addProperty("remainingDistance",maid.position().distanceTo(walk.target));}
        control.finish(id,walk.request,status,observed);
    }
    private static void stop(EntityMaid maid){maid.getNavigation().stop();maid.setTarget(null);maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);maid.getBrain().eraseMemory(MemoryModuleType.PATH);maid.getBrain().eraseMemory(MemoryModuleType.ATTACK_TARGET);}
    private static UUID selectedCompanion(EntityMaid maid) {
        var saved = maid.getPersistentData().getCompound(ANCHOR);
        return saved.hasUUID("companion") ? saved.getUUID("companion") : null;
    }
    private static float walkSpeed(EntityMaid maid) {
        // Resident bodies have different base speeds. The native controller multiplies
        // this navigation input by the full attribute, including all real status effects.
        var attribute=maid.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.MOVEMENT_SPEED);
        double base=attribute==null ? 0 : attribute.getBaseValue();
        // Match the effective input of the original companion's native owner follow.
        return base>0 ? (float)Math.clamp(.35/base, .35, 4) : .7f;
    }
    private static boolean canWalkTo(EntityMaid maid, BlockPos pos) {
        boolean held = selectedCompanion(maid) != null && maid.isHomeModeEnable();
        BlockPos previousCenter = maid.getRestrictCenter();
        int previousRadius = (int) maid.getRestrictRadius();
        try {
            if (held) {
                maid.setHomeModeEnable(false);
                maid.restrictTo(BlockPos.ZERO, com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig.MAID_NON_HOME_RANGE.get());
            }
            var path = maid.getNavigation().createPath(pos,0);
            return maid.getNavigation().isStableDestination(pos) && path != null && path.canReach();
        } finally {
            if (held) {
                maid.setHomeModeEnable(true);
                maid.restrictTo(previousCenter, previousRadius);
            }
        }
    }
    private static void anchor(EntityMaid maid, BlockPos pos, UUID companion) {
        var saved=new CompoundTag();
        var schedule=maid.getSchedulePos();
        schedule.save(saved);
        saved.putBoolean("bodyHome",maid.isHomeModeEnable());
        saved.putBoolean("bodySitting",maid.isMaidInSittingPose());
        saved.putString("bodySchedule",maid.getSchedule().name());
        saved.putString("bodyTask",maid.getTask().getUid().toString());
        if (companion != null) saved.putUUID("companion",companion);
        maid.getPersistentData().put(ANCHOR,saved);
        stop(maid);
        maid.setHomeModeEnable(true);maid.setInSittingPose(false);
        maid.setSchedule(MaidSchedule.ALL);maid.setTask(TaskManager.getIdleTask());
        schedule.setDimension(maid.level().dimension().location());
        schedule.setWorkPos(pos);schedule.setIdlePos(pos);schedule.setSleepPos(pos);
        schedule.setConfigured(true);schedule.restrictTo(maid);
    }
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
