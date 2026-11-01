package dev.myagentworld.native263;

import com.google.gson.*;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.*;

/** Only standard grid recipes are representable by Mineflayer's grid crafter.
 * Dynamic/special/machine recipes remain unavailable through that API.
 */
public final class NativeRecipes {
    public static JsonArray export(MinecraftServer server) {
        JsonArray out = new JsonArray();
        for (var holder : server.getRecipeManager().getRecipes()) {
            var recipe = holder.value();
            if (recipe.getClass() != ShapedRecipe.class && recipe.getClass() != ShapelessRecipe.class) continue;
            int width; int height; boolean shaped = recipe instanceof ShapedRecipe;
            List<Optional<Ingredient>> ingredients;
            if (recipe instanceof ShapedRecipe grid) {
                width = grid.getWidth(); height = grid.getHeight(); ingredients = grid.getIngredients();
            } else {
                var values = recipe.placementInfo().ingredients();
                width = Math.min(3, values.size()); height = (values.size() + 2) / 3;
                ingredients = new ArrayList<>();
                for (Ingredient ingredient : values) ingredients.add(Optional.of(ingredient));
                while (ingredients.size() < width * height) ingredients.add(Optional.empty());
            }
            if (width < 1 || height < 1 || width > 3 || height > 3) continue;
            JsonArray choices = new JsonArray(); List<ItemStack> stacks = new ArrayList<>(); boolean available = true;
            for (Optional<Ingredient> optional : ingredients) {
                JsonArray ids = new JsonArray(); ItemStack first = ItemStack.EMPTY;
                if (optional.isPresent()) {
                    var items = optional.get().items().toList();
                    if (items.isEmpty() || items.size() > 256) { available = false; break; }
                    for (var item : items) ids.add(BuiltInRegistries.ITEM.getId(item.value()));
                    first = new ItemStack(items.getFirst());
                    if (!optional.get().test(first)) { available = false; break; }
                }
                choices.add(ids); stacks.add(first);
            }
            if (!available) continue;
            CraftingInput input = CraftingInput.of(width, height, stacks);
            if (!((CraftingRecipe) recipe).matches(input, server.overworld())) continue;
            ItemStack result = ((CraftingRecipe) recipe).assemble(input);
            if (result.isEmpty()) continue;
            JsonObject row = new JsonObject(); row.addProperty("id", holder.id().identifier().toString());
            row.addProperty("shaped", shaped); row.addProperty("width", width); row.addProperty("height", height);
            row.add("choices", choices); row.addProperty("resultId", BuiltInRegistries.ITEM.getId(result.getItem()));
            row.addProperty("resultCount", result.getCount()); out.add(row);
        }
        return out;
    }
}
