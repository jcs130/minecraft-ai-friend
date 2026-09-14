import com.dwinovo.numen.core.entity.AutonomousBodyTick;
import java.util.Map;
import java.util.UUID;

/** Independent authorization regression: no server, world, body or model is constructed. */
public final class AutonomousTickPolicyTest {
    private static int checks;
    private static final UUID BODY = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    private static final UUID OWNER = UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
    private static final UUID OTHER = UUID.fromString("29c7f3a6-e1e8-4860-827b-117d02574530");
    private static final String ENTRY = "{\"bodyUuid\":\"" + BODY + "\",\"ownerUuid\":\"" + OWNER
            + "\",\"bodyName\":\"Kirito\"}";

    private static void check(boolean result, String label) {
        checks++;
        if (!result) throw new AssertionError(label);
    }

    private static void invalid(String json, String label) {
        try {
            AutonomousBodyTick.parsePolicy(json);
        } catch (IllegalArgumentException expected) {
            checks++;
            return;
        }
        throw new AssertionError("accepted invalid policy: " + label);
    }

    private static String policy(String entries) {
        return "{\"schema\":1,\"enabled\":true,\"bodies\":[" + entries + "]}";
    }

    public static void main(String[] args) {
        Map<UUID, AutonomousBodyTick.AllowedBody> entries = AutonomousBodyTick.parsePolicy(policy(ENTRY));
        var permitted = entries.get(BODY);
        check(entries.size() == 1 && permitted != null, "one explicit body");
        check(permitted.bodyUuid().equals(BODY) && permitted.ownerUuid().equals(OWNER)
                && permitted.bodyName().equals("Kirito"), "all identity fields retained");
        try {
            entries.put(OTHER, permitted);
            throw new AssertionError("mutable authorization map");
        } catch (UnsupportedOperationException expected) { checks++; }
        check(AutonomousBodyTick.parsePolicy(policy("")).isEmpty(), "empty policy grants nothing");
        check(AutonomousBodyTick.parsePolicy(policy(ENTRY).replace("true", "false")).isEmpty(),
                "disabled policy revokes grants");

        invalid("{}", "missing schema and grant");
        invalid("[]", "non-object root");
        invalid("null", "null root");
        invalid("{", "malformed JSON");
        invalid(policy(ENTRY).replace("\"schema\":1", "\"schema\":2"), "unsupported schema");
        invalid(policy(ENTRY).replace("\"enabled\":true,", ""), "missing enable");
        invalid(policy(ENTRY).replace("\"enabled\":true", "\"enabled\":\"true\""), "string enable");
        invalid(policy(ENTRY + "," + ENTRY), "duplicate body identity");
        invalid(policy(ENTRY.replace(BODY.toString(), BODY.toString().toUpperCase())), "noncanonical UUID");
        invalid(policy(ENTRY.replace(BODY.toString(), "not-a-uuid")), "invalid UUID");
        invalid(policy(ENTRY.replace("\"ownerUuid\":\"" + OWNER + "\",", "")), "missing owner");
        invalid(policy(ENTRY.replace("\"Kirito\"", "null")), "missing name");
        invalid(policy(ENTRY.replace("\"Kirito\"", "\"\"")), "empty name");
        invalid(policy(ENTRY.replace("\"Kirito\"", "\"Kirito\\n\"")), "control in name");
        invalid(" ".repeat(16385) + policy(ENTRY), "oversize input");
        StringBuilder many = new StringBuilder();
        for (int i = 0; i < 9; i++) {
            if (i > 0) many.append(',');
            many.append(ENTRY.replace(BODY.toString(), new UUID(1, i + 1).toString()));
        }
        invalid(policy(many.toString()), "more than eight explicitly allowed bodies");

        check(AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                OWNER, "Kirito", 0, false), "authorized live body with offline owner receives refresh");
        check(!AutonomousBodyTick.eligible(null, BODY, OWNER, "Kirito", true, false,
                OWNER, "Kirito", 0, false), "revoked/unconfigured body gets no refresh");
        check(!AutonomousBodyTick.eligible(permitted, OTHER, OWNER, "Kirito", true, false,
                OWNER, "Kirito", 0, false), "same name is insufficient");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OTHER, "Kirito", true, false,
                OWNER, "Kirito", 0, false), "changed body owner denied");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito2", true, false,
                OWNER, "Kirito", 0, false), "changed body name denied");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", false, false,
                OWNER, "Kirito", 0, false), "dead body receives no refresh");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, true,
                OWNER, "Kirito", 0, false), "removed body receives no refresh");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                null, null, 0, false), "missing registry entry denied");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                OTHER, "Kirito", 0, false), "registry owner mismatch denied");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                OWNER, "Kirito2", 0, false), "registry name mismatch denied");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                OWNER, "Kirito", 1, false), "native death marker stops refresh");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                OWNER, "Kirito", -1, false), "invalid death marker denied");
        check(!AutonomousBodyTick.eligible(permitted, BODY, OWNER, "Kirito", true, false,
                OWNER, "Kirito", 0, true), "online owner stays with original native ticket path");
        System.out.println("{\"ok\":true,\"assertions\":" + checks
                + ",\"scope\":\"compiled authorization gate only; no game body or chunk created\"}");
    }
}
