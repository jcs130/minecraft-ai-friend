package qa.recipebook;

import local.tlmcompat.numen.RecipeBookGuide;
import java.lang.reflect.Proxy;
import java.util.List;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.stats.ServerRecipeBook;
import net.minecraft.world.inventory.RecipeBookType;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;

/** Real Minecraft recipe-book state with synthetic recipe definitions; no player or server is created. */
public final class RecipeBookGuideCheck {
    private static int checks;
    private static void check(boolean yes, String message) {
        if (!yes) throw new AssertionError(message);
        checks++;
    }
    private static RecipeHolder<?> recipe(String namespace, String name, boolean special) {
        Recipe<?> definition = (Recipe<?>) Proxy.newProxyInstance(Recipe.class.getClassLoader(),
                new Class<?>[]{Recipe.class}, (proxy, method, args) -> switch (method.getName()) {
                    case "isSpecial" -> special;
                    case "toString" -> "SyntheticRecipe:" + name;
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> method.getReturnType() == boolean.class ? false : null;
                });
        return new RecipeHolder<>(ResourceLocation.fromNamespaceAndPath(namespace, name), definition);
    }
    public static void main(String[] args) {
        // Invoked only inside the fully initialized isolated NeoForge test server.
        ServerRecipeBook book = new ServerRecipeBook();
        var existing = recipe("legacy_test", "existing", false);
        var visible = recipe("minecraft", "guide_visible", false);
        var special = recipe("minecraft", "special_hidden", true);
        book.add(existing);
        book.addHighlight(existing);
        book.setBookSetting(RecipeBookType.CRAFTING, true, true);
        Object settings = book.getBookSettings();
        int added = RecipeBookGuide.addMissing(book, List.of(visible, visible, special));
        check(added == 1, "only an actual newly known, non-special recipe is counted");
        check(book.contains(existing), "previous discoveries are never erased");
        check(book.contains(visible), "compatible recipe becomes known");
        check(!book.contains(special), "Minecraft special recipes retain their original hidden behavior");
        check(book.willHighlight(existing), "old notification highlights remain intact");
        check(!book.willHighlight(visible), "guide does not forge a newly earned notification");
        check(book.getBookSettings().equals(settings), "all settings values remain unchanged across copied snapshots");
        check(book.isOpen(RecipeBookType.CRAFTING), "existing open preference remains intact");
        check(book.isFiltering(RecipeBookType.CRAFTING), "existing craftable-only preference remains intact");
        check(RecipeBookGuide.addMissing(book, List.of(visible, special)) == 0,
                "repeat login synchronization adds no duplicate recipe");
        check(book.contains(existing) && book.willHighlight(existing), "repeat preserves historical state");
        System.out.println("PASS " + checks + " real Minecraft recipe-book checks; no player, craft, XP or item grant");
    }
}
