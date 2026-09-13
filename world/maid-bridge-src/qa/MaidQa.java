package dev.qiandeng.maidqa;

import com.dwinovo.numen.entity.CompanionFactory;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.ChatClientInfo;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatSerializable;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.setting.SettingReader;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Isolated smoke fixture only: never packaged by build_maid_bridge.py. */
@Mod("qiandeng_maid_qa")
public final class MaidQa {
    private final List<EntityMaid> maids = new ArrayList<>();
    public MaidQa() { NeoForge.EVENT_BUS.addListener(this::register); }
    private void register(RegisterCommandsEvent event) {
        if (!"isolated-maid-bridge".equals(System.getenv("QD_QA_FIXTURE")))
            throw new IllegalStateException("QA fixture requires isolated environment");
        event.getDispatcher().register(Commands.literal("qdmaidqa").requires(s -> s.getEntity() == null && s.hasPermission(4))
            .then(Commands.argument("action", StringArgumentType.word()).executes(c -> {
                String action = StringArgumentType.getString(c, "action");
                var server = c.getSource().getServer(); var level = server.overworld();
                JsonObject out = new JsonObject();
                if (action.equals("setup") && maids.isEmpty()) {
                    try {
                        var directory = SettingReader.getSettingsFolder();
                        java.nio.file.Files.createDirectories(directory);
                        java.nio.file.Files.writeString(directory.resolve("qa-setting.yml"),
                            "meta:\n  version: 1\n  author: QA fixture\n  model_id: [\"touhou_little_maid:hakurei_reimu\"]\n  language: en_us\n"
                            + "setting: You are a deterministic isolated QA fixture. Your displayed name identifies your own body.\n");
                        SettingReader.reloadSettings();
                    } catch (java.io.IOException e) { throw new IllegalStateException("fixture_setting_failed", e); }
                    for (int i = 0; i < 2; i++) {
                        var pos = new Vec3(i * 3 + 0.5, -60, 0.5);
                        var owner = CompanionFactory.spawn(server, UUID.randomUUID(), "MaidQAOwner" + i,
                            UUID.randomUUID(), level, pos);
                        var maid = new EntityMaid(level);
                        maid.setUUID(UUID.randomUUID()); maid.setPos(pos); maid.tame(owner);
                        maid.setCustomName(Component.literal("QA Maid " + i));
                        maid.setPersistenceRequired(); maid.setInvulnerable(true); maid.setNoAi(true);
                        level.addFreshEntity(maid); maids.add(maid);
                        var manager = maid.getAiChatManager(); manager.llmSite = "deepseek";
                        manager.llmModel = "qd-maid-dialogue"; manager.ttsSite = MaidAIChatSerializable.NO_TTS_SITE;
                        manager.addUserHistory("QA context for " + i);
                    }
                    out.addProperty("setup", true);
                } else if (action.equals("chat")) {
                    AIConfig.LLM_ENABLED.set(true);
                    for (var maid : maids) {
                        var manager = maid.getAiChatManager();
                        // Full native manager path: also exercises its deepseek empty-key guard.
                        manager.chat("QA deterministic request " + maid.getStringUUID(),
                            new ChatClientInfo("en_us", maid.getName().getString(), List.of("QA fixture only")),
                            (net.minecraft.server.level.ServerPlayer) maid.getOwner());
                    }
                    out.addProperty("submitted", maids.size());
                } else if (action.equals("callback")) {
                    for (var maid : maids) {
                        var manager = maid.getAiChatManager();
                        manager.getLLMSite().client().chat(new LLMCallback(manager,
                            List.of(LLMMessage.userChat(maid, "QA callback " + maid.getStringUUID()))));
                    }
                    out.addProperty("submitted", maids.size());
                } else if (!action.equals("status")) { out.addProperty("error", "unknown_action"); }
                JsonArray rows = new JsonArray();
                for (var maid : maids) {
                    JsonObject row = new JsonObject(); row.addProperty("maidUuid", maid.getStringUUID());
                    row.addProperty("ownerUuid", maid.getOwnerUUID().toString());
                    row.addProperty("ownerOnline", maid.getOwner() instanceof net.minecraft.server.level.ServerPlayer);
                    var manager = maid.getAiChatManager();
                    row.addProperty("siteClass", manager.getLLMSite().getClass().getName());
                    row.addProperty("siteId", manager.getLLMSite().id());
                    row.addProperty("nativeSetting", manager.getSetting().isPresent());
                    JsonArray history = new JsonArray();
                    manager.getHistory().getDeque().forEach(message -> { if (message.role().getId().equals("assistant")) history.add(message.message()); });
                    row.add("assistantHistory", history); rows.add(row);
                }
                out.add("maids", rows);
                c.getSource().sendSuccess(() -> Component.literal("QD_MAID_QA " + out), false);
                return 1;
            })));
    }
}
