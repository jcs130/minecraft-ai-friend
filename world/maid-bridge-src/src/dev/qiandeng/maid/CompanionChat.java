package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMSite;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import java.util.Map;

/** Console-only setup for a normally adopted Numen companion; no adoption, prompt or model call. */
public final class CompanionChat {
    static final String MODEL = "qd-maid-dialogue";
    private CompanionChat() {}
    /** Read-only choice: preserve a valid entity selection; never enable or edit a global site. */
    static String selectSite(String current, Map<String, ? extends LLMSite> sites) {
        if (current != null && supported(sites.get(current))) return current;
        String selected = null;
        for (var entry : sites.entrySet()) {
            if (!supported(entry.getValue())) continue;
            if (selected != null) throw new BridgeProtocol.Failure("bridge_site_selection_ambiguous");
            selected = entry.getKey();
        }
        if (selected == null) throw new BridgeProtocol.Failure("enabled_bridge_site_required");
        return selected;
    }
    private static boolean supported(LLMSite site) {
        return site instanceof BridgeSite bridge && bridge.enabled() && bridge.models().containsKey(MODEL);
    }
    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("qdmaid")
            .requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.literal("companion_chat")
                .then(Commands.argument("maidUuid", StringArgumentType.word())
                    .then(Commands.argument("ownerUuid", StringArgumentType.word()).executes(c -> configure(
                        c.getSource(), StringArgumentType.getString(c, "maidUuid"),
                        StringArgumentType.getString(c, "ownerUuid")))))));
    }
    private static int configure(CommandSourceStack source, String maidId, String ownerId) {
        var result = MaidBridge.response(null, false, "rejected", "rejected");
        try {
            MaidBridge.requireThread(source.getServer());
            var maid = MaidBridge.find(source.getServer(), BridgeProtocol.uuid(maidId));
            var ownerUuid = BridgeProtocol.uuid(ownerId);
            BridgeProtocol.requireOwner(ownerUuid, maid.getOwnerUUID());
            var owner = source.getServer().getPlayerList().getPlayer(ownerUuid);
            // No hard Numen dependency for ordinary maid users; only its concrete live player qualifies.
            if (owner == null || !owner.getClass().getName().equals("com.dwinovo.numen.entity.NumenPlayer")
                || !owner.isAlive() || owner.hasDisconnected() || maid.getOwner() != owner)
                throw new BridgeProtocol.Failure("online_numen_owner_required");
            if (!AIConfig.LLM_ENABLED.get()) throw new BridgeProtocol.Failure("native_chat_globally_disabled");
            var manager = maid.getAiChatManager();
            if (manager.getSetting().isEmpty()) throw new BridgeProtocol.Failure("native_persona_setting_required");
            String selected = selectSite(manager.llmSite, AvailableSites.LLM_SITES);
            boolean unchanged = selected.equals(manager.llmSite) && MODEL.equals(manager.llmModel);
            // Idempotent native serializable fields only. Never touch customSetting, name, owner or TTS.
            manager.llmSite = selected;
            manager.llmModel = MODEL;
            result = MaidBridge.response(null, true, unchanged ? "already_configured" : "chat_configured", "applied");
            result.add("identity", MaidBridge.identity(maid));
            result.add("state", MaidBridge.state(maid));
            result.addProperty("llmSite", manager.llmSite);
            result.addProperty("llmModel", manager.llmModel);
            result.addProperty("modelCalled", false);
        } catch (BridgeProtocol.Failure error) { result.addProperty("code", error.code); }
        catch (Exception error) { result.addProperty("code", "configuration_unavailable"); }
        final String text = BridgeProtocol.PREFIX + result;
        source.sendSuccess(() -> Component.literal(text), false);
        return result.get("ok").getAsBoolean() ? 1 : 0;
    }
}
