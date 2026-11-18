package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.backpack.BackpackManager;
import com.github.tartaricacid.touhoulittlemaid.entity.backpack.BigBackpack;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.init.InitItems;
import com.github.tartaricacid.touhoulittlemaid.inventory.container.backpack.BaubleContainer;
import com.github.tartaricacid.touhoulittlemaid.item.bauble.ExtraLifeBauble;
import com.github.tartaricacid.touhoulittlemaid.item.bauble.UndyingTotemBauble;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** Starting equipment on the original, explicitly registered unified body. */
final class NativeMaidKit {
    private static final String INITIALIZED = "qiandengji_native_starter_kit";

    static void initialize(EntityMaid maid) {
        var saved = maid.getPersistentData();
        if (saved.getBoolean(INITIALIZED)) return;
        if (maid.getMaidBackpackType() == BackpackManager.getEmptyBackpack()) {
            // The stock big backpack uses the original item handler and has no extra backpack data.
            var backpack = BackpackManager.findBackpack(BigBackpack.ID).orElseThrow();
            maid.setMaidBackpackType(backpack);
        }
        if (!hasLifeProtection(maid)) putInFreeSlot(maid, Items.TOTEM_OF_UNDYING);
        putInFreeSlot(maid, InitItems.FALL_PROTECT_BAUBLE.get());
        putInFreeSlot(maid, InitItems.FIRE_PROTECT_BAUBLE.get());
        // Persist with the same entity as the equipment. A used or removed item is not a fresh starter kit.
        saved.putBoolean(INITIALIZED, true);
    }

    private static void putInFreeSlot(EntityMaid maid, Item item) {
        var slots = maid.getMaidBauble();
        if (slots.containsItem(item)) return;
        var stack = new ItemStack(item);
        for (int slot = 0; slot < slots.getSlots(); slot++) {
            if (slots.getStackInSlot(slot).isEmpty() && slots.isItemValid(slot, stack)) {
                // The native slot updates the handler, effect hooks and tracking clients.
                new BaubleContainer.BaubleSlot(maid, slot, 0, 0).setByPlayer(stack);
                return;
            }
        }
    }

    static boolean hasLifeProtection(EntityMaid maid) {
        var slots = maid.getMaidBauble();
        for (int slot = 0; slot < slots.getSlots(); slot++) {
            if (slots.getStackInSlot(slot).isEmpty()) continue;
            var effect = slots.getBaubleInSlot(slot);
            if (effect instanceof UndyingTotemBauble || effect instanceof ExtraLifeBauble) return true;
        }
        return false;
    }

    static JsonArray accessories(EntityMaid maid) {
        var result = new JsonArray();
        var slots = maid.getMaidBauble();
        for (int slot = 0; slot < slots.getSlots(); slot++) {
            ItemStack stack = slots.getStackInSlot(slot);
            if (stack.isEmpty()) continue;
            JsonObject row = HybridMaidPlugin.item(stack);
            row.addProperty("slot", slot);
            if (stack.isDamageableItem()) row.addProperty("maxDamage", stack.getMaxDamage());
            result.add(row);
        }
        return result;
    }

    static JsonObject favorability(EntityMaid maid) {
        var result = new JsonObject();
        result.addProperty("source", "touhou_little_maid");
        result.addProperty("points", maid.getFavorability());
        result.addProperty("level", maid.getFavorabilityManager().getLevel());
        return result;
    }
}
