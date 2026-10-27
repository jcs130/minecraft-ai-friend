package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Presentation only. Full correlation metadata stays in the private payload or
 * an explicit --json query; no authorization or gameplay decision uses this view. */
final class AgentMessagePolicy {
    static final String CHANNEL = "qiandengji:agent";
    static final int MAX_BYTES = 32700;
    private static final Set<String> COMPACT = Set.of("MC_AUTH_STATE", "MC_GUIDE", "MC_STATUS", "MC_GUIDE_NEXT");
    private static final Set<String> VOLATILE = Set.of("playerUuid", "sessionId", "authSessionId", "observedAt", "sequence");
    private AgentMessagePolicy() { }
    // Legacy message presentation fallback only, never control identity or permissions.
    static boolean agent(String name) { return name != null && name.toLowerCase(Locale.ROOT).startsWith("ag_"); }
    // Explicit control declaration on the already authenticated player connection.
    // This selects client classification only; it grants no permissions or login bypass.
    static Boolean identity(byte[] data) {
        if (data == null || data.length > 256) return null;
        try {
            JsonObject o = JsonParser.parseString(new String(data, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            if (o.size()!=4 || !o.get("op").getAsString().equals("identity")
                    || !o.get("protocol").getAsJsonPrimitive().isNumber() || !o.get("protocol").getAsString().equals("1")
                    || !o.get("control").getAsString().equals("agent")
                    || !o.get("reconnect").getAsJsonPrimitive().isBoolean()) return null;
            return o.get("reconnect").getAsBoolean();
        } catch (RuntimeException invalid) { return null; }
    }
    static boolean hello(byte[] data) {
        if (data == null || data.length > 256) return false;
        try {
            JsonObject o = JsonParser.parseString(new String(data, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            return o.size() == 3 && o.get("op").getAsString().equals("hello")
                    && o.get("protocol").getAsInt() == 1 && o.get("transport").getAsString().equals("payload");
        } catch (RuntimeException invalid) { return false; }
    }
    static JsonObject receipt(String text) {
        if (text == null) return null;
        // Task-market clients already consume this bare JSON shape. Preserve
        // their chat fallback; opt-in clients receive the same private envelope.
        if (text.startsWith("{")) {
            try {
                JsonObject data = JsonParser.parseString(text).getAsJsonObject();
                JsonElement type = data.get("type");
                if (!data.has("schemaVersion") || data.get("schemaVersion").getAsInt() != 1
                        || type == null || !type.isJsonPrimitive() || !type.getAsJsonPrimitive().isString()
                        || !type.getAsString().matches("MC_[A-Z0-9_]+")) return null;
                JsonObject out = new JsonObject(); out.addProperty("protocol", 1);
                out.addProperty("type", type.getAsString()); out.add("data", data); return out;
            } catch (RuntimeException invalid) { return null; }
        }
        if (!text.matches("(?s)^MC_[A-Z0-9_]+ \\{.*")) return null;
        int space = text.indexOf(' ');
        try {
            JsonObject out = new JsonObject(); out.addProperty("protocol", 1);
            out.addProperty("type", text.substring(0, space));
            out.add("data", JsonParser.parseString(text.substring(space + 1)).getAsJsonObject()); return out;
        } catch (RuntimeException invalid) { return null; }
    }
    static String compact(String text) {
        JsonObject frame = receipt(text);
        if (frame == null || !COMPACT.contains(frame.get("type").getAsString())) return text;
        JsonObject data = frame.getAsJsonObject("data"); removeVolatile(data);
        return frame.get("type").getAsString() + " " + data;
    }
    private static void removeVolatile(JsonElement value) {
        if (value.isJsonObject()) {
            JsonObject object = value.getAsJsonObject(); VOLATILE.forEach(object::remove);
            List.copyOf(object.keySet()).forEach(key -> removeVolatile(object.get(key)));
        } else if (value.isJsonArray()) value.getAsJsonArray().forEach(AgentMessagePolicy::removeVolatile);
    }
    static boolean joinTip(String text) {
        return text.startsWith("[系统·技能目录]") || text.startsWith("欢迎来到千灯纪！罗盘")
                || text.startsWith("Agent：/mycli intro")
                || text.startsWith("用 /mycli skills info <ID> 查各级效果");
    }
    static boolean launcherWarning(String componentJson) {
        // Exact upstream notification links, independent of the player's locale.
        // Normal chat, skin failures and API errors are not launcher warnings.
        return componentJson != null && componentJson.contains("/skin notification ignore-cracked-client")
                && componentJson.contains("https://skinsrestorer.net/docs/troubleshooting/launcher-issues");
    }
}
