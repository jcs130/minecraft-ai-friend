package dev.qiandeng.maw;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.ShapedRecipe;
import net.minecraft.world.item.crafting.ShapelessRecipe;
import vectorwing.farmersdelight.common.crafting.CookingPotRecipe;
import vectorwing.farmersdelight.common.crafting.CuttingBoardRecipe;
import com.mojang.serialization.JsonOps;
import net.minecraft.resources.RegistryOps;
import com.simibubi.create.content.processing.recipe.ProcessingRecipe;
import com.simibubi.create.content.processing.recipe.HeatCondition;
import com.simibubi.create.content.kinetics.millstone.MillingRecipe;
import com.simibubi.create.content.kinetics.crusher.CrushingRecipe;
import com.simibubi.create.content.kinetics.saw.CuttingRecipe;
import com.simibubi.create.content.kinetics.press.PressingRecipe;
import com.simibubi.create.content.fluids.transfer.FillingRecipe;
import com.simibubi.create.content.fluids.transfer.EmptyingRecipe;
import net.neoforged.neoforge.fluids.FluidStack;
import net.neoforged.neoforge.fluids.crafting.SizedFluidIngredient;

import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.List;
import java.util.TreeMap;

/** Read the loaded server recipe manager, not a guessed vanilla recipe table. */
final class PlayerRecipeCatalog {
    private static String id(JsonObject input, String key) {
        if (!input.has(key)) return null;
        String value = input.get(key).getAsString();
        if (!value.matches("[a-z0-9_.-]+:[a-z0-9_./-]+") || value.length() > 160)
            throw new IllegalArgumentException("invalid recipe identifier");
        return value;
    }

    private static int number(JsonObject input, String key, int fallback, int min, int max) {
        if (!input.has(key)) return fallback;
        double value = input.get(key).getAsDouble();
        if (!Double.isFinite(value) || value != Math.rint(value) || value < min || value > max)
            throw new IllegalArgumentException("invalid recipe pagination");
        return (int) value;
    }

