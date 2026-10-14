package cn.blockforge.generated.villagernews;

import dev.breezes.settlements.domain.inventory.BackpackEntry;
import dev.breezes.settlements.domain.inventory.VillagerInventory;
import net.minecraft.world.Container;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import java.util.ArrayList;
import java.util.List;

/** Eight real container slots over the native ledger. Counts and full components stay native. */
final class SettlementsCompat$SettlementsBackpackView implements Container {
    private final VillagerInventory inventory;
    private final ItemStack[] slots = new ItemStack[8];
    private final List<BackpackEntry> overflow = new ArrayList<>();
    private List<BackpackEntry> baseline;
    private int version = -1;

    SettlementsCompat$SettlementsBackpackView(VillagerInventory inventory) {
        this.inventory = inventory;
        refresh();
    }

    private void refresh() {
        if (version == inventory.getInventoryVersion()) return;
        for (int i = 0; i < slots.length; i++) slots[i] = ItemStack.EMPTY;
        baseline = new ArrayList<>(inventory.entries());
        overflow.clear();
        int slot = 0;
        for (BackpackEntry entry : baseline) {
            int remaining = entry.count();
            ItemStack item = entry.representative();
            while (remaining > 0 && slot < slots.length) {
                int count = Math.min(remaining, Math.min(99, item.getMaxStackSize()));
                slots[slot++] = item.copyWithCount(count);
                remaining -= count;
            }
            if (remaining > 0) overflow.add(new BackpackEntry(item.copyWithCount(1), remaining));
        }
        version = inventory.getInventoryVersion();
    }

    private static void aggregate(List<BackpackEntry> entries, ItemStack item, int count) {
        if (item.isEmpty() || count <= 0) return;
        for (int i = 0; i < entries.size(); i++) {
            BackpackEntry prior = entries.get(i);
            if (ItemStack.isSameItemSameComponents(prior.representative(), item)) {
                entries.set(i, new BackpackEntry(prior.representative(), Math.addExact(prior.count(), count)));
                return;
            }
        }
        entries.add(new BackpackEntry(item.copyWithCount(1), count));
    }

    private static int count(List<BackpackEntry> entries, ItemStack item) {
        return entries.stream().filter(e -> ItemStack.isSameItemSameComponents(e.representative(), item))
                .mapToInt(BackpackEntry::count).sum();
    }

    private void commit() {
        List<BackpackEntry> desired = new ArrayList<>();
        for (ItemStack item : slots) aggregate(desired, item, item.getCount());
        for (BackpackEntry entry : overflow) aggregate(desired, entry.representative(), entry.count());
        // All methods run synchronously on the native server thread. No other actor
        // can change this ledger between refresh/mutation/commit in one menu operation.
        for (BackpackEntry prior : baseline) {
            int remove = prior.count() - count(desired, prior.representative());
            if (remove > 0 && inventory.consume(prior.representative(), remove) != remove)
                throw new IllegalStateException("Settlements native inventory changed during menu operation");
        }
        for (BackpackEntry next : desired) {
            int add = next.count() - count(baseline, next.representative());
            if (add > 0) inventory.add(next.representative().copyWithCount(add));
        }
        baseline = desired;
        version = inventory.getInventoryVersion();
    }

    @Override public int getContainerSize() { return slots.length; }
    @Override public boolean isEmpty() {
        refresh();
        for (ItemStack item : slots) if (!item.isEmpty()) return false;
        return overflow.isEmpty();
    }
    @Override public ItemStack getItem(int index) { refresh(); return slots[index]; }
    @Override public ItemStack removeItem(int index, int amount) {
        refresh();
        if (amount <= 0 || slots[index].isEmpty()) return ItemStack.EMPTY;
        ItemStack result = slots[index].split(amount);
        commit();
        return result;
    }
    @Override public ItemStack removeItemNoUpdate(int index) {
        refresh();
        ItemStack result = slots[index];
        slots[index] = ItemStack.EMPTY;
        commit();
        return result;
    }
    @Override public void setItem(int index, ItemStack item) {
        refresh();
        slots[index] = item;
        commit();
    }
    @Override public void setChanged() { commit(); }
    @Override public boolean stillValid(Player player) { return true; }
    @Override public void clearContent() {
        refresh();
        for (int i = 0; i < slots.length; i++) slots[i] = ItemStack.EMPTY;
        overflow.clear();
        commit();
    }
}
