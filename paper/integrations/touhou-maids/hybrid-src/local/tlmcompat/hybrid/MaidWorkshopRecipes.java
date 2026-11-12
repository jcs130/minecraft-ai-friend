package local.tlmcompat.hybrid;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.ShapedRecipe;
import net.minecraft.world.item.crafting.ShapelessRecipe;

/** Plan against an inventory copy, including the vanilla recipe's container remainders. */
final class MaidWorkshopRecipes {
    record Plan(List<ItemStack> slots, ItemStack product) {}

    private MaidWorkshopRecipes() {}

    private static CraftingRecipe recipe(ServerLevel level, ResourceLocation id) {
        var holder = level.getRecipeManager().byKey(id).orElse(null);
        if (holder == null || !(holder.value() instanceof CraftingRecipe recipe)
                || !(recipe instanceof ShapedRecipe || recipe instanceof ShapelessRecipe) || recipe.isSpecial()) {
            throw new CompatibilityException("recipe_unavailable", "这个工位只使用服务器当前的有形或无形工作台配方。请用 workshop 查询可用配方。");
        }
        return recipe;
    }

    static int perCraft(ServerLevel level, ResourceLocation id) {
        ItemStack result = recipe(level, id).getResultItem(level.registryAccess());
        if (result.isEmpty() || !result.getItem().isEnabled(level.enabledFeatures())) {
            throw new CompatibilityException("recipe_unavailable", "当前世界没有启用这项成品。");
        }
        return result.getCount();
    }

    static Plan plan(ServerLevel level, ResourceLocation id, int batches, List<ItemStack> contents, int stackLimit) {
        CraftingRecipe recipe = recipe(level, id);
        List<Ingredient> ingredients = recipe.getIngredients();
        int width = recipe instanceof ShapedRecipe shaped ? shaped.getWidth() : 3;
        int height = recipe instanceof ShapedRecipe shaped ? shaped.getHeight() : (ingredients.size() + 2) / 3;
        if (width < 1 || width > 3 || height < 1 || height > 3 || ingredients.size() > width * height
                || ingredients.stream().allMatch(Ingredient::isEmpty)) {
            throw new CompatibilityException("recipe_unavailable", "这个配方无法在 3×3 工作台使用。");
        }

        List<ItemStack> next = new ArrayList<>(contents.stream().map(ItemStack::copy).toList());
        List<ItemStack> products = new ArrayList<>();
        List<ItemStack> remainders = new ArrayList<>();
        for (int batch = 0; batch < batches; batch++) {
            int[] assignment = match(ingredients, next);
            List<ItemStack> grid = new ArrayList<>();
            for (int index = 0; index < width * height; index++) {
                int slot = index < assignment.length ? assignment[index] : -1;
                if (slot < 0) {
                    grid.add(ItemStack.EMPTY);
                } else {
                    grid.add(next.get(slot).copyWithCount(1));
                    next.get(slot).shrink(1);
                }
            }
            CraftingInput input = CraftingInput.of(width, height, grid);
            if (!recipe.matches(input, level)) {
                throw new CompatibilityException("recipe_changed", "服务端配方已变化，请重新查询工位。");
            }
            ItemStack product = recipe.assemble(input, level.registryAccess());
            if (product.isEmpty() || !product.getItem().isEnabled(level.enabledFeatures())) {
                throw new CompatibilityException("recipe_unavailable", "当前世界没有启用这项成品。");
            }
            if (!products.isEmpty() && !ItemStack.isSameItemSameComponents(products.getFirst(), product)) {
                throw new CompatibilityException("variable_recipe", "这批材料会产出不同的物品，请分开下单。");
            }
            products.add(product);
            remainders.addAll(recipe.getRemainingItems(input).stream().filter(item -> !item.isEmpty()).toList());
        }
        // Keep produced stacks and recipe remainders out of subsequent batches' ingredient search.
        for (ItemStack stack : products) store(next, stack, stackLimit);
        for (ItemStack stack : remainders) store(next, stack, stackLimit);
        int made = products.stream().mapToInt(ItemStack::getCount).sum();
        return new Plan(List.copyOf(next), products.getFirst().copyWithCount(made));
    }

    private static int[] match(List<Ingredient> ingredients, List<ItemStack> contents) {
        List<Integer> units = new ArrayList<>();
        for (int slot = 0; slot < contents.size(); slot++) {
            ItemStack stack = contents.get(slot);
            if (stack.isEmpty() || !ItemStack.isSameItemSameComponents(stack, stack.getItem().getDefaultInstance())) continue;
            for (int count = 0; count < Math.min(stack.getCount(), ingredients.size()); count++) units.add(slot);
        }

        int[] owners = new int[units.size()];
        Arrays.fill(owners, -1);
        for (int i = 0; i < ingredients.size(); i++) {
            Ingredient ingredient = ingredients.get(i);
            if (!ingredient.isEmpty() && !assign(i, ingredients, contents, units, owners, new boolean[owners.length])) {
                String label = ingredient.getItems().length == 0 ? "配方所需材料" : ingredient.getItems()[0].getHoverName().getString();
                throw new CompatibilityException("materials_missing", "第 " + (i + 1) + " 项材料不足（可用材料之一：" + label
                    + "）。请把普通材料放入本次选择的箱子或背包。");
            }
        }
        int[] assignment = new int[ingredients.size()];
        Arrays.fill(assignment, -1);
        for (int unit = 0; unit < owners.length; unit++) {
            if (owners[unit] >= 0) assignment[owners[unit]] = units.get(unit);
        }
        return assignment;
    }

    // Reassign overlapping ingredient alternatives without stealing a required exact match.
    private static boolean assign(int ingredient, List<Ingredient> ingredients, List<ItemStack> contents,
                                  List<Integer> units, int[] owners, boolean[] seen) {
        for (int unit = 0; unit < units.size(); unit++) {
            if (seen[unit] || !ingredients.get(ingredient).test(contents.get(units.get(unit)))) continue;
            seen[unit] = true;
            if (owners[unit] == -1 || assign(owners[unit], ingredients, contents, units, owners, seen)) {
                owners[unit] = ingredient;
                return true;
            }
        }
        return false;
    }

    private static void store(List<ItemStack> contents, ItemStack item, int stackLimit) {
        int left = item.getCount();
        for (ItemStack existing : contents) {
            if (existing.isEmpty() || !ItemStack.isSameItemSameComponents(item, existing)) continue;
            int add = Math.min(left, Math.max(0, Math.min(stackLimit, existing.getMaxStackSize()) - existing.getCount()));
            existing.grow(add);
            left -= add;
            if (left == 0) return;
        }
        for (int index = 0; index < contents.size(); index++) {
            if (!contents.get(index).isEmpty()) continue;
            int add = Math.min(left, Math.min(stackLimit, item.getMaxStackSize()));
            contents.set(index, item.copyWithCount(add));
            left -= add;
            if (left == 0) return;
        }
        throw new CompatibilityException("workshop_full", "没有空间存放成品或配方返还物。请清出可用槽后再下单。");
    }
}
