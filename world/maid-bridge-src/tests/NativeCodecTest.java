package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.Role;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.AutoGenSettingCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.summary.HistorySummaryCallback;
import com.mojang.serialization.JsonOps;
import net.minecraft.resources.ResourceLocation;
import java.util.HashMap;
import java.util.List;

/** Real installed TLM codec, without starting Minecraft, HTTP requests or model inference. */
public final class NativeCodecTest {
    private static int checks;
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("codec check " + checks); }
    private static void failure(String code, Runnable action) {
        try { action.run(); throw new AssertionError("expected " + code); }
        catch (BridgeProtocol.Failure actual) { check(actual.code.equals(code)); }
    }
    public static void main(String[] args) {
        var previous = new LLMOpenAISite("preserved-site",
            ResourceLocation.parse("touhou_little_maid:textures/gui/ai_chat/openai.png"),
            "http://example.invalid/untrusted", true, "fixture-provider-value-must-not-export", true,
            new HashMap<>(java.util.Map.of("X-QD-Signature", "fixture-forged-value")),
            List.of(new LLMOpenAISite.ModelEntry("custom-label"), new LLMOpenAISite.ModelEntry("custom-reasoning", true)));
        var bridge = new BridgeSite(previous);
        check(bridge.id().equals(previous.id()));
        check(bridge.enabled());
        check(bridge.models().keySet().equals(previous.models().keySet()));
        check(bridge.getApiType().equals("qiandeng-qwen"));
        check(bridge.url().equals(BridgeProtocol.ENDPOINT));
        check(bridge.secretKey().isEmpty() && bridge.headers().isEmpty());
        check(previous.secretKey().equals("fixture-provider-value-must-not-export"));
        bridge.setSecretKey("fixture-injected-after-construction");
        bridge.setUrl("http://example.invalid/changed");
        check(bridge.secretKey().isEmpty() && bridge.url().equals(BridgeProtocol.ENDPOINT));
        var codec = new BridgeSite.Serializer().codec();
        var encoded = codec.encodeStart(JsonOps.INSTANCE, bridge).getOrThrow();
        check(!encoded.toString().contains("fixture-provider-value") && !encoded.toString().contains("fixture-forged")
            && !encoded.toString().contains("fixture-injected"));
        var restored = codec.parse(JsonOps.INSTANCE, encoded).getOrThrow();
        check(restored.id().equals("preserved-site") && restored.enabled());
        check(restored.models().keySet().equals(previous.models().keySet()));
        check(restored.isReasoningModel("custom-reasoning"));
        var defaults = new BridgeSite.Serializer().defaultSite();
        check(!defaults.enabled());
        check(defaults.models().containsKey("qd-maid-dialogue"));
        check(defaults.client() instanceof BridgeClient);
        var deepseek = new BridgeSite(new LLMOpenAISite("deepseek", previous.icon(), "", true, "",
            new HashMap<>(), List.of(new LLMOpenAISite.ModelEntry("qd-maid-dialogue"))));
        check(!((Object) deepseek instanceof LLMOpenAISite));
        check(deepseek.id().equals("deepseek") && deepseek.secretKey().isEmpty());
        var deepseekRestored = codec.parse(JsonOps.INSTANCE, codec.encodeStart(JsonOps.INSTANCE, deepseek).getOrThrow()).getOrThrow();
        check(deepseekRestored.id().equals("deepseek") && deepseekRestored.enabled());
        String numenType = "com.dwinovo.numen.entity.NumenPlayer";
        check(BridgeClient.usesPerceptionQueue(LLMCallback.class, YuiRescue.YUI, YuiRescue.KIRITO, numenType));
        check(!BridgeClient.usesPerceptionQueue(AutoGenSettingCallback.class, YuiRescue.YUI, YuiRescue.KIRITO, numenType));
        check(!BridgeClient.usesPerceptionQueue(HistorySummaryCallback.class, YuiRescue.YUI, YuiRescue.KIRITO, numenType));
        check(!BridgeClient.usesPerceptionQueue(null, YuiRescue.YUI, YuiRescue.KIRITO, numenType));
        check(!BridgeClient.usesPerceptionQueue(LLMCallback.class, java.util.UUID.randomUUID(), YuiRescue.KIRITO, numenType));
        check(!BridgeClient.usesPerceptionQueue(LLMCallback.class, YuiRescue.YUI, java.util.UUID.randomUUID(), numenType));
        check(!BridgeClient.usesPerceptionQueue(LLMCallback.class, YuiRescue.YUI, YuiRescue.KIRITO, "net.minecraft.server.level.ServerPlayer"));
        check(!BridgeClient.usesPerceptionQueue(LLMCallback.class, YuiRescue.YUI, YuiRescue.KIRITO, null));
        var history = new java.util.ArrayList<LLMMessage>();
        for (int i = 0; i < 100; i++) history.add(new LLMMessage(i % 2 == 0 ? Role.USER : Role.ASSISTANT,
            "old history " + "x".repeat(200), i));
        history.add(new LLMMessage(Role.USER, "new native input", 101));
        history.add(new LLMMessage(Role.ASSISTANT, "not the new user input", 102));
        var queuedMessages = BridgeClient.messagesForDelivery(history, true);
        check(queuedMessages.size() == 1);
        check(queuedMessages.get(0).getAsJsonObject().get("role").getAsString().equals("user"));
        check(queuedMessages.get(0).getAsJsonObject().get("content").getAsString().equals("new native input"));
        check(history.size() == 102); // Selection does not alter the native mod history.
        failure("context_limit", () -> BridgeClient.messagesForDelivery(history, false));
        failure("perception_user_input_required", () -> BridgeClient.messagesForDelivery(
            List.of(new LLMMessage(Role.ASSISTANT, "only assistant", 0)), true));
        failure("perception_user_input_required", () -> BridgeClient.messagesForDelivery(List.of(), true));
        failure("perception_user_input_required", () -> BridgeClient.messagesForDelivery(null, true));
        for (String invalid : List.of(" ", "x".repeat(8001), "before\0after")) {
            failure("perception_input_size_limit", () -> BridgeClient.messagesForDelivery(
                List.of(new LLMMessage(Role.USER, invalid, 0)), true));
        }
        check(BridgeClient.messagesForDelivery(List.of(new LLMMessage(Role.USER, "x".repeat(8000), 0)), true)
            .get(0).getAsJsonObject().get("content").getAsString().length() == 8000);
        var legacy = List.of(new LLMMessage(Role.SYSTEM, "preserved persona", 0),
            new LLMMessage(Role.USER, "old user", 1), new LLMMessage(Role.ASSISTANT, "old answer", 2),
            new LLMMessage(Role.USER, "new user", 3));
        var legacyMessages = BridgeClient.messagesForDelivery(legacy, false);
        check(legacyMessages.size() == 4);
        for (int i = 0; i < legacy.size(); i++) {
            check(legacyMessages.get(i).getAsJsonObject().get("role").getAsString().equals(legacy.get(i).role().getId()));
            check(legacyMessages.get(i).getAsJsonObject().get("content").getAsString().equals(legacy.get(i).message()));
        }
        check(BridgeClient.messagesForDelivery(java.util.Collections.nCopies(48, new LLMMessage(Role.USER, "x".repeat(250), 0)), false).size() == 48);
        failure("context_limit", () -> BridgeClient.messagesForDelivery(java.util.Collections.nCopies(49, new LLMMessage(Role.USER, "x", 0)), false));
        failure("context_limit", () -> BridgeClient.messagesForDelivery(List.of(new LLMMessage(Role.SYSTEM, "x".repeat(12001), 0)), false));
        System.out.println("{\"ok\":true,\"suite\":\"maid-native-codec\",\"checks\":" + checks + "}");
    }
}
