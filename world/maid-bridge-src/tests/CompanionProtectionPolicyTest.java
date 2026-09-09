package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.UUID;

/** The guard is one explicit entity/owner pair, including disabled and malformed-config boundaries. */
public final class CompanionProtectionPolicyTest {
    private static int checks;
    private static final UUID BODY = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static JsonObject valid() {
        return JsonParser.parseString("{\"schema\":1,\"enabled\":true,\"bodyUuid\":\"" + BODY
            + "\",\"ownerUuid\":\"" + OWNER + "\"}").getAsJsonObject();
    }
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("protection check " + checks); }
    private static void rejects(String text) {
        try { CompanionProtectionPolicy.parse(text); throw new AssertionError("accepted invalid config"); }
        catch (IllegalArgumentException | IllegalStateException expected) { checks++; }
    }
    public static void main(String[] args) {
        var policy = CompanionProtectionPolicy.parse(valid().toString());
        check(policy.matches(BODY, OWNER));
        check(!policy.matches(OWNER, BODY));
        check(!policy.matches(BODY, null));
        check(!policy.matches(null, OWNER));
        check(!policy.matches(UUID.randomUUID(), OWNER));
        check(!policy.matches(BODY, UUID.randomUUID()));
        check(!CompanionProtectionPolicy.disabled().matches(BODY, OWNER));
        var input = valid(); input.addProperty("enabled", false);
        check(!CompanionProtectionPolicy.parse(input.toString()).matches(BODY, OWNER));
        input = valid(); input.addProperty("schema", "1"); rejects(input.toString());
        input = valid(); input.addProperty("schema", 1.0); rejects(input.toString());
        input = valid(); input.addProperty("enabled", "true"); rejects(input.toString());
        input = valid(); input.addProperty("bodyUuid", "0-0-0-0-1"); rejects(input.toString());
        input = valid(); input.addProperty("bodyUuid", "@e[type=touhou_little_maid:maid]"); rejects(input.toString());
        input = valid(); input.addProperty("ownerUuid", BODY.toString()); rejects(input.toString());
        input = valid(); input.addProperty("global", true); rejects(input.toString());
        input = valid(); input.remove("ownerUuid"); rejects(input.toString());
        rejects(" ".repeat(4097));
        System.out.println("{\"ok\":true,\"suite\":\"companion-protection-policy\",\"checks\":" + checks + "}");
    }
}
