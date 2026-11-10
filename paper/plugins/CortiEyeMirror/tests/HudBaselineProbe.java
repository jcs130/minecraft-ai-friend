package org.afuhome.cortieye.test;

import com.google.gson.Gson;
import java.nio.file.Files;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.permissions.PermissionAttachment;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only fixture for a fresh, marked loopback server, never a production plugin. */
public final class HudBaselineProbe extends JavaPlugin {
    private final Map<UUID, PermissionAttachment> permissions = new HashMap<>();
    @Override public void onEnable() {
        try {
            if (!Files.readString(getServer().getWorldContainer().toPath().resolve(".spectator-hud-qa")).trim()
                    .equals("20261110 127.0.0.1:29541") || getServer().getPort() != 29541)
                throw new IllegalStateException("Not the isolated HUD lab");
        } catch (Exception error) { throw new IllegalStateException(error); }
        getCommand("hudprobe").setExecutor(this::command);
    }
    private boolean command(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
        try {
            Player target = Bukkit.getPlayerExact("HudSubject"), eye = Bukkit.getPlayerExact("HudLens");
            if (args[0].equals("fixture")) {
                target.getInventory().clear();
                ItemStack sword = new ItemStack(Material.IRON_SWORD);
                var meta = sword.getItemMeta(); meta.setDisplayName("HUD genuine fixture"); sword.setItemMeta(meta);
                target.getInventory().setItem(0, sword);
                target.getInventory().setItem(7, new ItemStack(Material.BREAD, 13));
                target.getInventory().setHeldItemSlot(7);
                target.setFoodLevel(13); target.setSaturation(2.5f);
                target.setLevel(9); target.setExp(0.25f);
                target.setGameMode(GameMode.SURVIVAL);
            } else if (args[0].equals("deny")) {
                permissions.computeIfAbsent(eye.getUniqueId(), id -> eye.addAttachment(this))
                        .setPermission("spectatorplus.sync." + args[1], !Boolean.parseBoolean(args[2]));
            } else if (args[0].equals("slot")) {
                target.getInventory().setHeldItemSlot(Integer.parseInt(args[1]));
            } else if (args[0].equals("queue-detach")) {
                var plugin = Bukkit.getPluginManager().getPlugin("CortiEyeMirror");
                var f = plugin.getClass().getDeclaredField("additionalEyeMirrors"); f.setAccessible(true);
                var additional = f.get(plugin); var h = additional.getClass().getDeclaredField("hud"); h.setAccessible(true);
                var hud = h.get(additional); var m = hud.getClass().getDeclaredMethod("subjectChanged", Player.class, Player.class);
                m.setAccessible(true); m.invoke(hud, eye, target); eye.setSpectatorTarget(null);
            }
            Map<String,Object> facts = new LinkedHashMap<>();
            facts.put("subject", target.getUniqueId().toString()); facts.put("eye", eye.getUniqueId().toString());
            facts.put("target", eye.getSpectatorTarget() == null ? null : eye.getSpectatorTarget().getUniqueId().toString());
            facts.put("world", target.getWorld().getUID().toString()); facts.put("eyeWorld", eye.getWorld().getUID().toString());
            facts.put("slot", target.getInventory().getHeldItemSlot()); facts.put("food", target.getFoodLevel());
            facts.put("saturation", target.getSaturation()); facts.put("level", target.getLevel());
            facts.put("progress", target.getExp()); facts.put("needed", target.getExperiencePointsNeededForNextLevel());
            facts.put("mode", eye.getGameMode().toString()); facts.put("online", Bukkit.getOnlinePlayers().size());
            sender.sendMessage(new Gson().toJson(facts));
        } catch (Throwable error) { sender.sendMessage("HUD_PROBE_ERROR " + error.getClass().getSimpleName() + ": " + error.getMessage()); }
        return true;
    }
}
