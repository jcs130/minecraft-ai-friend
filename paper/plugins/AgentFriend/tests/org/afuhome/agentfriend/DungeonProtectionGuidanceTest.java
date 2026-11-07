package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.List;

/** Regression for a real denial that sent an Agent to the nonexistent layout command. */
public final class DungeonProtectionGuidanceTest {
    private static int checks;
    private static void check(boolean ok) {
        if (!ok) throw new AssertionError("Dungeon protection guidance check " + checks);
        checks++;
    }
    public static void main(String[] args) {
        JsonObject denial = JsonParser.parseString("""
            {"status":"deny","reason":"site_dungeon","allowed":false,"action":"break",
             "world":"minecraft:overworld","x":1151,"y":57,"z":202,"retrySameAction":false}
            """).getAsJsonObject();
        String original = denial.toString();
        JsonObject compact = ProtectionQuery.compact(denial);
        String next = compact.get("nextAction").getAsString();
        check(!next.contains("dungeon layout"));
        check(next.contains("/mycli dungeon list") && next.contains("/mycli dungeon info <ID> --verbose"));
        check(next.contains("首室坐标不是入口"));
        check(!compact.get("allowed").getAsBoolean() && !compact.get("retrySameAction").getAsBoolean());
        check(denial.toString().equals(original));
        var request = ProtectionQuery.parse(new String[]{"protect","batch","break","1151,57,202"});
        var group = ProtectionQuery.batch(request,"minecraft:overworld",List.of(denial))
                .getAsJsonArray("groups").get(0).getAsJsonObject();
        check(group.get("nextAction").getAsString().equals(next));
        denial.addProperty("boundsIncomplete",true);
        check(!ProtectionQuery.nextAction(denial).contains("dungeon"));
        denial.remove("boundsIncomplete");
        denial.addProperty("reason","unknown_worldguard");
        check(!ProtectionQuery.nextAction(denial).contains("dungeon"));
        System.out.println("PASS " + checks + " dungeon protection guidance checks");
    }
}
