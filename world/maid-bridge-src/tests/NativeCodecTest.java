package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.mojang.serialization.JsonOps;
import net.minecraft.resources.ResourceLocation;
import java.util.HashMap;
import java.util.List;

/** Real installed TLM codec, without starting Minecraft, HTTP requests or model inference. */
public final class NativeCodecTest {
    private static int checks;
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("codec check " + checks); }
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
        System.out.println("{\"ok\":true,\"suite\":\"maid-native-codec\",\"checks\":" + checks + "}");
    }
}
