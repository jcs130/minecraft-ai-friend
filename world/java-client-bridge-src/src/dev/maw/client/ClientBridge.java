package dev.maw.client;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import net.minecraft.client.*;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.phys.*;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.common.NeoForge;
import com.mojang.blaze3d.platform.InputConstants;
import org.lwjgl.glfw.GLFW;
import java.nio.charset.StandardCharsets;
import java.nio.channels.*;
import java.nio.file.*;
import java.net.*;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import static dev.maw.client.ClientState.object;

@Mod(value="maw_client_bridge", dist=Dist.CLIENT)
public final class ClientBridge {
    private static final Gson JSON=new GsonBuilder().serializeNulls().create();
    private final Minecraft mc=Minecraft.getInstance();
    private final ClientState state=new ClientState();
    private final BaritoneAccess baritone=new BaritoneAccess();
    private final Path root=mc.gameDirectory.toPath().resolve("maw-client-bridge");
    private final String token=UUID.randomUUID().toString()+UUID.randomUUID(), instance=UUID.randomUUID().toString();
    private final ExecutorService io=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"maw-client-journal");t.setDaemon(true);return t;});
    private final KeyMapping pause=new KeyMapping("key.maw_client_bridge.pause",InputConstants.Type.KEYSYM,GLFW.GLFW_KEY_F8,"key.categories.misc");
    private final JsonObject catalog;
    private final Map<String,JsonObject> specs=new HashMap<>();
    private volatile JsonObject cached=object("ok",false,"status","starting");
    private volatile long lastTickAt;
    private volatile Action active;
    private volatile Lease lease;
    private volatile ActionStore store;
    private volatile String storeBody,storeServer;
    private volatile boolean broken;
    private volatile boolean controlPaused;
    private HttpServer http;
    private FileChannel lockFile;
    private FileLock lock;
    private final Object submissions=new Object();
    private record Lease(String id,String controller,String body,String server,String connection,long expiresAt) { }
    private static final class Action {
        volatile JsonObject record;final JsonObject args,before;final String operation,connection;final ActionStore store;
        int ticks,idleTicks;long startedAt;boolean started,finishing;String beforeBlock;
        Action(JsonObject record,JsonObject before,ActionStore store,String connection){
            this.record=record;this.args=record.getAsJsonObject("args");this.operation=record.get("operation").getAsString();
            this.before=before;this.store=store;this.connection=connection;
        }
    }
    public ClientBridge(IEventBus bus) throws Exception {
        try(var in=ClientBridge.class.getResourceAsStream("/client-operations.json")) {
            catalog=JsonParser.parseString(new String(Objects.requireNonNull(in).readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject();
        }
        for(JsonElement row:catalog.getAsJsonArray("operations"))specs.put(row.getAsJsonObject().get("id").getAsString(),row.getAsJsonObject());
        bus.addListener((RegisterKeyMappingsEvent e)->e.register(pause));
        NeoForge.EVENT_BUS.addListener(this::pre);NeoForge.EVENT_BUS.addListener(this::post);
        NeoForge.EVENT_BUS.addListener((net.neoforged.neoforge.client.event.ClientChatReceivedEvent event)->state.message(mc,event));
        if(!Boolean.parseBoolean(System.getProperty("maw.clientBridge.enabled","true")))return;
        Files.createDirectories(root.resolve("frames"));
        lockFile=FileChannel.open(root.resolve("instance.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);
        lock=lockFile.tryLock();if(lock==null)throw new IllegalStateException("client_bridge_game_directory_in_use");
        http=HttpServer.create(new InetSocketAddress("127.0.0.1",0),16);
        http.createContext("/rpc",this::handle);
        http.createContext("/frames/",this::frame);
        http.setExecutor(new ThreadPoolExecutor(2,4,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(16),r->{Thread t=new Thread(r,"maw-client-http");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy()));
        http.start();String endpoint="http://127.0.0.1:"+http.getAddress().getPort()+"/rpc";
        Files.writeString(root.resolve("connection.json"),JSON.toJson(object("schemaVersion",1,"endpoint",endpoint,"token",token,"instanceId",instance))+"\n");
        Runtime.getRuntime().addShutdownHook(new Thread(()->{http.stop(0);io.shutdown();baritone.close();try{lock.release();lockFile.close();}catch(Exception ignored){}},"maw-client-close"));
        org.slf4j.LoggerFactory.getLogger("maw_client_bridge").info("Client-only Agent bridge ready on loopback; credentials remain in the game directory. F8 releases control.");
    }
    private void pre(ClientTickEvent.Pre event) {
        while(pause.consumeClick()) {controlPaused=!controlPaused;lease=null;if(active!=null)finish(active,"cancelled","human_released_control",true);releaseKeys();}
        if(lease!=null&&(System.currentTimeMillis()>lease.expiresAt||!lease.connection.equals(state.connectionId()))){
            lease=null;releaseKeys();if(active!=null)finish(active,"unknown","connection_or_control_lease_lost",false);
        }
        Action a=active;
        if(a==null||a.finishing||!a.started)return;
        if(mc.player==null||mc.level==null||!mc.player.isAlive()||!a.connection.equals(state.connectionId())){
            finish(a,"unknown","body_unavailable_during_action",false);return;
        }
        a.ticks++;
        try {
            switch(a.operation) {
                case "baritone.goto","baritone.mine","baritone.follow","baritone.farm" -> {
                    if(a.operation.equals("baritone.mine"))baritone.tickMine();
                    long elapsed=System.currentTimeMillis()-a.startedAt;
                    boolean interval=a.operation.equals("baritone.follow")||a.operation.equals("baritone.farm");
                    int budget=a.args.has(interval?"durationMs":"timeoutMs")?integer(a.args,interval?"durationMs":"timeoutMs",1000,600000):60000;
                    JsonObject progress=a.record.deepCopy();progress.add("progress",object("backend","baritone","elapsedMs",elapsed,"actualPosition",object("x",mc.player.getX(),"y",mc.player.getY(),"z",mc.player.getZ())));a.record=progress;
                    if(a.operation.equals("baritone.goto")&&baritone.atGoal(blockPos(a.args)))finish(a,"succeeded","baritone_position_observed",true);
                    else if(a.operation.equals("baritone.mine")&&baritone.itemCount(text(a.args,"itemId"))>=integer(a.args,"targetCount",1,4096))finish(a,"succeeded","baritone_inventory_target_observed",true);
                    else if(a.operation.equals("baritone.follow")&&!baritone.targetPresent(text(a.args,"targetUuid")))finish(a,"failed","follow_target_no_longer_loaded",true);
                    else if(elapsed>=budget)finish(a,interval?"succeeded":"failed",interval?"baritone_interval_completed":"baritone_goal_timeout",true);
                    else if(baritone.preparingMine()||baritone.busy())a.idleTicks=0;
                    else if(++a.idleTicks>10&&a.ticks>20)finish(a,a.operation.equals("baritone.farm")?"succeeded":"failed",a.operation.equals("baritone.farm")?"baritone_farm_process_finished":"baritone_stopped_before_postcondition",true);
                }
                case "control.keys","world.useItem" -> { if(a.ticks>=integer(a.args,"ticks",1,200))finish(a,"succeeded","input_duration_completed",true); }
                case "body.move" -> {
                    JsonObject p=a.args.getAsJsonObject("position");double dx=p.get("x").getAsDouble()+.5-mc.player.getX(),dz=p.get("z").getAsDouble()+.5-mc.player.getZ();
                    if(Math.hypot(dx,dz)<.30&&mc.player.blockPosition().equals(blockPos(a.args)))finish(a,"succeeded","position_observed",true);
                    else if(a.ticks>200)finish(a,"failed","direct_walk_target_not_reached",true);
                    else {look((float)(Math.toDegrees(Math.atan2(-dx,dz))),mc.player.getXRot());mc.options.keyUp.setDown(true);mc.options.keyJump.setDown(mc.player.horizontalCollision);}
                }
                case "world.dig" -> {
                    BlockPos p=blockPos(a.args);
                    if(!mc.level.getBlockState(p).toString().equals(a.beforeBlock))finish(a,"succeeded","block_change_observed",true);
                    else if(a.ticks>200)finish(a,"unknown","block_change_not_confirmed",false);
                    else if(mc.hitResult instanceof BlockHitResult hit&&hit.getBlockPos().equals(p))mc.gameMode.continueDestroyBlock(p,hit.getDirection());
                    else finish(a,"failed","crosshair_left_target",true);
                }
                case "menu.click" -> {
                    JsonObject menu=state.menu(mc),old=a.before.getAsJsonObject("menu");
                    boolean changed=!menu.get("windowId").equals(old.get("windowId"))||!menu.get("stateId").equals(old.get("stateId"))
                        ||!menu.get("slots").equals(old.get("slots"))||!menu.get("carried").equals(old.get("carried"));
                    if(changed&&a.ticks>=4)finish(a,"succeeded","menu_change_observed",true);
                    else if(a.ticks>100)finish(a,"unknown","menu_change_not_confirmed",false);
                }
                case "screen.capture" -> { if(a.ticks>200)finish(a,"failed","frame_capture_timeout",true); }
                default -> { if(a.ticks>=5)finish(a,"succeeded","client_input_delivered",true); }
            }
        } catch(Exception error){finish(a,"unknown","client_action_exception",false);}
    }
    private void post(ClientTickEvent.Post event){
        state.tick(mc);lastTickAt=System.currentTimeMillis();
        if(state.tick()%5==0)try{cached=snapshot();}catch(Exception error){cached=object("ok",false,"status","unavailable","code","client_snapshot_failed");}
    }
    private JsonObject snapshot(){JsonObject out=state.snapshot(mc);out.addProperty("instanceId",instance);out.add("baritone",baritone.state());if(active!=null)out.add("currentAction",active.record.deepCopy());return out;}
    private JsonObject operations(){
        JsonObject result=catalog.deepCopy();
        for(var row:result.getAsJsonArray("operations")){
            JsonObject spec=row.getAsJsonObject();String id=spec.get("id").getAsString();
            if(id.startsWith("baritone.")&&!id.equals("baritone.state")){spec.addProperty("available",baritone.available());if(!baritone.available())spec.addProperty("unavailableReason","baritone_not_installed");}
        }return result;
    }
    private <T>T onClient(Callable<T> call) throws Exception {return mc.submit(()->{try{return call.call();}catch(RuntimeException e){throw e;}catch(Exception e){throw new CompletionException(e);}}).get(5,TimeUnit.SECONDS);}
    private void handle(HttpExchange exchange) {
        try {
            if(!authorized(exchange)){send(exchange,403,object("ok",false,"code","client_bridge_authentication_required"));return;}
            if(!exchange.getRequestMethod().equals("POST")||!exchange.getRequestURI().getRawPath().equals("/rpc")){send(exchange,405,object("ok",false,"code","rpc_post_required"));return;}
            byte[] bytes=exchange.getRequestBody().readNBytes(65537);
            if(bytes.length>65536){send(exchange,413,object("ok",false,"code","request_over_budget"));return;}
            JsonObject request=JsonParser.parseString(new String(bytes,StandardCharsets.UTF_8)).getAsJsonObject();
            if(!instance.equals(text(request,"instanceId")))throw new IllegalArgumentException("client_instance_changed");
            JsonObject params=request.has("params")?request.getAsJsonObject("params"):new JsonObject();
            send(exchange,200,rpc(text(request,"method"),params));
        } catch(Exception error){
            Throwable cause=error instanceof ExecutionException?error.getCause():error;String code=cause.getMessage();
            if(code==null||!code.matches("[a-zA-Z0-9_]{1,100}"))code="client_rpc_failed";
            try{send(exchange,200,object("ok",false,"code",code,"retryAutomatically",false));}catch(Exception ignored){}
        } finally {exchange.close();}
    }
    private boolean authorized(HttpExchange x){
        String host=x.getRequestHeaders().getFirst("Host"),origin=x.getRequestHeaders().getFirst("Origin"),auth=x.getRequestHeaders().getFirst("Authorization");
        return x.getRemoteAddress().getAddress().isLoopbackAddress()&&("127.0.0.1:"+http.getAddress().getPort()).equals(host)
            &&origin==null&&auth!=null&&MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8),("Bearer "+token).getBytes(StandardCharsets.UTF_8));
    }
    private void frame(HttpExchange x){
        try {
            if(!authorized(x)||!x.getRequestMethod().equals("GET")){send(x,403,object("ok",false,"code","frame_authentication_required"));return;}
            String id=x.getRequestURI().getRawPath().substring("/frames/".length());
            if(!id.matches("[a-f0-9]{24}-[A-Za-z0-9_.-]{1,64}\\.png"))throw new IllegalArgumentException("frame_id_invalid");
            Path file=root.resolve("frames").resolve(id);if(!Files.isRegularFile(file)){send(x,404,object("ok",false,"code","frame_unavailable"));return;}
            byte[] data=Files.readAllBytes(file);x.getResponseHeaders().set("Content-Type","image/png");x.getResponseHeaders().set("Cache-Control","no-store");
            x.sendResponseHeaders(200,data.length);x.getResponseBody().write(data);
        }catch(Exception error){try{send(x,400,object("ok",false,"code","frame_failed"));}catch(Exception ignored){}}
        finally{x.close();}
    }
    private void send(HttpExchange x,int status,JsonObject value)throws Exception{
        value.addProperty("schemaVersion",1);value.addProperty("instanceId",instance);value.addProperty("retryAutomatically",false);
        byte[] bytes=JSON.toJson(value).getBytes(StandardCharsets.UTF_8);
        x.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");x.getResponseHeaders().set("Cache-Control","no-store");
        x.sendResponseHeaders(status,bytes.length);x.getResponseBody().write(bytes);
    }
    private JsonObject rpc(String method,JsonObject p)throws Exception{
        if(method.equals("health"))return object("ok",!broken&&System.currentTimeMillis()-lastTickAt<5000,"provider","java-client",
            "lastTickAt",lastTickAt,"body",cached.deepCopy(),"controlAcquired",lease!=null,"controlPaused",controlPaused,"unresolved",store==null?0:store.unresolvedCount(),"modelRequests",0);
        if(method.equals("operations"))return operations();
        if(method.equals("shutdown")&&Boolean.getBoolean("maw.clientBridge.qaQuit")){
            if(active!=null)throw new IllegalStateException("finish_action_before_shutdown");
            mc.execute(mc::stop);return object("ok",true,"clientShutdownRequested",true);
        }
        if(method.equals("snapshot")||method.equals("identity"))return onClient(()->{checkBinding(p,false);return snapshot();});
        if(method.equals("claim"))return claim(p);
        if(method.equals("result")){
            onClient(()->{checkBinding(p,false);return true;});String id=text(p,"action_id");
            if(active!=null&&id.equals(text(active.record,"action_id")))return active.record.deepCopy();
            if(store==null){synchronized(submissions){if(store==null){storeBody=text(p,"expectedUuid");storeServer=text(p,"expectedServer");store=new ActionStore(root,storeBody,storeServer);}}}
            if(!storeBody.equals(text(p,"expectedUuid"))||!storeServer.equals(text(p,"expectedServer")))throw new IllegalStateException("action_scope_mismatch");
            JsonObject value=store.get(id);return value==null?object("ok",false,"status","unknown","outcomeKnown",false,"code","unknown_action_id"):value;
        }
        if(method.equals("read"))return onClient(()->{
            checkBinding(p,true);String op=text(p,"operation");JsonObject args=p.has("args")?p.getAsJsonObject("args"):new JsonObject();
            return switch(op){
                case "body.snapshot","body.identity" -> snapshot();
                case "menu.current" -> object("ok",true,"bodyId",mc.player.getUUID(),"state",state.menu(mc));
                case "screen.current" -> object("ok",true,"bodyId",mc.player.getUUID(),"screen",state.screen(mc));
                case "chat.recent" -> state.messages(mc,args.has("afterSeq")?integer(args,"afterSeq",0,Integer.MAX_VALUE):0,args.has("limit")?integer(args,"limit",1,64):24);
                case "world.blockAt" -> object("ok",true,"bodyId",mc.player.getUUID(),"block",state.block(mc,blockPos(args)));
                case "body.observe" -> state.observe(mc,args.has("radius")?integer(args,"radius",1,8):4);
                case "baritone.state" -> object("ok",true,"bodyId",mc.player.getUUID(),"capturedAt",Instant.now(),"state",baritone.state());
                default -> throw new IllegalArgumentException("read_operation_unavailable");
            };
        });
        if(method.equals("submit"))return submit(p);
        if(method.equals("cancel")||method.equals("stop")||method.equals("release"))return onClient(()->{
            checkLease(p);Action a=active;
            if(method.equals("release")&&a!=null)throw new IllegalStateException("reconcile_action_before_release");
            if(method.equals("cancel")&&(a==null||!text(a.record,"action_id").equals(text(p,"action_id"))))return object("ok",false,"code","action_not_active");
            if(a!=null)finish(a,"cancelled","controller_stopped_input",true);releaseKeys();if(method.equals("release"))lease=null;
            return object("ok",true,"pendingTerminalWrite",a!=null,"bodyRemoved",false);
        });
        throw new IllegalArgumentException("rpc_method_unavailable");
    }
    private JsonObject claim(JsonObject p)throws Exception{
        synchronized(submissions){
            JsonObject own=onClient(()->{checkBinding(p,true);String controller=text(p,"controllerId");
                if(controlPaused)throw new IllegalStateException("human_control_paused");
                if(baritone.busy()&&!baritone.owned())throw new IllegalStateException("baritone_already_controlled");
                if(!controller.matches("[A-Za-z0-9_.-]{1,64}"))throw new IllegalArgumentException("controller_id_invalid");
                if(lease!=null&&System.currentTimeMillis()<lease.expiresAt&&!lease.controller.equals(controller))throw new IllegalStateException("body_already_controlled");
                return snapshot();});
            String body=text(own,"bodyId"),server=text(own,"server");
            if(store==null||!body.equals(storeBody)||!server.equals(storeServer)){
                if(active!=null||lease!=null)throw new IllegalStateException("release_original_binding_first");
                store=new ActionStore(root,body,server);storeBody=body;storeServer=server;
            }
            return onClient(()->{checkBinding(p,true);if(!state.connectionId().equals(text(own,"connectionId")))throw new IllegalStateException("client_connection_changed");
                lease=new Lease(lease==null?UUID.randomUUID().toString():lease.id,text(p,"controllerId"),body,server,state.connectionId(),System.currentTimeMillis()+90000);
                return object("ok",true,"bodyId",body,"leaseId",lease.id,"expiresAt",lease.expiresAt,"unresolved",store.unresolvedCount(),"permissionChanged",false);});
        }
    }
    private void checkBinding(JsonObject p,boolean requireAlive){
        if(mc.player==null||mc.level==null){if(requireAlive)throw new IllegalStateException("client_body_offline");return;}
        if(!mc.player.getUUID().toString().equals(text(p,"expectedUuid"))||!state.server(mc).equals(text(p,"expectedServer")))throw new IllegalStateException("client_body_binding_mismatch");
        if(requireAlive&&!mc.player.isAlive())throw new IllegalStateException("client_body_dead");
    }
    private void checkLease(JsonObject p){checkBinding(p,true);Lease l=lease;
        if(l==null||!l.id.equals(text(p,"leaseId"))||!l.controller.equals(text(p,"controllerId"))||!l.connection.equals(state.connectionId())||l.expiresAt<System.currentTimeMillis())
            throw new IllegalStateException("control_lease_required");
    }
    private JsonObject submit(JsonObject p)throws Exception{
        synchronized(submissions){
            String id=text(p,"action_id"),op=text(p,"operation");JsonObject args=p.has("args")?p.getAsJsonObject("args").deepCopy():new JsonObject();
            onClient(()->{checkBinding(p,true);return true;});
            if(!id.matches("[A-Za-z0-9_.-]{1,64}"))throw new IllegalArgumentException("invalid_action_id");
            if(store==null||!storeBody.equals(text(p,"expectedUuid"))||!storeServer.equals(text(p,"expectedServer")))throw new IllegalStateException("control_lease_required");
            String fingerprint=ActionStore.fingerprint(op,args);JsonObject prior=active!=null&&id.equals(text(active.record,"action_id"))?active.record.deepCopy():store.get(id);
            if(prior!=null){if(!fingerprint.equals(text(prior,"fingerprint")))throw new IllegalArgumentException("action_id_parameters_changed");prior.addProperty("cached",true);return prior;}
            JsonObject before=onClient(()->{checkLease(p);if(active!=null||broken||store.unresolvedCount()>0)throw new IllegalStateException("reconcile_action_before_submit");
                validate(op,args);return snapshot();});
            JsonObject record=object("ok",true,"accepted",true,"action_id",id,"operation",op,"args",args,"fingerprint",fingerprint,
                "bodyId",text(before,"bodyId"),"server",text(before,"server"),"connectionId",text(before,"connectionId"),
                "status","accepted","terminal",false,"outcomeKnown",true,"acceptedAt",Instant.now(),"authority","client_observed");
            store.accept(record);Action action=new Action(record,before,store,text(before,"connectionId"));
            active=action;mc.execute(()->{try{checkLease(p);begin(action);}catch(Exception e){finish(action,"failed",safeCode(e,"action_precondition_changed"),true);}});
            return record.deepCopy();
        }
    }
    private void validate(String op,JsonObject a){
        JsonObject spec=specs.get(op);if(spec==null||spec.get("readOnly").getAsBoolean())throw new IllegalArgumentException("action_operation_unavailable");
        var schema=spec.getAsJsonObject("parameters");for(String key:a.keySet())if(!schema.getAsJsonObject("properties").has(key))throw new IllegalArgumentException("unexpected_argument");
        if(schema.has("required"))for(var key:schema.getAsJsonArray("required"))if(!a.has(key.getAsString()))throw new IllegalArgumentException("required_argument_missing");
        if(a.has("ticks"))integer(a,"ticks",1,200);
        if(!op.startsWith("baritone."))try{if(baritone.busy()&&!baritone.owned())throw new IllegalStateException("baritone_already_controlled");}catch(Exception error){throw new IllegalStateException(safeCode(error,"baritone_api_unavailable"));}
        switch(op){
            case "baritone.goto","baritone.mine","baritone.follow","baritone.farm" -> {
                if(mc.screen!=null)throw new IllegalArgumentException("close_screen_before_baritone");
                if(a.has("timeoutMs"))integer(a,"timeoutMs",1000,600000);if(a.has("durationMs"))integer(a,"durationMs",1000,600000);
                if(op.equals("baritone.goto"))blockPos(a);
                if(op.equals("baritone.mine"))integer(a,"targetCount",1,4096);
                if(op.equals("baritone.farm"))integer(a,"radius",1,32);
                try{baritone.validate(op,a);}catch(Exception error){throw new IllegalStateException(safeCode(error,"baritone_api_unavailable"));}
            }
            case "control.keys" -> {if(mc.screen!=null)throw new IllegalArgumentException("close_screen_before_movement");
                for(String key:a.getAsJsonObject("controls").keySet())if(!keys().containsKey(key)||!a.getAsJsonObject("controls").get(key).isJsonPrimitive()||!a.getAsJsonObject("controls").get(key).getAsJsonPrimitive().isBoolean())throw new IllegalArgumentException("control_key_invalid");}
            case "body.move" -> {if(mc.screen!=null)throw new IllegalArgumentException("close_screen_before_movement");BlockPos target=blockPos(a);if(mc.player.position().distanceTo(Vec3.atBottomCenterOf(target))>16)throw new IllegalArgumentException("direct_move_range_exceeded");}
            case "control.look" -> {number(a,"yaw",-3600,3600);number(a,"pitch",-90,90);}
            case "inventory.selectHotbar" -> {integer(a,"hotbarSlot",0,8);if(!state.snbt(mc,mc.player.getInventory().getItem(integer(a,"hotbarSlot",0,8))).equals(text(a,"expectedSnbt")))throw new IllegalArgumentException("hotbar_item_changed");}
            case "menu.click" -> checkMenu(a);
            case "menu.close" -> {if(mc.player.containerMenu.containerId!=integer(a,"windowId",0,Integer.MAX_VALUE))throw new IllegalArgumentException("menu_changed");}
            case "screen.click","screen.key","screen.type" -> {
                if(mc.screen==null||!state.screenToken().equals(text(a,"screenToken")))throw new IllegalArgumentException("screen_changed");
                if(op.equals("screen.click")){number(a,"x",0,mc.screen.width);number(a,"y",0,mc.screen.height);integer(a,"button",0,2);}
                if(op.equals("screen.key")){integer(a,"key",0,GLFW.GLFW_KEY_LAST);if(a.has("modifiers"))integer(a,"modifiers",0,15);}
                if(op.equals("screen.type")&&text(a,"text").length()>512)throw new IllegalArgumentException("text_over_budget");
            }
            case "world.dig","world.useBlock" -> {BlockPos p=blockPos(a);if(mc.screen!=null||!(mc.hitResult instanceof BlockHitResult hit)||!hit.getBlockPos().equals(p)
                ||mc.player.getEyePosition().distanceTo(mc.hitResult.getLocation())>mc.player.blockInteractionRange())throw new IllegalArgumentException("target_not_under_crosshair_or_out_of_reach");
                if(a.has("expectedHeldSnbt")&&!state.snbt(mc,mc.player.getMainHandItem()).equals(text(a,"expectedHeldSnbt")))throw new IllegalArgumentException("held_item_components_changed");
                if(a.has("face")&&!((BlockHitResult)mc.hitResult).getDirection().getName().equals(text(a,"face")))throw new IllegalArgumentException("hit_face_changed");
            }
            case "world.attack" -> {if(mc.screen!=null||!(mc.hitResult instanceof EntityHitResult hit)||hit.getEntity().getId()!=integer(a,"entityId",0,Integer.MAX_VALUE)
                ||!hit.getEntity().getUUID().toString().equals(text(a,"expectedUuid"))||mc.player.getEyePosition().distanceTo(hit.getLocation())>mc.player.entityInteractionRange())throw new IllegalArgumentException("entity_not_under_crosshair_or_out_of_reach");}
            case "world.useItem" -> {if(mc.screen!=null)throw new IllegalArgumentException("close_screen_before_item_use");}
            case "chat.send" -> {String text=text(a,"text");if(text.isBlank()||text.length()>256||text.contains("\n")||text.contains("\r"))throw new IllegalArgumentException("chat_text_invalid");}
            case "menu.openInventory","screen.capture" -> { }
            default -> throw new IllegalArgumentException("action_operation_unavailable");
        }
    }
    private void checkMenu(JsonObject a){var menu=mc.player.containerMenu;
        if(menu.containerId!=integer(a,"windowId",0,Integer.MAX_VALUE)||menu.getStateId()!=integer(a,"expectedStateId",0,Integer.MAX_VALUE))throw new IllegalArgumentException("menu_state_changed");
        int slot=integer(a,"slot",0,menu.slots.size()-1);integer(a,"button",0,8);
        if(!Set.of("PICKUP","QUICK_MOVE","SWAP").contains(text(a,"clickType")))throw new IllegalArgumentException("menu_click_type_unavailable");
        if(!state.snbt(mc,menu.slots.get(slot).getItem()).equals(text(a,"expectedSnbt"))||!state.snbt(mc,menu.getCarried()).equals(text(a,"expectedCarriedSnbt")))throw new IllegalArgumentException("menu_item_components_changed");
    }
    private void begin(Action a){
        if(a.finishing||active!=a)return;
        validate(a.operation,a.args);a.started=true;a.startedAt=System.currentTimeMillis();
        switch(a.operation){
            case "baritone.goto","baritone.mine","baritone.follow","baritone.farm" -> {
                if(a.operation.equals("baritone.mine")&&baritone.itemCount(text(a.args,"itemId"))>=integer(a.args,"targetCount",1,4096)){finish(a,"succeeded","baritone_inventory_target_observed",true);return;}
                try{baritone.begin(a.operation,a.args);}catch(Exception error){throw new IllegalStateException(safeCode(error,"baritone_api_unavailable"));}
            }
            case "control.keys" -> {releaseKeys();a.args.getAsJsonObject("controls").entrySet().forEach(e->keys().get(e.getKey()).setDown(e.getValue().getAsBoolean()));}
            case "control.look" -> look((float)number(a.args,"yaw",-3600,3600),(float)number(a.args,"pitch",-90,90));
            case "body.move" -> {releaseKeys();}
            case "inventory.selectHotbar" -> mc.player.getInventory().selected=integer(a.args,"hotbarSlot",0,8);
            case "menu.openInventory" -> mc.setScreen(new InventoryScreen(mc.player));
            case "menu.close" -> mc.player.closeContainer();
            case "menu.click" -> mc.gameMode.handleInventoryMouseClick(integer(a.args,"windowId",0,Integer.MAX_VALUE),integer(a.args,"slot",0,mc.player.containerMenu.slots.size()-1),integer(a.args,"button",0,8),ClickType.valueOf(text(a.args,"clickType")),mc.player);
            case "screen.click" -> {double x=number(a.args,"x",0,mc.screen.width),y=number(a.args,"y",0,mc.screen.height);int b=integer(a.args,"button",0,2);var screen=mc.screen;screen.mouseClicked(x,y,b);screen.mouseReleased(x,y,b);}
            case "screen.key" -> {int key=integer(a.args,"key",0,GLFW.GLFW_KEY_LAST),mods=a.args.has("modifiers")?integer(a.args,"modifiers",0,15):0;var screen=mc.screen;screen.keyPressed(key,0,mods);screen.keyReleased(key,0,mods);}
            case "screen.type" -> {for(char c:text(a.args,"text").toCharArray())mc.screen.charTyped(c,0);}
            case "world.dig" -> {a.beforeBlock=mc.level.getBlockState(blockPos(a.args)).toString();var hit=(BlockHitResult)mc.hitResult;mc.gameMode.startDestroyBlock(hit.getBlockPos(),hit.getDirection());}
            case "world.useBlock" -> {mc.gameMode.useItemOn(mc.player,InteractionHand.MAIN_HAND,(BlockHitResult)mc.hitResult);mc.player.swing(InteractionHand.MAIN_HAND);}
            case "world.useItem" -> mc.options.keyUse.setDown(true);
            case "world.attack" -> {mc.gameMode.attack(mc.player,((EntityHitResult)mc.hitResult).getEntity());mc.player.swing(InteractionHand.MAIN_HAND);}
            case "chat.send" -> {String text=text(a.args,"text");if(text.startsWith("/"))mc.getConnection().sendCommand(text.substring(1));else mc.getConnection().sendChat(text);}
            case "screen.capture" -> {
                String id=text(a.record,"action_id"),scoped=ActionStore.hash(text(a.record,"server")+"\n"+text(a.record,"bodyId")).substring(0,24)+"-"+id,name="maw-"+scoped+".png";
                Screenshot.grab(mc.gameDirectory,name,mc.getMainRenderTarget(),message->io.execute(()->{
                    try {Files.move(mc.gameDirectory.toPath().resolve("screenshots").resolve(name),root.resolve("frames").resolve(scoped+".png"),StandardCopyOption.REPLACE_EXISTING);
                        try(var frames=Files.list(root.resolve("frames"))){
                            var old=frames.filter(f->f.getFileName().toString().endsWith(".png")).sorted(Comparator.comparingLong(f->{try{return Files.getLastModifiedTime(f).toMillis();}catch(Exception e){return Long.MAX_VALUE;}})).toList();
                            for(int i=0;i<old.size()-64;i++)Files.deleteIfExists(old.get(i));
                        }
                        mc.execute(()->{a.record.addProperty("frame","/frames/"+scoped+".png");finish(a,"succeeded","original_framebuffer_captured",true);});
                    }catch(Exception e){mc.execute(()->finish(a,"failed","frame_capture_failed",true));}
                }));
            }
            default -> throw new IllegalArgumentException("action_operation_unavailable");
        }
    }
    private void finish(Action a,String status,String code,boolean known){
        if(a.finishing)return;a.finishing=true;releaseKeys();
        boolean stopImmediate=true;
        try{stopImmediate=baritone.stopOwned();}catch(Exception error){status="unknown";code="baritone_stop_unconfirmed";known=false;broken=true;}
        if(a.operation.equals("world.dig")&&mc.gameMode!=null)mc.gameMode.stopDestroyBlock();
        JsonObject result=a.record.deepCopy();result.addProperty("status",status);result.addProperty("terminal",true);result.addProperty("outcomeKnown",known);
        result.addProperty("ok",status.equals("succeeded"));result.addProperty("code",code);result.addProperty("completedAt",Instant.now().toString());
        result.addProperty("effectConfirmed",Set.of("position_observed","baritone_position_observed","baritone_inventory_target_observed","block_change_observed","menu_change_observed","original_framebuffer_captured").contains(code));
        if(a.operation.startsWith("baritone."))result.add("result",object("backend","baritone","stopImmediate",stopImmediate,"goalCompleted",false,
            "actualPosition",mc.player==null?null:object("x",mc.player.getX(),"y",mc.player.getY(),"z",mc.player.getZ()),"inventoryCount",mc.player!=null&&a.args.has("itemId")?baritone.itemCount(text(a.args,"itemId")):null));
        try{result.add("after",state.snapshot(mc));}catch(Exception error){result.add("after",JsonNull.INSTANCE);}
        io.execute(()->{try{a.store.finish(result);a.record=result;}
            catch(Exception error){broken=true;}finally{if(active==a)active=null;}});
    }
    private Map<String,KeyMapping> keys(){return Map.of("forward",mc.options.keyUp,"back",mc.options.keyDown,"left",mc.options.keyLeft,"right",mc.options.keyRight,
        "jump",mc.options.keyJump,"sneak",mc.options.keyShift,"sprint",mc.options.keySprint,"attack",mc.options.keyAttack,"use",mc.options.keyUse);}
    private void releaseKeys(){keys().values().forEach(k->k.setDown(false));}
    private void look(float yaw,float pitch){mc.player.setYRot(yaw);mc.player.setXRot(pitch);mc.player.yRotO=yaw;mc.player.xRotO=pitch;}
    private static String text(JsonObject o,String k){if(!o.has(k)||!o.get(k).isJsonPrimitive()||!o.get(k).getAsJsonPrimitive().isString())throw new IllegalArgumentException("string_argument_required");return o.get(k).getAsString();}
    private static int integer(JsonObject o,String k,int min,int max){double v=number(o,k,min,max);if(v!=Math.rint(v))throw new IllegalArgumentException("integer_argument_required");return (int)v;}
    private static double number(JsonObject o,String k,double min,double max){if(!o.has(k)||!o.get(k).isJsonPrimitive()||!o.get(k).getAsJsonPrimitive().isNumber())throw new IllegalArgumentException("number_argument_required");double v=o.get(k).getAsDouble();if(!Double.isFinite(v)||v<min||v>max)throw new IllegalArgumentException("number_out_of_range");return v;}
    private static BlockPos blockPos(JsonObject a){JsonObject p=a.getAsJsonObject("position");if(p==null)throw new IllegalArgumentException("position_required");return new BlockPos(integer(p,"x",-29999984,29999984),integer(p,"y",-2048,2048),integer(p,"z",-29999984,29999984));}
    private static String safeCode(Exception e,String fallback){return e.getMessage()!=null&&e.getMessage().matches("[a-zA-Z0-9_]{1,100}")?e.getMessage():fallback;}
}
