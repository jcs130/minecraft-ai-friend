package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class ReplantGuidanceTest {
    private static int checks;
    private static void check(String name, boolean value) { if (!value) throw new AssertionError(name); checks++; }
    private static JsonObject base(boolean ready) {
        JsonObject out = new JsonObject(); out.addProperty("ready", ready); out.addProperty("current", 0);
        out.addProperty("target", 8); out.addProperty("nextCommand", "/mycli guild claim"); return out;
    }
    public static void main(String[] args) {
        List<String> harvested = new ArrayList<>(List.of("WHEAT:a:10:64:2", "WHEAT:a:1:64:2", "WHEAT:b:0:64:0",
                "CARROTS:a:2:64:2", "WHEAT:a:1:64:2", "WHEAT:missing:1:64:2", "WHEAT:a:no:64:2", "WHEAT:a:30000001:64:2"));
        List<String> saved = List.copyOf(harvested); JsonObject original = base(false);
        var out = ReplantGuidance.attach(original, "WHEAT", harvested, List.of("a:10:64:2"), Map.of("a", "world", "b", "nether"), "world", 0, 64, 0);
        check("correct crop, counted, duplicates and invalid filtered", out.get("pendingRecordedSites").getAsInt() == 2);
        check("current dimension first", out.getAsJsonArray("replantTargets").get(0).getAsJsonObject().get("world").getAsString().equals("world"));
        check("crop block coordinate preserved", out.getAsJsonArray("replantTargets").get(0).getAsJsonObject().get("y").getAsInt() == 64);
        check("action names actual coordinate", out.get("nextAction").getAsString().contains("world(1,64,2)"));
        check("explains premature planting", out.get("nextAction").getAsString().contains("进入本阶段"));
        check("does not fabricate live block availability", out.get("targetSource").getAsString().contains("not_live_block"));
        check("read original untouched", !original.has("replantTargets") && original.get("current").getAsInt() == 0);
        check("ledger untouched", harvested.equals(saved));
        var unknown = ReplantGuidance.attach(base(false), "POTATOES", harvested, List.of(), Map.of("a", "world"), "world", 0, 0, 0);
        check("unknown does not invent coordinates", unknown.getAsJsonArray("replantTargets").isEmpty());
        check("unknown does not mark complete", !unknown.get("ready").getAsBoolean());
        check("recovery has independent activity", unknown.get("nextAction").getAsString().contains("dungeon list"));
        JsonObject ready = base(true);
        check("ready remains claim", ReplantGuidance.attach(ready, "WHEAT", harvested, List.of(), Map.of(), "world", 0, 0, 0) == ready);
        for (int i = 20; i < 40; i++) harvested.add("WHEAT:a:" + i + ":64:2");
        var capped = ReplantGuidance.attach(base(false), "WHEAT", harvested, List.of(), Map.of("a", "world"), "world", 0, 64, 0);
        check("bounded output", capped.getAsJsonArray("replantTargets").size() == 8 && capped.get("targetsTruncated").getAsBoolean());
        check("nearest first", capped.getAsJsonArray("replantTargets").get(0).getAsJsonObject().get("x").getAsInt() == 1);
        System.out.println("ReplantGuidanceTest: " + checks + " passed");
    }
}
