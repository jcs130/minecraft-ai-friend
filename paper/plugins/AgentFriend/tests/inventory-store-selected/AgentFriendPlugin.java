package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Isolated plugin-service doubles. InventoryBatch, Bukkit items, YAML and the game thread are real. */
public final class AgentFriendPlugin extends JavaPlugin {
    final InventoryTidy tidy = new InventoryTidy();
    final DungeonManager boxes = new DungeonManager();
    final TradeGate trade = new TradeGate();
    int configWrites, bagWrites;
    boolean failConfig;
    InventoryTidy inventoryTidy() { return tidy; }
    DungeonManager dungeon() { return boxes; }
    Guild guildShared() { return new Guild(); }
    boolean nativeRpgSelected() { return true; }
    TradeGate nativeRpg() { return trade; }
    boolean isSoulbound(ItemStack item) { return item.getType() == Material.OBSIDIAN; }
    @Override public void saveConfig() {
        if (failConfig) throw new IllegalStateException("fixture persist failure");
        configWrites++;
    }
    @Override public void onEnable() {
        var marker = Path.of(".inventory-store-selected-test");
        try {
            if (!"127.0.0.1".equals(getServer().getIp()) || !Files.isRegularFile(marker)
                    || !"SYNTHETIC ONLY".equals(Files.readString(marker).trim())) {
                throw new IllegalStateException("Use the isolated test runner.");
            }
        } catch (IOException e) { throw new IllegalStateException(e); }
        Bukkit.getScheduler().runTask(this, () -> {
            var result = new JsonObject();
            try {
                result.add("checks", new Cases(this).run());
                result.addProperty("success", true);
            } catch (Throwable e) {
                getLogger().log(java.util.logging.Level.SEVERE, "Synthetic test failure", e);
                result.addProperty("success", false);
                result.addProperty("error", e.toString());
            } finally {
                result.addProperty("paper", Bukkit.getVersion());
                try { Files.writeString(Path.of("inventory-store-result.json"), result.toString()); }
                catch (IOException e) { getLogger().severe(e.toString()); }
                Bukkit.shutdown();
            }
        });
    }
}

final class InventoryTidy {
    String blocked;
    int cleanCalls;
    String blocker(Player p) { return blocked; }
    boolean stashWritesBlocked(UUID actor) { return false; }
    static int firstCarriedSlot(Player p) { return ResidentCli.isResident(p.getUniqueId()) ? 0 : 9; }
    void clean(Player p, boolean preview) { cleanCalls++; }
    static void saveBag(AgentFriendPlugin plugin, Player p, String request) { plugin.bagWrites++; }
}
final class DungeonManager {
    record Snapshot(ItemStack[] items) {}
    final Map<UUID,ItemStack[]> stock = new HashMap<>();
    boolean local, ready = true;
    int spent;
    Snapshot stashSnapshot(UUID actor) { return new Snapshot(stock.computeIfAbsent(actor, k -> new ItemStack[54])); }
    void stageStashContents(UUID actor, ItemStack[] items) { stock.put(actor, items); }
    boolean nearStash(Player p) { return local; }
    boolean remoteStashReady(Player p) { return ready; }
    void chargeRemoteStash(Player p) { spent += 2; }
    static boolean plainGuildDonation(Material m) { return m == Material.STRING; }
    int guildDonationCategory(Material m) { return 1; }
}
final class TradeGate {
    boolean busy;
    boolean blockPendingTrade(Player p) { return busy; }
    JsonObject recyclingState(Player p) { var json=new JsonObject(); json.addProperty("pending", false); return json; }
}
final class Guild {
    List<Inventory> inventories(int category) { return List.of(); }
}
final class BackpackShortcutMigration {
    static boolean isShortcut(ItemStack item) { return item.getType() == Material.COMPASS; }
}
final class ResidentCli {
    static final Set<UUID> syntheticResidents = new HashSet<>();
    static boolean isResident(UUID actor) { return syntheticResidents.contains(actor); }
}
