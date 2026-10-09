package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.Map;

/** Lossless wire encoding: repeated tag alternatives refer to a prior input. */
final class RecipeIngredientEncoding {
    static void compact(JsonObject row) {
        if (!row.has("ingredients") || !row.get("ingredients").isJsonArray()) return;
        JsonArray inputs = row.getAsJsonArray("ingredients");
        Map<String, Integer> earlier = new HashMap<>();
        boolean changed = false;
        for (var element : inputs) {
            JsonObject input = element.getAsJsonObject();
            if (!input.has("alternatives")) continue;
            JsonArray alternatives = input.getAsJsonArray("alternatives");
            if (alternatives.isEmpty()) continue;
            String exact = alternatives.toString();
            Integer prior = earlier.putIfAbsent(exact, input.get("index").getAsInt());
            if (prior != null && exact.length() > 32) {
                input.remove("alternatives");
                input.addProperty("alternativesFrom", prior);
                changed = true;
            }
        }
        if (changed) row.addProperty("ingredientEncoding", "prior_index_references_v1");
    }
}
