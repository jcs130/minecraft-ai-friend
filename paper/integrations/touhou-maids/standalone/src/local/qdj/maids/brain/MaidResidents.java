package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.behavior.BehaviorUtils;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;

/** Low-frequency decisions over native pathfinding, work and sleep. No connected fake clients. */
final class MaidResidents {
    private record Job(UUID id,JsonObject input,BlockPos target,long deadline,long readyAt,String dimension,long revision,boolean sitting,
        net.minecraft.world.item.ItemStack item,net.minecraft.world.level.block.state.BlockState block) {}
    private record Thinking(UUID id,long deadline,long revision) {}
    private final MinecraftServer server;
    private final MaidAgentsServer agents;
    private final ResidentConfig config;
    private final ResidentReceipts receipts;
    private final ResidentState state;
    final ResidentSettings settings;
    private final Map<UUID,ResidentConfig.Resident> roles=new LinkedHashMap<>();
    private final Map<UUID,Job> jobs=new java.util.HashMap<>();
    private final Map<UUID,Thinking> thinking=new java.util.HashMap<>();
    private final Map<UUID,Long> nextPlan=new java.util.HashMap<>();
    private final Map<UUID,Map<String,Object>> latest=new java.util.HashMap<>();
    private final Map<UUID,Long> lastPublic=new java.util.HashMap<>();
    private static final String ACTIVE="tlm_resident_active_request";
    private static final String INSTALLED="tlm_resident_home_installed";
    private static final net.minecraft.server.level.TicketType<UUID> TICKET=net.minecraft.server.level.TicketType.create(
        "tlm_resident",java.util.Comparator.comparing(UUID::toString),60);
    MaidResidents(MinecraftServer server,MaidAgentsServer agents,Path dir) throws Exception {
        this.server=server;this.agents=agents;config=ResidentConfig.read(dir.resolve("tlm-residents.json"),agents);
        receipts=new ResidentReceipts(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-actions"));
        state=new ResidentState(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-state"));
        for(var r:config.residents()){
            var last=state.load(r.maidId());
            if(last!=null&&last.pending()!=null){var terminal=receipts.read(r.maidId(),last.pending());
                if(terminal!=null&&List.of("completed","blocked","rejected","partial","cancelled","timeout").contains(terminal.get("status")))state.finish(r.maidId(),last.pending());}
        }
        config.residents().forEach(r->{roles.put(r.maidId(),r);nextPlan.put(r.maidId(),System.currentTimeMillis()+30_000+roles.size()*10_000L);});
        settings=new ResidentSettings(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-settings"),dir,this,agents);
    }
    ResidentConfig.Resident role(UUID id) { return roles.get(id); }
    List<UUID> ids() { return List.copyOf(roles.keySet()); }
    boolean busy(UUID id) { return jobs.containsKey(id)||thinking.containsKey(id); }
    EntityMaid body(UUID id) { var a=agents.agent(id);return a==null?null:agents.loaded(a); }
    private boolean leased(UUID id) { return agents.companions()!=null&&agents.companions().reserved(id); }
    Map<String,Object> observe(UUID id) {
        var r=require(id);var maid=body(id);var row=new LinkedHashMap<String,Object>();
        row.put("maidId",id.toString());row.put("name",settings.name(id));row.put("profession",r.profession());row.put("home",r.home());
        row.put("loaded",maid!=null);row.put("observedAt",java.time.Instant.now().toString());row.put("usesPlayerSlot",false);
        if(maid!=null) {
            row.put("position",ResidentActions.point(maid.blockPosition()));row.put("dimension",maid.level().dimension().location().toString());
            row.put("health",maid.getHealth());row.put("sleeping",maid.isSleeping());row.put("task",maid.getTask().getUid().toString());
            row.put("appearance",Map.of("ysm",maid.isYsmModel(),"modelId",maid.getYsmModelId(),"texture",maid.getYsmModelTexture()));
            row.put("rpg",ResidentRpg.observe(maid,r.profession()));row.put("inventory",agents.agent(id).observation(maid));
            row.put("homeInstalled",maid.getPersistentData().getBoolean(INSTALLED));
            String pending=maid.getPersistentData().getString(ACTIVE);
            row.put("activeRequest",pending.isBlank()?"none":pending);
            if(!pending.isBlank()&&!jobs.containsKey(id)) row.put("recovery","unknown_no_replay_query_original_request");
        }
        row.put("leased",leased(id));row.put("thinking",thinking.containsKey(id));
        if(latest.containsKey(id)) row.put("lastReceipt",latest.get(id));
        return row;
    }
    Map<String,Object> publicView(UUID id) {
        var r=require(id);var maid=body(id);var row=new LinkedHashMap<String,Object>();
        row.put("maidId",id.toString());row.put("name",settings.name(id));row.put("profession",r.profession());
        row.put("available",maid!=null&&!leased(id));row.put("usesPlayerSlot",false);
        row.put("homeDoor",r.home().door());row.put("homeDimension",r.home().dimension());
        return row;
    }
    Map<String,Object> mapPositions() {
        var out=new ArrayList<Map<String,Object>>();
        for(var id:ids()) {var maid=body(id);if(maid==null||!maid.isAlive()||maid.isInvisible()||!settings.flag(id,"mapVisible"))continue;
            out.add(Map.of("uuid",id.toString(),"name",maid.getName().getString(),"kind","npc","profession",role(id).profession(),
                "dimension",maid.level().dimension().location().toString(),"x",maid.getX(),"y",maid.getY(),"z",maid.getZ(),"yaw",maid.getYRot(),"pitch",maid.getXRot()));}
        return Map.of("schemaVersion",1,"observedAt",java.time.Instant.now().toString(),"npcs",out);
    }
    private ResidentConfig.Resident require(UUID id) {var r=roles.get(id);if(r==null)throw new IllegalArgumentException("unknown_resident");return r;}
    Map<String,Object> appearance(UUID id) throws Exception {
        var r=require(id);var maid=body(id);if(maid==null||busy(id)||leased(id))throw new IllegalArgumentException("body_unavailable_or_busy");
        return ResidentAppearance.apply(maid,r);
    }
    Map<String,Object> home(UUID id,boolean apply,UUID requestId) throws Exception {
        var r=require(id);var maid=body(id);
        if(maid==null)throw new IllegalArgumentException("resident_body_not_loaded");
        if(!maid.level().dimension().location().toString().equals(r.home().dimension()))throw new IllegalArgumentException("resident_not_in_home_dimension");
        var level=(ServerLevel)maid.level();
        if(!apply)return ResidentHomes.inspect(level,r);
        var old=receipts.read(id,requestId);if(old!=null)return reconcile(old);
        if(leased(id)||busy(id))throw new IllegalArgumentException("body_busy_or_recruited");
        if(!maid.getPersistentData().getString(ACTIVE).isBlank()||state.load(id)!=null&&state.load(id).pending()!=null)
            throw new IllegalArgumentException("unknown_previous_action_read_original_request");
        if(maid.getPersistentData().getBoolean(INSTALLED))throw new IllegalArgumentException("home_already_installed");
        var before=ResidentHomes.inspect(level,r);
        if(!"ready".equals(before.get("status")))return before;
        var row=base(id,requestId,"furnish");row.put("status","accepted");row.put("plan",before);
        receipts.write(id,requestId,row);state.locate(id,maid.level().dimension().location().toString(),maid.chunkPosition().x,maid.chunkPosition().z);state.begin(id,requestId);maid.getPersistentData().putString(ACTIVE,requestId.toString());
        try {ResidentHomes.furnish(level,r);ResidentHomes.bind(maid,r);maid.getPersistentData().putBoolean(INSTALLED,true);
            row.put("status","completed");row.put("completed",true);row.put("reason","furniture_sign_and_native_home_verified");}
        catch(Exception error){row.put("status","unknown");row.put("completed",false);row.put("reason","inspect_original_home_plan_before_retry");}
        receipts.write(id,requestId,row);
        if("completed".equals(row.get("status"))){state.finish(id,requestId);maid.getPersistentData().remove(ACTIVE);}
        latest.put(id,row);return row;
    }
    Map<String,Object> receipt(UUID id,UUID request) throws Exception {
        require(id);var row=receipts.read(id,request);
        if(row!=null&&"cli".equals(row.get("action"))&&!jobs.containsKey(id)&&List.of("accepted","unknown").contains(row.get("status"))){
            var service=ResidentServices.query(id,request);
            if(List.of("completed","blocked","rejected").contains(service.get("status"))){
                row.putAll(service);row.put("observedAt",java.time.Instant.now().toString());receipts.write(id,request,row);
                var current=state.load(id);if(current!=null&&request.equals(current.pending())){state.finish(id,request);var maid=body(id);if(maid!=null)maid.getPersistentData().remove(ACTIVE);}
                latest.put(id,row);
            }
        }
        if(row==null){
            var plan=thinking.get(id);
            if(plan!=null&&plan.id().equals(request))return Map.of("status","accepted","reason","planning_no_action_dispatched","requestId",request.toString(),"completed",false);
            var last=latest.get(id);
            if(last!=null&&request.toString().equals(last.get("requestId")))return last;
        }
        return row==null?Map.of("status","unknown","reason","request_not_recorded","requestId",request.toString()):
            jobs.containsKey(id)&&jobs.get(id).id().equals(request)?row:reconcile(row);
    }
    private static Map<String,Object> reconcile(Map<String,Object> old) {
        if("accepted".equals(old.get("status"))) {old.put("status","unknown");old.put("reason","interrupted_read_actual_world_do_not_replay");old.put("completed",false);}
        return old;
    }
    /** An operator acknowledges uncertainty after inspecting the original request; history never becomes a fake success. */
    Map<String,Object> acknowledgeUnknown(UUID id,UUID request,String note) throws Exception {
        require(id);var maid=body(id);if(maid==null||busy(id)||leased(id))throw new IllegalArgumentException("body_unavailable_or_busy");
        if(!ResidentConfig.text(note,300))throw new IllegalArgumentException("note: one line up to 300 characters required");
        var prior=state.load(id);if(prior==null||!request.equals(prior.pending()))throw new IllegalArgumentException("pending_request_mismatch");
        var row=receipts.read(id,request);if(row==null)throw new IllegalArgumentException("original_receipt_unavailable");
        if(!List.of("accepted","unknown").contains(row.get("status")))throw new IllegalArgumentException("request_not_unknown");
        var result=new LinkedHashMap<String,Object>();result.put("schemaVersion",1);result.put("maidId",id.toString());
        result.put("requestId",request.toString());result.put("status","acknowledged_unknown");result.put("completed",false);
        result.put("reason","operator_inspected_world_old_action_not_replayed");result.put("note",note);result.put("observedAt",java.time.Instant.now().toString());
        result.put("actual",observe(id));
        ResidentReceipts.replace(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-reconciliations").resolve(id+"/"+request+".json"),result);
        maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        state.finish(id,request);maid.getPersistentData().remove(ACTIVE);nextPlan.put(id,System.currentTimeMillis()+config.planningSeconds()*1000L);
        return result;
    }
    Map<String,Object> submit(UUID id,UUID request,JsonObject input) throws Exception {
        var r=require(id);var old=receipts.read(id,request);if(old!=null){
            if(old.containsKey("input")&&!JsonParser.parseString(new Gson().toJson(old.get("input"))).equals(input))throw new IllegalArgumentException("request_id_conflict");
            return receipt(id,request);
        }
        var maid=body(id);String action="";
        var row=base(id,request,action);
        row.put("input",input);
        try {
            action=ResidentContract.validate(input);row.put("action",action);
            if(maid==null||maid.isNoAi()||maid.guiOpening)throw new IllegalArgumentException("body_unavailable");
            if(leased(id)&&!action.equals("cli")||jobs.containsKey(id)||thinking.containsKey(id))throw new IllegalArgumentException("body_busy_or_recruited");
            if(!maid.getPersistentData().getString(ACTIVE).isBlank())throw new IllegalArgumentException("unknown_previous_action_read_original_request");
            if(state.load(id)!=null&&state.load(id).pending()!=null)throw new IllegalArgumentException("unknown_previous_action_read_original_request:"+state.load(id).pending());
            if(!List.of("walk","home","task","equip","break","place","cast","say","rest","cli").contains(action))throw new IllegalArgumentException("unsupported_resident_action");
            BlockPos target=action.equals("home")?r.home().door().pos():action.equals("walk")||action.equals("break")||action.equals("place")?ResidentActions.position(input,"at"):maid.blockPosition();
            if(!maid.level().hasChunkAt(target)||maid.blockPosition().distSqr(target)>96*96)throw new IllegalArgumentException("target_unloaded_or_more_than_96_blocks");
            if(!action.equals("cli")&&!maid.level().dimension().location().toString().equals(r.home().dimension()))throw new IllegalArgumentException("wrong_dimension");
            if(action.equals("break")||action.equals("place"))ResidentActions.check(maid,r,target);
            long now=System.currentTimeMillis();long duration=action.equals("break")?ResidentActions.miningMillis(maid,target):0;
            var item=ResidentActions.stack(maid,input).copy();var block=maid.level().getBlockState(target);
            row.put("status","accepted");row.put("input",input);row.put("before",ResidentActions.point(maid.blockPosition()));
            receipts.write(id,request,row);state.locate(id,maid.level().dimension().location().toString(),maid.chunkPosition().x,maid.chunkPosition().z);state.begin(id,request);maid.getPersistentData().putString(ACTIVE,request.toString());
            jobs.put(id,new Job(request,input.deepCopy(),target,now+(action.equals("cli")?240_000:90_000),now+duration,maid.level().dimension().location().toString(),agents.agent(id).revision(),maid.isMaidInSittingPose(),item,block));
            if(action.equals("break")||action.equals("place")){maid.setInSittingPose(true);maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
            if(action.equals("walk")||action.equals("home")){maid.setInSittingPose(false);BehaviorUtils.setWalkAndLookTargetMemories(maid,target,.7f,1);}
        }catch(IllegalArgumentException invalid){row.put("status","rejected");row.put("reason",invalid.getMessage());receipts.write(id,request,row);}
        latest.put(id,row);return row;
    }
    private static LinkedHashMap<String,Object> base(UUID maid,UUID id,String action){var r=new LinkedHashMap<String,Object>();r.put("schemaVersion",1);r.put("maidId",maid.toString());r.put("requestId",id.toString());r.put("action",action);r.put("observedAt",java.time.Instant.now().toString());r.put("completed",false);r.put("retryable",false);return r;}
    void tick() {
        long now=System.currentTimeMillis();
        for(var r:roles.values()) {
            var id=r.maidId();
            var homeLevel=server.getLevel(net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION,ResourceLocation.parse(r.home().dimension())));
            if(homeLevel!=null)homeLevel.getChunkSource().addRegionTicket(TICKET,new net.minecraft.world.level.ChunkPos(r.home().door().pos()),2,id);
            try{
                var last=state.load(id);
                if(last!=null){var level=server.getLevel(net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION,ResourceLocation.parse(last.dimension())));
                    if(level!=null)level.getChunkSource().addRegionTicket(TICKET,new net.minecraft.world.level.ChunkPos(last.chunkX(),last.chunkZ()),2,id);}
            }catch(Exception error){latest.put(id,Map.of("status","unknown","reason","resident_checkpoint_unavailable"));continue;}
            var maid=body(id);
            if(maid==null){
                var lost=jobs.get(id);
                if(lost!=null&&now>lost.deadline()){
                    var row=base(id,lost.id(),lost.input().get("action").getAsString());
                    row.put("status","unknown");row.put("reason","body_unavailable_read_original_request_no_replay");
                    try{receipts.write(id,lost.id(),row);}catch(Exception storage){row.put("reason","receipt_storage_failed_no_replay");}
                    latest.put(id,row);jobs.remove(id); // durable fence remains until explicit inspection
                }
                continue;
            }
            ((ServerLevel)maid.level()).getChunkSource().addRegionTicket(TICKET,maid.chunkPosition(),2,id);
            try{
                // Import an older in-world fence once; never erase an uncertain pre-upgrade action.
                var previous=state.load(id);String legacy=maid.getPersistentData().getString(ACTIVE);
                state.locate(id,maid.level().dimension().location().toString(),maid.chunkPosition().x,maid.chunkPosition().z);
                if(previous==null&&!legacy.isBlank())state.begin(id,UUID.fromString(legacy));
                var last=state.load(id);
                if(last.pending()!=null&&!jobs.containsKey(id))maid.getPersistentData().putString(ACTIVE,last.pending().toString());
                else if(last.pending()==null&&!jobs.containsKey(id))maid.getPersistentData().remove(ACTIVE);
            }catch(Exception error){latest.put(id,Map.of("status","unknown","reason","resident_checkpoint_unavailable"));continue;}
            settings.install(id);
            ResidentRpg.tick(maid);
            var job=jobs.get(id);
            if(job!=null){step(r,maid,job,now);continue;}
            var pending=thinking.get(id);
            if(pending!=null&&now>pending.deadline()){thinking.remove(id);latest.put(id,Map.of("status","timeout","reason","model_deadline_no_action","requestId",pending.id().toString(),"completed",false));nextPlan.put(id,now+config.planningSeconds()*1000L);}
            if(leased(id)||busy(id)||!maid.getPersistentData().getString(ACTIVE).isBlank()||!maid.getPersistentData().getBoolean(INSTALLED))continue;
            // TLM handles reaching the configured sleep point and using its real bed.
            if(!maid.level().isDay()){if(!maid.isHomeModeEnable())ResidentHomes.bind(maid,r);continue;}
            if(settings.flag(id,"autonomous")&&now>=nextPlan.getOrDefault(id,0L)&&!maid.isSleeping()&&!maid.guiOpening&&
                (agents.companions()==null||!agents.companions().thinking(id))) plan(id);
        }
    }
    private void step(ResidentConfig.Resident r,EntityMaid maid,Job job,long now) {
        String action=job.input().get("action").getAsString();Map<String,Object> result=null;
        try {
            if(List.of("break","place","equip").contains(action)&&!net.minecraft.world.item.ItemStack.matches(job.item(),ResidentActions.stack(maid,job.input())))
                throw new IllegalArgumentException("item_components_changed_read_again");
            if(List.of("break","place").contains(action)&&!job.block().equals(maid.level().getBlockState(job.target())))throw new IllegalArgumentException("block_state_changed_read_again");
            if(!action.equals("cli")&&(leased(r.maidId())||agents.agent(r.maidId()).revision()!=job.revision()||!maid.level().dimension().location().toString().equals(job.dimension())))
                result=Map.of("status","cancelled","reason","body_control_or_dimension_changed","completed",false);
            else if(now>job.deadline())result=Map.of("status",action.equals("cli")?"unknown":"timeout","reason",action.equals("cli")?"service_pending_query_original_request_no_replay":"goal_not_reached","completed",false);
            else if(action.equals("walk")||action.equals("home")) {
                if(maid.position().distanceToSqr(Vec3.atBottomCenterOf(job.target()))<=4) {
                    if(action.equals("home"))ResidentHomes.bind(maid,r);
                    result=Map.of("status","completed","reason","arrived","completed",true);
                } else {if(maid.canBrainMoving()&&!maid.getBrain().hasMemoryValue(MemoryModuleType.WALK_TARGET))BehaviorUtils.setWalkAndLookTargetMemories(maid,job.target(),.7f,1);return;}
            } else if(action.equals("break")&&now<job.readyAt()) {
                ResidentActions.check(maid,r,job.target());
                if(!ResidentActions.visible(maid,job.target()))throw new IllegalArgumentException("mining_line_of_sight_lost");
                return;
            } else result=switch(action) {
                case "cli"->ResidentServices.execute(maid,job.id(),job.input().get("command").getAsString());
                case "break"->ResidentActions.mine(maid,r,job.input());
                case "place"->ResidentActions.place(maid,r,job.input());
                case "equip"->{MaidAgent.equip(maid,job.input().get("equipmentSlot").getAsString(),job.input().get("slot").getAsBigDecimal().intValueExact(),ResourceLocation.parse(job.input().get("expectedItem").getAsString()));yield Map.of("status","completed","completed",true,"reason","equipment_exchanged");}
                case "task"->{MaidAgent.task(maid,ResourceLocation.parse(job.input().get("task").getAsString()));yield Map.of("status","completed","completed",true,"reason","native_mode_selected_work_not_yet_completed");}
                case "cast"->ResidentRpg.cast(maid,r.profession(),job.input().get("skill").getAsString(),allies(maid));
                case "rest"->{ResidentHomes.bind(maid,r);yield Map.of("status","completed","completed",true,"reason","native_schedule_resumed");}
                case "say"->{String text=job.input().get("text").getAsString();String channel=job.input().has("channel")?job.input().get("channel").getAsString():"nearby";
                    if(!ResidentConfig.text(text,140)||!List.of("nearby","public").contains(channel))throw new IllegalArgumentException("invalid_speech");
                    if(now-lastPublic.getOrDefault(r.maidId(),0L)<60_000)throw new IllegalArgumentException("speech_cooldown");
                    var line=Component.literal("[居民] "+r.name()+"："+text);
                    for(var p:server.getPlayerList().getPlayers())if(channel.equals("public")||p.level()==maid.level()&&p.distanceToSqr(maid)<=24*24)p.sendSystemMessage(line);
                    maid.getChatBubbleManager().addTextChatBubble(text);lastPublic.put(r.maidId(),now);yield Map.of("status","completed","completed",true,"reason","speech_sent","channel",channel);}
                default->throw new IllegalArgumentException("unsupported_action");
            };
        } catch(Exception invalid){result=Map.of("status",invalid instanceof IllegalArgumentException?"blocked":"unknown","reason",invalid instanceof IllegalArgumentException?String.valueOf(invalid.getMessage()):"native_operation_failed_inspect_state_do_not_replay","completed",false);}
        if(result==null||"accepted".equals(result.get("status")))return;
        var row=base(r.maidId(),job.id(),action);row.putAll(result);row.put("input",job.input());row.put("actualPosition",ResidentActions.point(maid.blockPosition()));
        row.put("observedAt",java.time.Instant.now().toString());row.put("inventoryAfter",agents.agent(r.maidId()).observation(maid));
        try {receipts.write(r.maidId(),job.id(),row);if(!"unknown".equals(row.get("status"))){state.finish(r.maidId(),job.id());maid.getPersistentData().remove(ACTIVE);}}
        catch(Exception e){row.put("status","unknown");row.put("reason","receipt_storage_failed_no_replay");}
        if((action.equals("walk")||action.equals("home"))&&!"completed".equals(row.get("status"))){maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
        if((action.equals("break")||action.equals("place"))&&!leased(r.maidId())&&agents.agent(r.maidId()).revision()==job.revision())maid.setInSittingPose(job.sitting());
        if(Boolean.TRUE.equals(row.get("completed"))&&List.of("break","place").contains(action))ResidentRpg.xp(maid,1);
        if(agents.companions()!=null)try{agents.companions().rememberAction(r.maidId(),job.id(),row);}catch(Exception error){row.put("memoryStatus","journal_unavailable_original_receipt_retained");}
        latest.put(r.maidId(),row);jobs.remove(r.maidId());nextPlan.put(r.maidId(),now+config.planningSeconds()*1000L);
    }
    private List<LivingEntity> allies(EntityMaid maid){var out=new ArrayList<LivingEntity>();out.add(maid);
        for(var id:roles.keySet()){var other=body(id);if(other!=null&&other!=maid)out.add(other);}
        if(agents.companions()!=null)for(var p:server.getPlayerList().getPlayers())if(agents.companions().leader(maid.getUUID(),p.getUUID()))out.add(p);
        return out;}
    Map<String,Object> plan(UUID id) {
        var r=require(id);var maid=body(id);long now=System.currentTimeMillis();
        if(maid==null||busy(id)||leased(id)||!maid.getPersistentData().getString(ACTIVE).isBlank())return Map.of("status","blocked","reason","body_unavailable_or_busy");
        var site=maid.getAiChatManager().getLLMSite();if(site==null)return Map.of("status","unavailable","reason","model_site_unavailable");
        UUID turn=UUID.randomUUID();thinking.put(id,new Thinking(turn,now+60_000,agents.agent(id).revision()));nextPlan.put(id,now+config.planningSeconds()*1000L);
        var observation=new LinkedHashMap<>(observe(id));observation.remove("home");observation.put("homeDoor",r.home().door());observation.put("workPoint",r.home().work());
        if(agents.companions()!=null)try{observation.put("character",agents.companions().residentContext(id));}catch(Exception error){thinking.remove(id);return Map.of("status","unavailable","reason","resident_memory_unavailable");}
        observation.put("cli",ResidentServices.catalogue());
        observation.put("availableTasks",MaidAgent.tasks(maid));observation.put("nearbyBlocks",survey(maid,r));
        observation.put("nearbyEntities",((ServerLevel)maid.level()).getEntitiesOfClass(LivingEntity.class,maid.getBoundingBox().inflate(12),
            e->e!=maid&&e.isAlive()&&maid.distanceToSqr(e)<=144&&maid.hasLineOfSight(e)).stream()
            .sorted(java.util.Comparator.comparingDouble(maid::distanceToSqr)).limit(16)
            .map(e->Map.of("id",e.getStringUUID(),"type",net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString(),
                "name",e.getName().getString(),"at",ResidentActions.point(e.blockPosition()),"hostile",e instanceof net.minecraft.world.entity.monster.Enemy)).toList());
        String prompt="你是有自己住处和职业的Minecraft居民。维护自己的生活、装备和同伴关系，尊重他人领地。"+
            "选择一个有意义且现场可行的动作，也可以rest恢复原生作息。原生工作AI会持续工作，不需要反复下同一指令。"+
            "只输出JSON，不调用工具。action可为rest/home、walk(at:{x,y,z}绝对整数坐标)、task(task:完整ID)、"+
            "equip(equipmentSlot:mainhand/offhand/head/chest/legs/feet,slot:背包编号,expectedItem:实际ID)、"+
            "break(at,expectedBlock:已观察ID)、place(at,face:up/down/north/south/east/west,slot,expectedItem)、"+
            "cast(skill:本人技能ID)、say(text:140字内,channel:nearby或public)。不要猜未观察物品或方块；材料必须实际拥有。"+
            "cli(command:不带/mycli的子命令)可按需查询书籍目录、写书和真实拍照，先用archive status或photo status，字段见cli目录。异步动作只查原回执。"+
            "移动一次96格内，挖建5格内且通过普通领地权限，未知或拒绝时换目标，不反复重试。不要公开私聊内容。"+
            "真实现场："+new Gson().toJson(observation);
        prompt+="工具契约："+new Gson().toJson(ResidentContract.describe());
        try {site.client().chat(new CompanionConversation(maid,prompt,"决定下一件要做的事。",(reply,error)->server.execute(()->{
            var pending=thinking.get(id);if(pending==null||!pending.id().equals(turn))return;thinking.remove(id);
            if(error!=null||System.currentTimeMillis()>pending.deadline()||agents.agent(id).revision()!=pending.revision()||leased(id)){
                latest.put(id,Map.of("status","failed","reason",error==null?"plan_became_stale":error,"requestId",turn.toString(),"completed",false));return;}
            try {if(reply==null||reply.length()>4096)throw new IllegalArgumentException("plan_too_large");var input=JsonParser.parseString(reply).getAsJsonObject();submit(id,turn,input);}
            catch(Exception invalid){latest.put(id,Map.of("status","rejected","reason","invalid_model_action","requestId",turn.toString()));}
        })));}catch(Exception unavailable){thinking.remove(id);return Map.of("status","unavailable","reason","model_unavailable_no_action","requestId",turn.toString());}
        return Map.of("status","accepted","requestId",turn.toString(),"completed",false);
    }
    private static List<Map<String,Object>> survey(EntityMaid maid,ResidentConfig.Resident r) {
        var out=new ArrayList<Map<String,Object>>();var level=(ServerLevel)maid.level();
        if(r.workArea()==null)return out;
        for(BlockPos p:BlockPos.betweenClosed(maid.blockPosition().offset(-4,-2,-4),maid.blockPosition().offset(4,2,4))){
            if(out.size()>=32)break;
            if(r.workArea().contains(p)&&level.hasChunkAt(p)&&!level.getBlockState(p).isAir()&&ResidentActions.visible(maid,p))
                out.add(Map.of("at",ResidentActions.point(p),"block",ResidentActions.block(level,p)));
        }return out;
    }
}
