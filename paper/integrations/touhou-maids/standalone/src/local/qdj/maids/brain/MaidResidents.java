package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Path;
import java.io.IOException;
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
    private final ResidentPlanningHealth planningHealth;
    final ResidentCombat combat=new ResidentCombat(this);
    private final java.util.Set<UUID> combatReady=new java.util.HashSet<>();
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
    private static final net.minecraft.server.level.TicketType<UUID> SIMULATION=net.minecraft.server.level.TicketType.create(
        "tlm_resident_simulation",java.util.Comparator.comparing(UUID::toString),60);
    MaidResidents(MinecraftServer server,MaidAgentsServer agents,Path dir) throws Exception {
        this.server=server;this.agents=agents;config=ResidentConfig.read(dir.resolve("tlm-residents.json"),agents);
        receipts=new ResidentReceipts(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-actions"));
        state=new ResidentState(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-state"));
        planningHealth=new ResidentPlanningHealth(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-planning"),config.planningSeconds()*1000L);
        for(var r:config.residents()){
            var last=state.load(r.maidId());
            if(last!=null&&last.pending()!=null){var terminal=receipts.read(r.maidId(),last.pending());
                if(terminal!=null&&List.of("completed","blocked","rejected","partial","cancelled","timeout").contains(terminal.get("status")))state.finish(r.maidId(),last.pending());}
        }
        config.residents().forEach(r->{roles.put(r.maidId(),r);nextPlan.put(r.maidId(),System.currentTimeMillis()+30_000+roles.size()*10_000L);});
        settings=new ResidentSettings(server.getWorldPath(LevelResource.ROOT).resolve("data/tlm-resident-settings"),dir,this,agents);
    }
    ResidentConfig.Resident role(UUID id) { return roles.get(id); }
    Map<String,Object> travelReceipt(UUID id,UUID request)throws Exception{require(id);return agents.companions().travelReceipt(id,request);}
    Map<String,Object> inspectTravel(UUID id,UUID request,UUID review,JsonObject inspection)throws Exception{require(id);return agents.companions().inspectTravel(id,request,review,inspection);}
    Map<String,Object> resumeTravel(UUID id,UUID review)throws Exception{require(id);return agents.companions().resumeAfterInspection(id,review);}
    void notice(UUID id,String text)throws IOException{require(id);agents.companions().notice(id,text);}
    List<UUID> ids() { return List.copyOf(roles.keySet()); }
    boolean sameParty(UUID a,UUID b){return agents.companions()!=null&&agents.companions().sameParty(a,b);}
    boolean busy(UUID id) { return jobs.containsKey(id)||thinking.containsKey(id); }
    boolean holdsPosition(UUID id) { var job=jobs.get(id);return job!=null&&ResidentContract.holdsPosition(job.input()); }
    boolean ownsMovement(UUID id){var job=jobs.get(id);return job!=null&&(ResidentContract.holdsPosition(job.input())||List.of("walk","home").contains(job.input().get("action").getAsString()));}
    String swordControl(UUID id) {
        var maid=body(id);
        var job=jobs.get(id);
        if (maid==null || !maid.isAlive() || maid.isNoAi() || maid.guiOpening || maid.isSleeping()
                || maid.isPassenger() || maid.isMaidInSittingPose() || maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED)
                || job==null || leased(id) && !agents.companions().mayResidentAct(id, "cast")) return "";
        String action=job.input().get("action").getAsString();
        boolean casting=action.equals("cast") || action.equals("cli") && job.input().get("command").getAsString().strip().startsWith("cast ");
        if(!casting || agents.agent(id).revision()!=job.revision()) return "";
        return job.id().toString();
    }
    Map<String,Object> swordReflex(EntityMaid maid, UUID target) {
        try {
            UUID id=maid.getUUID();
            String skill=(String)ResidentVortex.call("residentSwordReflex",new Class<?>[]{UUID.class,UUID.class},id,target);
            if(skill.isBlank()) return Map.of();
            var command=new JsonObject();
            command.addProperty("action","cast");
            command.addProperty("skill",skill);
            Map<String,Object> result=submit(id,UUID.randomUUID(),command);
            return "accepted".equals(result.get("status")) ? result : Map.of();
        } catch (Exception unavailable) {
            return Map.of();
        }
    }
    void combatStarted(UUID id){agents.agent(id).invalidateActions();}
    void combatTick(){for(var id:ids()){
        var maid=body(id);if(maid==null||!combatReady.contains(id))continue;
        boolean allowed=!jobs.containsKey(id)&&maid.getPersistentData().getString(ACTIVE).isBlank()
            &&(agents.companions()==null||agents.companions().combatAllowed(id));
        combat.tick(maid,allowed);
    }}
    EntityMaid body(UUID id) { var a=agents.agent(id);return a==null?null:agents.loaded(a); }
    private boolean leased(UUID id) { return agents.companions()!=null&&agents.companions().reserved(id); }
    Map<String,Object> observe(UUID id) {
        var r=require(id);var maid=body(id);var row=new LinkedHashMap<String,Object>();
        row.put("maidId",id.toString());row.put("name",settings.name(id));row.put("profession",r.profession());row.put("home",r.home());
        row.put("loaded",maid!=null);row.put("observedAt",java.time.Instant.now().toString());row.put("usesPlayerSlot",false);
        if(maid!=null) {
            row.put("position",ResidentActions.point(maid.blockPosition()));row.put("dimension",maid.level().dimension().location().toString());
            row.put("health",maid.getHealth());row.put("sleeping",maid.isSleeping());row.put("task",maid.getTask().getUid().toString());
            row.put("downed",maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED));
            row.put("appearance",Map.of("ysm",maid.isYsmModel(),"modelId",maid.getYsmModelId(),"texture",maid.getYsmModelTexture()));
            row.put("rpg",ResidentRpg.observe(maid,r.profession()));row.put("inventory",agents.agent(id).observation(maid));
            row.put("combat",combat.observe(id));
            row.put("inventorySlots",ResidentActions.inventory(maid));row.put("roamingWork",r.roamingWork());
            row.put("homeInstalled",maid.getPersistentData().getBoolean(INSTALLED));
            String pending=maid.getPersistentData().getString(ACTIVE);
            row.put("activeRequest",pending.isBlank()?"none":pending);
            if(!pending.isBlank()&&!jobs.containsKey(id)) row.put("recovery","unknown_no_replay_query_original_request");
        }
        row.put("leased",leased(id));row.put("thinking",thinking.containsKey(id));
        try{row.put("planning",planningHealth.status(id,System.currentTimeMillis()));}
        catch(IOException error){row.put("planning",Map.of("status","unavailable","reason","planning_checkpoint_unavailable"));}
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
        if(row!=null&&List.of("cli","cast").contains(row.get("action"))&&(!jobs.containsKey(id)||body(id)==null)
                &&List.of("accepted","unknown").contains(row.get("status"))){
            var service=ResidentServices.query(id,request);
            if(List.of("completed","blocked","rejected").contains(service.get("status"))){
                row.putAll(service);row.put("observedAt",java.time.Instant.now().toString());receipts.write(id,request,row);
                var current=state.load(id);if(current!=null&&request.equals(current.pending())){state.finish(id,request);var maid=body(id);if(maid!=null)maid.getPersistentData().remove(ACTIVE);}
                var job=jobs.get(id);
                if(job!=null&&request.equals(job.id()))jobs.remove(id);
                combat.swordReceipt(id,request,row);
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
        if("cli".equals(row.get("action")))ResidentServices.acknowledgeUnknown(id,request,note);
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
            if(maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED))throw new IllegalArgumentException("trial_downed_read_status_wait_for_rescue");
            if(leased(id)&&!agents.companions().mayResidentAct(id,action)||jobs.containsKey(id)||thinking.containsKey(id))throw new IllegalArgumentException("body_busy_or_party_controls_movement");
            if(agents.companions()!=null&&agents.companions().pendingTravel(id))throw new IllegalArgumentException("unknown_companion_travel_read_original_receipt");
            if(!maid.getPersistentData().getString(ACTIVE).isBlank())throw new IllegalArgumentException("unknown_previous_action_read_original_request");
            if(state.load(id)!=null&&state.load(id).pending()!=null)throw new IllegalArgumentException("unknown_previous_action_read_original_request:"+state.load(id).pending());
            if(!List.of("walk","home","task","equip","break","place","cast","say","rest","cli").contains(action))throw new IllegalArgumentException("unsupported_resident_action");
            BlockPos target=action.equals("home")?r.home().door().pos():action.equals("walk")||action.equals("break")||action.equals("place")?ResidentActions.position(input,"at"):maid.blockPosition();
            if(!action.equals("home")&&(!maid.level().hasChunkAt(target)||maid.blockPosition().distSqr(target)>96*96))throw new IllegalArgumentException("target_unloaded_or_more_than_96_blocks");
            if(action.equals("break")||action.equals("place"))ResidentActions.check(maid,r,target);
            long now=System.currentTimeMillis();long duration=action.equals("break")?ResidentActions.miningMillis(maid,target):0;
            var item=ResidentActions.stack(maid,input).copy();
            // A home in another dimension must not load the same coordinates in this world.
            var block=List.of("break","place").contains(action)?maid.level().getBlockState(target):net.minecraft.world.level.block.Blocks.AIR.defaultBlockState();
            row.put("status","accepted");row.put("input",input);row.put("before",ResidentActions.point(maid.blockPosition()));
            combat.stop(maid,"finite_action_owns_body");
            receipts.write(id,request,row);state.locate(id,maid.level().dimension().location().toString(),maid.chunkPosition().x,maid.chunkPosition().z);state.begin(id,request);maid.getPersistentData().putString(ACTIVE,request.toString());
            jobs.put(id,new Job(request,input.deepCopy(),target,now+(action.equals("cli")?240_000:90_000),now+duration,maid.level().dimension().location().toString(),agents.agent(id).revision(),maid.isMaidInSittingPose(),item,block));
            if(ResidentContract.holdsPosition(input)){maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
            if(action.equals("break")||action.equals("place")){maid.setInSittingPose(true);maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
            if(action.equals("walk")||action.equals("home")&&maid.level().dimension().location().toString().equals(r.home().dimension())&&maid.blockPosition().distSqr(target)<=96*96){ResidentHomes.explore(maid,target);BehaviorUtils.setWalkAndLookTargetMemories(maid,target,.7f,1);}
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
            var pending=thinking.get(id);
            if(pending!=null&&now>pending.deadline()){
                thinking.remove(id);planFailure(id,pending.id(),"timeout","model_deadline_no_action",true,null);
            }
            var maid=body(id);
            if(maid==null){
                var lost=jobs.get(id);
                if(lost!=null&&lost.input().get("action").getAsString().equals("cast")&&ResidentVortex.selected()){
                    try { receipt(id,lost.id()); } catch (Exception unavailable) { /* Keep the original fence. */ }
                    lost=jobs.get(id);
                }
                if(lost!=null&&now>lost.deadline()){
                    var row=base(id,lost.id(),lost.input().get("action").getAsString());
                    row.put("status","unknown");row.put("reason","body_unavailable_read_original_request_no_replay");
                    try{receipts.write(id,lost.id(),row);}catch(Exception storage){row.put("reason","receipt_storage_failed_no_replay");}
                    latest.put(id,row);jobs.remove(id); // durable fence remains until explicit inspection
                }
                continue;
            }
            ((ServerLevel)maid.level()).getChunkSource().addRegionTicket(TICKET,maid.chunkPosition(),2,id);
            // NeoForge's native ticking ticket also runs ordinary crop/random ticks
            // without a connected player. Only the occupied chunk; old tickets expire
            // after three seconds. No fake connection or global random-tick override.
            ((ServerLevel)maid.level()).getChunkSource().addRegionTicket(SIMULATION,maid.chunkPosition(),2,id,true);
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
            combatReady.add(id);
            ResidentRpg.tick(maid);
            var job=jobs.get(id);
            if(job!=null){step(r,maid,job,now);continue;}
            if(maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED))continue;
            if(combat.active(id)||leased(id)||busy(id)||!maid.getPersistentData().getString(ACTIVE).isBlank()||!maid.getPersistentData().getBoolean(INSTALLED)
                ||agents.companions()!=null&&agents.companions().pendingTravel(id))continue;
            // TLM handles reaching the configured sleep point and using its real bed.
            if(!maid.level().isDay()){
                if(!maid.level().dimension().location().toString().equals(r.home().dimension())||maid.blockPosition().distSqr(r.home().door().pos())>96*96) {
                    if(now>=nextPlan.getOrDefault(id,0L)){
                        nextPlan.put(id,now+config.planningSeconds()*1000L);
                        try{submit(id,UUID.randomUUID(),JsonParser.parseString("{\"action\":\"home\"}").getAsJsonObject());}catch(Exception unavailable){/* Keep the bounded retry interval and any durable fence. */}
                    }
                }else if(!ResidentHomes.bound(maid,r))ResidentHomes.bind(maid,r);
                continue;
            }
            if(settings.flag(id,"autonomous")&&now>=nextPlan.getOrDefault(id,0L)&&!maid.isSleeping()&&!maid.guiOpening&&
                (agents.companions()==null||!agents.companions().thinking(id))) plan(id);
        }
    }
    private void step(ResidentConfig.Resident r,EntityMaid maid,Job job,long now) {
        String action=job.input().get("action").getAsString();Map<String,Object> result=null;
        try {
            if(maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED)&&!action.equals("cli")
                &&!(action.equals("cast")&&ResidentVortex.selected()&&ResidentVortex.usesSwords(r.maidId())))throw new IllegalArgumentException("trial_downed_action_stopped");
            if(ResidentContract.holdsPosition(job.input())){maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
            if(List.of("break","place","equip").contains(action)&&!net.minecraft.world.item.ItemStack.matches(job.item(),ResidentActions.stack(maid,job.input())))
                throw new IllegalArgumentException("item_components_changed_read_again");
            if(List.of("break","place").contains(action)&&!job.block().equals(maid.level().getBlockState(job.target())))throw new IllegalArgumentException("block_state_changed_read_again");
            if(!action.equals("cli")&&(leased(r.maidId())&&!agents.companions().mayResidentAct(r.maidId(),action)||agents.agent(r.maidId()).revision()!=job.revision()||!maid.level().dimension().location().toString().equals(job.dimension())))
                result=Map.of("status","cancelled","reason","body_control_or_dimension_changed","completed",false);
            else if(now>job.deadline())result=Map.of("status",action.equals("cli")?"unknown":"timeout","reason",action.equals("cli")?"service_pending_query_original_request_no_replay":"goal_not_reached","completed",false);
            else if(action.equals("home")&&(!maid.level().dimension().location().toString().equals(r.home().dimension())||maid.blockPosition().distSqr(job.target())>96*96)) {
                var world=server.getLevel(net.minecraft.resources.ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION,ResourceLocation.parse(r.home().dimension())));
                result=ResidentTravel.home(maid,world,r.home().door().pos());
                var current=body(r.maidId());if(current==null)throw new IllegalStateException("original_body_not_found_after_travel");maid=current;ResidentHomes.bind(maid,r);
            } else if(action.equals("walk")||action.equals("home")) {
                if(maid.position().distanceToSqr(Vec3.atBottomCenterOf(job.target()))<=4) {
                    if(action.equals("home"))ResidentHomes.bind(maid,r);
                    else if(agents.companions()!=null)agents.companions().relocateWork(maid);
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
                case "cast"->ResidentRpg.cast(maid,r.profession(),job.input().get("skill").getAsString(),allies(maid),job.id());
                case "rest"->{
                    boolean homeDimension=maid.level().dimension().location().toString().equals(r.home().dimension());
                    if(homeDimension)ResidentHomes.bind(maid,r);
                    else {ResidentHomes.explore(maid,maid.blockPosition());maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
                    yield Map.of("status","completed","completed",true,"reason",homeDimension?"native_schedule_resumed":"resting_at_current_location_home_unchanged");}
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
        combat.swordReceipt(r.maidId(),job.id(),row);
        // The world action already has its terminal receipt. A later RPG failure must not replay it next tick.
        jobs.remove(r.maidId());
        if(Boolean.TRUE.equals(row.get("completed"))&&List.of("break","place").contains(action)){
            try{ResidentRpg.xp(maid,1);row.put("progressionStatus","submitted_to_native_profile");}
            catch(RuntimeException unavailable){row.put("progressionStatus","unknown_no_automatic_replay");}
            try{receipts.write(r.maidId(),job.id(),row);}catch(Exception unavailable){row.put("progressionReceipt","unconfirmed_original_world_receipt_retained");}
        }
        if(agents.companions()!=null)try{agents.companions().rememberAction(r.maidId(),job.id(),row);}catch(Exception error){row.put("memoryStatus","journal_unavailable_original_receipt_retained");}
        latest.put(r.maidId(),row);jobs.remove(r.maidId());nextPlan.put(r.maidId(),now+config.planningSeconds()*1000L);
    }
    List<LivingEntity> allies(EntityMaid maid){var out=new ArrayList<LivingEntity>();out.add(maid);
        for(var id:roles.keySet()){var other=body(id);if(other!=null&&other!=maid)out.add(other);}
        if(agents.companions()!=null)for(var p:server.getPlayerList().getPlayers())if(agents.companions().leader(maid.getUUID(),p.getUUID()))out.add(p);
        return out;}
    Map<String,Object> plan(UUID id) {
        var r=require(id);var maid=body(id);long now=System.currentTimeMillis();
        if(maid==null||combat.active(id)||busy(id)||leased(id)||!maid.getPersistentData().getString(ACTIVE).isBlank())return Map.of("status","blocked","reason","body_unavailable_or_busy");
        if(agents.companions()!=null&&agents.companions().pendingTravel(id))return Map.of("status","blocked","reason","unknown_companion_travel_read_original_receipt");
        try{
            var health=planningHealth.status(id,now);long retry=((Number)health.get("retryAfterMs")).longValue();
            if(retry>0){nextPlan.put(id,now+retry);return Map.of("status","blocked","reason","model_backoff_no_action","retryAfterMs",retry,"completed",false,"planning",health);}
        }catch(IOException error){nextPlan.put(id,now+config.planningSeconds()*1000L);return Map.of("status","unavailable","reason","planning_checkpoint_unavailable","completed",false);}
        var site=maid.getAiChatManager().getLLMSite();if(site==null)return planFailure(id,UUID.randomUUID(),"failed","model_site_unavailable",true,null);
        UUID turn=UUID.randomUUID();thinking.put(id,new Thinking(turn,now+60_000,agents.agent(id).revision()));nextPlan.put(id,now+config.planningSeconds()*1000L);
        var observation=new LinkedHashMap<>(observe(id));observation.remove("home");observation.put("homeDoor",r.home().door());observation.put("homeDimension",r.home().dimension());observation.put("workPoint",r.home().work());
        if(agents.companions()!=null)try{observation.put("character",agents.companions().residentContext(id));}catch(Exception error){
            thinking.remove(id);String detail=String.valueOf(error.getMessage());
            String reason=java.util.Set.of("resident_goal_projection_stale","resident_goal_context_unavailable","resident_goal_scope_or_schema_mismatch","resident_goal_context_invalid","resident_goal_observation_invalid").contains(detail)?detail:"resident_memory_unavailable";
            return planFailure(id,turn,"failed",reason,false,null);
        }
        observation.put("cli",ResidentServices.catalogue());
        observation.put("availableTasks",MaidAgent.tasks(maid));observation.put("nearbyBlocks",survey(maid,r));
        observation.put("nearbyEntities",((ServerLevel)maid.level()).getEntitiesOfClass(LivingEntity.class,maid.getBoundingBox().inflate(12),
            e->e!=maid&&e.isAlive()&&maid.distanceToSqr(e)<=144&&maid.hasLineOfSight(e)).stream()
            .sorted(java.util.Comparator.comparingDouble(maid::distanceToSqr)).limit(16)
            .map(e->Map.of("id",e.getStringUUID(),"type",net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString(),
                "name",e.getName().getString(),"at",ResidentActions.point(e.blockPosition()),"hostile",e instanceof net.minecraft.world.entity.monster.Enemy)).toList());
        String prompt="你是有自己住处和职业的Minecraft居民。维护自己的生活、装备和同伴关系，尊重他人领地。"+
            "character.currentGoals是MC核心保存的目标意图；有目标时结合实际回执继续未完成部分，安全恢复优先，不随意改接别的目标。"+
            "目标中的计划、历史进度和host judgment都不是本次现场已完成的证明；以原动作回执和当前实际状态核对。"+
            "选择一个有意义且现场可行的动作，也可以rest恢复原生作息。原生工作AI会持续工作，不需要反复下同一指令。"+
            "只输出JSON，不调用工具。action可为rest/home、walk(at:{x,y,z}绝对整数坐标)、task(task:完整ID)、"+
            "equip(equipmentSlot:mainhand/offhand/head/chest/legs/feet,slot:背包编号,expectedItem:实际ID)、"+
            "break(at,expectedBlock:已观察ID)、place(at,face:up/down/north/south/east/west,slot,expectedItem)、"+
            "cast(skill:本人技能ID)、say(text:140字内,channel:nearby或public)。不要猜未观察物品或方块；材料必须实际拥有。"+
            "cli(command:不带/mycli的子命令)可按cli目录查询和办理公会、回收、商店、个人箱、遗迹、书籍和真实拍照。参数从对应查询的结构化ID取得。异步动作只查原回执。"+
            "移动一次96格内，挖建5格内且通过普通领地权限，未知或拒绝时换目标，不反复重试。不要公开私聊内容。"+
            "真实现场："+new Gson().toJson(observation);
        prompt+="工具契约："+new Gson().toJson(ResidentContract.describe());
        try {site.client().chat(new CompanionConversation(maid,prompt,"决定下一件要做的事。",(reply,error)->server.execute(()->{
            var pending=thinking.get(id);if(pending==null||!pending.id().equals(turn))return;thinking.remove(id);
            if(error!=null||System.currentTimeMillis()>pending.deadline()||agents.agent(id).revision()!=pending.revision()||leased(id)){
                boolean stale=agents.agent(id).revision()!=pending.revision()||leased(id);
                planFailure(id,turn,"failed",stale?"plan_became_stale":error!=null?error:"model_deadline_no_action",!stale,null);return;}
            JsonObject input;
            try{input=ResidentContract.modelInput(reply);}
            catch(IllegalArgumentException invalid){
                planFailure(id,turn,"rejected","invalid_model_action",true,ResidentContract.diagnosis(invalid));return;
            }
            try{planningHealth.healthy(id,turn);}
            catch(IOException storage){planFailure(id,turn,"failed","planning_checkpoint_unavailable",false,null);return;}
            try{submit(id,turn,input);}
            catch(Exception uncertain){latest.put(id,Map.of("status","unknown","reason","submission_unconfirmed_query_original_request","requestId",turn.toString(),"completed",false));}
        })));}catch(Exception unavailable){thinking.remove(id);return planFailure(id,turn,"failed","model_unavailable_no_action",true,null);}
        return Map.of("status","accepted","requestId",turn.toString(),"completed",false);
    }
    private Map<String,Object> planFailure(UUID id,UUID turn,String status,String reason,boolean penalize,Map<String,Object> validation){
        long now=System.currentTimeMillis();var row=base(id,turn,"plan");row.put("status",status);row.put("reason",reason);
        row.put("actionDispatched",false);if(validation!=null)row.put("validation",validation);
        nextPlan.put(id,now+config.planningSeconds()*1000L);
        try{
            if(penalize){var health=planningHealth.failed(id,turn,reason,now);row.put("planning",health);
                long retry=((Number)health.get("retryAfterMs")).longValue();row.put("retryAfterMs",retry);nextPlan.put(id,now+retry);}
            row.put("receiptPersisted",true);receipts.write(id,turn,row);
        }catch(IOException storage){row.put("receiptPersisted",false);row.put("persistenceReason","planning_checkpoint_unavailable");}
        latest.put(id,row);return row;
    }
    private static List<Map<String,Object>> survey(EntityMaid maid,ResidentConfig.Resident r) {
        var out=new ArrayList<Map<String,Object>>();var level=(ServerLevel)maid.level();
        boolean homeDimension=maid.level().dimension().location().toString().equals(r.home().dimension());
        if(!r.roamingWork()&&(!homeDimension||r.workArea()==null))return out;
        for(BlockPos p:BlockPos.betweenClosed(maid.blockPosition().offset(-4,-2,-4),maid.blockPosition().offset(4,2,4))){
            if(out.size()>=32)break;
            if((r.roamingWork()||r.workArea().contains(p))&&level.hasChunkAt(p)&&!level.getBlockState(p).isAir()&&ResidentActions.visible(maid,p))
                out.add(Map.of("at",ResidentActions.point(p),"block",ResidentActions.block(level,p)));
        }return out;
    }
}
