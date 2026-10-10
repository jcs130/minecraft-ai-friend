package dev.qiandeng.maw.numenserver;

import static dev.qiandeng.maw.numenserver.PrivateStore.*;
import com.dwinovo.numen.agent.inbox.EventQueue;
import com.dwinovo.numen.agent.script.ApiReply;
import com.dwinovo.numen.agent.script.ErrorKind;
import com.dwinovo.numen.entity.*;
import com.dwinovo.numen.permission.Mode;
import com.dwinovo.numen.permission.Permission;
import com.dwinovo.numen.program.*;
import com.dwinovo.numen.sdk.*;
import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** All body/world/lease access runs on the Minecraft thread. HTTP only queues work. */
public final class HeadlessRuntime {
    static volatile HeadlessRuntime INSTANCE;
    private static final ThreadLocal<Boolean> DISPATCH=ThreadLocal.withInitial(()->false);
    final MinecraftServer server;
    final Path directory, secrets;
    final JsonObject config;
    final String session=UUID.randomUUID().toString();
    final Map<UUID,JsonObject> bodies=new LinkedHashMap<>();
    final Map<UUID,HeadlessBrain> brains=new HashMap<>();
    final Map<UUID,Consumer<JsonObject>> listeners=new HashMap<>();
    final ConcurrentLinkedQueue<Runnable> requests=new ConcurrentLinkedQueue<>();
    final Map<UUID,JsonObject> leases=new HashMap<>();
    HeadlessHttp http;
    final MaidConfigBridge maids;
    final BedrockMenus bedrockMenus = new BedrockMenus(this);
    int ticks;

