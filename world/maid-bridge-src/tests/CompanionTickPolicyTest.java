package dev.qiandeng.maid;
import java.util.UUID;

public final class CompanionTickPolicyTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError(checks); }
    public static void main(String[] args) {
        UUID body = UUID.fromString("e6ef6001-47c6-4f13-823c-1b724520d164");
        UUID owner = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
        UUID other = UUID.randomUUID();
        var policy = CompanionTickPolicy.parse("{\"schema\":1,\"enabled\":true,\"bodyUuid\":\"" + body + "\",\"ownerUuid\":\"" + owner + "\"}");
        check(policy.eligible(body, owner, owner, true, true, true, false, true, false, false));
        check(!CompanionTickPolicy.disabled().eligible(body, owner, owner, true, true, true, false, true, false, false));
        check(!policy.eligible(other, owner, owner, true, true, true, false, true, false, false));
        check(!policy.eligible(body, other, owner, true, true, true, false, true, false, false));
        check(!policy.eligible(body, owner, other, true, true, true, false, true, false, false));
        check(!policy.eligible(body, owner, null, true, true, true, false, true, false, false));
        check(!policy.eligible(body, owner, owner, false, true, true, false, true, false, false));
        check(!policy.eligible(body, owner, owner, true, false, true, false, true, false, false));
        check(!policy.eligible(body, owner, owner, true, true, false, false, true, false, false));
        check(!policy.eligible(body, owner, owner, true, true, true, true, true, false, false));
        check(!policy.eligible(body, owner, owner, true, true, true, false, false, false, false));
        check(!policy.eligible(body, owner, owner, true, true, true, false, true, true, false));
        check(!policy.eligible(body, owner, owner, true, true, true, false, true, false, true));
        System.out.println("{\"ok\":true,\"checks\":" + checks + "}");
    }
}
