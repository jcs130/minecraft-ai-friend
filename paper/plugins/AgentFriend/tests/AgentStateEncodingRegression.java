package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Assert identical bounded payload/cache bytes, including UTF-8 clipping. */
public final class AgentStateEncodingRegression {
    public static void main(String[] args) {
        compare(state(0, 0));
        compare(state(48, 32));
        compare(state(48, 1024));
        JsonObject tooBig = state(0, 0);
        tooBig.addProperty("equipmentEffects", "灵".repeat(6000));
        check(AgentStatePublisher.encodeBounded(tooBig) == null, "oversized base state became sendable");
        JsonObject boundary = state(1, 0);
        boundary.addProperty("padding", "x".repeat(16_384 - boundary.toString().getBytes(StandardCharsets.UTF_8).length - 13));
        check(boundary.toString().getBytes(StandardCharsets.UTF_8).length == 16_384, "boundary fixture is not exact");
        compare(boundary);
        System.out.println("PASS: ordinary, empty, multibyte clipped, size-boundary and oversized Agent JSON"
                + " preserve original bytes, final JSON and ability order.");
    }

    private static JsonObject state(int entries, int labelLength) {
        JsonObject root = new JsonObject(); root.addProperty("schemaVersion", 1);
        JsonObject mana = new JsonObject(); mana.addProperty("current", 1.25); mana.addProperty("max", 100.0);
        root.add("mana", mana); root.add("equipmentEffects", new JsonArray());
        JsonArray abilities = new JsonArray();
        for (int i = 0; i < entries; i++) {
            JsonObject entry = new JsonObject(); entry.addProperty("id", "mycli:spell" + i);
            entry.addProperty("name", "魔".repeat(labelLength)); entry.addProperty("level", 3);
            entry.add("cooldownMs", JsonNull.INSTANCE); entry.addProperty("cooldownRemainingMs", 4321L + i);
            abilities.add(entry);
        }
        root.add("abilities", abilities); return root;
    }

    private static void compare(JsonObject input) {
        JsonObject old = input.deepCopy(); byte[] bytes = old.toString().getBytes(StandardCharsets.UTF_8);
        var entries = old.getAsJsonArray("abilities");
        while (bytes.length > 16_384 && entries.size() > 0) {
            entries.remove(entries.size() - 1); bytes = old.toString().getBytes(StandardCharsets.UTF_8);
        }
        var payload = AgentStatePublisher.encodeBounded(input.deepCopy());
        if (bytes.length > 16_384) { check(payload == null, "original rejection changed"); return; }
        check(payload != null && Arrays.equals(bytes, payload.bytes()), "wire bytes changed");
        check(payload.json().equals(old.toString()), "last-state JSON differs from original final root");
        check(payload.json().equals(new String(payload.bytes(), StandardCharsets.UTF_8)), "cache JSON differs from wire bytes");
    }
    private static void check(boolean valid, String message) { if (!valid) throw new AssertionError(message); }
}
