package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Normalizes only the name field of a native private-chat packet. */
final class PrivateChatIdentity {
    static JsonElement normalize(JsonElement name, Map<UUID, String> online) {
        Set<UUID> identities = new HashSet<>();
        collect(name, identities, 0);
        if (identities.size() != 1) return name;
        UUID uuid = identities.iterator().next();
        String username = online.get(uuid);
        // UUID lookup is authoritative. The optional dot is Floodgate's native
        // Bedrock prefix; keep it so click-to-reply addresses the right account.
        if (username == null || !username.matches("\\.?[A-Za-z0-9_]{1,16}")) return name;
        JsonObject result = new JsonObject(); result.addProperty("text", username);
        result.addProperty("insertion", username);
        JsonObject click = new JsonObject(); click.addProperty("action", "suggest_command");
        click.addProperty("value", "/msg " + username + " "); result.add("clickEvent", click);
        JsonObject contents = new JsonObject(); contents.addProperty("type", "minecraft:player");
        contents.addProperty("id", uuid.toString());
        JsonObject plain = new JsonObject(); plain.addProperty("text", username); contents.add("name", plain);
        JsonObject hover = new JsonObject(); hover.addProperty("action", "show_entity"); hover.add("contents", contents);
        result.add("hoverEvent", hover);
        return result;
    }
    private static void collect(JsonElement element, Set<UUID> identities, int depth) {
        if (element == null || depth > 16) return;
        if (element.isJsonArray()) { for (JsonElement child : element.getAsJsonArray()) collect(child, identities, depth + 1); return; }
        if (!element.isJsonObject()) return;
        JsonObject object = element.getAsJsonObject();
        try {
            JsonObject hover = object.getAsJsonObject("hoverEvent");
            if (hover != null && "show_entity".equals(hover.get("action").getAsString())) {
                JsonObject contents = hover.getAsJsonObject("contents");
                if (contents != null && "minecraft:player".equals(contents.get("type").getAsString()))
                    identities.add(uuid(contents.get("id")));
            }
        } catch (RuntimeException ignored) { /* Unverified names remain unchanged. */ }
        collect(object.get("extra"), identities, depth + 1);
        collect(object.get("with"), identities, depth + 1);
    }
    private static UUID uuid(JsonElement value) {
        // 1.20.6's component codec serializes UUIDs as four signed integers.
        // Older JSON components use the canonical UUID string.
        if (!value.isJsonArray()) return UUID.fromString(value.getAsString());
        JsonArray words = value.getAsJsonArray();
        if (words.size() != 4) throw new IllegalArgumentException("UUID words");
        int[] parts = new int[4];
        for (int i = 0; i < 4; i++) parts[i] = words.get(i).getAsBigDecimal().intValueExact();
        return new UUID(((long) parts[0] << 32) | (parts[1] & 0xffffffffL),
                ((long) parts[2] << 32) | (parts[3] & 0xffffffffL));
    }
}
