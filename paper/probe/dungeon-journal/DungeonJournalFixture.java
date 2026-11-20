package org.afuhome.agentfriend;

import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import java.nio.file.*;

public final class DungeonJournalFixture extends JavaPlugin {
    private DungeonEditJournal journal;
    private World world;
    private final String domain = "site-fixture";
    private Block block(int x) { return world.getBlockAt(x, 100, 0); }
    private static void check(boolean test, String message) { if (!test) throw new AssertionError(message); }

    @Override public void onEnable() {
        try {
            check(Bukkit.getPort() == 26736 && "127.0.0.1".equals(Bukkit.getIp()) &&
                    Files.readString(Path.of(".journal-qa")).strip().equals("SYNTHETIC_DUNGEON_JOURNAL_ONLY"), "fixture guard");
        } catch (Exception failure) { throw new IllegalStateException(failure); }
        world = Bukkit.getWorlds().getFirst();
        journal = new DungeonEditJournal(this);
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) || args.length != 1) return false;
        try {
            switch (args[0]) {
                case "seed" -> {
                    check(!journal.dirty(domain), "seed requires fresh directory");
                    block(0).setType(Material.STONE, false);
                    block(0).getRelative(0,-1,0).setType(Material.STONE, false);
                    block(2).setType(Material.AIR,false);
                    block(4).setType(Material.BARREL,false);
                    Barrel barrel = (Barrel) block(4).getState();
                    var item = new ItemStack(Material.EMERALD, 7);
                    var meta = item.getItemMeta();
                    meta.setDisplayName("Journal QA");
                    item.setItemMeta(meta);
                    barrel.setCustomName("Journal QA barrel");
                    barrel.getSnapshotInventory().setItem(11,item);
                    barrel.getPersistentDataContainer().set(new NamespacedKey(this,"marker"),PersistentDataType.INTEGER,42);
                    check(barrel.update(true,false), "barrel original");
                    check(journal.capture(domain, block(0).getState()), "record stone");
                    check(journal.capture(domain, block(2).getState()), "record air");
                    check(journal.capture(domain, block(4).getState()), "record complete tile");
                    ((Barrel)block(4).getState()).getInventory().clear();
                    block(4).setType(Material.COBBLESTONE,false);
                    block(2).setType(Material.CRAFTING_TABLE,false);
                    check(journal.capture(domain, block(2).getState()), "second write is idempotent");
                    block(0).setType(Material.AIR,false);
                    world.save();
                }
                case "hold" -> {
                    Player p = Bukkit.getPlayerExact("JournalBodyQA");
                    check(p != null, "waiting for protocol player");
                    p.setGameMode(GameMode.SURVIVAL);
                    check(p.teleport(block(0).getLocation().add(.5,0,.5)), "hold player inside original stone");
                    check(journal.dirty(domain) && journal.ready(domain), "journal recovered on restart");
                    check(block(2).getType()==Material.CRAFTING_TABLE && block(4).getType()==Material.COBBLESTONE, "dirty world survived process stop");
                    check(!journal.restore(domain), "reset pending");
                    check(!journal.capture(domain, block(9).getState()), "writes forbidden during reset");
                }
                case "release" -> {
                    check(block(0).getType()==Material.AIR && journal.dirty(domain), "overlapping player protected");
                    check(block(2).getType()==Material.AIR, "temporary crafting table removed");
                    Barrel b = (Barrel) block(4).getState();
                    var item = b.getInventory().getItem(11);
                    check(item != null && item.getType()==Material.EMERALD && item.getAmount()==7 &&
                        "Journal QA".equals(item.getItemMeta().getDisplayName()) && "Journal QA barrel".equals(b.getCustomName()) &&
                        b.getPersistentDataContainer().getOrDefault(new NamespacedKey(this,"marker"),PersistentDataType.INTEGER,0)==42,
                        "tile name, PDC, inventory slot, item metadata and quantity");
                    Player p = Bukkit.getPlayerExact("JournalBodyQA");
                    check(p != null && p.teleport(world.getSpawnLocation()), "exit");
                }
                case "check" -> {
                    check(journal.ready(domain) && !journal.dirty(domain) && block(0).getType()==Material.STONE, "fresh round ready");
                    check(block(2).getType()==Material.AIR && block(4).getType()==Material.BARREL, "persisted restored world");
                }
                case "damage" -> {
                    check(journal.capture("wild-fault", block(4).getState()), "seed fault journal");
                    Path folder = getDataFolder().toPath().resolve("dungeon-edit-journal-v1/wild-fault");
                    try (var files=Files.newDirectoryStream(folder,"*.block")) {
                        Path f=files.iterator().next();
                        byte[] bytes=Files.readAllBytes(f); bytes[bytes.length-1]^=1; Files.write(f,bytes);
                    }
                }
                case "fault" -> {
                    check(!journal.ready("wild-fault") && journal.dirty("wild-fault") && !journal.restore("wild-fault")
                        && !journal.capture("wild-fault",block(1).getState()), "corrupt journal locks edits and reset");
                }
                default -> throw new AssertionError("unknown test step");
            }
            getLogger().info("JOURNAL_QA_OK "+args[0]);
        } catch (Throwable failure) { getLogger().log(java.util.logging.Level.SEVERE,"JOURNAL_QA_FAILED "+args[0],failure); }
        return true;
    }
}
