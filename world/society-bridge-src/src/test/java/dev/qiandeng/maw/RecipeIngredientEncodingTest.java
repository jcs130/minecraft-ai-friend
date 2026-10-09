package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;

public final class RecipeIngredientEncodingTest {
    private static int checks;
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }
    public static void main(String[] args) {
        JsonArray alternatives = new JsonArray();
        for (int i = 0; i < 48; i++) {
            JsonObject option = new JsonObject();
            option.addProperty("id", "test:planks_" + i); option.addProperty("count", 1);
            option.addProperty("displayName", "木板 " + i);
            option.addProperty("snbt", "{id:\"test:planks_" + i + "\",count:1}");
            alternatives.add(option);
        }
        JsonArray ingredients = new JsonArray();
        for (int i = 0; i < 9; i++) {
            JsonObject input = new JsonObject(); input.addProperty("index", i);
            input.addProperty("empty", i == 4); input.addProperty("requiredCount", i == 4 ? 0 : 1);
            input.add("alternatives", i == 4 ? new JsonArray() : alternatives.deepCopy()); ingredients.add(input);
        }
        JsonObject row = new JsonObject(); row.add("ingredients", ingredients);
        JsonObject before = row.deepCopy();
        check(before.toString().getBytes(StandardCharsets.UTF_8).length > 8192, "fixture must reproduce the real row budget failure");
        RecipeIngredientEncoding.compact(row);
        check(row.toString().getBytes(StandardCharsets.UTF_8).length < 8192, "full alternatives must fit without increasing the wire budget");
        check(row.get("ingredientEncoding").getAsString().equals("prior_index_references_v1"), "encoding marker missing");
        for (int i = 0; i < 9; i++) {
            JsonObject input = ingredients.get(i).getAsJsonObject();
            if (i == 0 || i == 4) check(input.equals(before.getAsJsonArray("ingredients").get(i)), "original/empty input changed");
            else {
                check(input.get("alternativesFrom").getAsInt() == 0 && !input.has("alternatives"), "must reference the exact prior alternatives");
                JsonObject decoded = input.deepCopy(); decoded.remove("alternativesFrom"); decoded.add("alternatives", ingredients.get(0).getAsJsonObject().get("alternatives"));
                check(decoded.equals(before.getAsJsonArray("ingredients").get(i)), "full components were lost");
            }
        }
        JsonObject once = row.deepCopy(); RecipeIngredientEncoding.compact(row);
        check(row.equals(once), "encoding must be idempotent");
        JsonObject distinct = before.deepCopy();
        distinct.getAsJsonArray("ingredients").get(1).getAsJsonObject().getAsJsonArray("alternatives").get(0).getAsJsonObject().addProperty("snbt", "{id:\"test:planks_0\",count:1,components:{different:1}}");
        RecipeIngredientEncoding.compact(distinct);
        check(distinct.getAsJsonArray("ingredients").get(1).getAsJsonObject().has("alternatives"), "different full components must not share alternatives");
        System.out.println("RecipeIngredientEncoding " + checks + " checks passed; rawBytes=" + before.toString().getBytes(StandardCharsets.UTF_8).length + "; wireBytes=" + row.toString().getBytes(StandardCharsets.UTF_8).length);
    }
}
