package org.agentmc.bridge;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.minecraft.*;

/** Actual game-thread operations. This client has no model, launcher or reconnect policy. */
public final class ClientBridge implements ClientModInitializer {
    public static final String MINECRAFT_VERSION = FabricLoader.getInstance().getModContainer("minecraft").orElseThrow().getMetadata().getVersion().getFriendlyString();
    public static volatile boolean running;
    private static ClientBridge instance;
    private static final String PROTOCOL = "agent-mc-java/v1";
    private final Gson gson = new Gson();
    private final ArrayDeque<ControlLedger.Action> queue = new ArrayDeque<>();
    private final ArrayDeque<JsonObject> messages = new ArrayDeque<>();
    private ControlLedger ledger;
    private ControlLedger.Action current;
    private class_310 client;
    private VisualExport visual;
    private Object lastScreen, lastHandler;
    private String screenToken = UUID.randomUUID().toString();
    private int generation;
    private long messageSeq;
    private boolean minescriptEnabled;
    private MinescriptRunner scriptRunner;
    private boolean scriptStopUnconfirmed;
    private MethodSession methodSession;
    public static boolean hasController() { return instance != null && instance.ledger != null && instance.ledger.active(System.currentTimeMillis()); }
    @Override public void onInitializeClient() {
        instance = this; client = class_310.method_1551(); visual = new VisualExport(client);
        try {
            Path directory = FabricLoader.getInstance().getGameDir().resolve("agent-mc-bridge");
            Path config = directory.resolve("config.json");
            if (Files.isRegularFile(config)) minescriptEnabled = flag(JsonParser.parseString(Files.readString(config)).getAsJsonObject(), "minescriptEnabled");
            ledger = new ControlLedger(directory.resolve("actions"));
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            byte[] secret = new byte[32]; new SecureRandom().nextBytes(secret);
            String token = HexFormat.of().formatHex(secret);
            server.createContext("/v1/rpc", exchange -> {
                try {
                    String provided = exchange.getRequestHeaders().getFirst("Authorization");
                    if (!"POST".equals(exchange.getRequestMethod()) || provided == null || !MessageDigest.isEqual(provided.getBytes(StandardCharsets.UTF_8), ("Bearer " + token).getBytes(StandardCharsets.UTF_8))) {
                        exchange.sendResponseHeaders(403, -1); return;
                    }
                    byte[] body = exchange.getRequestBody().readNBytes(262145);
                    if (body.length > 262144) throw new IllegalArgumentException("Request too large");
                    JsonObject request = JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
                    if (!PROTOCOL.equals(text(request, "protocol", ""))) throw new IllegalArgumentException("Unsupported bridge protocol");
                    CompletableFuture<JsonObject> result = new CompletableFuture<>();
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                    client.execute(() -> {
                        if (System.nanoTime() >= deadline) { result.completeExceptionally(new TimeoutException("Request expired before game-thread dispatch")); return; }
                        try { result.complete(rpc(text(request, "method", ""), object(request, "params"))); } catch (Exception error) { result.completeExceptionally(error); }
                    });
                    JsonObject response = result.get(5, TimeUnit.SECONDS);
                    byte[] bytes = gson.toJson(response).getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json"); exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes);
                } catch (Exception error) {
                    JsonObject failure = new JsonObject();
                    Throwable cause = error instanceof ExecutionException ? error.getCause() : error;
                    failure.addProperty("error", cause instanceof IllegalArgumentException || cause instanceof IllegalStateException ? cause.getMessage() : "Client operation unavailable; inspect local client log");
                    byte[] bytes = gson.toJson(failure).getBytes(StandardCharsets.UTF_8);
                    try { exchange.sendResponseHeaders(409, bytes.length); exchange.getResponseBody().write(bytes); } catch (Exception ignored) {}
                } finally { exchange.close(); }
            });
            server.setExecutor(Executors.newFixedThreadPool(4, task -> { Thread thread = new Thread(task, "agent-mc-rpc"); thread.setDaemon(true); return thread; }));
            server.start(); running = true;
            JsonObject connection = new JsonObject(); connection.addProperty("protocol", PROTOCOL); connection.addProperty("endpoint", "http://127.0.0.1:" + server.getAddress().getPort());
            connection.addProperty("token", token); connection.addProperty("instanceId", UUID.randomUUID().toString());
            connection.addProperty("minecraftVersion", MINECRAFT_VERSION); connection.addProperty("createdAt", Instant.now().toString());
            Path file = directory.resolve("connection.json"); Files.writeString(file, gson.toJson(connection)); restrict(file);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> { running = false; server.stop(0); }));
            ClientTickEvents.START_CLIENT_TICK.register(this::tick);
            ClientPlayConnectionEvents.JOIN.register((handler, sender, c) -> { generation++; ledger.release(); cancelAll("connection changed"); });
            ClientPlayConnectionEvents.DISCONNECT.register((handler, c) -> { generation++; ledger.release(); cancelAll("connection closed"); });
            ClientReceiveMessageEvents.GAME.register((message, overlay) -> receiveMessage(message.getString(), overlay, "system", null));
            ClientReceiveMessageEvents.CHAT.register((message, signed, sender, parameters, timestamp) ->
                receiveMessage(message.getString(), false, "player", sender == null ? null : sender.getName()));
            System.out.println("[AgentMC] Local bridge ready; token stored privately, no server connection initiated");
        } catch (Exception error) { throw new IllegalStateException("Agent MC bridge initialization failed", error); }
    }
    private void receiveMessage(String text, boolean overlay, String kind, String sender) {
        JsonObject entry = new JsonObject(); entry.addProperty("seq", ++messageSeq); entry.addProperty("text", text); entry.addProperty("overlay", overlay);
        entry.addProperty("kind", kind); if (sender != null) entry.addProperty("sender", sender); entry.addProperty("at", Instant.now().toString());
        messages.add(entry); while (messages.size() > 50) messages.removeFirst();
    }
    private static void restrict(Path file) throws Exception {
        PosixFileAttributeView posix = Files.getFileAttributeView(file, PosixFileAttributeView.class);
        if (posix != null) posix.setPermissions(Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        AclFileAttributeView acl = Files.getFileAttributeView(file, AclFileAttributeView.class);
        if (acl != null) acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(acl.getOwner()).setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
    }
    private JsonObject rpc(String method, JsonObject args) throws Exception {
        long now = System.currentTimeMillis();
        if (method.equals("capabilities")) return gson.toJsonTree(Map.of("protocol", PROTOCOL, "minecraftVersion", MINECRAFT_VERSION, "realRendering", true, "visualData", "agent-mc-visual/v1", "systemInput", false, "minescript", minescriptAvailable(), "baritone", false, "methodAdapter", MethodSession.PROTOCOL, "methodCalls", MethodSession.METHODS)).getAsJsonObject();
        if (method.equals("operations")) return operations();
        if (method.equals("state")) return state();
        if (method.equals("result")) { ControlLedger.Action action = ledger.get(text(args, "action_id", "")); if (action == null) throw new IllegalArgumentException("Unknown action_id; do not assume it was not dispatched"); return gson.toJsonTree(action).getAsJsonObject(); }
        connected();
        String actualServer=client.method_1558()==null?"":client.method_1558().field_3761;
        if(!client.field_1724.method_5667().toString().replace("-", "").equalsIgnoreCase(text(args,"expectedUuid","").replace("-", "")) || !actualServer.toLowerCase().replaceAll(":25565$","").equals(text(args,"expectedServer","").toLowerCase().replaceAll(":25565$",""))) throw new IllegalStateException("Client UUID/server mismatch");
        if(args.has("expectedGeneration")&&args.get("expectedGeneration").getAsDouble()!=generation)throw new IllegalStateException("Method connection generation changed before dispatch");
        if (method.equals("visual_registry")) return visual.registry();
        if (method.equals("visual_frame")) return visual.frame(integer(args,"radius",2));
        if (method.equals("visual_skin")) return visual.skin(text(args,"resource",""));
        if (method.equals("visual_chunk")) return visual.chunk(integer(args,"x",0),integer(args,"z",0),text(args,"epoch",""));
        if (method.equals("method_read")) {JsonObject result=new JsonObject();result.add("value",MethodSession.read(client,text(args,"name",""),args.getAsJsonArray("args")));result.addProperty("sampledAt",Instant.now().toString());result.addProperty("generation",generation);return result;}
        if (method.equals("screenshot")) {
            try (class_1011 image = class_318.method_1663(client.method_1522())) {
                JsonObject shot = new JsonObject(); shot.addProperty("mime", "image/png"); shot.addProperty("base64", Base64.getEncoder().encodeToString(image.method_24036()));
                shot.addProperty("capturedAt", Instant.now().toString()); shot.add("state", state()); return shot;
            }
        }
        if (method.equals("claim")) { connected(); if(scriptStopUnconfirmed) throw new IllegalStateException("Prior script cancellation unknown; explicit reconciliation required"); return ledger.claim(text(args, "controllerId", ""), integer(args, "ttlMs", 15000), now); }
        if (method.equals("renew")) return ledger.renew(text(args, "controllerId", ""), text(args, "nonce", ""), integer(args, "ttlMs", 15000), now);
        ledger.require(text(args, "controllerId", ""), text(args, "nonce", ""), now);
        if (Set.of("method_call","method_result","method_finish").contains(method)) {
            if(current==null||!current.id.equals(text(args,"action_id",""))||methodSession==null)throw new IllegalStateException("Original method session is not running; reconcile original action_id");
            if(method.equals("method_call"))return methodSession.call(integer(args,"call",0),text(args,"name",""),args.getAsJsonArray("args"));
            if(method.equals("method_result"))return methodSession.result(integer(args,"call",0));
            if(methodSession.pending())throw new IllegalStateException("Await pending method call before finishing");
            releaseKeys();ledger.finish(current,"partial","JavaScript program ended; verify actual world effect",state(),now);JsonObject result=gson.toJsonTree(current).getAsJsonObject();current=null;methodSession=null;return result;
        }
        if (method.equals("release") || method.equals("stop")) { cancelAll("controller stopped"); if (method.equals("release")) ledger.release(); return gson.toJsonTree(Map.of("stopped", true)).getAsJsonObject(); }
        if (method.equals("cancel")) {
            String id = text(args, "action_id", ""); ControlLedger.Action action = ledger.get(id);
            if (action == null) throw new IllegalArgumentException("Unknown action_id");
            queue.remove(action); if (current == action) { cancelScript(); releaseKeys(); current = null; }
            ledger.finish(action, "cancelled", "explicit cancellation", state(), now); return gson.toJsonTree(action).getAsJsonObject();
        }
        if (!method.equals("do")) throw new IllegalArgumentException("Unknown bridge method");
        if(scriptStopUnconfirmed) throw new IllegalStateException("Prior script cancellation unknown; body blocked");
        connected();
        String operation = text(args, "operation", ""); JsonObject input = object(args, "input"); validate(operation, input);
        String id = text(args, "action_id", ""); ControlLedger.Action existing = ledger.get(id);
        ControlLedger.Action action = ledger.admit(id, operation, input, now);
        if (existing == null) { if(text(args,"queue","append").equals("now")) cancelAll("explicit queue replacement"); if (queue.size() >= 16) { ledger.finish(action, "blocked", "client action queue full", state(), now); } else queue.add(action); }
        return gson.toJsonTree(action).getAsJsonObject();
    }
    private JsonObject operations() {
        JsonObject result = new JsonObject();
        result.add("operations", gson.toJsonTree(Map.of(
            "move", "{forward,back,left,right,jump,sneak,sprint:boolean,ticks:1..200}; actual position is verified",
            "look", "{yaw:-180..180,pitch:-90..90}; degrees in the actual Java client",
            "chat", "{text:string}; leading / sends a command; delivery is not server acceptance",
            "use", "{ticks:1..100}; use held item at the current look target",
            "menu_click", "{screenToken,slot,button:0..8,type:PICKUP|QUICK_MOVE|SWAP}; reject stale GUI; return full cursor/slots",
            "close_screen", "{screenToken}; closes the actual current GUI without capturing the OS cursor",
            "hotbar", "{slot:0..8}; selects actual inventory hotbar",
            "inventory_open", "{}; opens the actual player inventory GUI without OS input",
            "gui_click", "{screenToken,index}; actual displayed ButtonWidget, no system mouse")));
        if (minescriptAvailable()) result.getAsJsonObject("operations").addProperty("minescript.run", "{code:string,input:JSON,timeoutMs:100..30000}; Python Minescript 4.0; variables minescript/input_data/result; trusted local code, not a sandbox. Original action ID, exclusive native queue and cancellation apply. Script report is not goal evidence.");
        result.getAsJsonObject("operations").addProperty("method.run", "{durationMs:1000..120000}; reserved JavaScript body session, method_call/result/finish. mc_script owns its lifecycle; no source code executes inside Java.");
        return result;
    }
    private boolean minescriptAvailable() { return minescriptEnabled && Path.of("").toAbsolutePath().normalize().equals(FabricLoader.getInstance().getGameDir().toAbsolutePath().normalize()) && FabricLoader.getInstance().getModContainer("minescript").map(mod -> mod.getMetadata().getVersion().getFriendlyString().equals("4.0")).orElse(false); }
    private MinescriptRunner scripts() throws Exception { if (!minescriptAvailable()) throw new IllegalStateException("Minescript 4.0 is not explicitly enabled and installed"); if(scriptRunner==null)scriptRunner=new MinescriptRunner(FabricLoader.getInstance().getGameDir()); return scriptRunner; }
    private void cancelScript() {
        if(scriptRunner==null)return;
        try { scriptRunner.cancel(); } catch(Exception error) { scriptStopUnconfirmed=true;releaseKeys();try{if(current!=null)ledger.finish(current,"unknown","Script cancellation unconfirmed",new JsonObject(),System.currentTimeMillis());}catch(Exception ignored){} throw new IllegalStateException("Minescript cancellation unknown; no new body work permitted"); }
    }
    private void validate(String operation, JsonObject input) {
        if(operation.equals("method.run")){if(input.size()!=1||!input.has("durationMs")||!input.get("durationMs").isJsonPrimitive()||!input.get("durationMs").getAsJsonPrimitive().isNumber()||input.get("durationMs").getAsDouble()!=integer(input,"durationMs",0)||integer(input,"durationMs",0)<1000||integer(input,"durationMs",0)>120000)throw new IllegalArgumentException("method.run requires integer durationMs 1000..120000");return;}
        Map<String,Set<String>> fields=Map.of("move",Set.of("forward","back","left","right","jump","sneak","sprint","ticks"),"look",Set.of("yaw","pitch"),"chat",Set.of("text"),"use",Set.of("ticks"),"menu_click",Set.of("screenToken","slot","button","type"),"close_screen",Set.of("screenToken"),"hotbar",Set.of("slot"),"gui_click",Set.of("screenToken","index"),"inventory_open",Set.of(),"minescript.run",Set.of("code","input","timeoutMs"));
        if(fields.containsKey(operation))for(String key:input.keySet())if(!fields.get(operation).contains(key))throw new IllegalArgumentException("Unknown "+operation+" input field: "+key+"; query operations for exact names (back, not backward)");
        if(operation.equals("minescript.run")) {if(!minescriptAvailable())throw new IllegalArgumentException("Minescript unavailable; explicit installation/configuration required");MinescriptRunner.validate(input);return;}
        if (!Set.of("move", "look", "chat", "use", "menu_click", "close_screen", "hotbar", "gui_click", "inventory_open").contains(operation)) throw new IllegalArgumentException("Operation unavailable; query operations");
        int ticks = integer(input, "ticks", 1); if (ticks < 1 || ticks > (operation.equals("use") ? 100 : 200)) throw new IllegalArgumentException("Invalid tick duration");
        for (String key : List.of("forward", "back", "left", "right", "jump", "sneak", "sprint")) if (input.has(key) && !(input.get(key).isJsonPrimitive() && input.get(key).getAsJsonPrimitive().isBoolean())) throw new IllegalArgumentException("Movement keys must be boolean");
        if (operation.equals("look") && (!finite(input, "yaw", -180, 180) || !finite(input, "pitch", -90, 90))) throw new IllegalArgumentException("Invalid yaw/pitch");
        if (operation.equals("chat") && (text(input, "text", "").isBlank() || text(input, "text", "").length() > 256 || text(input, "text", "").contains("\n"))) throw new IllegalArgumentException("Invalid chat text");
        if (Set.of("menu_click", "close_screen", "gui_click").contains(operation) && !screenToken.equals(text(input, "screenToken", ""))) throw new IllegalStateException("Stale screenToken");
        if (operation.equals("hotbar") && (integer(input, "slot", -1) < 0 || integer(input, "slot", -1) > 8)) throw new IllegalArgumentException("Invalid hotbar slot");
        if (operation.equals("menu_click") && (integer(input, "slot", -1) < 0 || integer(input, "slot", -1) >= client.field_1724.field_7512.field_7761.size() || integer(input, "button", 0) < 0 || integer(input, "button", 0) > 8)) throw new IllegalArgumentException("Invalid menu slot/button");
    }
    private void tick(class_310 c) {
        try {
            updateScreen();
            if (!ledger.active(System.currentTimeMillis()) || c.field_1724 == null || c.field_1687 == null) { if (current != null || !queue.isEmpty()) cancelAll("lease expired or body disconnected"); return; }
            c.field_1690.field_1837 = false;
            if (current == null && !queue.isEmpty()) {
                current = queue.remove(); validate(current.operation, current.input);
                current.before = position(); current.phase = "running"; ledger.save(current); dispatch(current);
            }
            if (current == null) return;
            ControlLedger.Action action = current;
            if(action.operation.equals("method.run")){methodSession.tick();return;}
            if (action.operation.equals("minescript.run")) {
                JsonObject reply = scripts().poll(); if(reply==null)return;
                releaseKeys(); JsonObject evidence=state();evidence.add("script",reply);
                ledger.finish(action,flag(reply,"ok")?"partial":"blocked", "Script ended; its result is a program report. Verify actual state/server effect before claiming goal completion",evidence,System.currentTimeMillis());current=null;return;
            }
            if (action.operation.equals("move") || action.operation.equals("use")) pressKeys(action);
            int duration = action.operation.equals("move") || action.operation.equals("use") ? integer(action.input, "ticks", 1) : 5;
            // START_CLIENT_TICK precedes vanilla input processing; allow all requested game ticks before releasing.
            if (action.ticks++ < duration) return;
            releaseKeys();
            double[] after = position(); double moved = Math.sqrt(Math.pow(after[0]-action.before[0],2)+Math.pow(after[1]-action.before[1],2)+Math.pow(after[2]-action.before[2],2));
            JsonObject evidence = state(); evidence.addProperty("moved", moved);
            String phase = Set.of("chat", "use", "menu_click", "gui_click").contains(action.operation) ? "partial" : action.operation.equals("move") && moved < .02 ? "blocked" : "completed";
            ledger.finish(action, phase, phase.equals("partial") ? "Input dispatched; verify actual server/inventory/GUI effect before claiming success" : phase.equals("blocked") ? "No actual movement. Inspect collision, GUI and actual movement key names before changing the plan" : null, evidence, System.currentTimeMillis()); current = null;
        } catch (Exception error) {
            try { cancelScript(); releaseKeys(); if (current != null) ledger.finish(current, scriptStopUnconfirmed?"unknown":"blocked", error.getMessage(), new JsonObject(), System.currentTimeMillis()); } catch (Exception ignored) {}
            current = null;
        }
    }
    private void dispatch(ControlLedger.Action action) throws Exception {
        JsonObject input = action.input;
        switch (action.operation) {
            case "method.run" -> methodSession=new MethodSession(client,integer(input,"durationMs",60000));
            case "minescript.run" -> scripts().start(action.id,input);
            case "look" -> { client.field_1724.method_36456(input.get("yaw").getAsFloat()); client.field_1724.method_36457(input.get("pitch").getAsFloat()); }
            case "chat" -> { String value = text(input, "text", ""); if (value.startsWith("/")) client.method_1562().method_45730(value.substring(1)); else client.method_1562().method_45729(value); }
            case "hotbar" -> client.field_1724.method_31548().field_7545 = integer(input, "slot", 0);
            case "close_screen" -> client.field_1724.method_7346();
            case "inventory_open" -> client.method_1507(new class_490(client.field_1724));
            case "menu_click" -> {
                class_1713 type = switch (text(input, "type", "PICKUP")) { case "PICKUP" -> class_1713.field_7790; case "QUICK_MOVE" -> class_1713.field_7794; case "SWAP" -> class_1713.field_7791; default -> throw new IllegalArgumentException("Unsupported slot click type"); };
                client.field_1761.method_2906(client.field_1724.field_7512.field_7763, integer(input, "slot", -1), integer(input, "button", 0), type, client.field_1724);
            }
            case "gui_click" -> {
                List<class_4185> buttons = buttons(); int index = integer(input, "index", -1);
                if (index < 0 || index >= buttons.size() || !buttons.get(index).field_22763 || !buttons.get(index).field_22764) throw new IllegalArgumentException("GUI button unavailable");
                buttons.get(index).method_25306();
            }
        }
    }
    private void pressKeys(ControlLedger.Action action) {
        JsonObject input = action.input; class_315 options = client.field_1690;
        options.field_1894.method_23481(flag(input,"forward")); options.field_1881.method_23481(flag(input,"back")); options.field_1913.method_23481(flag(input,"left")); options.field_1849.method_23481(flag(input,"right"));
        options.field_1903.method_23481(flag(input,"jump")); options.field_1832.method_23481(flag(input,"sneak")); options.field_1867.method_23481(flag(input,"sprint")); options.field_1904.method_23481(action.operation.equals("use"));
    }
    private void releaseKeys() { methodSession=null; if (client == null) return; class_315 o=client.field_1690; for (class_304 key : List.of(o.field_1894,o.field_1881,o.field_1913,o.field_1849,o.field_1903,o.field_1832,o.field_1867,o.field_1904,o.field_1886)) key.method_23481(false); }
    private void cancelAll(String reason) { cancelScript(); try { releaseKeys(); if (current != null) ledger.finish(current,"cancelled",reason,new JsonObject(),System.currentTimeMillis()); for(var action:queue) ledger.finish(action,"cancelled",reason,new JsonObject(),System.currentTimeMillis()); } catch(Exception ignored) {} current=null;queue.clear(); }
    private void connected() { if (client.field_1724 == null || client.field_1687 == null || client.method_1562() == null) throw new IllegalStateException("Client is not connected to a world"); }
    private double[] position() { return new double[]{client.field_1724.method_23317(),client.field_1724.method_23318(),client.field_1724.method_23321()}; }
    private void updateScreen() { Object handler=client.field_1724 == null ? null : client.field_1724.field_7512; if(lastScreen!=client.field_1755 || lastHandler!=handler) {screenToken=UUID.randomUUID().toString();lastScreen=client.field_1755;lastHandler=handler;} }
    private List<class_4185> buttons() { return client.field_1755 == null ? List.of() : client.field_1755.method_25396().stream().filter(child -> child instanceof class_4185).map(child -> (class_4185)child).toList(); }
    private JsonObject item(class_1799 stack, int slot) {
        JsonObject item=new JsonObject(); item.addProperty("slot",slot);item.addProperty("empty",stack.method_7960());item.addProperty("count",stack.method_7947());
        if(!stack.method_7960()) {
            item.addProperty("name",class_7923.field_41178.method_10221(stack.method_7909()).toString());item.addProperty("displayName",stack.method_7964().getString());
            item.add("encoded",class_1799.field_24671.encodeStart(class_6903.method_46632(JsonOps.INSTANCE,client.field_1724.method_56673()),stack).result().orElse(JsonNull.INSTANCE));
            item.addProperty("components",stack.method_57353().toString());
        }
        return item;
    }
    private JsonObject state() {
        updateScreen(); JsonObject state=new JsonObject();state.addProperty("protocol",PROTOCOL);state.addProperty("sampledAt",Instant.now().toString());state.addProperty("generation",generation);
        state.addProperty("connected",client.field_1724!=null&&client.field_1687!=null);state.addProperty("server",client.method_1558()==null?"":client.method_1558().field_3761);state.addProperty("controllerId",ledger.owner(System.currentTimeMillis()));
        state.addProperty("screenToken",screenToken);state.addProperty("screen",client.field_1755==null?"":client.field_1755.getClass().getName());state.addProperty("screenTitle",client.field_1755==null?"":client.field_1755.method_25440().getString());
        JsonArray buttons=new JsonArray();int index=0;for(var button:buttons()){JsonObject b=new JsonObject();b.addProperty("index",index++);b.addProperty("label",button.method_25369().getString());b.addProperty("active",button.field_22763);buttons.add(b);}state.add("buttons",buttons);
        state.add("messages",gson.toJsonTree(messages));
        JsonArray actionStates=new JsonArray();for(var action:ledger.recent()){JsonObject summary=new JsonObject();summary.addProperty("id",action.id);summary.addProperty("phase",action.phase);summary.addProperty("updatedAt",action.updatedAt);actionStates.add(summary);}state.add("actions",actionStates);
        if(client.field_1724!=null&&client.field_1687!=null){
            var player=client.field_1724;state.addProperty("uuid",player.method_5667().toString());state.addProperty("username",player.method_5477().getString());state.add("position",gson.toJsonTree(position()));
            state.addProperty("yaw",player.method_36454());state.addProperty("pitch",player.method_36455());state.addProperty("health",player.method_6032());state.addProperty("food",player.method_7344().method_7586());state.addProperty("dimension",client.field_1687.method_27983().method_29177().toString());
            state.addProperty("worldTime",client.field_1687.method_8532());state.addProperty("raining",client.field_1687.method_8419());
            JsonArray inventory=new JsonArray();var inv=player.method_31548();for(int slot=0;slot<inv.method_5439();slot++) inventory.add(item(inv.method_5438(slot),slot));state.add("inventory",inventory);state.addProperty("selectedSlot",inv.field_7545);
            var menu=player.field_7512;JsonArray slots=new JsonArray();for(int slot=0;slot<menu.field_7761.size();slot++) slots.add(item(menu.field_7761.get(slot).method_7677(),slot));state.add("menuSlots",slots);state.add("cursor",item(menu.method_34255(),-1));state.addProperty("syncId",menu.field_7763);state.addProperty("menuRevision",menu.method_37421());
        }
        return state;
    }
    private static JsonObject object(JsonObject value,String key){return value.has(key)&&value.get(key).isJsonObject()?value.getAsJsonObject(key):new JsonObject();}
    private static String text(JsonObject value,String key,String fallback){return value.has(key)&&value.get(key).isJsonPrimitive()?value.get(key).getAsString():fallback;}
    private static int integer(JsonObject value,String key,int fallback){return value.has(key)?value.get(key).getAsInt():fallback;}
    private static boolean flag(JsonObject value,String key){return value.has(key)&&value.get(key).getAsBoolean();}
    private static boolean finite(JsonObject value,String key,double min,double max){if(!value.has(key))return false;double number=value.get(key).getAsDouble();return Double.isFinite(number)&&number>=min&&number<=max;}
}
