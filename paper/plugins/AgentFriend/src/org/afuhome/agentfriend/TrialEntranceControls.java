package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.sign.Side;
import org.bukkit.block.data.Rotatable;
import org.bukkit.block.data.type.Switch;
import org.bukkit.block.BlockFace;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerInteractEvent;

/** Three native buttons. Installation is an explicit, surveyed console operation. */
final class TrialEntranceControls {
    private record Choice(String id, String label, int z, Material base, NamedTextColor color, String hint) { }
    private record Planned(Block block, String role, Choice choice) { }
    private static final int X = -596, Y = 92;
    private static final List<Choice> CHOICES = List.of(
            new Choice("normal", "普通", -313, Material.LIME_CONCRETE, NamedTextColor.GREEN, "初次挑战推荐"),
            new Choice("adventure", "冒险", -310, Material.ORANGE_CONCRETE, NamedTextColor.GOLD, "远程与精英增强"),
            new Choice("apocalypse", "末日", -307, Material.PURPLE_CONCRETE, NamedTextColor.LIGHT_PURPLE, "高强度团队挑战"));
    private final AgentFriendPlugin plugin;
    private final File marker, before;

    TrialEntranceControls(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        marker = new File(plugin.getDataFolder(), "trial-entrance-controls.building");
        before = new File(plugin.getDataFolder(), "trial-entrance-controls.before.yml");
    }
    private World world() { return Bukkit.getWorld("world"); }
    private List<Planned> plan() {
        List<Planned> out = new ArrayList<>();
        if (world() == null) return out;
        for (Choice c : CHOICES) {
            out.add(new Planned(world().getBlockAt(X, Y - 1, c.z()), "base", c));
            out.add(new Planned(world().getBlockAt(X, Y, c.z()), "button", c));
            out.add(new Planned(world().getBlockAt(X - 1, Y - 1, c.z()), "sign_base", c));
            out.add(new Planned(world().getBlockAt(X - 1, Y, c.z()), "sign", c));
        }
        return out;
    }
    private Material material(Planned p) {
        return switch (p.role()) {
            case "base" -> p.choice().base();
            case "button" -> Material.STONE_BUTTON;
            case "sign_base" -> Material.CHISELED_STONE_BRICKS;
            default -> Material.OAK_SIGN;
        };
    }
    private String[] lines(Choice c) {
        return new String[]{"试炼塔 · " + c.label(), c.hint(), "按按钮选择难度", "菜单确认后开场"};
    }
    private boolean matches(Planned p) {
        Block b = p.block();
        if (b.getType() != material(p)) return false;
        if (p.role().equals("button")) return b.getBlockData() instanceof Switch s
                && s.getAttachedFace() == Switch.AttachedFace.FLOOR;
        if (p.role().equals("sign")) {
            if (!(b.getState() instanceof Sign sign) || !sign.isWaxed()
                    || !(b.getBlockData() instanceof Rotatable r) || r.getRotation() != BlockFace.EAST) return false;
            String[] text = lines(p.choice());
            for (Side side : Side.values()) for (int i = 0; i < text.length; i++)
                if (!sign.getSide(side).line(i).equals(Component.text(text[i], p.choice().color()))) return false;
        }
        return true;
    }
    private boolean ready() {
        List<Planned> blocks = plan();
        return !marker.exists() && blocks.size() == 12 && blocks.stream().allMatch(this::matches);
    }
    void describe(CommandSender sender) {
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1);
        boolean loaded = world() != null && world().isChunkLoaded(X >> 4, CHOICES.getFirst().z() >> 4);
        out.addProperty("ready", loaded ? Boolean.valueOf(ready()) : null);
        out.addProperty("verification", loaded ? "loaded_blocks" : "unknown_unloaded");
        out.addProperty("confirmationRequired", true);
        out.addProperty("selectionCommand", "/mycli arena difficulty <normal|adventure|apocalypse>");
        out.addProperty("startCommand", "/mycli arena start");
        JsonArray buttons = new JsonArray();
        for (Choice c : CHOICES) {
            JsonObject b = new JsonObject(); b.addProperty("difficulty", c.id()); b.addProperty("label", c.label());
            b.addProperty("world", "world"); b.addProperty("x", X); b.addProperty("y", Y); b.addProperty("z", c.z());
            b.addProperty("command", "/mycli arena difficulty " + c.id()); buttons.add(b);
        }
        out.add("buttons", buttons);
        sender.sendMessage("试炼入口有普通（绿）、冒险（橙）、末日（紫）三个按钮；按牌选难度，再点菜单「开始」。发起者决定全队难度，附近12格内的合格队友入场。");
        sender.sendMessage("MC_TRIAL_BUTTONS " + out);
    }
    boolean handleInteract(PlayerInteractEvent event) {
        Block b = event.getClickedBlock();
        if (b == null || !b.getWorld().equals(world()) || b.getX() != X || b.getY() != Y
                || b.getType() != Material.STONE_BUTTON) return false;
        for (Choice c : CHOICES) if (b.getZ() == c.z()) {
            event.setCancelled(true); Player p = event.getPlayer();
            if (plugin.isObserver(p)) {
                p.sendMessage("§c观战账号不能选择或发起试炼；请使用对应的生存角色，/mycli arena status 查看规则。");
                return true;
            }
            plugin.dungeon().command(p, new String[]{"arena", "difficulty", c.id()});
            p.sendMessage("§e已按下「" + c.label() + "」按钮。请核对队友和难度，再点「开始" + c.label() + "试炼」。");
            // Open after other native interaction listeners (including backpack items).
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (p.isOnline()) plugin.openDungeonDifficultyMenu(p);
            });
            return true;
        }
        return false;
    }
    void admin(CommandSender sender, String action) {
        if (action.equals("audit")) { describe(sender); return; }
        if (!action.equals("survey") && !action.equals("build")) {
            sender.sendMessage("用法：mycli admin trialbuttons survey|build|audit"); return;
        }
        if (world() == null || !plugin.dungeon().isBuilt() || plugin.dungeon().hasActiveRun()) {
            sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=denied reason=trial_unavailable_or_active；先检查 dungeonaudit，待试炼空闲再勘察。"); return;
        }
        if (marker.exists()) {
            sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=denied reason=unfinished_construction；保留现场和building文件，按施工前完整备份恢复，不重复覆盖。"); return;
        }
        if (ready()) { sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=already_ready changedBlocks=0"); describe(sender); return; }
        List<Planned> blocks = plan();
        if (before.exists()) {
            sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=denied reason=installed_layout_changed；已有施工前像，请核对现场并从配套备份修复，不重建覆盖。"); return;
        }
        for (Planned p : blocks) {
            Block b = p.block();
            boolean original = p.choice().id().equals("normal") && (p.role().equals("base")
                    && b.getType() == Material.CHISELED_STONE_BRICKS
                    || p.role().equals("button") && b.getType() == Material.STONE_BUTTON && b.getBlockData() instanceof Switch s
                    && s.getAttachedFace() == Switch.AttachedFace.FLOOR);
            if (b.getState() instanceof TileState || !b.getType().isAir() && !original) {
                sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=denied reason=block_conflict x=" + b.getX()
                        + " y=" + b.getY() + " z=" + b.getZ() + " material=" + b.getType()
                        + "；未施工，请先核实原方块用途，不强行清除。"); return;
            }
            for (Player p2 : world().getPlayers()) if (!plugin.isObserver(p2)
                    && p2.getLocation().distanceSquared(b.getLocation().add(.5, .5, .5)) < 2.25) {
                sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=denied reason=player_in_site；请让角色离开按钮施工位置再勘察。"); return;
            }
        }
        if (action.equals("survey")) {
            sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=survey_ready plannedBlocks=12；先确认E/F完整施工前快照，再执行mycli admin trialbuttons build。"); return;
        }
        try {
            YamlConfiguration snapshot = new YamlConfiguration();
            snapshot.set("world-uuid", world().getUID().toString()); snapshot.set("layout-version", 1);
            for (int i = 0; i < blocks.size(); i++) {
                Block b = blocks.get(i).block(); String k = "blocks." + i;
                snapshot.set(k + ".x", b.getX()); snapshot.set(k + ".y", b.getY()); snapshot.set(k + ".z", b.getZ());
                snapshot.set(k + ".data", b.getBlockData().getAsString());
            }
            snapshot.save(marker);
            for (Planned p : blocks) {
                Block b = p.block(); b.setType(material(p), false);
                if (p.role().equals("button")) {
                    Switch data = (Switch) Bukkit.createBlockData(Material.STONE_BUTTON);
                    data.setAttachedFace(Switch.AttachedFace.FLOOR); b.setBlockData(data, false);
                } else if (p.role().equals("sign")) {
                    Rotatable data = (Rotatable) Bukkit.createBlockData(Material.OAK_SIGN);
                    data.setRotation(BlockFace.EAST); b.setBlockData(data, false);
                    Sign sign = (Sign) b.getState(); String[] text = lines(p.choice());
                    for (Side side : Side.values()) for (int i = 0; i < text.length; i++)
                        sign.getSide(side).line(i, Component.text(text[i], p.choice().color()));
                    sign.setWaxed(true);
                    if (!sign.update(true, false)) throw new IllegalStateException("sign_update");
                }
            }
            if (!blocks.stream().allMatch(this::matches)) throw new IllegalStateException("layout_verification");
            Files.move(marker.toPath(), before.toPath());
            sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=success plannedBlocks=12 difficultyButtons=3；请save-all flush并做施工后E/F完整快照。");
            describe(sender);
        } catch (Exception error) {
            plugin.getLogger().severe("Trial entrance construction interrupted: " + error.getClass().getSimpleName());
            sender.sendMessage("MC_TRIAL_BUTTON_BUILD status=failed reason=construction_interrupted；保留现场和building文件，从施工前配套完整快照恢复，不重复覆盖。");
        }
    }
}
