package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.Material;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** All planning and publication happen on the game thread, against the actor's own bag. */
final class InventoryBatch {
    static final Set<String> ACTIONS = Set.of("clean", "store", "donate");
    private final AgentFriendPlugin plugin;

    InventoryBatch(AgentFriendPlugin plugin) { this.plugin = plugin; }

    private Path pending(UUID actor) {
        return plugin.getDataFolder().toPath().resolve("inventory-transfers").resolve(actor.toString()).resolve("pending.yml");
    }

    boolean unresolved(UUID actor) { return Files.exists(pending(actor)); }

    private static boolean present(ItemStack item) {
        return item != null && !item.getType().isAir() && item.getAmount() > 0;
    }

    private static ItemStack[] copy(ItemStack[] items) {
        return Arrays.stream(items).map(item -> present(item) ? item.clone() : null).toArray(ItemStack[]::new);
    }

    // Always keep an accessible working supply even when it lives outside the hotbar.
    static int reserve(Material type) {
        String name = type.name();
        if (type.isEdible() || type == Material.ARROW || type == Material.SPECTRAL_ARROW || type == Material.TORCH
                || type == Material.IRON_INGOT || type == Material.ENDER_PEARL || type == Material.EXPERIENCE_BOTTLE)
            return type.getMaxStackSize();
        if (type.getMaxDurability() > 0 || type == Material.WATER_BUCKET || type == Material.BUCKET) return 1;
        return 0;
    }

    private static final class Target {
        final String id;
        final Inventory chest;
        final ItemStack[] before, after;
        final int stackLimit;

        Target(String id, Inventory chest, ItemStack[] items, int stackLimit) {
            this.id = id; this.chest = chest; this.before = copy(items); this.after = copy(items);
            this.stackLimit = stackLimit;
        }

        int insert(ItemStack sample, int amount) {
            int remaining = amount, limit = Math.min(stackLimit, sample.getMaxStackSize());
            for (int slot = 0; slot < after.length && remaining > 0; slot++) {
                ItemStack existing = after[slot];
                if (!present(existing) || !existing.isSimilar(sample)) continue;
                int added = Math.min(remaining, Math.max(0, limit - existing.getAmount()));
                existing.setAmount(existing.getAmount() + added); remaining -= added;
            }
            for (int slot = 0; slot < after.length && remaining > 0; slot++) {
                if (present(after[slot])) continue;
                int added = Math.min(remaining, limit);
                after[slot] = sample.clone(); after[slot].setAmount(added); remaining -= added;
            }
            return amount - remaining;
        }
    }

    private List<Target> destinations(Player p, boolean personal, int category) {
        if (personal) return List.of(new Target("personal", null, plugin.dungeon().stashSnapshot(p.getUniqueId()).items(), 64));
        List<Inventory> chests = plugin.guildShared().inventories(category);
        if (chests == null) return List.of();
        List<Target> destinations = new ArrayList<>();
        for (Inventory chest : chests) {
            var loc = Objects.requireNonNull(chest.getLocation());
            String id = loc.getWorld().getUID()+"/"+loc.getX()+"/"+loc.getY()+"/"+loc.getZ();
            destinations.add(new Target(id, chest, chest.getContents(), chest.getMaxStackSize()));
        }
        return destinations;
    }

    private static void count(Map<Material,Integer> kept, ItemStack item) {
        if (present(item)) kept.merge(item.getType(), item.getAmount(), Integer::sum);
    }

