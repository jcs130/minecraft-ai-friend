package dev.god.botgate;

import net.minecraft.core.component.DataComponentPatch;
import net.minecraft.core.component.PatchedDataComponentMap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;

/** Outgoing packet copies only; never changes the server's inventory or registry. */
public final class VanillaItemComponents {
    private VanillaItemComponents() { }

    public static ItemStack sanitize(ItemStack stack) {
        if (stack == null || stack.isEmpty()) return stack;
        DataComponentPatch original = stack.getComponentsPatch();
        DataComponentPatch clean = filtered(original);
        if (clean.equals(original)) return stack;
        ItemStack copy = stack.copy();
        // Iron's Spellbooks initializes components in every ItemStack constructor,
        // including copy(). Restore only AFTER construction, directly on our copy.
        ((PatchedDataComponentMap) copy.getComponents()).restorePatch(clean);
        return copy;
    }

    public static boolean needsSanitizing(ItemStack stack) {
        return stack != null && !stack.isEmpty()
                && !filtered(stack.getComponentsPatch()).equals(stack.getComponentsPatch());
    }

    /** Only call for stacks owned by a newly allocated outgoing packet copy. */
    public static void sanitizeOwned(ItemStack stack) {
        if (stack == null || stack.isEmpty()) return;
        DataComponentPatch original = stack.getComponentsPatch();
        DataComponentPatch clean = filtered(original);
        if (!clean.equals(original)) ((PatchedDataComponentMap) stack.getComponents()).restorePatch(clean);
    }

    private static DataComponentPatch filtered(DataComponentPatch original) {
        return original.forget(type -> {
            ResourceLocation id = BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type);
            return id == null || !"minecraft".equals(id.getNamespace());
        });
    }
}
