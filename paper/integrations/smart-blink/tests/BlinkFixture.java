package org.qiandengji.magic.tests;

import com.google.gson.Gson;
import com.nisovin.magicspells.MagicSpells;
import com.nisovin.magicspells.Spell;
import com.nisovin.magicspells.events.SpellCastedEvent;
import com.nisovin.magicspells.events.SpellTargetLocationEvent;
import io.vortexcore.VortexCorePlugin;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.data.type.Slab;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only terrain fixtures. Refuses all production addresses and identities. */
public final class BlinkFixture extends JavaPlugin implements Listener {
    private final Gson gson = new Gson();
    private UUID actor; private String scenario = ""; private int successes, teleports;
    @Override public void onEnable() {
        if (!getServer().getIp().equals("127.0.0.1") || getServer().getPort() != 29397) throw new IllegalStateException("Loopback fixture only");
        try { if (!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030")) throw new IllegalStateException("Own marker required"); }
        catch (java.io.IOException e) { throw new IllegalStateException(e); }
        Bukkit.getPluginManager().registerEvents(this, this);
        getServer().getCommandMap().register("blinkfixture", new Command("blinkqa") {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return false;
                if (args.length < 2 || !args[1].matches("ag_BL[a-z0-9]{3,10}")) throw new IllegalArgumentException("Own QA actor only");
                Player p = Bukkit.getPlayerExact(args[1]); if (p == null) throw new IllegalStateException("Own actor offline");
                try { run(sender, p, args); } catch (Exception e) { throw new IllegalStateException(e); }
                return true;
            }
        });
    }
    private VortexCorePlugin vortex() { return (VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG"); }
    private void run(CommandSender sender, Player p, String[] args) throws Exception {
        if (vortex().playerProfileService().qiandengjiLoading(p.getUniqueId())) { sender.sendMessage("BLINK_QA loading"); return; }
        World w = p.getWorld();
        if (args[0].equals("case")) {
            scenario = ""; actor = p.getUniqueId();
            w = Bukkit.getWorld("world"); w.getWorldBorder().setCenter(0, 0); w.getWorldBorder().setSize(20000);
            for (int x = 202; x <= 241; x++) for (int z = 27; z <= 33; z++) for (int y = 174; y <= 228; y++)
                w.getBlockAt(x, y, z).setType(y == 200 ? Material.STONE : Material.AIR, false);
            p.setGameMode(GameMode.SURVIVAL); p.teleport(new Location(w, 205.5, 201, 30.5, -90, 0));
            p.setFallDistance(0); p.setFoodLevel(20); p.setHealth(p.getMaxHealth());
            p.setOp(false); MagicSpells.getSpellByName("blink").setCooldown(p, 0);
            vortex().qiandengjiMana().setMana(p.getUniqueId(), vortex().qiandengjiMana().getMaxMana(p));
            scenario = args[2]; successes = teleports = 0;
            switch (scenario) {
                case "wall" -> { for (int z = 27; z <= 33; z++) for (int y = 201; y <= 208; y++) w.getBlockAt(215, y, z).setType(Material.STONE, false); }
                case "void" -> { for (int x = 222; x <= 241; x++) for (int z = 27; z <= 33; z++) w.getBlockAt(x, 200, z).setType(Material.AIR, false); }
                case "magma", "aim_magma" -> { for (int x = 228; x <= 241; x++) for (int z = 27; z <= 33; z++) w.getBlockAt(x, 200, z).setType(Material.MAGMA_BLOCK, false); }
                case "slab" -> {
                    var slab = (Slab)Bukkit.createBlockData(Material.STONE_SLAB); slab.setType(Slab.Type.BOTTOM);
                    for (int x = 225; x <= 241; x++) for (int z = 27; z <= 33; z++) w.getBlockAt(x, 200, z).setBlockData(slab, false);
                }
                case "ceiling" -> { for (int x = 202; x <= 241; x++) for (int z = 27; z <= 33; z++) w.getBlockAt(x, 203, z).setType(Material.STONE, false); }
                case "no_mana" -> vortex().qiandengjiMana().setMana(p.getUniqueId(), 0);
                case "spectator" -> p.setGameMode(GameMode.SPECTATOR);
                case "empty" -> { for (int x = 202; x <= 241; x++) for (int z = 27; z <= 33; z++) if (x != 205 || z != 30) w.getBlockAt(x, 200, z).setType(Material.AIR, false); }
                case "border" -> { w.getWorldBorder().setCenter(205.5, 30.5); w.getWorldBorder().setSize(30); }
                case "flat", "aimed", "cancel_target", "redirect", "cancel_tp", "direct", "alias" -> {}
                default -> throw new IllegalArgumentException("Unknown scenario");
            }
        } else if (args[0].equals("restore")) {
            scenario = ""; w.getWorldBorder().setCenter(0, 0); w.getWorldBorder().setSize(20000); p.setGameMode(GameMode.SURVIVAL);
        } else if (!args[0].equals("status")) throw new IllegalArgumentException("Unknown command");
        var spell = MagicSpells.getSpellByName("blink");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("scenario", scenario); result.put("position", List.of(p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()));
        result.put("rotation", List.of(p.getLocation().getYaw(), p.getLocation().getPitch()));
        result.put("world", w.getKey().toString()); result.put("mana", vortex().qiandengjiMana().getMana(p.getUniqueId()));
        result.put("cooldown", spell.getCooldown(p)); result.put("successEvents", successes); result.put("teleports", teleports);
        result.put("loaded", w.getLoadedChunks().length); result.put("op", p.isOp()); result.put("spellClass", spell.getClass().getName());
        var shape = w.getBlockAt(205, 200, 30).getCollisionShape().getBoundingBoxes();
        result.put("localShape", shape.stream().map(b -> List.of(b.getMinX(), b.getMinY(), b.getMinZ(), b.getMaxX(), b.getMaxY(), b.getMaxZ())).toList());
        var type = spell.getClass().getClassLoader().loadClass("org.qiandengji.magic.BlinkLanding");
        Object planner = type.getConstructor(Player.class, double.class).newInstance(p, 25.0);
        Object selection = type.getMethod("select").invoke(planner);
        Map<String, Object> plan = new LinkedHashMap<>();
        for (String key : List.of("mode", "reason", "blockReads")) plan.put(key, selection.getClass().getMethod(key).invoke(selection));
        Location at = (Location)selection.getClass().getMethod("destination").invoke(selection);
        plan.put("destination", at == null ? null : List.of(at.getX(), at.getY(), at.getZ())); result.put("plan", plan);
        sender.sendMessage("BLINK_QA " + gson.toJson(result));
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void target(SpellTargetLocationEvent event) {
        if (actor == null || !actor.equals(event.getCaster().getUniqueId()) || !event.getSpell().getInternalName().equals("blink")) return;
        if (scenario.equals("cancel_target")) event.setCancelled(true);
        if (scenario.equals("redirect")) event.setTargetLocation(event.getTargetLocation().clone().add(100, 0, 0));
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true) public void teleport(PlayerTeleportEvent event) {
        if (actor == null || !actor.equals(event.getPlayer().getUniqueId()) || event.getCause() != PlayerTeleportEvent.TeleportCause.PLUGIN) return;
        if (scenario.equals("cancel_tp")) event.setCancelled(true); else if (!scenario.isEmpty()) teleports++;
    }
    @EventHandler(priority = EventPriority.MONITOR) public void cast(SpellCastedEvent event) {
        if (actor != null && actor.equals(event.getCaster().getUniqueId()) && event.getSpell().getInternalName().equals("blink")
                && event.getSpellCastState() == Spell.SpellCastState.NORMAL && event.getPostCastAction() == Spell.PostCastAction.HANDLE_NORMALLY) successes++;
    }
}