    void command(Player p, String[] args) {
        String action = args[1].toLowerCase(Locale.ROOT);
        boolean preview = false;
        for (int n = 2; n < args.length; n++) {
            if (args[n].equals("--dry-run")) preview = true;
            else if (!args[n].equals("--json")) {
                reject(p, action, "invalid_argument", "/mycli inventory "+action+" [--dry-run] [--json]"); return;
            }
        }
        String blocked = plugin.inventoryTidy().blocker(p);
        if (blocked != null) {
            reject(p, action, blocked, switch (blocked) {
                case "close_container_first" -> "关掉物品界面并放下光标上的物品后再试";
                case "pvp_inventory_locked" -> "/mycli pvp status";
                case "save_unverified" -> "请服主核对原背包回执";
                default -> "回到可操作的生存角色后再试";
            }); return;
        }
        UUID actor = p.getUniqueId();
        if (unresolved(actor) || plugin.inventoryTidy().stashWritesBlocked(actor)) {
            reject(p, action, "transfer_unverified", "请服主核对本人的原转移回执"); return;
        }
        if (plugin.nativeRpgSelected() && (plugin.nativeRpg().blockPendingTrade(p)
                || plugin.nativeRpg().recyclingState(p).get("pending").getAsBoolean())) {
            reject(p, action, "trade_pending", "/mycli trade recycle status"); return;
        }
        if (action.equals("clean")) { plugin.inventoryTidy().clean(p, preview); return; }

        boolean personal = action.equals("store");
        ItemStack[] before = copy(p.getInventory().getStorageContents()), after = copy(before);
        int first = Math.min(InventoryTidy.firstCarriedSlot(p), before.length);
        Map<Material,Integer> kept = new EnumMap<>(Material.class), amounts = new EnumMap<>(Material.class);
        for (int slot = 0; slot < first; slot++) count(kept, before[slot]);
        for (ItemStack worn : p.getInventory().getArmorContents()) count(kept, worn);
        count(kept, p.getInventory().getItemInOffHand());
        if (ResidentCli.isResident(actor)) count(kept, p.getInventory().getItemInMainHand());
        Map<Integer,List<Target>> pools = new LinkedHashMap<>();
        int moved = 0, freed = 0, full = 0, unavailable = 0;
        for (int slot = first; slot < before.length; slot++) {
            ItemStack item = before[slot];
            if (!present(item) || item.hasItemMeta() || plugin.isSoulbound(item) || BackpackShortcutMigration.isShortcut(item)) continue;
            Material type = item.getType();
            if (!personal && !DungeonManager.plainGuildDonation(type)) continue;
            int keep = Math.min(item.getAmount(), Math.max(0, reserve(type) - kept.getOrDefault(type, 0)));
            kept.merge(type, keep, Integer::sum);
            int offered = item.getAmount() - keep;
            if (offered == 0) continue;
            int category = personal ? -1 : plugin.dungeon().guildDonationCategory(type);
            List<Target> targets = pools.computeIfAbsent(category, c -> destinations(p, personal, c));
            if (targets.isEmpty()) { unavailable += offered; continue; }
            int left = offered;
            for (Target dest : targets) { left -= dest.insert(item, left); if (left == 0) break; }
            full += left;
            int sent = offered - left;
            if (sent == 0) continue;
            moved += sent; amounts.merge(type, sent, Integer::sum);
            if (sent == item.getAmount()) { after[slot] = null; freed++; }
            else after[slot].setAmount(item.getAmount() - sent);
        }
        List<Target> changed = pools.values().stream().flatMap(Collection::stream)
                .filter(t -> !Arrays.equals(t.before, t.after)).toList();
        int cost = moved > 0 && personal && !plugin.dungeon().nearStash(p) ? 2 : 0;
        if (!preview && moved > 0 && personal && !plugin.dungeon().remoteStashReady(p)) {
            reject(p, action, "remote_storage_unavailable", "补足2魔力或前往试炼场实体个人箱"); return;
        }
        String request = null;
        if (!preview && moved > 0) {
            request = UUID.randomUUID().toString();
            Path file = pending(actor);
            try {
                writeIntent(file, request, action, before, after, changed);
                p.getInventory().setStorageContents(after);
                if (!Arrays.equals(after, copy(p.getInventory().getStorageContents()))) throw new IOException("source_readback_mismatch");
                InventoryTidy.saveBag(plugin, p, request);
                for (Target dest : changed) {
                    if (personal) { plugin.dungeon().stageStashContents(actor, dest.after); plugin.saveConfig(); }
                    else dest.chest.setContents(dest.after);
                }
                for (Target dest : changed) {
                    ItemStack[] actual = personal ? plugin.dungeon().stashSnapshot(actor).items() : dest.chest.getContents();
                    if (!Arrays.equals(dest.after, copy(actual))) throw new IOException("destination_readback_mismatch");
                }
                if (cost > 0) plugin.dungeon().chargeRemoteStash(p);
                p.updateInventory();
                if (personal) Files.delete(file);
                else Files.move(file, file.resolveSibling(request+".donated.yml"), StandardCopyOption.ATOMIC_MOVE);
            } catch (Exception error) {
                plugin.getLogger().log(java.util.logging.Level.SEVERE, "Inventory transfer "+actor+" request="+request, error);
                JsonObject out = new JsonObject(); out.addProperty("action", action); out.addProperty("success", false);
                out.addProperty("reason", "save_unverified"); out.addProperty("outcomeUnknown", true);
                out.addProperty("requestId", request); out.addProperty("retrySameAction", false);
                p.sendMessage("§e存盘待核实，请服主核对原回执 "+request+"。"); receipt(p,out); return;
            }
        }
        JsonObject out = new JsonObject(); out.addProperty("action",action); out.addProperty("success",true);
        out.addProperty("reason", preview ? "preview" : moved > 0 ? (full+unavailable > 0 ? "partial" : "completed")
                : unavailable > 0 ? "shared_chest_unavailable" : full > 0 ? "destination_full" : "nothing_to_move");
        out.addProperty("dryRun",preview); out.addProperty("moved",preview ? 0 : moved); out.addProperty("plannedItems",moved);
        out.addProperty("freedSlots",preview ? 0 : freed); out.addProperty("plannedFreedSlots",freed);
        out.addProperty("leftForCapacity",full); out.addProperty("leftForUnavailableChest",unavailable);
        out.addProperty("manaSpent",preview ? 0 : cost); out.addProperty("quotedMana",cost);
        if (request != null) out.addProperty("requestId", request);
        JsonObject items = new JsonObject(); amounts.forEach((m,n) -> items.addProperty(m.getKey().toString(),n)); out.add("items",items);
        p.sendMessage("§b【"+(personal?"远程存箱":"公会捐献")+(preview?"预览":"")+"】"+(preview?"可转移 ":"转移 ")+moved+
                " 件，"+(preview?"预计释放 ":"释放 ")+freed+" 格。"+(full>0?"箱满，随身保留 "+full+" 件。":"")+
                (unavailable>0?"共享箱暂不可用，随身保留 "+unavailable+" 件。":"")+(cost>0?(preview?"预计消耗 ":"消耗 ")+cost+" 魔力。":""));
        receipt(p,out);
    }

