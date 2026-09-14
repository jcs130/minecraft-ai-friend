package dev.qiandeng.irons;

import com.dwinovo.numen.core.FailureType;
import com.dwinovo.numen.core.task.base.AbstractCompanionTask;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.TaskFactory;
import com.dwinovo.numen.task.TaskRecord;
import com.dwinovo.numen.task.TaskState;
import com.mojang.serialization.JsonOps;
import net.minecraft.core.RegistryAccess;
import net.minecraft.resources.RegistryOps;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/** Native one-tick inventory toss; copies real stacks rather than reconstructing items. */
final class NativeDropTask extends AbstractCompanionTask<NativeDropTask.Record> {
    static final String CAPABILITY = "component_preserving_drop_v1";
    static final class Record extends TaskRecord {
        final Item item;
        final int count;
        final String label;
        Record(String id, long gameTime, String itemId, int count) {
            super("drop_items", "mcp-" + id, gameTime + 80);
            var key = ResourceLocation.parse(itemId);
            if (!BuiltInRegistries.ITEM.containsKey(key)) throw new IllegalArgumentException("unknown_drop_item");
            this.item = BuiltInRegistries.ITEM.get(key);
            this.count = count;
            this.label = itemId;
        }
    }
    static void install() { TaskFactory.register(Record.class, NativeDropTask::new); }
    static int count(NumenPlayer player, Item item) {
        return player.getInventory().items.stream().filter(stack -> stack.is(item)).mapToInt(ItemStack::getCount).sum();
    }
    static String fingerprint(ItemStack stack, RegistryAccess registry) {
        try {
            // Normalize count so identity means complete item/components, not quantity.
            String encoded = ItemStack.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE, registry),
                    stack.copyWithCount(1)).getOrThrow().toString();
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(encoded.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) { throw new IllegalArgumentException("drop_components_unreadable"); }
    }
    private final List<Map<String, Object>> entities = new ArrayList<>();
    private int before, after, dropped;
    private boolean touched;
    NativeDropTask(NumenPlayer player, Record record) { super(player, record); }

    @Override protected void onStart() {
        before = count(player, r.item); after = before;
        if (!(player.level() instanceof ServerLevel level) || before < r.count) {
            fail("insufficient_main_inventory_items", FailureType.NO_MATERIAL); return;
        }
        if (player.containerMenu != player.inventoryMenu) {
            fail("close_container_before_drop", FailureType.UNKNOWN); return;
        }
        int remaining = r.count;
        for (int slot = 0; slot < player.getInventory().items.size() && remaining > 0; slot++) {
            ItemStack source = player.getInventory().items.get(slot);
            if (!source.is(r.item)) continue;
            int take = Math.min(remaining, source.getCount());
            ItemStack original = source.copy();
            ItemStack planned = source.copyWithCount(take);
            String fingerprint = fingerprint(planned, player.registryAccess());
            // Split preserves custom data, names, enchantments, damage and all mod components.
            ItemStack removed = source.split(take);
            player.getInventory().setChanged(); touched = true;
            var entity = player.drop(removed, false);
            if (entity == null) {
                // NeoForge cancelled the native toss. Restore only this exact still-
                // unchanged source slot; never manufacture a generic replacement item.
                ItemStack expected = original.copyWithCount(original.getCount() - take);
                ItemStack current = player.getInventory().items.get(slot);
                if (ItemStack.matches(current, expected) && count(player, r.item) == before - dropped - take)
                    player.getInventory().items.set(slot, original);
                after = count(player, r.item);
                player.getInventory().setChanged(); player.inventoryMenu.broadcastChanges();
                fail("native_drop_cancelled_or_unconfirmed", FailureType.UNKNOWN); return;
            }
            boolean live = level.getEntity(entity.getUUID()) == entity && entity.isAlive();
            boolean same = ItemStack.isSameItemSameComponents(planned, entity.getItem())
                    && entity.getItem().getCount() == take;
            var row = new HashMap<String, Object>();
            row.put("entityUuid", entity.getStringUUID()); row.put("sourceSlot", slot);
            row.put("count", take); row.put("itemId", r.label);
            row.put("componentSha256", fingerprint); row.put("componentsVerified", same);
            row.put("entityObserved", live); row.put("x", entity.getX());
            row.put("y", entity.getY()); row.put("z", entity.getZ());
            entities.add(row); after = count(player, r.item);
            if (!live || !same || after != before - dropped - take) {
                fail("native_drop_effect_mismatch", FailureType.UNKNOWN); return;
            }
            dropped += take; remaining -= take;
        }
        after = count(player, r.item);
        player.getInventory().setChanged(); player.inventoryMenu.broadcastChanges();
        if (dropped == r.count && before - after == r.count) succeed();
        else fail("native_drop_quantity_mismatch", FailureType.UNKNOWN);
    }
    @Override protected TaskState onTick() { return TaskState.SUCCESS; }
    @Override protected void cleanup() {}
    @Override protected String successMessage() { return "Items tossed into the game world; teammate pickup is not confirmed."; }
    @Override protected Map<String, Object> resultData() {
        var data = new HashMap<String, Object>();
        data.put("capability", CAPABILITY); data.put("item_id", r.label);
        data.put("requested_count", r.count); data.put("dropped_count", dropped);
        data.put("inventory_before", before); data.put("inventory_after", after);
        data.put("inventory_touched", touched); data.put("entities", entities);
        data.put("pickup_confirmed", false); data.put("dimension", player.level().dimension().location().toString());
        return data;
    }
}