    private static JsonObject item(ServerPlayer player, ItemStack stack) {
        if (stack.isEmpty()) return null;
        JsonObject result = new JsonObject();
        result.addProperty("id", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
        result.addProperty("count", stack.getCount());
        result.addProperty("displayName", stack.getHoverName().getString());
        result.addProperty("snbt", stack.saveOptional(player.registryAccess()).toString());
        return result;
    }

    private static JsonObject fluid(ServerPlayer player, FluidStack stack) {
        if (stack.isEmpty()) throw new IllegalArgumentException("empty processing fluid");
        JsonObject result = new JsonObject();
        result.addProperty("id", BuiltInRegistries.FLUID.getKey(stack.getFluid()).toString());
        result.addProperty("amount", stack.getAmount());
        result.addProperty("amountUnit", "mB");
        var ops = RegistryOps.create(JsonOps.INSTANCE, player.registryAccess());
        result.add("nativeFluidStack", FluidStack.CODEC.encodeStart(ops, stack).getOrThrow());
        result.addProperty("snbt", stack.saveOptional(player.registryAccess()).toString());
        return result;
    }

    /** Exact locked Create classes only; subclasses may add unexported semantics. */
    private static String createKind(Recipe<?> recipe) {
        Class<?> kind = recipe.getClass();
        if (kind == MillingRecipe.class) return "create:milling";
        if (kind == CrushingRecipe.class) return "create:crushing";
        if (kind == CuttingRecipe.class) return "create:cutting";
        if (kind == PressingRecipe.class) return "create:pressing";
        if (kind == FillingRecipe.class) return "create:filling";
        if (kind == EmptyingRecipe.class) return "create:emptying";
        return null;
    }

    private static void createDefinition(ServerPlayer player, JsonObject row, ProcessingRecipe<?, ?> recipe) {
        String kind = createKind(recipe);
        row.addProperty("executionAvailable", false);
        row.addProperty("executionCode", "create_machine_execution_not_verified_by_catalog");
        if (kind == null || !kind.equals(row.get("type").getAsString()) || !kind.equals(row.get("serializer").getAsString())) {
            row.addProperty("code", "unsupported_create_recipe_semantics"); return;
        }
        int maxOutputs = switch (kind) {
            case "create:milling", "create:cutting" -> 4;
            case "create:crushing" -> 7;
            case "create:pressing" -> 2;
            default -> 1;
        };
        boolean filling = kind.equals("create:filling"), emptying = kind.equals("create:emptying");
        // The six machines test only item ingredient[0]. More entries or
        // unexpected fluid/heat fields cannot be advertised as consumed input.
        if (recipe.getIngredients().size() != 1 || recipe.getRollableResults().isEmpty() || recipe.getRollableResults().size() > maxOutputs ||
                recipe.getFluidIngredients().size() != (filling ? 1 : 0) || recipe.getFluidResults().size() != (emptying ? 1 : 0) ||
                recipe.getRequiredHeat() != HeatCondition.NONE || recipe.getProcessingDuration() < 0) {
            row.addProperty("code", "unsupported_create_recipe_shape"); return;
        }
        var ops = RegistryOps.create(JsonOps.INSTANCE, player.registryAccess());
        JsonArray ingredients = new JsonArray();
        int index = 0;
        for (Ingredient ingredient : recipe.getIngredients()) {
            if (!ingredient.isSimple()) {
                row.addProperty("code", "custom_ingredient_semantics_unavailable"); return;
            }
            ItemStack[] alternatives = ingredient.getItems();
            if (ingredient.isEmpty() || alternatives.length == 0 || alternatives.length > 64) {
                row.addProperty("code", "create_ingredient_unavailable_or_over_budget"); return;
            }
            JsonObject input = new JsonObject();
            input.addProperty("index", index++); input.addProperty("empty", false);
            input.addProperty("requiredCount", 1); // One item per Ingredient occurrence, not alternative stack count.
            input.add("nativeIngredient", Ingredient.CODEC.encodeStart(ops, ingredient).getOrThrow());
            JsonArray options = new JsonArray();
            for (ItemStack option : alternatives) options.add(item(player, option));
            input.add("alternatives", options); ingredients.add(input);
        }
        JsonArray fluidInputs = new JsonArray();
        index = 0;
        for (SizedFluidIngredient ingredient : recipe.getFluidIngredients()) {
            if (!ingredient.ingredient().isSimple()) {
                row.addProperty("code", "custom_fluid_ingredient_semantics_unavailable"); return;
            }
            FluidStack[] alternatives = ingredient.getFluids();
            if (ingredient.amount() <= 0 || alternatives.length == 0 || alternatives.length > 64) {
                row.addProperty("code", "create_fluid_ingredient_unavailable_or_over_budget"); return;
            }
            JsonObject input = new JsonObject();
            input.addProperty("index", index++); input.addProperty("requiredAmount", ingredient.amount()); input.addProperty("amountUnit", "mB");
            input.add("nativeIngredient", SizedFluidIngredient.FLAT_CODEC.encodeStart(ops, ingredient).getOrThrow());
            JsonArray options = new JsonArray();
            for (FluidStack option : alternatives) options.add(fluid(player, option));
            input.add("alternatives", options); fluidInputs.add(input);
        }
        JsonArray outputs = new JsonArray();
        for (var chance : recipe.getRollableResults()) {
            ItemStack stack = chance.getStack();
            if (stack.isEmpty() || !Float.isFinite(chance.getChance()) || chance.getChance() < 0 || chance.getChance() > 1) {
                row.addProperty("code", "create_output_definition_invalid"); return;
            }
            JsonObject value = new JsonObject(); value.add("item", item(player, stack));
            value.addProperty("baseChancePerItem", chance.getChance()); outputs.add(value);
        }
        JsonArray fluids = new JsonArray();
        for (FluidStack stack : recipe.getFluidResults()) fluids.add(fluid(player, stack));
        JsonObject processing = new JsonObject();
        processing.addProperty("definitionSource", "Create_6.0.10_ProcessingRecipe");
        processing.addProperty("processingDurationTicks", recipe.getProcessingDuration());
        boolean durationApplies = kind.equals("create:milling") || kind.equals("create:crushing") || kind.equals("create:cutting");
        processing.addProperty("durationAffectsProcessing", durationApplies);
        processing.addProperty("durationInterpretation", durationApplies ? "recipe_base_work_not_wall_clock" : "unused_by_recipe_type");
        processing.addProperty("requiredHeat", recipe.getRequiredHeat().getSerializedName());
        processing.add("fluidInputs", fluidInputs); processing.add("fluidResults", fluids);
        processing.add("rollableResults", outputs);
        processing.addProperty("chanceSemantics", "independent_per_item_nextFloat_less_than_or_equal_to_chance");
        processing.addProperty("randomResultsSampled", false);
        processing.addProperty("dynamicHandlersIncluded", false);
        processing.addProperty("recipeSelectionPriorityVerified", false);
        processing.addProperty("machineExecutionVerified", false);
        processing.addProperty("fluidHandlingAvailable", false);
        row.add("ingredients", ingredients); row.add("processing", processing);
        row.addProperty("definitionAvailable", true);
    }

    private static boolean hasOutput(ServerPlayer player, Recipe<?> recipe, String output) {
        // ProcessingRecipe.getResultItem() is only the first display result.
        // Search every declared item result, including probabilistic byproducts,
        // without calling rollResults or sampling the server's random source.
        if (recipe instanceof ProcessingRecipe<?, ?> processing) {
            return processing.getRollableResults().stream().anyMatch(value -> {
                ItemStack stack = value.getStack();
                return !stack.isEmpty() && output.equals(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            });
        }
        if (recipe instanceof CuttingBoardRecipe cutting) {
            return cutting.getRollableResults().stream().anyMatch(value ->
                    !value.stack().isEmpty() && output.equals(BuiltInRegistries.ITEM.getKey(value.stack().getItem()).toString()));
        }
        ItemStack stack = recipe.getResultItem(player.registryAccess());
        return !stack.isEmpty() && output.equals(BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
    }

    private static JsonObject definition(ServerPlayer player, RecipeHolder<?> holder) {
        Recipe<?> recipe = holder.value();
        JsonObject row = new JsonObject();
        row.addProperty("recipeId", holder.id().toString());
        row.addProperty("type", BuiltInRegistries.RECIPE_TYPE.getKey(recipe.getType()).toString());
        row.addProperty("serializer", BuiltInRegistries.RECIPE_SERIALIZER.getKey(recipe.getSerializer()).toString());
        row.addProperty("definitionAvailable", false);
        try {
            if (recipe instanceof ProcessingRecipe<?, ?> processing) {
                createDefinition(player, row, processing); return row;
            }
            if (row.get("type").getAsString().startsWith("create:") || row.get("serializer").getAsString().startsWith("create:")) {
                row.addProperty("executionAvailable", false);
                row.addProperty("executionCode", "create_machine_execution_not_verified_by_catalog");
                row.addProperty("code", "unsupported_create_recipe_semantics"); return row;
            }
            row.add("output", item(player, recipe.getResultItem(player.registryAccess())));
            // Only serializers whose full item-input semantics are known are
            // recipes the Agent may execute. Fluid, probabilistic, dynamic and
            // custom recipes remain discoverable metadata with an explicit gap.
            String serializer = row.get("serializer").getAsString();
            boolean standard = serializer.equals("minecraft:crafting_shaped") || serializer.equals("minecraft:crafting_shapeless") ||
                    serializer.equals("minecraft:smelting") || serializer.equals("minecraft:blasting") ||
                    serializer.equals("minecraft:smoking") || serializer.equals("minecraft:campfire_cooking");
            if (!(standard || recipe instanceof CookingPotRecipe || recipe instanceof CuttingBoardRecipe)) {
                row.addProperty("code", "unsupported_recipe_semantics"); return row;
            }
            JsonArray ingredients = new JsonArray();
            int index = 0;
            for (Ingredient ingredient : recipe.getIngredients()) {
                if (!ingredient.isSimple()) {
                    row.addProperty("code", "custom_ingredient_semantics_unavailable"); return row;
                }
                ItemStack[] alternatives = ingredient.getItems();
                if (alternatives.length > 64 || index >= 24) {
                    row.addProperty("code", "recipe_ingredient_budget_exceeded"); return row;
                }
                JsonObject input = new JsonObject();
                input.addProperty("index", index++);
                input.addProperty("empty", ingredient.isEmpty());
                // Vanilla/simple Ingredient consumes one stack item; expanded
                // tag members are alternatives, never simultaneous materials.
                input.addProperty("requiredCount", ingredient.isEmpty() ? 0 : 1);
                JsonArray options = new JsonArray();
                for (ItemStack option : alternatives) options.add(item(player, option));
                input.add("alternatives", options); ingredients.add(input);
            }
            row.add("ingredients", ingredients);
            if (recipe instanceof ShapedRecipe shaped) {
                JsonObject grid = new JsonObject();
                grid.addProperty("width", shaped.getWidth()); grid.addProperty("height", shaped.getHeight());
                grid.addProperty("ordering", "row_major"); grid.addProperty("mirrorAllowed", true);
                row.add("grid", grid);
            }
            if (recipe instanceof AbstractCookingRecipe cooking) {
                JsonObject processing = new JsonObject();
                processing.addProperty("cookTimeTicks", cooking.getCookingTime());
                processing.addProperty("experience", cooking.getExperience());
                row.add("processing", processing);
            }
            if (recipe instanceof CookingPotRecipe pot) {
                JsonObject processing = new JsonObject();
                processing.addProperty("cookTimeTicks", pot.getCookTime());
                processing.addProperty("experience", pot.getExperience());
                processing.add("servingContainer", item(player, pot.getOutputContainer()));
                processing.add("containerOverride", item(player, pot.getContainerOverride()));
                processing.addProperty("heatRequired", true);
                row.add("processing", processing);
            }
            if (recipe instanceof CuttingBoardRecipe cutting) {
                JsonObject processing = new JsonObject();
                // Preserve the actual custom ability/tag predicate. getItems()
                // alone cannot express canPerformAction(knife_dig).
                var ops = RegistryOps.create(JsonOps.INSTANCE, player.registryAccess());
                processing.add("toolIngredient", Ingredient.CODEC.encodeStart(ops, cutting.getTool()).getOrThrow());
                JsonArray matchingTools = new JsonArray();
                for (int slot = 0; slot < player.inventoryMenu.slots.size(); slot++) {
                    if (slot == 0) continue; // virtual crafting preview is not owned equipment
                    ItemStack held = player.inventoryMenu.getSlot(slot).getItem();
                    if (!held.isEmpty() && cutting.getTool().test(held)) {
                        JsonObject tool = item(player, held); tool.addProperty("playerInventorySlot", slot); matchingTools.add(tool);
                    }
                }
                processing.add("matchingOwnedTools", matchingTools);
                processing.addProperty("heldToolMatches", cutting.getTool().test(player.getMainHandItem()));
                JsonArray outputs = new JsonArray();
                for (var chance : cutting.getRollableResults()) {
                    JsonObject value = new JsonObject(); value.add("item", item(player, chance.stack()));
                    value.addProperty("baseChancePerItem", chance.chance()); outputs.add(value);
                }
                processing.add("rollableResults", outputs);
                processing.addProperty("fortuneMayModifyChance", true);
                processing.addProperty("dropsIntoWorld", true);
                processing.addProperty("toolConsumed", false);
                row.add("processing", processing);
            }
            row.addProperty("definitionAvailable", true);
        } catch (RuntimeException error) {
            row.remove("ingredients"); row.remove("grid"); row.remove("processing");
            row.addProperty("definitionAvailable", false); row.addProperty("code", "recipe_definition_unavailable");
        }
        return row;
    }

    private static JsonObject row(ServerPlayer player, RecipeHolder<?> holder) {
        JsonObject value = definition(player, holder);
        RecipeIngredientEncoding.compact(value);
        if (value.toString().getBytes(StandardCharsets.UTF_8).length <= 8192) return value;
        JsonObject bounded = new JsonObject();
        for (String key : new String[]{"recipeId", "type", "serializer"}) bounded.add(key, value.get(key));
        bounded.addProperty("definitionAvailable", false); bounded.addProperty("code", "recipe_definition_too_large");
        return bounded;
    }

    static JsonObject query(ServerPlayer player, JsonObject input, JsonObject result) {
        String recipeId = id(input, "recipeId"), type = id(input, "recipeType"), output = id(input, "outputId");
        int offset = number(input, "offset", 0, 0, 10000), limit = number(input, "limit", 6, 1, 12);
        var manager = player.serverLevel().getRecipeManager();
        List<RecipeHolder<?>> all = manager.getRecipes().stream().sorted(Comparator.comparing(value -> value.id().toString())).toList();
        TreeMap<String, Integer> types = new TreeMap<>();
        java.util.ArrayList<RecipeHolder<?>> matched = new java.util.ArrayList<>();
        for (RecipeHolder<?> holder : all) {
            String nativeType = BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString();
            types.merge(nativeType, 1, Integer::sum);
            if (recipeId != null && !recipeId.equals(holder.id().toString()) || type != null && !type.equals(nativeType)) continue;
            if (output != null) {
                if (!hasOutput(player, holder.value(), output)) continue;
            }
            matched.add(holder);
        }
        result.addProperty("ok", true); result.addProperty("query", "recipes");
        result.addProperty("source", "server_recipe_manager");
        if (output != null) result.addProperty("outputFilterScope", "create_and_cutting_board_declared_item_results_and_other_recipe_display_results");
        result.addProperty("matchedCount", matched.size()); result.addProperty("offset", offset);
        JsonArray recipeTypes = new JsonArray();
        types.entrySet().stream().limit(64).forEach(entry -> {
            JsonObject value = new JsonObject(); value.addProperty("id", entry.getKey()); value.addProperty("count", entry.getValue());
            recipeTypes.add(value);
        });
        result.add("recipeTypes", recipeTypes); result.addProperty("recipeTypesTruncated", types.size() > 64);
        JsonArray recipes = new JsonArray(); result.add("recipes", recipes);
        int next = Math.min(offset, matched.size());
        while (next < matched.size() && recipes.size() < limit) {
            JsonObject value = row(player, matched.get(next));
            // Leave headroom for playerUuid and nextOffset in the 16KiB wire.
            if (result.toString().getBytes(StandardCharsets.UTF_8).length +
                    value.toString().getBytes(StandardCharsets.UTF_8).length > 15000) break;
            recipes.add(value); next++;
        }
        boolean more = next < matched.size();
        result.addProperty("truncated", more);
        if (more) result.addProperty("nextOffset", next); else result.add("nextOffset", JsonNull.INSTANCE);
        return result;
    }
}
