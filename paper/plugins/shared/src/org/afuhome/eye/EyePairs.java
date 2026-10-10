package org.afuhome.eye;

import com.google.gson.*;
import java.util.*;

/** Pure name resolver shared by presentation plugins. Login authentication belongs to the gateway. */
public final class EyePairs {
    public record Pair(String agent, String eye, boolean automatic) {}
    private EyePairs() {}
    public static boolean freeObserver(JsonObject root, String name) {
        JsonArray names = root.getAsJsonArray("freeObservers");
        if (names == null) return name.equalsIgnoreCase("live");
        if (names.size() > 4) throw new IllegalArgumentException("freeObservers limit");
        boolean found = false;
        for (JsonElement entry : names) {
            String value = entry.getAsString();
            if (!value.matches("[A-Za-z0-9_]{1,16}") || value.equalsIgnoreCase("Goddess"))
                throw new IllegalArgumentException("invalid freeObserver");
            found |= value.equalsIgnoreCase(name);
        }
        return found;
    }
    public static String baseName(String eye) {
        if (eye == null || !eye.matches("[A-Za-z0-9_]{1,16}")) return null;
        String lower = eye.toLowerCase(Locale.ROOT);
        int suffix = lower.endsWith("_eye") ? 4 : lower.endsWith("eye") ? 3 : 0;
        if (suffix == 0 || eye.length() <= suffix) return null;
        String base = eye.substring(0, eye.length() - suffix);
        if (base.equalsIgnoreCase("Goddess") || base.toLowerCase(Locale.ROOT).endsWith("eye")) return null;
        return base;
    }
    public static List<Pair> resolve(JsonObject root, Collection<String> online) {
        if (!root.has("schemaVersion") || root.get("schemaVersion").getAsInt() != 1)
            throw new IllegalArgumentException("schemaVersion");
        freeObserver(root, ""); // validate even when no observer is online
        JsonArray entries = root.getAsJsonArray("pairs");
        if (entries == null || entries.size() > 16) throw new IllegalArgumentException("pairs");
        Map<String, Pair> result = new LinkedHashMap<>();
        Set<String> agents = new HashSet<>();
        for (JsonElement entry : entries) {
            JsonObject value = entry.getAsJsonObject();
            String agent = value.get("agent").getAsString();
            String eye = value.has("eye") ? value.get("eye").getAsString() : agent + "_eye";
            String a = agent.toLowerCase(Locale.ROOT), e = eye.toLowerCase(Locale.ROOT);
            if (!agent.matches("[A-Za-z0-9_]{1,16}") || !eye.matches("[A-Za-z0-9_]{1,16}")
                    || a.equals(e) || a.equals("goddess") || e.equals("goddess")
                    || !agents.add(a) || result.putIfAbsent(e, new Pair(agent, eye, false)) != null)
                throw new IllegalArgumentException("invalid or duplicate pair");
        }
        if (agents.stream().anyMatch(result::containsKey)) throw new IllegalArgumentException("Agent is an Eye");
        boolean auto = !root.has("autoNameEyes") || root.get("autoNameEyes").getAsBoolean();
        if (auto) {
            for (String eye : online.stream().sorted(String.CASE_INSENSITIVE_ORDER).toList()) {
                String base = baseName(eye), key = eye.toLowerCase(Locale.ROOT);
                if (base == null || freeObserver(root, eye) || result.containsKey(key) || agents.contains(key)
                        || result.containsKey(base.toLowerCase(Locale.ROOT))) continue;
                if (result.size() >= 16) break;
                result.put(key, new Pair(base, eye, true));
            }
        }
        return List.copyOf(result.values());
    }
}
