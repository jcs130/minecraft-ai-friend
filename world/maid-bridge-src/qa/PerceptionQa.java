package dev.qiandeng.maidqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.ChatClientInfo;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatManager;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatSerializable;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.qiandeng.maid.YuiRescue;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.util.List;
import java.util.UUID;

/** Real TLM callbacks in a fresh, internally networked world only; never part of the bridge JAR. */
@Mod("qiandeng_maid_perception_qa")
public final class PerceptionQa {
    private EntityMaid yui;
    private EntityMaid other;
    private boolean burstSubmitted;
    public PerceptionQa() { NeoForge.EVENT_BUS.addListener(this::register); }

    private void register(RegisterCommandsEvent event) {
        if (!"isolated-maid-bridge".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("isolated_fixture_required");
        event.getDispatcher().register(Commands.literal("qdperceptionqa")
            .requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(c -> {
                var server = c.getSource().getServer(); var level = server.overworld();
                String action = StringArgumentType.getString(c, "action"); JsonObject out = new JsonObject();
                try {
                    if (action.equals("setup")) {
                        if (yui != null || level.getEntity(YuiRescue.YUI) != null
                                || server.getPlayerList().getPlayer(YuiRescue.KIRITO) != null)
                            throw new IllegalStateException("fixture_already_created");
                        AIConfig.LLM_ENABLED.set(true);
                        var kirito = CompanionFactory.spawn(server, YuiRescue.KIRITO, "PerceptionQaKirito",
                            UUID.fromString("40faf2cc-c96b-49e0-a951-8e55e4a7f159"), level, new Vec3(0.5, -60, 0.5));
                        yui = new EntityMaid(level); yui.setUUID(YuiRescue.YUI); yui.setPos(1.5, -60, 0.5);
                        initialize(yui, kirito, "Perception QA Yui"); level.addFreshEntity(yui);
                        var owner = CompanionFactory.spawn(server, UUID.randomUUID(), "PerceptionQaOther",
                            UUID.randomUUID(), level, new Vec3(5.5, -60, 0.5));
                        other = new EntityMaid(level); other.setPos(6.5, -60, 0.5);
                        initialize(other, owner, "Perception QA synchronous"); level.addFreshEntity(other);
                    } else if (action.equals("burst")) {
                        if (burstSubmitted) throw new IllegalStateException("burst_already_submitted");
                        burstSubmitted = true;
                        // Same server tick, before any HTTP callback can release a per-body lock.
                        for (int i = 1; i <= 3; i++) chat(yui, "PERCEPTION_QA_INPUT_" + i);
                        out.addProperty("submitted", 3);
                    } else if (action.equals("normal")) {
                        chat(other, "PERCEPTION_QA_NORMAL"); out.addProperty("submitted", 1);
                    } else if (action.equals("subclass")) {
                        var manager = yui.getAiChatManager();
                        manager.getLLMSite().client().chat(new NormalSubclass(manager,
                            List.of(LLMMessage.userChat(yui, "PERCEPTION_QA_SUBCLASS"))));
                        out.addProperty("submitted", 1);
                    } else if (action.equals("long_history")) {
                        // Normal native manager path, including its unchanged
                        // summary policy. This old input exceeds the bridge's
                        // synchronous 12k character budget by itself.
                        yui.getAiChatManager().addUserHistory("PERCEPTION_QA_OLD_CONTEXT_" + "x".repeat(13000));
                        chat(yui, "PERCEPTION_QA_AFTER_LONG_HISTORY");
                        out.addProperty("submitted", 1);
                    } else if (action.equals("invalid")) {
                        chat(yui, "PERCEPTION_QA_INVALID_RECEIPT"); out.addProperty("submitted", 1);
                    } else if (!action.equals("status")) throw new IllegalStateException("unknown_fixture_action");
                    out.addProperty("ok", true);
                    if (yui != null) out.add("yui", describe(yui));
                    if (other != null) out.add("other", describe(other));
                } catch (Exception error) {
                    out.addProperty("ok", false); out.addProperty("failure", error.getClass().getSimpleName() + ":" + error.getMessage());
                }
                c.getSource().sendSuccess(() -> Component.literal("QD_PERCEPTION_QA " + out), false);
                return out.get("ok").getAsBoolean() ? 1 : 0;
            })));
    }

    private static void initialize(EntityMaid maid, ServerPlayer owner, String name) {
        maid.tame(owner); maid.setCustomName(Component.literal(name));
        maid.setPersistenceRequired(); maid.setInvulnerable(true); maid.setNoAi(true);
        var manager = maid.getAiChatManager(); manager.llmSite = "codingplan";
        manager.llmModel = "qd-maid-dialogue"; manager.ttsSite = MaidAIChatSerializable.NO_TTS_SITE;
        manager.customSetting = "You are an isolated deterministic QA fixture, with no external service or model.";
    }

    private static void chat(EntityMaid maid, String text) {
        maid.getAiChatManager().chat(text, new ChatClientInfo("en_us", maid.getName().getString(),
            List.of("Internal isolated QA fixture only")), (ServerPlayer) maid.getOwner());
    }

    private static JsonObject describe(EntityMaid maid) {
        JsonObject row = new JsonObject(); row.addProperty("maidUuid", maid.getStringUUID());
        row.addProperty("ownerUuid", maid.getOwnerUUID().toString());
        row.addProperty("ownerType", maid.getOwner() == null ? "unavailable" : maid.getOwner().getClass().getName());
        row.addProperty("siteClass", maid.getAiChatManager().getLLMSite().getClass().getName());
        JsonArray assistants = new JsonArray(); JsonArray users = new JsonArray();
        int[] userCharacters = {0};
        maid.getAiChatManager().getHistory().getDeque().forEach(message -> {
            if (message.role().getId().equals("assistant")) assistants.add(message.message());
            if (message.role().getId().equals("user")) {
                userCharacters[0] += message.message().length();
                // RCON framing is not a history transport. Preserve exact length
                // but keep this QA observation beneath the native packet limit.
                users.add(message.message().substring(0, Math.min(160, message.message().length())));
            }
        });
        row.add("assistantHistory", assistants); row.add("userHistory", users);
        row.addProperty("userHistoryCharacters", userCharacters[0]);
        var bubbles = maid.getChatBubbleManager().getChatBubbleDataCollection();
        row.addProperty("bubbleCount", bubbles.size());
        JsonArray bubbleKinds = new JsonArray(); bubbles.chatBubbles().values().forEach(b -> bubbleKinds.add(b.getClass().getName()));
        row.add("bubbleKinds", bubbleKinds); return row;
    }

    /** A callback subclass must keep the synchronous response contract, even on the fixed Yui body. */
    private static final class NormalSubclass extends LLMCallback {
        NormalSubclass(MaidAIChatManager manager, List<LLMMessage> messages) { super(manager, messages); }
    }
}