    static void receipt(Player p, JsonObject out) {
        out.addProperty("schemaVersion",1); out.addProperty("playerUuid",p.getUniqueId().toString());
        p.sendMessage("MC_INVENTORY_BATCH "+out);
    }
    private static void reject(Player p,String action,String reason,String next) {
        JsonObject out = new JsonObject(); out.addProperty("action",action); out.addProperty("success",false);
        out.addProperty("reason",reason); out.addProperty("changed",false); out.addProperty("nextAction",next);
        p.sendMessage("§e["+reason+"] "+next); receipt(p,out);
    }

    // If playerdata and the destination do not both settle, retain the exact deltas
    // and never enqueue another batch against that actor. Public chest receipts also
    // outlive this process so an unflushed chunk can be reconciled after a hard stop.
    private static void writeIntent(Path file,String request,String action,ItemStack[] before,ItemStack[] after,
                                    List<Target> destinations) throws IOException {
        YamlConfiguration data = new YamlConfiguration();
        data.set("request",request); data.set("action",action); data.set("actor",file.getParent().getFileName().toString());
        data.set("created",java.time.Instant.now().toString()); deltas(data,"bag",before,after);
        int row = 0;
        for (Target dest : destinations) {
            String key = "destinations."+row++;
            data.set(key+".id", dest.id); deltas(data,key+".slots",dest.before,dest.after);
        }
        Files.createDirectories(file.getParent());
        Path temp = Files.createTempFile(file.getParent(),"intent-",".tmp");
        try {
            try (var channel = FileChannel.open(temp,StandardOpenOption.WRITE)) {
                ByteBuffer bytes = StandardCharsets.UTF_8.encode(data.saveToString());
                while (bytes.hasRemaining()) channel.write(bytes);
                channel.force(true);
            }
            Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE);
        } finally { Files.deleteIfExists(temp); }
    }

    private static void deltas(YamlConfiguration data,String path,ItemStack[] before,ItemStack[] after) {
        for (int slot=0; slot<before.length; slot++) if (!Objects.equals(before[slot],after[slot])) {
            data.set(path+"."+slot+".before",before[slot]); data.set(path+"."+slot+".after",after[slot]);
        }
    }
}
