package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import net.minecraft.resources.ResourceLocation;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Real TLM site objects; no Minecraft world, configuration writes, HTTP or inference. */
public final class CompanionChatSiteTest {
    private static int checks;
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("site check " + checks); }
    private static void failure(String code, Runnable action) {
        try { action.run(); throw new AssertionError("expected " + code); }
        catch (BridgeProtocol.Failure actual) { check(actual.code.equals(code)); }
    }
    private static LLMOpenAISite nativeSite(String id, boolean enabled, String model) {
        return new LLMOpenAISite(id,
            ResourceLocation.parse("touhou_little_maid:textures/gui/ai_chat/openai.png"),
            "http://example.invalid", enabled, "", new HashMap<>(), List.of(new LLMOpenAISite.ModelEntry(model)));
    }
    public static void main(String[] args) {
        var codingplan = new BridgeSite(nativeSite("codingplan", true, CompanionChat.MODEL));
        var deepseek = new BridgeSite(nativeSite("deepseek", false, CompanionChat.MODEL));
        Map<String, LLMSite> sites = new HashMap<>(Map.of("codingplan", codingplan, "deepseek", deepseek));
        // Production regression: a disabled legacy label must not block the one enabled bridge.
        check(CompanionChat.selectSite("deepseek", sites).equals("codingplan"));
        check(CompanionChat.selectSite("", sites).equals("codingplan"));
        check(CompanionChat.selectSite("codingplan", sites).equals("codingplan"));
        check(CompanionChat.selectSite(null, sites).equals("codingplan"));
        check(!deepseek.enabled() && codingplan.enabled());
        var other = new BridgeSite(nativeSite("other", true, CompanionChat.MODEL));
        sites.put("other", other);
        check(CompanionChat.selectSite("codingplan", sites).equals("codingplan"));
        check(CompanionChat.selectSite("other", sites).equals("other"));
        failure("bridge_site_selection_ambiguous", () -> CompanionChat.selectSite("deepseek", sites));
        failure("enabled_bridge_site_required", () -> CompanionChat.selectSite("deepseek", Map.of("deepseek", deepseek)));
        failure("enabled_bridge_site_required", () -> CompanionChat.selectSite("codingplan", Map.of(
            "codingplan", nativeSite("codingplan", true, CompanionChat.MODEL))));
        failure("enabled_bridge_site_required", () -> CompanionChat.selectSite("other", Map.of(
            "other", new BridgeSite(nativeSite("other", true, "unrelated-model")))));
        check(!deepseek.enabled() && codingplan.enabled() && other.enabled());
        check(codingplan.models().size() == 1 && codingplan.models().containsKey(CompanionChat.MODEL));
        System.out.println("{\"ok\":true,\"suite\":\"companion-chat-site-selection\",\"checks\":" + checks + "}");
    }
}
