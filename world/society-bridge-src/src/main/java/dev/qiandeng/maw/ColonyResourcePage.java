package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Paginates complete native resource facts; never clips or merges item components. */
final class ColonyResourcePage {
    static final int MAX_BYTES = 16384;
    static final int MAX_LIMIT = 24;
    static final int DEFAULT_LIMIT = 12;

    static int integer(JsonObject input, String key, Integer fallback) {
        if (!input.has(key)) {
            if (fallback != null) return fallback;
            throw new IllegalArgumentException("missing integer");
        }
        var value = input.get(key);
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("expected JSON integer");
        }
        try { return value.getAsBigDecimal().intValueExact(); }
        catch (ArithmeticException invalid) { throw new IllegalArgumentException("integer out of range", invalid); }
    }

    static JsonObject apply(JsonObject envelope, List<JsonObject> nativeRows, int offset, int limit) {
        if (offset < 0 || limit < 1 || limit > MAX_LIMIT) throw new IllegalArgumentException("invalid resource page");
        List<JsonObject> rows = new ArrayList<>(nativeRows);
        rows.sort(Comparator.comparing((JsonObject row) -> row.get("id").getAsString())
                .thenComparing(row -> row.get("snbt").getAsString())
                .thenComparing(JsonObject::toString));
        JsonObject result = envelope.deepCopy();
        JsonArray resources = new JsonArray();
        result.addProperty("ok", true);
        result.addProperty("offset", offset);
        result.addProperty("limit", limit);
        result.addProperty("total", rows.size());
        result.add("resources", resources);
        pageFields(result, rows.size(), offset, resources.size());
        if (offset > rows.size()) {
            result.addProperty("ok", false);
            result.addProperty("code", "invalid_resource_offset");
            if (bytes(result) > MAX_BYTES) throw new IllegalArgumentException("resource envelope too large");
            return result;
        }
        for (int index = offset; index < rows.size() && resources.size() < limit; index++) {
            resources.add(rows.get(index));
            pageFields(result, rows.size(), offset, resources.size());
            if (bytes(result) <= MAX_BYTES) continue;
            resources.remove(resources.size() - 1);
            pageFields(result, rows.size(), offset, resources.size());
            if (resources.isEmpty()) {
                result.addProperty("ok", false);
                result.addProperty("code", "resource_item_too_large");
                result.addProperty("blockedOffset", index);
            }
            break; // The rejected row is exactly nextOffset; no item is skipped.
        }
        if (bytes(result) > MAX_BYTES) throw new IllegalArgumentException("resource envelope too large");
        return result;
    }

    private static void pageFields(JsonObject result, int total, int offset, int returned) {
        int next = offset + returned;
        result.addProperty("returned", returned);
        result.addProperty("truncated", next < total);
        result.add("nextOffset", next < total ? new com.google.gson.JsonPrimitive(next) : JsonNull.INSTANCE);
    }

    private static int bytes(JsonObject value) {
        return value.toString().getBytes(StandardCharsets.UTF_8).length;
    }
}
