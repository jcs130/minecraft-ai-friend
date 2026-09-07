package dev.qiandeng.chanting;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Mod(QiandengChantingItems.MOD_ID)
public final class QiandengChantingItems {
    public static final String MOD_ID = "qiandeng_chanting", PREFIX = "QD_CHANT_JSON ";
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
    public static final DeferredItem<ChantingStaffItem> WHISPERING_STAFF = ITEMS.register("whispering_staff", () -> new ChantingStaffItem(new Item.Properties().stacksTo(1)));
    public static final DeferredItem<ChantingStaffItem> RESONANCE_STAFF = ITEMS.register("resonance_staff", () -> new ChantingStaffItem(new Item.Properties().stacksTo(1)));
    private static GestureBook gestures = newBook();
    private static final Map<String, StaffAudioSession> audio = new HashMap<>();
    private static GestureBook newBook() { return new GestureBook(UUID.randomUUID().toString(), System.currentTimeMillis()); }

    public QiandengChantingItems(IEventBus bus) {
        ITEMS.register(bus);
        bus.addListener(this::creative);
        bus.addListener(this::payloads);
        NeoForge.EVENT_BUS.addListener(this::commands);
        NeoForge.EVENT_BUS.addListener(this::tick);
        NeoForge.EVENT_BUS.addListener(this::logout);
        NeoForge.EVENT_BUS.addListener(this::started);
        NeoForge.EVENT_BUS.addListener(this::stopped);
    }
    private void payloads(net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent e) {
        e.registrar("1").optional().playToServer(StaffModePayload.TYPE, StaffModePayload.CODEC,
            (payload, context) -> context.enqueueWork(() -> {
                if (context.player() instanceof ServerPlayer actor) {
                    gestures.select(key(actor), payload.slot(), pose(actor), System.currentTimeMillis());
                    var snapshot = gestures.status(key(actor), pose(actor), System.currentTimeMillis());
                    var session = audio.get(key(actor));
                    if (snapshot != null && snapshot.active() && snapshot.invalidCode() == null && session != null
                            && snapshot.id().equals(session.id()) && session.select(snapshot.slot())) boundary(actor, "hold", -1);
                }
            }));
        e.registrar("1").optional().playToServer(StaffAudioBoundaryPayload.TYPE, StaffAudioBoundaryPayload.CODEC,
            (payload, context) -> context.enqueueWork(() -> { if (context.player() instanceof ServerPlayer actor) acknowledge(actor, payload); }));
        e.registrar("1").optional().playToClient(StaffAudioStatePayload.TYPE, StaffAudioStatePayload.CODEC,
            (payload, context) -> context.enqueueWork(() -> StaffAudioMailbox.accept(payload)));
        e.registrar("1").optional().playToClient(StaffSkillbarPayload.TYPE, StaffSkillbarPayload.CODEC,
            (payload, context) -> context.enqueueWork(() -> StaffSkillbarState.accept(payload.json())));
        e.registrar("1").optional().playToServer(StaffStopPayload.TYPE, StaffStopPayload.CODEC,
            (payload, context) -> context.enqueueWork(() -> {
                if (context.player() instanceof ServerPlayer actor) {
                    gestures.cancel(key(actor), System.currentTimeMillis());
                    endAudio(actor, "cancel");
                    if (actor.isUsingItem() && actor.getUseItem().getItem() instanceof ChantingStaffItem) actor.stopUsingItem();
                }
            }));
    }
    private void creative(BuildCreativeModeTabContentsEvent e) {
        if (e.getTabKey().location().toString().equals("minecraft:tools_and_utilities")) { e.accept(WHISPERING_STAFF); e.accept(RESONANCE_STAFF); }
    }
    private void started(ServerStartedEvent e) { gestures = newBook(); audio.clear(); }
    private void stopped(ServerStoppedEvent e) { gestures = newBook(); audio.clear(); }
    static void begin(ServerPlayer p) {
        var snapshot = gestures.begin(key(p), pose(p), System.currentTimeMillis());
        if (snapshot == null) return;
        var previous = audio.get(key(p));
        if (previous != null && previous.id().equals(snapshot.id())) return;
        audio.put(key(p), new StaffAudioSession(snapshot.id()));
        boundary(p, "hold", -1); // Drop pre-gesture buffered audio before any asynchronous packet arrives.
        if (p.connection.hasChannel(StaffAudioStatePayload.TYPE)) net.neoforged.neoforge.network.PacketDistributor.sendToPlayer(p,
            new StaffAudioStatePayload(0, snapshot.id(), 0, -1, true));
    }
    static void release(ServerPlayer p, ItemStack stack) {
        gestures.release(key(p), hand(p.getUsedItemHand()), stack, System.currentTimeMillis());
        endAudio(p, "release");
    }
    private static String boundary(ServerPlayer p, String phase, long floor) {
        var event = new StaffAudioBoundaryEvent(p, phase, floor);
        NeoForge.EVENT_BUS.post(event);
        return event.result();
    }
    private static void endAudio(ServerPlayer p, String phase) {
        var session = audio.get(key(p));
        if (session != null && session.end(phase)) boundary(p, phase, -1);
    }
    private static void acknowledge(ServerPlayer p, StaffAudioBoundaryPayload request) {
        var session = audio.get(key(p));
        var snapshot = gestures.status(key(p), pose(p), System.currentTimeMillis());
        boolean current = session != null && session.matches(request.gestureId(), request.revision(), request.floor())
            && snapshot != null && snapshot.id().equals(session.id()) && snapshot.active()
            && !snapshot.claimed() && snapshot.invalidCode() == null && snapshot.slot() == 0;
        String result = current ? boundary(p, "fence", request.floor()) : "stale_boundary";
        boolean accepted = result.equals("accepted");
        if (accepted) session.confirm();
        if (p.connection.hasChannel(StaffAudioStatePayload.TYPE)) net.neoforged.neoforge.network.PacketDistributor.sendToPlayer(p,
            new StaffAudioStatePayload(1, request.gestureId(), request.revision(), request.floor(), accepted));
        if (current && !accepted) p.displayClientMessage(Component.literal(result.equals("not_listening")
            ? "此玩家尚未启用语音，可用肩键选择快捷技能"
            : "语音未就绪，可用肩键选择快捷技能"), true);
    }
    private static String key(ServerPlayer p) { return p.getUUID().toString(); }
    private static String hand(InteractionHand h) { return h == InteractionHand.MAIN_HAND ? "mainhand" : "offhand"; }
    private static GestureBook.Pose pose(ServerPlayer p) {
        var hands = new HashMap<String, GestureBook.Held>();
        for (InteractionHand h : InteractionHand.values()) {
            ItemStack stack = p.getItemInHand(h);
            hands.put(hand(h), new GestureBook.Held(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(), stack));
        }
        boolean usingCurrentStack = p.isUsingItem() && p.getUseItem() == p.getItemInHand(p.getUsedItemHand());
        return new GestureBook.Pose(p.isAlive() && !p.isSpectator() && !p.isRemoved() && p.containerMenu == p.inventoryMenu, hands,
                usingCurrentStack ? hand(p.getUsedItemHand()) : "");
    }
    private void tick(ServerTickEvent.Post e) {
        long now = System.currentTimeMillis();
        for (ServerPlayer p : e.getServer().getPlayerList().getPlayers()) {
            gestures.observe(key(p), pose(p), now);
            var snapshot = gestures.status(key(p), pose(p), now);
            if (snapshot != null && snapshot.invalidCode() != null) endAudio(p, "cancel");
            else if (snapshot != null && !snapshot.active()) endAudio(p, "release");
        }
        gestures.prune(now);
    }
    private void logout(PlayerEvent.PlayerLoggedOutEvent e) {
        if (e.getEntity() instanceof ServerPlayer p) {
            gestures.observe(key(p), new GestureBook.Pose(false, Map.of(), ""), System.currentTimeMillis());
            endAudio(p, "cancel"); audio.remove(key(p));
        }
    }
    private void commands(RegisterCommandsEvent e) {
        var root = Commands.literal("qdchant").requires(s -> s.hasPermission(2));
        root.then(Commands.literal("health").executes(c -> emit(c.getSource(), health())));
        root.then(Commands.literal("bar").then(Commands.argument("actor", StringArgumentType.word())
            .then(Commands.argument("data", StringArgumentType.word()).executes(c -> syncBar(c.getSource(),
                StringArgumentType.getString(c, "actor"), StringArgumentType.getString(c, "data"))))));
        root.then(Commands.literal("status").then(Commands.argument("actor", StringArgumentType.string())
            .executes(c -> run(c.getSource(), StringArgumentType.getString(c, "actor"), null, null, 0))));
        root.then(Commands.literal("claim").then(Commands.argument("actor", StringArgumentType.string())
            .then(Commands.argument("recordedAt", LongArgumentType.longArg())
            .then(Commands.argument("recordingEndedAt", LongArgumentType.longArg())
            .then(Commands.argument("slot", com.mojang.brigadier.arguments.IntegerArgumentType.integer(0, 8)).executes(c -> run(c.getSource(),
                StringArgumentType.getString(c, "actor"), LongArgumentType.getLong(c, "recordedAt"), LongArgumentType.getLong(c, "recordingEndedAt"), com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(c, "slot"))))))));
        e.getDispatcher().register(root);
    }
    private static int syncBar(CommandSourceStack source, String query, String encoded) {
        try {
            if (encoded.length() > 16000) throw new IllegalArgumentException("bar_too_large");
            ServerPlayer actor = resolve(source.getServer(), query);
            if (actor == null) return emit(source, base(false, "actor_not_found", "玩家不在线"));
            String json = new String(java.util.Base64.getUrlDecoder().decode(encoded), java.nio.charset.StandardCharsets.UTF_8);
            StaffSkillbarState.parse(json);
            boolean connected = actor.connection.hasChannel(StaffSkillbarPayload.TYPE);
            if (connected) net.neoforged.neoforge.network.PacketDistributor.sendToPlayer(actor, new StaffSkillbarPayload(json));
            JsonObject out = base(connected, connected ? "bar_synced" : "client_unavailable", connected ? "快捷栏已同步" : "客户端未启用言灵道具界面");
            out.addProperty("actor", actor.getGameProfile().getName());
            out.addProperty("actorUuid", key(actor));
            return emit(source, out);
        } catch (RuntimeException e) { return emit(source, base(false, "invalid_bar", "快捷栏数据无效")); }
    }
    private static JsonObject health() {
        JsonObject out = base(true, "ready", "言灵道具已加载");
        JsonArray items = new JsonArray();
        items.add(BuiltInRegistries.ITEM.getKey(WHISPERING_STAFF.get()).toString());
        items.add(BuiltInRegistries.ITEM.getKey(RESONANCE_STAFF.get()).toString());
        out.add("items", items);
        out.addProperty("audioBoundaryProtocol", 1);
        return out;
    }
    private static ServerPlayer resolve(MinecraftServer server, String query) {
        if (query == null || query.contains("@") || query.length() > 64) return null;
        UUID uuid = null;
        try { uuid = UUID.fromString(query); } catch (IllegalArgumentException ignored) {}
        var matches = new LinkedHashMap<UUID, ServerPlayer>();
        // Includes loaded Numen ServerPlayers without forcing chunks or summoning bodies.
        for (var level : server.getAllLevels()) for (var entity : level.getAllEntities()) {
            if (entity instanceof ServerPlayer p && (uuid == null ? p.getGameProfile().getName().equalsIgnoreCase(query) : p.getUUID().equals(uuid))) matches.put(p.getUUID(), p);
        }
        if (matches.size() > 1) throw new IllegalArgumentException("ambiguous_actor");
        return matches.isEmpty() ? null : matches.values().iterator().next();
    }
    private static int run(CommandSourceStack source, String query, Long recordedAt, Long recordingEndedAt, int slot) {
        JsonObject out;
        ServerPlayer actor = null;
        try {
            actor = resolve(source.getServer(), query);
            if (actor == null) return emit(source, base(false, "actor_not_found", "未找到唯一已加载的玩家，请使用登录名或 UUID"));
            var pose = pose(actor);
            long now = System.currentTimeMillis();
            GestureBook.Snapshot snapshot;
            if (recordedAt == null) {
                snapshot = gestures.status(key(actor), pose, now);
                out = base(true, "status", "当前言灵道具状态");
            } else {
                var state = gestures.status(key(actor), pose, now);
                var session = audio.get(key(actor));
                // Never consume a voice ticket before its recorder boundary was installed.
                boolean pendingAudio = slot == 0 && state != null && state.slot() == 0 && state.invalidCode() == null
                    && !state.claimed() && (session == null || !session.id().equals(state.id()) || !session.ready());
                var result = pendingAudio ? new GestureBook.Result(false, "audio_boundary_pending", state)
                    : gestures.claim(key(actor), recordedAt, recordingEndedAt, slot, pose, now);
                snapshot = result.gesture();
                out = base(result.ok(), result.code(), summary(result.code()));
                out.addProperty("recordedAt", recordedAt);
            }
            out.addProperty("actor", actor.getGameProfile().getName());
            out.addProperty("actorUuid", key(actor));
            out.addProperty("holding", pose.holding());
            out.addProperty("using", pose.using());
            out.addProperty("serverTime", now);
            var audioState = audio.get(key(actor));
            out.addProperty("audioBoundaryReady", audioState != null && audioState.ready());
            out.addProperty("audioRevision", audioState == null ? -1 : audioState.revision());
            if (snapshot != null) {
                out.addProperty("gestureId", snapshot.id());
                JsonObject g = new JsonObject();
                g.addProperty("startedAt", snapshot.startedAt());
                if (snapshot.releasedAt() == null) g.add("releasedAt", JsonNull.INSTANCE); else g.addProperty("releasedAt", snapshot.releasedAt());
                g.addProperty("itemId", snapshot.itemId()); g.addProperty("hand", snapshot.hand());
                g.addProperty("active", snapshot.active()); g.addProperty("claimed", snapshot.claimed());
                g.addProperty("slot", snapshot.slot());
                if (snapshot.invalidCode() != null) g.addProperty("invalidCode", snapshot.invalidCode());
                out.add("gesture", g);
            }
        } catch (IllegalArgumentException e) { out = base(false, "ambiguous_actor", "登录名对应多个角色，请使用 UUID"); }
        catch (Exception e) {
            out = base(false, "outcome_unknown", "手势结果待核实，不要自动重发");
            if (actor != null) { out.addProperty("actor", actor.getGameProfile().getName()); out.addProperty("actorUuid", key(actor)); }
        }
        return emit(source, out);
    }
    private static JsonObject base(boolean ok, String code, String summary) {
        JsonObject out = new JsonObject(); out.addProperty("schema", 1); out.addProperty("ok", ok);
        out.addProperty("code", code); out.addProperty("summary", summary); return out;
    }
    private static int emit(CommandSourceStack source, JsonObject out) {
        source.sendSuccess(() -> Component.literal(PREFIX + out), false);
        return out.get("ok").getAsBoolean() ? 1 : 0;
    }
    private static String summary(String code) {
        return switch (code) {
            case "audio_boundary_pending" -> "语音连接尚未准备好，请重新举杖等待提示";
            case "claimed" -> "已确认这一次言灵手势";
            case "direct_voice" -> "独立语音输入";
            case "gesture_required" -> "请长按使用言灵杖，再说出咒语";
            case "gesture_consumed" -> "这次言灵手势已经使用，请松开后重新咏唱";
            case "gesture_cancelled" -> "已结束这次言灵手势，请重新举杖";
            case "gesture_pending" -> "已听到咒语，松开使用键释放";
            case "shortcut_selected" -> "本次已选择快捷技能，松开使用键释放";
            case "slot_changed" -> "快捷槽已改变，请重新举杖选择";
            case "ambiguous_gesture", "recording_crossed_gesture", "gesture_mode_changed" -> "这句话跨过了切换动作，请重新举杖咏唱";
            case "gesture_expired" -> "言灵手势已过期，请重新咏唱";
            case "staff_changed" -> "咏唱时的言灵杖已换手或放下，本次不施法";
            case "actor_unavailable" -> "当前角色不能咏唱";
            case "server_restarted" -> "服务器已重启，请重新咏唱";
            default -> "这段录音的时间无效，请重新咏唱";
        };
    }
}
