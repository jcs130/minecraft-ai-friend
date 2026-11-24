package local.tlmcompat.hybrid;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Path;

public final class PersonalMaidVoicePolicyTest {
    private static int checks;

    private static void check(boolean value) {
        if (!value) throw new AssertionError("voice policy check " + checks);
        checks++;
    }

    private static void rejected(JsonObject row) {
        try {
            PersonalMaidDialogue.parse(row);
            throw new AssertionError("invalid voice policy accepted");
        } catch (IllegalArgumentException expected) {
            checks++;
        }
    }

    public static void main(String[] args) {
        JsonObject row = JsonParser.parseString("{\"schema\":2,\"scope\":\"player_owned\",\"packs\":{\"littlemaid_peco\":\"qa-jp\",\"chinese_pack\":\"qa-original-cn\"},\"chinesePacks\":[\"chinese_pack\"],\"chineseVoice\":\"qa-cn\"}").getAsJsonObject();
        row.addProperty("nativeEncoder", Path.of("qa-encoder").toAbsolutePath().toString());
        var policy = PersonalMaidDialogue.parse(row);
        check("qa-cn".equals(policy.selectedVoice("littlemaid_peco")));
        check("qa-original-cn".equals(policy.selectedVoice("chinese_pack")));
        check(policy.chineseFallback("littlemaid_peco"));
        check(!policy.chineseFallback("chinese_pack"));
        check(policy.selectedVoice("missing_pack") == null);
        check(policy.selectedVoice((String) null) == null);
        check("qa-jp".equals(policy.packs().get("littlemaid_peco")));
        var noFallback = row.deepCopy();
        noFallback.remove("chineseVoice");
        check("qa-jp".equals(PersonalMaidDialogue.parse(noFallback).selectedVoice("littlemaid_peco")));
        var unknown = row.deepCopy();
        unknown.getAsJsonArray("chinesePacks").add("missing_pack");
        rejected(unknown);
        var duplicate = row.deepCopy();
        duplicate.getAsJsonArray("chinesePacks").add("chinese_pack");
        rejected(duplicate);
        var badVoice = row.deepCopy();
        badVoice.addProperty("chineseVoice", "../not-a-voice");
        rejected(badVoice);
        var privateRow = JsonParser.parseString("{\"schema\":1,\"ownerId\":\"40000000-0000-0000-0000-000000000001\",\"maidId\":\"40000000-0000-0000-0000-000000000002\",\"soundPackId\":\"littlemaid_peco\",\"voice\":\"qa-original-role\"}").getAsJsonObject();
        check("qa-original-role".equals(PersonalMaidDialogue.parse(privateRow).selectedVoice("littlemaid_peco")));
        System.out.println("Personal maid Chinese voice policy: " + checks + " checks passed");
    }
}
