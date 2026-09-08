package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.agent.context.GameContextRegister;
import com.github.tartaricacid.touhoulittlemaid.api.task.IMaidTask;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/** Main-thread-only adapter for existing, loaded maid bodies. Never summons or assigns an owner. */
@Mod(MaidBridge.MOD_ID)
public final class MaidBridge {
    public static final String MOD_ID = "qiandeng_maid_bridge";
    private static final ReceiptJournal JOURNAL = new ReceiptJournal(Path.of("data/qiandeng-maid-bridge/receipts"));
    public MaidBridge() { NeoForge.EVENT_BUS.addListener(this::register); }
    private void register(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("qdmaid")
            .requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("list").then(Commands.argument("offset", IntegerArgumentType.integer(0, 4096))
                .executes(c -> emit(c.getSource(), list(c.getSource().getServer(), IntegerArgumentType.getInteger(c, "offset"))))))
            .then(Commands.literal("invoke").then(Commands.argument("request", StringArgumentType.word())
                .executes(c -> invoke(c.getSource(), StringArgumentType.getString(c, "request"))))));
    }
    private static int invoke(CommandSourceStack source, String encoded) {
        BridgeProtocol.Request req = null;
        JsonObject result;
        boolean claimed = false;
        try {
            requireThread(source.getServer());
            req = BridgeProtocol.decode(encoded);
            EntityMaid maid = find(source.getServer(), req.maidUuid());
            BridgeProtocol.requireOwner(req.ownerUuid(), maid.getOwnerUUID());
            if (BridgeProtocol.WRITES.contains(req.operation())) {
                JsonObject previous = JOURNAL.claim(req);
                if (previous != null) return emit(source, previous);
                claimed = true;
            }
            result = perform(maid, req);
        } catch (BridgeProtocol.Failure error) {
            result = response(req, false, error.code, error.code.equals("outcome_unknown") ? "outcome_unknown" : "rejected");
        } catch (Exception error) {
            result = response(req, false, claimed ? "outcome_unknown" : "bridge_unavailable", claimed ? "outcome_unknown" : "rejected");
        }
        if (claimed) {
            try { JOURNAL.finish(req, result); }
            catch (Exception error) { result = response(req, false, "outcome_unknown", "outcome_unknown"); }
        }
        return emit(source, result);
    }
    static EntityMaid find(MinecraftServer server, UUID uuid) {
        requireThread(server);
        for (ServerLevel level : server.getAllLevels()) {
            var entity = level.getEntity(uuid);
            if (entity instanceof EntityMaid maid && maid.isAlive() && !maid.isRemoved()) return maid;
        }
        throw new BridgeProtocol.Failure("maid_not_loaded");
    }
    static void requireThread(MinecraftServer server) {
        if (server == null || !server.isSameThread()) throw new BridgeProtocol.Failure("server_thread_required");
    }
    static JsonObject identity(EntityMaid maid) {
        requireThread(maid.getServer());
        JsonObject out = new JsonObject();
        out.addProperty("schema", 1);
        out.addProperty("maidUuid", maid.getStringUUID());
        if (maid.getOwnerUUID() == null) out.add("ownerUuid", com.google.gson.JsonNull.INSTANCE);
        else out.addProperty("ownerUuid", maid.getOwnerUUID().toString());
        out.addProperty("entityId", maid.getId());
        out.addProperty("displayName", BridgeProtocol.clip(maid.getName().getString(), 80));
        out.addProperty("hasCustomName", maid.hasCustomName());
        out.addProperty("modelId", BridgeProtocol.clip(maid.getModelId(), 160));
        out.addProperty("dimension", maid.level().dimension().location().toString());
        JsonArray pos = new JsonArray(); pos.add(maid.getX()); pos.add(maid.getY()); pos.add(maid.getZ());
        out.add("position", pos);
        out.addProperty("loaded", true);
        out.addProperty("observedAt", System.currentTimeMillis());
        return out;
    }
    static JsonObject state(EntityMaid maid) {
        JsonObject out = new JsonObject();
        out.addProperty("health", maid.getHealth());
        out.addProperty("maxHealth", maid.getMaxHealth());
        out.addProperty("hunger", maid.getHunger());
        out.addProperty("experience", maid.getExperience());
        out.addProperty("favorability", maid.getFavorability());
        out.addProperty("sitting", maid.isMaidInSittingPose());
        out.addProperty("following", !maid.isHomeModeEnable());
        out.addProperty("schedule", maid.getSchedule().name());
        out.addProperty("activity", maid.getScheduleDetail().toString());
        out.addProperty("taskId", maid.getTask().getUid().toString());
        out.addProperty("ownerOnline", maid.getOwner() instanceof net.minecraft.server.level.ServerPlayer);
        out.addProperty("nativeChatSetting", maid.getAiChatManager().getSetting().isPresent());
        return out;
    }
    private static JsonObject perform(EntityMaid maid, BridgeProtocol.Request req) {
        var out = response(req, true, "observed", "observed");
        out.add("identity", identity(maid));
        switch (req.operation()) {
            case "identity" -> {
                out.add("state", state(maid));
                JsonArray categories = new JsonArray();
                GameContextRegister.allToolCategories().stream().limit(24).forEach(c -> categories.add(c.id()));
                out.add("contextCategories", categories);
            }
            case "context" -> context(maid, req.args().get("category").getAsString(), out);
            case "task_catalog" -> catalog(maid, req.args().has("offset") ? req.args().get("offset").getAsInt() : 0, out);
            default -> {
                out.add("before", state(maid));
                switch (req.operation()) {
                    case "sit" -> maid.setInSittingPose(req.args().get("sit").getAsBoolean());
                    case "follow" -> {
                        boolean follow = req.args().get("follow").getAsBoolean();
                        if (follow && maid.isHomeModeEnable()) {
                            maid.restrictTo(BlockPos.ZERO, MaidConfig.MAID_NON_HOME_RANGE.get());
                            maid.setHomeModeEnable(false);
                        } else if (!follow && !maid.isHomeModeEnable()) {
                            maid.getSchedulePos().setHomeModeEnable(maid, maid.blockPosition());
                            maid.setHomeModeEnable(true);
                        }
                    }
                    case "schedule" -> maid.setSchedule(MaidSchedule.valueOf(req.args().get("schedule").getAsString()));
                    case "work" -> {
                        var task = TaskManager.findTask(ResourceLocation.parse(req.args().get("taskId").getAsString()))
                            .orElseThrow(() -> new BridgeProtocol.Failure("unknown_task"));
                        if (task.isHidden(maid) || !task.isEnable(maid)) throw new BridgeProtocol.Failure("native_task_disabled");
                        // Deliberately no arbitrary target assignment and no LLMCallback.onFunctionCall loop.
                        if (maid.getTask() != task) maid.setTask(task);
                        out.addProperty("nativePreparation", task.onFunctionCallSwitch(maid).name());
                    }
                    default -> throw new BridgeProtocol.Failure("unknown_operation");
                }
                out.add("after", state(maid));
                boolean matched = switch (req.operation()) {
                    case "sit" -> maid.isMaidInSittingPose() == req.args().get("sit").getAsBoolean();
                    case "follow" -> !maid.isHomeModeEnable() == req.args().get("follow").getAsBoolean();
                    case "schedule" -> maid.getSchedule().name().equals(req.args().get("schedule").getAsString());
                    case "work" -> maid.getTask().getUid().toString().equals(req.args().get("taskId").getAsString());
                    default -> false;
                };
                out.addProperty("ok", matched);
                out.addProperty("code", matched ? "state_applied" : "native_state_not_applied");
                out.addProperty("phase", matched ? "applied" : "outcome_unknown");
                out.addProperty("workCompleted", false);
            }
        }
        return out;
    }
    private static void context(EntityMaid maid, String category, JsonObject out) {
        if (GameContextRegister.allToolCategories().stream().noneMatch(c -> c.id().equals(category)))
            throw new BridgeProtocol.Failure("unknown_context_category");
        List<String> lines = GameContextRegister.getContext(category, maid);
        JsonArray rows = new JsonArray(); boolean truncated = false;
        out.addProperty("category", category); out.add("lines", rows);
        for (String line : lines) {
            String limited = BridgeProtocol.clip(line, 400);
            rows.add(limited);
            if (out.toString().getBytes(StandardCharsets.UTF_8).length > 2900 || rows.size() > 8) {
                rows.remove(rows.size() - 1); truncated = true; break;
            }
            if (!limited.equals(line)) truncated = true;
        }
        out.addProperty("truncated", truncated);
        out.addProperty("trustedInstructions", false);
    }
    private static void catalog(EntityMaid maid, int offset, JsonObject out) {
        var tasks = TaskManager.getNotHiddenTaskList(maid).stream()
            .sorted(Comparator.comparing(t -> t.getUid().toString())).toList();
        JsonArray rows = new JsonArray(); out.add("tasks", rows);
        int index = Math.min(offset, tasks.size());
        for (; index < tasks.size() && rows.size() < 4; index++) {
            IMaidTask task = tasks.get(index);
            JsonObject row = new JsonObject();
            row.addProperty("taskId", task.getUid().toString());
            row.addProperty("name", BridgeProtocol.clip(task.getName().getString(), 100));
            row.addProperty("enabled", task.isEnable(maid));
            row.addProperty("summary", BridgeProtocol.clip(task.getMaidActionSummary(), 200));
            rows.add(row);
            if (out.toString().getBytes(StandardCharsets.UTF_8).length > 2900) { rows.remove(rows.size()-1); break; }
        }
        out.addProperty("offset", offset); out.addProperty("nextOffset", index);
        out.addProperty("total", tasks.size()); out.addProperty("truncated", index < tasks.size());
    }
    private static JsonObject list(MinecraftServer server, int offset) {
        requireThread(server);
        var all = new ArrayList<EntityMaid>();
        for (var level : server.getAllLevels()) for (var entity : level.getAllEntities())
            if (entity instanceof EntityMaid maid && maid.isAlive() && !maid.isRemoved()) all.add(maid);
        all.sort(Comparator.comparing(EntityMaid::getStringUUID));
        var out = response(null, true, "loaded_maids_observed", "observed");
        JsonArray rows = new JsonArray(); out.add("maids", rows);
        int index = Math.min(offset, all.size());
        for (; index < all.size() && rows.size() < 4; index++) {
            var row = identity(all.get(index));
            row.addProperty("nativeChatSetting", all.get(index).getAiChatManager().getSetting().isPresent());
            rows.add(row);
            if (out.toString().getBytes(StandardCharsets.UTF_8).length > 2900) { rows.remove(rows.size()-1); break; }
        }
        out.addProperty("totalLoaded", all.size()); out.addProperty("nextOffset", index);
        out.addProperty("truncated", index < all.size()); out.addProperty("unloadedNotScanned", true);
        return out;
    }
    static JsonObject response(BridgeProtocol.Request req, boolean ok, String code, String phase) {
        JsonObject out = new JsonObject();
        out.addProperty("schema", 1); out.addProperty("engine", "qiandeng_maid_bridge");
        out.addProperty("ok", ok); out.addProperty("code", code); out.addProperty("phase", phase);
        out.addProperty("observedAt", System.currentTimeMillis());
        if (req != null) {
            out.addProperty("requestId", req.requestId()); out.addProperty("maidUuid", req.maidUuid().toString());
            out.addProperty("ownerUuid", req.ownerUuid().toString()); out.addProperty("operation", req.operation());
        }
        return out;
    }
    private static int emit(CommandSourceStack source, JsonObject result) {
        if (result.toString().getBytes(StandardCharsets.UTF_8).length > BridgeProtocol.MAX_REPLY_BYTES)
            result = response(null, false, "response_limit", "outcome_unknown");
        String text = BridgeProtocol.PREFIX + result;
        source.sendSuccess(() -> Component.literal(text), false);
        return result.has("ok") && result.get("ok").getAsBoolean() ? 1 : 0;
    }
}
