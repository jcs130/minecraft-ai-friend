package dev.qiandeng.irons;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class InteractionArgumentsTest {
    private static int checks;
    private static void check(String json, boolean valid) {
        check(json, "interact_at", valid);
    }
    private static void check(String json, String tool, boolean valid) {
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
        boolean accepted;
        try { WorldInteractionBridge.arguments(encoded, tool); accepted = true; }
        catch (RuntimeException error) { accepted = false; }
        if (accepted != valid) throw new AssertionError(json);
        checks++;
    }
    public static void main(String[] args) {
        String point = "{\"button\":\"right\",\"x\":3,\"y\":64,\"z\":0,\"hold_ticks\":0}";
        check(point, true);
        check(point.replace("\"hold_ticks\":0", "\"hold_ticks\":100"), true);
        check(point.replace("\"hold_ticks\":0", "\"hold_ticks\":-1"), false);
        check(point.replace("\"hold_ticks\":0", "\"hold_ticks\":101"), false);
        check(point.replace("\"hold_ticks\":0", "\"hold_ticks\":true"), false);
        check(point.replace("\"x\":3", "\"x\":null"), false);
        check(point.replace("\"x\":3", "\"x\":3.5"), false);
        check(point.replace("\"y\":64", "\"y\":320"), false);
        check(point.replace("\"x\":3", "\"x\":29999985"), false);
        check("{\"button\":\"right\",\"x\":null,\"y\":null,\"z\":null,\"hold_ticks\":32,\"item_id\":\"minecraft:bread\"}", true);
        check(point.replace("\"right\"", "\"invalid\""), false);
        check(point.replace("}", ",\"command\":\"give\"}"), false);
        String mine = "{\"block_ids\":[\"minecraft:oak_log\",\"minecraft:birch_log\"],\"count\":4}";
        check(mine, "mine", true);
        check(mine.replace("\"count\":4", "\"count\":8"), "mine", true);
        for (String invalid : new String[]{"0", "9", "true", "1.0", "-1", "null"})
            check(mine.replace("\"count\":4", "\"count\":" + invalid), "mine", false);
        check(mine.replace("minecraft:oak_log", "minecraft:oak_log\\nkill @a"), "mine", false);
        check(mine.replace("minecraft:oak_log", "#minecraft:logs"), "mine", false);
        check(mine.replace("[\"minecraft:oak_log\",\"minecraft:birch_log\"]", "[]"), "mine", false);
        check(mine.replace("}", ",\"spec\":{}}"), "mine", false);
        System.out.println("{\"ok\":true,\"checks\":" + checks + "}");
    }
}
