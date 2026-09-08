package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.SerializableSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.SerializerRegister;
import com.github.tartaricacid.touhoulittlemaid.ai.service.ServiceType;
import com.github.tartaricacid.touhoulittlemaid.ai.service.SupportModelSelect;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.github.tartaricacid.touhoulittlemaid.api.ILittleMaid;
import com.github.tartaricacid.touhoulittlemaid.api.LittleMaidExtension;
import com.mojang.serialization.Codec;
import net.minecraft.resources.ResourceLocation;
import java.util.HashMap;
import java.util.List;

/** Uses the native codec shape so existing model labels and site IDs survive migration. */
public final class BridgeSite implements LLMSite, SupportModelSelect {
    public static final String TYPE = "qiandeng-qwen";
    private final LLMOpenAISite data;
    public BridgeSite(LLMOpenAISite source) {
        data = new LLMOpenAISite(source.id(), source.icon(), BridgeProtocol.ENDPOINT, source.enabled(), "", false,
              new HashMap<>(), new HashMap<>(source.modelEntries()));
    }
    // Composition avoids TLM's provider-specific instanceof/empty-key validation for legacy IDs
    // such as deepseek. This bridge has an HMAC identity key, never a dummy provider key.
    @Override public String id() { return data.id(); }
    @Override public ResourceLocation icon() { return data.icon(); }
    @Override public boolean enabled() { return data.enabled(); }
    @Override public void setEnabled(boolean enabled) { data.setEnabled(enabled); }
    @Override public java.util.Map<String, String> models() { return data.models(); }
    @Override public void addModel(String model, String name) { data.addModel(model, name); }
    @Override public void removeModel(String model) { data.removeModel(model); }
    public boolean isReasoningModel(String model) { return data.isReasoningModel(model); }
    @Override public String getApiType() { return TYPE; }
    @Override public LLMClient client() { return new BridgeClient(this); }
    // An edited URL or header can never route trusted identities to another service.
    @Override public String url() { return BridgeProtocol.ENDPOINT; }
    public String secretKey() { return ""; }
    public void setSecretKey(String ignored) {}
    public void setUrl(String ignored) {}
    @Override public java.util.Map<String, String> headers() { return java.util.Map.of(); }
    public boolean hasThinkingField() { return false; }

    public static final class Serializer implements SerializableSite<BridgeSite> {
        private static final Codec<BridgeSite> CODEC = LLMOpenAISite.Serializer.CODEC.xmap(BridgeSite::new, site -> site.data);
        @Override public Codec<BridgeSite> codec() { return CODEC; }
        @Override public BridgeSite defaultSite() {
            return new BridgeSite(new LLMOpenAISite(TYPE,
                ResourceLocation.parse("touhou_little_maid:textures/gui/ai_chat/openai.png"),
                BridgeProtocol.ENDPOINT, false, "", new HashMap<>(), List.of(new LLMOpenAISite.ModelEntry("qd-maid-dialogue"))));
        }
    }

    @LittleMaidExtension
    public static final class Extension implements ILittleMaid {
        public Extension() {}
        @Override public void registerAIChatSerializer(SerializerRegister register) {
            register.register(ServiceType.LLM, TYPE, new Serializer());
        }
    }
}