    static void start(MinecraftServer server) throws Exception {
        Path path=server.getServerDirectory().resolve("config/maw-numen-server.json");
        if(!Files.isRegularFile(path)) return;
        JsonObject config=read(path);
        if(!config.get("enabled").getAsBoolean()) return;
        HeadlessRuntime r=new HeadlessRuntime(server,config);
        INSTANCE=r;
        try { r.http=new HeadlessHttp(r);r.http.start();r.restoreAll(); }
        catch(Exception failure) { stop();throw failure; }
        org.slf4j.LoggerFactory.getLogger("maw-numen-server").info("MAW_NUMEN_SERVER ready serverResident=true clientRequired=false port={}",config.get("port").getAsInt());
    }
    private HeadlessRuntime(MinecraftServer server,JsonObject config) throws Exception {
        this.server=server;this.config=config;
        this.directory=server.getWorldPath(LevelResource.ROOT).resolve("maw-numen-server");
        this.secrets=server.getServerDirectory().resolve("config/maw-numen-private");
        this.maids=net.neoforged.fml.ModList.get().isLoaded("touhou_little_maid")?new MaidConfigBridge(this):null;
        Files.createDirectories(directory.resolve("bodies"));Files.createDirectories(secrets);
        try(var paths=Files.list(directory.resolve("bodies"))) {
            for(Path path:paths.filter(p->p.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).toList()) {
                UUID id=UUID.fromString(path.getFileName().toString().replace(".json",""));
                JsonObject b=read(path);UUID.fromString(text(b,"ownerUuid",36));
                if(!id.toString().equals(text(b,"bodyId",36))) throw new IllegalArgumentException("body_record_identity_mismatch");
                bodies.put(id,b);
            }
        }
    }
    public static boolean managed(UUID id) { HeadlessRuntime r=INSTANCE;return r!=null&&r.bodies.containsKey(id); }
    public static boolean authorizedDispatch() { return DISPATCH.get(); }
    public static boolean deliver(NumenPlayer body,EventQueue.Entry entry) {
        HeadlessRuntime r=INSTANCE;if(r==null||!r.bodies.containsKey(body.getUUID()))return false;
        r.event(body.getUUID(),entry.type(),entry.text(),entry.urgent(),entry.ts());
        HeadlessBrain brain=r.brains.get(body.getUUID());
        if(brain!=null)brain.arrived(entry);
        return true;
    }
    static void tick(MinecraftServer server) {
        HeadlessRuntime r=INSTANCE;if(r==null||r.server!=server)return;
        long until=System.nanoTime()+2_000_000;
        for(int n=0;n<8&&System.nanoTime()<until;n++) {Runnable job=r.requests.poll();if(job==null)break;job.run();}
        for(HeadlessBrain brain:List.copyOf(r.brains.values()))brain.tick();
        if(++r.ticks%20==0){r.bedrockMenus.prune(System.currentTimeMillis());r.lifecycle();}
    }
    static void stop() {
        HeadlessRuntime r=INSTANCE;if(r==null)return;
        for(HeadlessBrain brain:r.brains.values())brain.stop("server_stopping");
        if(r.http!=null)r.http.stop();
        for(UUID id:r.bodies.keySet()) {NumenPlayer b=NumenPlayer.findByUuid(r.server,id);if(b!=null)ServerPrograms.stop(b);}
        INSTANCE=null;
    }
    <T> T onMain(Callable<T> call) throws Exception {
        if(requests.size()>=128)throw new IllegalStateException("server_request_queue_full");
        CompletableFuture<T> result=new CompletableFuture<>();
        requests.add(()->{if(result.isCancelled())return;try{result.complete(call.call());}catch(Throwable ex){result.completeExceptionally(ex);}});
        try{return result.get(10,TimeUnit.SECONDS);}catch(TimeoutException ex){result.cancel(false);throw new IllegalStateException("server_tick_unavailable_request_unknown");}
    }
    JsonObject base(String action) {return object("schemaVersion",1,"provider","numen_server","numenVersion","0.1.4.1","action",action,"sampledAt",Instant.now(),"clientRequired",false,"retryAutomatically",false);}
    JsonObject ok(String action) {JsonObject o=base(action);o.addProperty("ok",true);return o;}
    JsonObject denied(String action,String code) {JsonObject o=base(action);o.addProperty("ok",false);o.addProperty("code",code);return o;}
    Path bodyFile(UUID id){return directory.resolve("bodies").resolve(id+".json");}
    void save(UUID id){write(bodyFile(id),bodies.get(id));}
    UUID own(UUID owner,JsonObject args) {
        UUID id=UUID.fromString(text(args,"companion",36));JsonObject b=bodies.get(id);
        if(b==null||!owner.toString().equals(text(b,"ownerUuid",36)))throw new IllegalArgumentException("body_not_owned");
        return id;
    }
    NumenPlayer live(UUID id) {
        NumenPlayer body=NumenPlayer.findByUuid(server,id);
        if(body==null)throw new IllegalArgumentException("body_offline_or_dead");return body;
    }
    void reconcile(UUID id) {
        JsonObject b=bodies.get(id);
        if(!b.has("activeAction"))return;
        JsonObject a=action(id,text(b,"activeAction",64));
        if(a.get("phase").getAsString().equals("unknown"))b.addProperty("blocked","previous_action_unknown_do_not_replay");
        else if(a.get("phase").getAsString().equals("terminal"))b.remove("activeAction");
    }
    void restoreAll() {
        for(UUID id:bodies.keySet()) {
            try {reconcile(id);JsonObject b=bodies.get(id);if(b.get("wantOnline").getAsBoolean())restore(id);}
            catch(RuntimeException failure){bodies.get(id).addProperty("blocked",safeCode(failure));save(id);}
        }
    }
    void restore(UUID id) {
        JsonObject b=bodies.get(id);if(b.has("blocked"))return;
        var entry=CompanionRegistry.get(server).find(id);
        if(entry==null)throw new IllegalArgumentException("registry_missing_no_replacement_created");
        if(!entry.taskName().isEmpty()||!entry.taskLua().isEmpty())throw new IllegalArgumentException("saved_native_task_unknown_no_replay");
        if(entry.diedAt()>0)return;
        if(NumenPlayer.findByUuid(server,id)!=null)return;
        if(!Files.isRegularFile(server.getWorldPath(LevelResource.ROOT).resolve("playerdata").resolve(id+".dat")))throw new IllegalArgumentException("saved_body_missing_no_replacement_created");
        CompanionFactory.spawn(server,id,entry.name(),entry.owner(),Optional.ofNullable(server.getLevel(entry.dimension())).orElse(server.overworld()),null);
        b.addProperty("state","alive");save(id);event(id,"restored","原身份恢复；旧动作没有重放。",false,System.currentTimeMillis());
    }
    void lifecycle() {
        for(UUID id:List.copyOf(bodies.keySet()))try{
            JsonObject b=bodies.get(id);var entry=CompanionRegistry.get(server).find(id);if(entry==null)continue;
            if(entry.diedAt()>0) {
                if(!b.has("lastDeathTick")||b.get("lastDeathTick").getAsLong()!=entry.diedAt()) {
                    b.addProperty("lastDeathTick",entry.diedAt());b.addProperty("state","dead");save(id);
                    event(id,"death",entry.deathCause(),true,System.currentTimeMillis());
                    if(brains.containsKey(id))brains.get(id).died();
                }
                if(!b.get("wantOnline").getAsBoolean()||b.has("blocked")||server.overworld().getGameTime()-entry.diedAt()<100||NumenPlayer.findByUuid(server,id)!=null)continue;
                // Native onDeath completed the vanilla drops/keepInventory and saved
                // the same UUID. Respawn at the registered safe anchor, not the hazard.
                JsonObject anchor=b.getAsJsonObject("anchor");
                Vec3 pos=new Vec3(anchor.get("x").getAsDouble(),anchor.get("y").getAsDouble(),anchor.get("z").getAsDouble());
                Vec3 safe=SafeAnchor.near(server.overworld(),pos);if(safe==null)continue;
                NumenPlayer body=CompanionFactory.spawn(server,id,entry.name(),entry.owner(),server.overworld(),safe);
                body.setHealth(body.getMaxHealth());body.clearFire();CompanionRegistry.get(server).markAlive(id);
                b.addProperty("state","alive");save(id);event(id,"respawn","已在安全出生点以原 UUID 复活。",true,System.currentTimeMillis());
                if(brains.containsKey(id))brains.get(id).respawned();
            } else if(!b.get("wantOnline").getAsBoolean()) {
                NumenPlayer body=NumenPlayer.findByUuid(server,id);if(body!=null)Companions.dormant(server,body);
            }
        }catch(RuntimeException failure){JsonObject b=bodies.get(id);b.addProperty("blocked",safeCode(failure));save(id);}
    }
    JsonObject operations(String group) {
        JsonObject o=ok("operations");JsonArray rows=new JsonArray();
        if(group==null||group.isBlank()) {
            for(var g:ApiRegistry.groups())rows.add(object("id",g.fullName(),"description",g.summary(),"count",g.functions().size()));
            o.add("groups",rows);o.addProperty("totalFunctions",ApiRegistry.functions().size());
        }else{
            var g=ApiRegistry.group(group);if(g==null)throw new IllegalArgumentException("unknown_group");
            for(var f:g.functions()) {
                JsonObject row=object("id",f.fullName(),"description",f.summary(),"side",f.side().name().toLowerCase(),"execution",f.kind().toString(),"returns",f.returns().type().toString(),"availableWithoutClient",f.side().name().equalsIgnoreCase("SERVER"));
                JsonArray params=new JsonArray();for(var p:f.params())params.add(object("name",p.name(),"role",p.role().name().toLowerCase(),"type",p.type().toString(),"description",p.explained()));
                JsonArray examples=new JsonArray();f.examples().stream().limit(3).forEach(examples::add);row.add("parameters",params);row.add("examples",examples);rows.add(row);
            }o.add("functions",rows);
        }return o;
    }
    JsonObject list(UUID owner) {
        JsonObject o=ok("list_companions");JsonArray rows=new JsonArray();
        bodies.forEach((id,b)->{if(owner.toString().equals(text(b,"ownerUuid",36)))rows.add(snapshot(id,false));});
        o.add("companions",rows);return o;
    }
    JsonObject create(UUID owner,JsonObject args) {
        String name=text(args,"name",16),aid=id(args,"action_id");
        if(!name.matches("[A-Za-z0-9_]{1,16}"))throw new IllegalArgumentException("invalid_name");
        Path intent=directory.resolve("creations").resolve(owner.toString()).resolve(aid+".json");
        String fingerprint=hash(name);
        if(Files.exists(intent)) {
            JsonObject old=read(intent);if(!fingerprint.equals(text(old,"fingerprint",64)))throw new IllegalArgumentException("action_id_conflict");
            UUID body=UUID.fromString(text(old,"bodyId",36));
            if(!"terminal".equals(text(old,"phase",16)))return object("ok",false,"phase","unknown","code","creation_interrupted_do_not_replay","bodyId",body,"replayed",true);
            JsonObject o=snapshot(body,false);o.addProperty("replayed",true);return o;
        }
        for(var pair:bodies.entrySet())if(owner.toString().equals(text(pair.getValue(),"ownerUuid",36))&&name.equalsIgnoreCase(text(pair.getValue(),"name",16)))throw new IllegalArgumentException("name_already_owned_use_existing_body_uuid");
        long mine=bodies.values().stream().filter(b->owner.toString().equals(text(b,"ownerUuid",36))).count();
        if(mine>=2||bodies.size()>=8)throw new IllegalArgumentException("companion_capacity_reached");
        UUID bodyId=UUID.randomUUID();BlockPos spawn=server.overworld().getSharedSpawnPos();
        Vec3 anchor=Vec3.atBottomCenterOf(spawn);Vec3 safe=SafeAnchor.near(server.overworld(),anchor);
        if(safe==null)throw new IllegalArgumentException("spawn_anchor_not_safe");
        JsonObject b=object("schemaVersion",1,"bodyId",bodyId,"ownerUuid",owner,"name",name,"state","provisioning","wantOnline",true,"driver","external","profileId","default","anchor",position(safe),"createdAt",Instant.now());
        write(intent,object("fingerprint",fingerprint,"bodyId",bodyId,"session",session,"phase","pending"));
        bodies.put(bodyId,b);save(bodyId);
        CompanionRegistry.get(server).put(bodyId,new CompanionRegistry.Entry(name,owner,server.overworld().dimension(),BlockPos.containing(safe)));
        NumenPlayer body=CompanionFactory.spawn(server,bodyId,name,owner,server.overworld(),safe);
        Permission.setMode(body,Mode.ASK);b.addProperty("state","alive");save(bodyId);
        write(intent,object("fingerprint",fingerprint,"bodyId",bodyId,"session",session,"phase","terminal"));
        event(bodyId,"created","同伴已出生；生存模式、无 OP。",false,System.currentTimeMillis());return snapshot(bodyId,true);
    }
    static JsonObject position(Vec3 p){return object("x",p.x,"y",p.y,"z",p.z);}
    JsonObject snapshot(UUID id,boolean inventory) {
        JsonObject stored=bodies.get(id),o=base("get_state");
        o.addProperty("bodyId",id.toString());o.addProperty("ownerUuid",text(stored,"ownerUuid",36));o.addProperty("name",text(stored,"name",16));
        o.addProperty("driver",text(stored,"driver",16));o.addProperty("profileId",text(stored,"profileId",32));
        o.addProperty("wantOnline",stored.get("wantOnline").getAsBoolean());if(stored.has("blocked"))o.add("blocked",stored.get("blocked"));
        NumenPlayer body=NumenPlayer.findByUuid(server,id);var entry=CompanionRegistry.get(server).find(id);
        o.addProperty("ok",body!=null);o.addProperty("online",body!=null);o.addProperty("status",entry!=null&&entry.diedAt()>0?"dead":body==null?"offline":"alive");
        if(stored.has("activeAction"))o.add("currentAction",action(id,text(stored,"activeAction",64)));else o.add("currentAction",JsonNull.INSTANCE);
        if(brains.containsKey(id))o.add("brain",brains.get(id).status());
        if(body==null){o.addProperty("code","body_offline_or_dead");return o;}
        o.addProperty("dimension",body.level().dimension().location().toString());o.add("position",position(body.position()));
        o.addProperty("health",body.getHealth());o.addProperty("maxHealth",body.getMaxHealth());o.addProperty("hunger",body.getFoodData().getFoodLevel());
        o.addProperty("permissionMode",Permission.modeOf(body).name().toLowerCase());o.addProperty("programRunning",ServerPrograms.running(id));
        if(inventory) {
            JsonArray slots=new JsonArray();for(int slot=0;slot<body.getInventory().getContainerSize();slot++)slots.add(stack(body.getInventory().getItem(slot),slot));o.add("inventory",slots);
            JsonArray menu=new JsonArray();for(int slot=0;slot<Math.min(128,body.containerMenu.slots.size());slot++)menu.add(stack(body.containerMenu.slots.get(slot).getItem(),slot));
            o.add("menu",object("containerId",body.containerMenu.containerId,"slotCount",body.containerMenu.slots.size(),"slots",menu,"cursor",stack(body.containerMenu.getCarried(),-1)));
        }return o;
    }
    JsonObject stack(ItemStack s,int slot) {
        JsonObject o=object("slot",slot,"empty",s.isEmpty());if(s.isEmpty())return o;
        o.addProperty("id",BuiltInRegistries.ITEM.getKey(s.getItem()).toString());o.addProperty("name",s.getHoverName().getString());o.addProperty("count",s.getCount());
        o.addProperty("damage",s.getDamageValue());o.addProperty("maxDamage",s.getMaxDamage());
        o.addProperty("componentsSnbt",s.save(server.registryAccess()).toString());return o;
    }
    JsonObject claim(UUID owner,UUID id,JsonObject args) {
        String controller=id(args,"controller_id");JsonObject old=leases.get(id);long now=System.currentTimeMillis();
        if(bodies.get(id).has("blocked"))throw new IllegalArgumentException("body_reconciliation_required");
        if(old!=null&&old.get("expiresAt").getAsLong()>now&&!controller.equals(text(old,"controllerId",64)))throw new IllegalArgumentException("controller_busy");
        if(old!=null&&!controller.equals(text(old,"controllerId",64))&&ServerPrograms.running(id))throw new IllegalArgumentException("previous_action_still_running");
        HeadlessBrain brain=brains.get(id);if(brain!=null&&brain.busy())throw new IllegalArgumentException("hosted_brain_active_stop_first");
        JsonObject lease=old!=null&&controller.equals(text(old,"controllerId",64))?old:object("controllerId",controller,"leaseId",token());
        lease.addProperty("expiresAt",now+90_000);leases.put(id,lease);bodies.get(id).addProperty("driver","external");save(id);
        JsonObject o=ok("claim_control");o.addProperty("bodyId",id.toString());o.add("lease",lease.deepCopy());return o;
    }
    void requireLease(UUID id,JsonObject args) {
        JsonObject lease=leases.get(id);
        if(lease==null||lease.get("expiresAt").getAsLong()<=System.currentTimeMillis()||!equalsSecret(text(lease,"leaseId",64),text(args,"lease_id",64)))throw new IllegalArgumentException("control_lease_required");
        lease.addProperty("expiresAt",System.currentTimeMillis()+90_000);
    }
    Path actionFile(UUID body,String aid){return directory.resolve("actions").resolve(body.toString()).resolve(aid+".json");}
    JsonObject action(UUID body,String aid) {
        Path file=actionFile(body,aid);if(!Files.isRegularFile(file))return denied("action_status","unknown_action_id");
        JsonObject o=read(file);
        if(!session.equals(text(o,"session",36))&&!text(o,"phase",16).equals("terminal")) {o.addProperty("phase","unknown");o.addProperty("ok",false);o.addProperty("code","interrupted_result_unknown_do_not_replay");}
        o.addProperty("sampledAt",Instant.now().toString());return o;
    }
    JsonObject lua(UUID body,String aid,String code,Consumer<JsonObject> terminal) {
        if(code.isBlank()||code.length()>16384)throw new IllegalArgumentException("invalid_program_size");
        Path file=actionFile(body,aid);String fingerprint=hash(code);
        if(Files.isRegularFile(file)) {
            JsonObject old=action(body,aid);if(!fingerprint.equals(text(old,"fingerprint",64)))throw new IllegalArgumentException("action_id_conflict");
            old.addProperty("replayed",true);if(terminal!=null&&text(old,"phase",16).equals("terminal"))terminal.accept(old);return old;
        }
        JsonObject b=bodies.get(body);if(b.has("blocked"))throw new IllegalArgumentException("body_reconciliation_required");
        NumenPlayer her=live(body);if(her.isDeadOrDying())throw new IllegalArgumentException("body_dead");
        if(ServerPrograms.running(body)||b.has("activeAction"))throw new IllegalArgumentException("body_busy_query_current_action");
        JsonObject out=ok("lua");out.addProperty("bodyId",body.toString());out.addProperty("action_id",aid);out.addProperty("fingerprint",fingerprint);out.addProperty("session",session);out.addProperty("phase","accepted");out.add("before",snapshot(body,true));
        write(file,out);b.addProperty("activeAction",aid);save(body);if(terminal!=null)listeners.put(body,terminal);
        UUID executionOwner=UUID.nameUUIDFromBytes(("MAWServerExecutor:"+her.getOwnerUuid()).getBytes(StandardCharsets.UTF_8));
        ClientTransport serverOnly=new ClientTransport(){
            public void request(NumenPlayer unused,com.dwinovo.numen.network.payload.ClientCallPayload call,Consumer<Answer> done){done.accept(new Answer(ApiReply.error(ErrorKind.FAILED,"server_only_function_unavailable: "+call.function()+"; use operations for server capabilities",null,null).toString(),null));}
            public void cancel(String callId){}
        };
        DISPATCH.set(true);
        try {ServerPrograms.run(her,body,executionOwner,new ServerPrograms.Request(aid,code,ModuleSet.factory(),true),serverOnly,CallObserver.NONE,result->{
            JsonObject end=read(file);end.addProperty("phase","terminal");end.addProperty("completedAt",Instant.now().toString());
            JsonObject outcome=JsonParser.parseString(result.toJson()).getAsJsonObject();end.add("outcome",outcome);
            end.addProperty("ok",result instanceof RunResult.Ended e&&e.outcome().ending().status().name().equalsIgnoreCase("OK"));
            b.remove("activeAction");end.add("after",snapshot(body,true));write(file,end);save(body);
            event(body,"action_terminal","action_id="+aid+" "+(end.get("ok").getAsBoolean()?"成功":"结束，请检查 outcome"),false,System.currentTimeMillis());
            Consumer<JsonObject> sink=listeners.remove(body);if(sink!=null)sink.accept(end.deepCopy());
        });}finally{DISPATCH.set(false);}
        return out.deepCopy();
    }
    JsonObject cancel(UUID body,String aid) {
        JsonObject record=action(body,aid);if(!record.has("phase"))return record;
        if(text(record,"phase",16).equals("unknown")||text(record,"phase",16).equals("terminal"))return record;
        ServerPrograms.cutOff(body,aid,true);JsonObject o=ok("action_cancel");o.addProperty("action_id",aid);o.addProperty("phase","cancel_requested_query_terminal");return o;
    }
    void event(UUID id,String type,String text,boolean urgent,long at) {
        Path file=directory.resolve("events").resolve(id+".json");JsonObject o=Files.exists(file)?read(file):object("next",1,"acked",0,"dropped",0,"entries",new JsonArray());
        long seq=o.get("next").getAsLong();o.addProperty("next",seq+1);JsonArray entries=o.getAsJsonArray("entries");
        if(entries.size()>=256){entries.remove(0);o.addProperty("dropped",o.get("dropped").getAsLong()+1);}
        entries.add(object("sequence",seq,"type",type,"text",text.length()>8192?text.substring(0,8192):text,"urgent",urgent,"at",at));write(file,o);
    }
    JsonObject events(UUID id,long after,Long ack) {
        if(after<0)throw new IllegalArgumentException("invalid_event_cursor");
        Path file=directory.resolve("events").resolve(id+".json");JsonObject o=Files.exists(file)?read(file):object("next",1,"acked",0,"dropped",0,"entries",new JsonArray());
        if(ack!=null){
            if(ack<0||ack>=o.get("next").getAsLong())throw new IllegalArgumentException("invalid_ack_sequence");
            o.addProperty("acked",Math.max(ack,o.get("acked").getAsLong()));
            JsonArray kept=new JsonArray();for(var e:o.getAsJsonArray("entries"))if(e.getAsJsonObject().get("sequence").getAsLong()>ack)kept.add(e);o.add("entries",kept);write(file,o);
        }
        JsonArray rows=new JsonArray();for(var e:o.getAsJsonArray("entries"))if(e.getAsJsonObject().get("sequence").getAsLong()>after&&rows.size()<32)rows.add(e.deepCopy());
        JsonObject out=ok(ack==null?"get_events":"ack_events");out.addProperty("bodyId",id.toString());out.add("events",rows);out.add("acked",o.get("acked"));out.add("dropped",o.get("dropped"));out.addProperty("nextSequence",o.get("next").getAsLong());return out;
    }
    JsonObject invoke(UUID owner,String operation,JsonObject args) {
        try {
            if(operation.equals("operations"))return operations(args.has("group")?text(args,"group",80):null);
            if(operation.equals("list_companions"))return list(owner);
            if(operation.equals("create_companion"))return create(owner,args);
            UUID id=own(owner,args);
            return switch(operation){
                case "get_state"->snapshot(id,true);
                case "claim_control"->claim(owner,id,args);
                case "lua"->{requireLease(id,args);yield lua(id,id(args,"action_id"),text(args,"code",16384),null);}
                case "action_status"->action(id,id(args,"action_id"));
                case "action_cancel"->{requireLease(id,args);yield cancel(id,id(args,"action_id"));}
                case "get_events"->events(id,args.has("after")?args.get("after").getAsLong():0,null);
                case "ack_events"->{requireLease(id,args);yield events(id,0,args.get("through").getAsLong());}
                case "restore_companion"->{requireLease(id,args);bodies.get(id).addProperty("wantOnline",true);restore(id);save(id);yield snapshot(id,true);}
                case "dormant_companion"->{requireLease(id,args);if(ServerPrograms.running(id))throw new IllegalArgumentException("stop_action_before_dormant");bodies.get(id).addProperty("wantOnline",false);save(id);NumenPlayer body=NumenPlayer.findByUuid(server,id);if(body!=null)Companions.dormant(server,body);yield snapshot(id,false);}
                case "release_control"->{requireLease(id,args);if(ServerPrograms.running(id))throw new IllegalArgumentException("stop_action_before_release");leases.remove(id);yield ok(operation);}
                case "set_permission"->{requireLease(id,args);if(ServerPrograms.running(id))throw new IllegalArgumentException("stop_action_before_reconfigure");String mode=text(args,"mode",16);if(!Set.of("ask","bypass","observe").contains(mode))throw new IllegalArgumentException("invalid_permission_mode");Permission.setMode(live(id),Mode.byName(mode));yield snapshot(id,false);}
                default->throw new IllegalArgumentException("unknown_operation");
            };
        }catch(RuntimeException ex){return denied(operation,safeCode(ex));}
    }
    static String safeCode(Throwable error) {
        String msg=error.getMessage();return msg!=null&&msg.matches("[A-Za-z0-9_]{1,100}")?msg:"operation_failed_inspect_server_receipt";
    }
    JsonObject profile(UUID owner,String id,boolean redacted) {
        Path file=secrets.resolve("profiles").resolve(owner.toString()).resolve(id+".json");
        JsonObject p=Files.isRegularFile(file)?read(file):object("profileId",id,"name","默认模型","provider","openai","model","","baseUrl","https://api.openai.com/v1","apiKey","");
        if(redacted){p.addProperty("keyConfigured",!text(p,"apiKey",4096).isBlank());p.remove("apiKey");}return p;
    }
    JsonArray profiles(UUID owner) {
        JsonArray a=new JsonArray();Path folder=secrets.resolve("profiles").resolve(owner.toString());
        if(Files.isDirectory(folder))try(var files=Files.list(folder)){for(Path file:files.filter(p->p.getFileName().toString().matches("[a-z0-9_-]{1,32}\\.json")).sorted().limit(8).toList())a.add(profile(owner,file.getFileName().toString().replace(".json",""),true));}catch(java.io.IOException ex){throw new IllegalStateException("profile_read_failed");}
        return a;
    }
    JsonObject ui(UUID owner,String playerName,String action,JsonObject args) {
        ServerPlayer player=server.getPlayerList().getPlayer(owner);
        if(player==null||player instanceof NumenPlayer||!player.getGameProfile().getName().equals(playerName))throw new IllegalArgumentException("owner_connection_not_online");
        if(action.startsWith("bedrock."))return bedrockMenus.invoke(player,action,args);
        if(action.startsWith("maid.")){
            if(maids==null)throw new IllegalArgumentException("maid_mod_unavailable");
            return maids.invoke(player,action,args);
        }
        if(action.equals("menu")){JsonObject out=list(owner);out.add("profiles",profiles(owner));out.addProperty("endpoint",text(config,"publicEndpoint",250));return out;}
        if(action.equals("profile.save")){
            String pid=text(args,"profileId",32);if(!pid.matches("[a-z0-9_-]{1,32}"))throw new IllegalArgumentException("invalid_profile_id");
            JsonObject old=profile(owner,pid,false);JsonObject p=object("profileId",pid,"name",text(args,"name",50),"provider",text(args,"provider",24),"model",text(args,"model",120),"baseUrl",text(args,"baseUrl",250));
            if(!Set.of("openai","deepseek","anthropic").contains(text(p,"provider",24)))throw new IllegalArgumentException("unsupported_provider");
            validateEndpoint(text(p,"baseUrl",250));if(text(p,"model",120).isBlank())throw new IllegalArgumentException("model_name_required");String key=text(args,"apiKey",4096);if(key.isBlank())key=text(old,"apiKey",4096);
            if(!key.isEmpty()&&!key.matches("[\\x21-\\x7e]{8,4096}"))throw new IllegalArgumentException("invalid_api_key");p.addProperty("apiKey",key);
            if(profiles(owner).size()>=8&&!Files.exists(secrets.resolve("profiles").resolve(owner.toString()).resolve(pid+".json")))throw new IllegalArgumentException("profile_capacity_reached");
            write(secrets.resolve("profiles").resolve(owner.toString()).resolve(pid+".json"),p);return object("ok",true,"profile",profile(owner,pid,true));
        }
        if(action.equals("create"))return create(owner,args);
        if(action.equals("token")){
            String token=PrivateStore.token();Path file=secrets.resolve("accounts.json");JsonObject accounts=read(file);JsonArray list=accounts.getAsJsonArray("accounts");
            // Rotate just this owner's token; no bearer is ever read back.
            JsonArray kept=new JsonArray();for(var e:list)if(!owner.toString().equals(e.getAsJsonObject().get("ownerUuid").getAsString()))kept.add(e);
            kept.add(object("ownerUuid",owner,"label",playerName,"tokenHash",hash(token)));accounts.add("accounts",kept);write(file,accounts);
            return object("ok",true,"token",token,"endpoint",text(config,"publicEndpoint",250));
        }
        UUID id=own(owner,args);JsonObject b=bodies.get(id);
        if(action.equals("settings")){
            if(ServerPrograms.running(id)||brains.containsKey(id)&&brains.get(id).busy())throw new IllegalArgumentException("body_busy_stop_before_reconfigure");
            String driver=text(args,"driver",16),pid=text(args,"profileId",32),mode=text(args,"permissionMode",16);
            if(!Set.of("external","hosted").contains(driver)||!pid.matches("[a-z0-9_-]{1,32}")||!Set.of("ask","bypass","observe").contains(mode))throw new IllegalArgumentException("invalid_body_settings");
            b.addProperty("driver",driver);b.addProperty("profileId",pid);leases.remove(id);save(id);Permission.setMode(live(id),Mode.byName(mode));return snapshot(id,false);
        }
        if(action.equals("stop")){HeadlessBrain brain=brains.get(id);if(brain!=null)brain.stop("owner_stop");if(b.has("activeAction"))cancel(id,text(b,"activeAction",64));return snapshot(id,false);}
        if(action.equals("task")){
            if(!text(b,"driver",16).equals("hosted"))throw new IllegalArgumentException("select_hosted_driver_first");
            if(leases.containsKey(id)&&leases.get(id).get("expiresAt").getAsLong()>System.currentTimeMillis())throw new IllegalArgumentException("external_controller_active");
            if(b.has("blocked"))throw new IllegalArgumentException("body_reconciliation_required");
            HeadlessBrain brain=brains.computeIfAbsent(id,k->new HeadlessBrain(this,k));brain.task(text(args,"text",2000));return snapshot(id,false);
        }
        throw new IllegalArgumentException("unknown_ui_action");
    }
    void validateEndpoint(String value) {
        java.net.URI uri;try{uri=java.net.URI.create(value);}catch(Exception ex){throw new IllegalArgumentException("invalid_model_endpoint");}
        boolean test=config.has("testOnlyAllowLoopbackModels")&&config.get("testOnlyAllowLoopbackModels").getAsBoolean()&&Set.of("127.0.0.1","localhost").contains(uri.getHost());
        if(uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||uri.getHost()==null||!(test&&Set.of("http","https").contains(uri.getScheme())||"https".equals(uri.getScheme()))||!test&&uri.getPort()!=-1&&uri.getPort()!=443)throw new IllegalArgumentException("model_endpoint_requires_allowed_https_host");
        boolean allowed=test;for(var host:config.getAsJsonArray("allowedModelHosts"))allowed|=uri.getHost().equalsIgnoreCase(host.getAsString());
        if(!allowed)throw new IllegalArgumentException("model_host_not_enabled_by_operator");
    }
}
