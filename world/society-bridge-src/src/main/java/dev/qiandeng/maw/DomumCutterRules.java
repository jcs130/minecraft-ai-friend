package dev.qiandeng.maw;

import com.google.gson.JsonObject;

/** Pure, complete selection preconditions; no item construction or world mutation. */
final class DomumCutterRules {
    static String check(JsonObject input, JsonObject state) {
        try {
            if (!string(input, "playerUuid").equals(string(state, "playerUuid"))) return "player_identity_mismatch";
            if (integer(input, "windowId") != integer(state, "windowId")) return "stale_window";
            if (integer(input, "expectedStateId") != integer(state, "stateId")) return "stale_menu_state";
            var expectedPos = input.getAsJsonObject("expectedPosition");
            var position = state.getAsJsonObject("position");
            for (String axis : new String[]{"x", "y", "z"}) {
                if (integer(expectedPos, axis) != integer(position, axis)) return "cutter_position_changed";
            }
            if (!input.has("expectedGroup") || !input.get("expectedGroup").equals(state.get("currentGroup"))) return "group_changed";
            if (!string(input, "expectedVariantSnbt").equals(string(state.getAsJsonObject("currentVariant"), "snbt"))) return "variant_components_changed";
            var expected = input.getAsJsonArray("expectedInputsSnbt");
            var actual = state.getAsJsonArray("inputs");
            if (expected == null || expected.size() != actual.size()) return "missing_input_precondition";
            for (int index = 0; index < actual.size(); index++) {
                var value = expected.get(index);
                if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()
                        || !value.getAsString().equals(string(actual.get(index).getAsJsonObject().getAsJsonObject("item"), "snbt"))) {
                    return "input_components_changed";
                }
            }
            if (!string(input, "expectedCarriedSnbt").equals(string(state.getAsJsonObject("carried"), "snbt"))) return "cursor_changed";
            if (!string(input, "expectedOutputSnbt").equals(string(state.getAsJsonObject("output"), "snbt"))) return "output_components_changed";
            return null;
        } catch (RuntimeException invalid) { return "missing_or_invalid_precondition"; }
    }

    static int integer(JsonObject object, String name) {
        var value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("integer required");
        return value.getAsBigDecimal().intValueExact();
    }

    static String string(JsonObject object, String name) {
        var value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("string required");
        return value.getAsString();
    }

    static String groupId(JsonObject object) {
        String id = string(object, "groupId");
        if (id.length() > 256 || !id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) throw new IllegalArgumentException("resource ID required");
        return id;
    }
}
