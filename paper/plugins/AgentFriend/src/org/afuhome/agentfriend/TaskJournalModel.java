package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;

/** Pure read-only presentation: one task identity, two groups, no fabricated completion. */
final class TaskJournalModel {
    static final int PAGE_SIZE = 7;
    private static final Set<String> FIELDS = Set.of("progress", "target", "remaining", "stage", "stages",
            "floor", "maxFloor", "remainingMobs", "gradeIndex", "gradeName", "fame", "fameTarget",
            "fameRemaining", "certificateCount", "missingProofs", "houseChecks", "missingConditions",
            "available", "canSubmit", "startedAt", "expiresAt", "acceptedAt",
            "endedAt", "observedAt", "paused", "resumable", "returnPending", "authority");
    static String text(JsonObject data, String key, String fallback) {
        JsonElement value = data.get(key);
        return value != null && value.isJsonPrimitive() ? value.getAsString() : fallback;
    }
    static boolean flag(JsonObject data, String key) {
        JsonElement value = data.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isBoolean() && value.getAsBoolean();
    }
    static String command(String value, String fallback) {
        return value != null && value.startsWith("/mycli ") && value.length() <= 200
                && value.chars().noneMatch(Character::isISOControl) ? value : fallback;
    }
    static String state(String raw) {
        return switch (raw) {
            case "submitted", "claimed", "completed", "complete", "won" -> "complete";
            case "ready", "ready_to_submit", "ready_to_claim" -> "ready";
            case "none", "idle" -> "idle";
            case "cancelled", "expired", "failed" -> raw;
            case "unavailable", "unknown" -> "unavailable";
            default -> "active";
        };
    }
    static JsonObject item(String group, String system, String id, String title, JsonObject source,
                           String fallbackRead, String submit) {
        if (!Set.of("guild", "skills").contains(group) || !system.matches("[a-z_]{1,32}")
                || !id.matches("[A-Za-z0-9_:.\\-]{1,100}")) throw new IllegalArgumentException("journal_identity");
        JsonObject out = new JsonObject();
        out.addProperty("itemId", system + ":" + id);
        out.addProperty("group", group);
        out.addProperty("sourceSystem", system);
        out.addProperty("sourceId", id);
        out.addProperty("title", title);
        String raw = text(source, "state", text(source, "status", text(source, "lifecycle", "active")));
        if (flag(source, "graduated") || flag(source, "done")) raw = "completed";
        if (flag(source, "ready") && !Set.of("submitted", "completed", "claimed", "cancelled", "expired", "failed", "unavailable", "unknown").contains(raw)) raw = "ready";
        if (source.has("available") && !flag(source, "available")) raw = "unavailable";
        out.addProperty("state", state(raw));
        out.addProperty("sourceState", raw);
        out.addProperty("phase", text(source, "phase", raw));
        out.addProperty("reason", text(source, "reason", "observed"));
        out.addProperty("readOnly", true);
        out.addProperty("nextAction", text(source, "nextAction", text(source, "instruction", text(source, "meaning", "查看本人当前条件和下一步"))));
        out.addProperty("nextCommand", command(text(source, "nextCommand", fallbackRead), fallbackRead));
        out.addProperty("detailsCommand", fallbackRead);
        String run = text(source, "runId", text(source, "run", ""));
        if (!run.isEmpty()) out.addProperty("runId", run);
        if (!submit.isEmpty() && (!source.has("canSubmit") || flag(source,"canSubmit"))
                && !Set.of("complete", "cancelled", "expired", "failed", "unavailable", "idle").contains(out.get("state").getAsString())) {
            out.addProperty("submitCommand", command(submit, fallbackRead));
            out.addProperty("journalSubmitCommand", "/mycli journal submit " + out.get("itemId").getAsString());
        }
        for (String field : FIELDS) if (source.has(field)) out.add(field, source.get(field).deepCopy());
        return out;
    }
    static List<JsonObject> unique(List<JsonObject> rows) {
        Map<String, JsonObject> result = new LinkedHashMap<>();
        for (JsonObject row : rows) result.putIfAbsent(row.get("itemId").getAsString(), row.deepCopy());
        return List.copyOf(result.values());
    }
    static JsonObject page(List<JsonObject> rows, String filter, int page) {
        if (!Set.of("all", "guild", "skills").contains(filter)) throw new IllegalArgumentException("journal_group");
        List<JsonObject> selected = unique(rows).stream().filter(row -> filter.equals("all") || text(row, "group", "").equals(filter)).toList();
        int pages = Math.max(1, (selected.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        if (page < 1 || page > pages) throw new IllegalArgumentException("journal_page");
        JsonObject out = new JsonObject();
        out.addProperty("schemaVersion", 1); out.addProperty("type", "journal");
        out.addProperty("readOnly", true); out.addProperty("filter", filter);
        out.addProperty("page", page); out.addProperty("pages", pages);
        out.addProperty("pageSize", PAGE_SIZE); out.addProperty("total", selected.size());
        JsonArray items = new JsonArray();
        for (int i = (page - 1) * PAGE_SIZE; i < Math.min(selected.size(), page * PAGE_SIZE); i++) items.add(selected.get(i).deepCopy());
        out.add("items", items);
        JsonArray groups = new JsonArray(); groups.add("guild"); groups.add("skills"); out.add("groups", groups);
        out.addProperty("refreshCommand", "/mycli journal " + filter + " " + page);
        if (page < pages) out.addProperty("nextCommand", "/mycli journal " + filter + " " + (page + 1));
        out.addProperty("autoContinue", false);
        return out;
    }
}
