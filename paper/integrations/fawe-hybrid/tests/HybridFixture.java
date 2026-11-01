package org.afuhome.compat;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Isolated-server fixture only. Never package in the adapter. */
public final class HybridFixture extends JavaPlugin {
    @Override public boolean onCommand(CommandSender sender, Command command,
                                       String label, String[] args) {
        if (sender instanceof Player || args.length != 1) return false;
        Player player = Bukkit.getPlayerExact(args[0]);
        if (player == null) return false;
        player.getInventory().setItem(0, new ItemStack(Material.DIAMOND_AXE));
        player.getInventory().setHeldItemSlot(0);
        Bukkit.getPluginManager().callEvent(new PlayerItemHeldEvent(player, 0, 2));
        getLogger().info("QA_VANILLA_EVENT_RETURNED");
        // Youer creates injected Material entries lazily when converting an
        // actual mod stack. Merely iterating Material.values() is not a repro.
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "minecraft:item replace entity "
            + player.getName() + " weapon.mainhand with touhou_little_maid:hakurei_gohei");
        Material custom = player.getInventory().getItemInMainHand().getType();
        if (custom == Material.DIAMOND_AXE || custom == Material.AIR) {
            throw new IllegalStateException("The actual mod item was not installed");
        }
        Bukkit.getPluginManager().callEvent(new PlayerItemHeldEvent(player, 0, 2));
        getLogger().info("QA_HYBRID_EVENT_RETURNED " + custom.getKey());
        player.getInventory().clear();
        return true;
    }
}
