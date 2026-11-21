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
import java.util.LinkedHashMap;
import java.util.Map;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.bukkit.Bukkit;
import org.bukkit.NamespacedKey;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.persistence.PersistentDataType;

/** Starting equipment on the original, explicitly registered unified body. */
final class NativeMaidKit {
    private static final String INITIALIZED = "qiandengji_native_starter_kit";

    static void provision(EntityMaid maid, NativeMaidCompanionSupport companion) {
        var backpack = BackpackManager.findBackpack(BigBackpack.ID).orElseThrow();
        var worn = maid.getMaidBackpackType();
        if (worn.getAvailableMaxContainerIndex() < backpack.getAvailableMaxContainerIndex()
                && (worn == BackpackManager.getEmptyBackpack()
                    || worn instanceof com.github.tartaricacid.touhoulittlemaid.entity.backpack.SmallBackpack
                    || worn instanceof com.github.tartaricacid.touhoulittlemaid.entity.backpack.MiddleBackpack)) {
            maid.setMaidBackpackType(backpack);
        }
        maid.getConfigManager().setShowBackpack(false);
        for (var entry:keepsakes(maid).entrySet()) issueKeepsake(maid,entry.getKey(),entry.getValue());
        if (companion != null) {
            try {
                companion.provisionStaff(maid);
            } catch (CompatibilityException refused) {
                if (!java.util.Set.of("starter_already_issued","maid_inventory_full","rpg_unavailable",
                        "rpg_item_unavailable").contains(refused.code())) throw refused;
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String,org.bukkit.inventory.ItemStack> keepsakes(EntityMaid maid) {
        var game = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (game == null || !game.isEnabled()) return Map.of();
        try {
            return (Map<String,org.bukkit.inventory.ItemStack>) Class.forName(
                "org.afuhome.agentfriend.CompanionTravelAccess",false,game.getClass().getClassLoader())
                .getMethod("companionKeepsakes",String.class).invoke(null,maid.getName().getString());
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return Map.of();
        }
    }

    private static void issueKeepsake(EntityMaid maid, String id, org.bukkit.inventory.ItemStack original) {
        var saved = maid.getPersistentData();
        String marker = "qiandengji_starter_" + id;
        if (saved.getBoolean(marker)) return;
        var key = new NamespacedKey("agentfriend",id);
        var inventory = maid.getMaidInv();
        boolean exists = keepsake(maid.getMainHandItem(),key) || keepsake(maid.getOffhandItem(),key);
        int free = -1;
        for (int slot=0;slot<inventory.getSlots();slot++) {
            ItemStack stack = inventory.getStackInSlot(slot);
            if (keepsake(stack,key)) { exists = true; break; }
            if (free<0 && stack.isEmpty() && slot<NativeMaidInventory.capacity(maid)) free=slot;
        }
        if (exists) {
            saved.putBoolean(marker,true);
        } else {
            var stack=CraftItemStack.asNMSCopy(original);
            if (free<0) free=compactOneSlot(maid,stack);
            if (free<0 || !inventory.isItemValid(free,stack)) return;
            inventory.setStackInSlot(free,stack);
            saved.putBoolean(marker,true);
        }
    }

    // Only make room when an entire stack fits. Keep all existing items in
    // the original backpack and preserve components and native stack limits.
    private static int compactOneSlot(EntityMaid maid, ItemStack keepsake) {
        var inventory=maid.getMaidInv();
        int capacity=NativeMaidInventory.capacity(maid);
        for (int from=capacity-1;from>=0;from--) {
            var source=inventory.getStackInSlot(from);
            if (source.isEmpty() || !inventory.isItemValid(from,keepsake)) continue;
            int excess=source.getCount();
            var transfers=new LinkedHashMap<Integer,ItemStack>();
            for (int to=0;to<capacity && excess>0;to++) {
                if (to==from) continue;
                var target=inventory.getStackInSlot(to);
                if (!ItemStack.isSameItemSameComponents(source,target) || !inventory.isItemValid(to,source)) continue;
                int limit=Math.min(inventory.getSlotLimit(to),target.getMaxStackSize());
                int move=Math.min(excess,limit-target.getCount());
                if (move<=0) continue;
                transfers.put(to,target.copyWithCount(target.getCount()+move));
                excess-=move;
            }
            if (excess>0) continue;
            transfers.forEach(inventory::setStackInSlot);
            inventory.setStackInSlot(from,ItemStack.EMPTY);
            return from;
        }
        return -1;
    }

    private static boolean keepsake(ItemStack stack, NamespacedKey key) {
        return !stack.isEmpty() && CraftItemStack.asCraftMirror(stack).getItemMeta()
            .getPersistentDataContainer().has(key,PersistentDataType.BYTE);
    }

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
