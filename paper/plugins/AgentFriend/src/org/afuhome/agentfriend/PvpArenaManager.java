package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPotionEffectEvent;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerPickupItemEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.projectiles.ProjectileSource;
import org.bukkit.potion.PotionEffect;

/** Isolated, opt-in 1v1 with equal vanilla equipment and crash-safe inventory escrow. */
final class PvpArenaManager implements Listener {
    static final int X = -700, Y = 160, Z = -550;
    private static final int RING = 11;
    private final AgentFriendPlugin plugin;
    private final World world;
    private final Path escrowPath;
    private final List<UUID> queue = new ArrayList<>();
    private final Map<UUID, Location> queueOrigins = new HashMap<>();
    private final Set<UUID> recovering = new HashSet<>();
    private Match match;

    private static final class Match {
        final UUID a, b;
        final long createdAt = System.currentTimeMillis();
        final Map<UUID, Double> damage = new HashMap<>();
        boolean live, closing;
        Match(Player a, Player b) { this.a = a.getUniqueId(); this.b = b.getUniqueId(); }
        boolean has(UUID id) { return a.equals(id) || b.equals(id); }
        UUID other(UUID id) { return a.equals(id) ? b : a; }
    }

    PvpArenaManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        world = Bukkit.getWorld("world");
        escrowPath = plugin.getDataFolder().toPath().resolve("pvp-escrow.yml");
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    boolean built() { return plugin.getConfig().getBoolean("pvp-arena.built", false); }
    boolean inMatch(Player p) { return match != null && match.has(p.getUniqueId()); }
    boolean blocksNamedTravel(Player p) {
        return inMatch(p) || queue.contains(p.getUniqueId()) || recovering.contains(p.getUniqueId());
    }
    boolean namedTravelArea(Location at) { return built() && inRing(at); }
    private Location lobby() { return new Location(world, X + .5, Y + 1, Z + 14.5, 180, 0); }
    private Location spawn(boolean first) {
        return new Location(world, X + (first ? -8 : 8) + .5, Y + 1, Z + .5,
                first ? -90 : 90, 0);
    }
    private boolean inRing(Location at) {
        return at != null && at.getWorld() == world
                && Math.abs(at.getX() - X - .5) <= RING + 1
                && Math.abs(at.getZ() - Z - .5) <= RING + 1
                && at.getY() >= Y && at.getY() <= Y + 5;
    }

    void command(Player p, String[] args) {
        String action = args.length < 2 ? "status" : args[1].toLowerCase(java.util.Locale.ROOT);
        switch (action) {
            case "status", "状态" -> status(p);
            case "join", "加入" -> join(p);
            case "leave", "退出" -> leave(p);
            case "lobby", "前往" -> lobby(p);
            case "board", "rank", "排行" -> board(p);
            case "menu", "菜单" -> plugin.openPvpMenu(p);
            default -> p.sendMessage(ChatColor.RED + "用法：/mycli pvp status|join|leave|lobby|board|menu");
        }
    }

    private void result(Player p, String action, boolean ok, String reason) {
        JsonObject json = new JsonObject();
        json.addProperty("schemaVersion", 1);
        json.addProperty("action", action);
        json.addProperty("ok", ok);
        json.addProperty("reason", reason);
        json.addProperty("queued", queue.contains(p.getUniqueId()));
        json.addProperty("participant", inMatch(p));
        json.addProperty("active", match != null && match.live);
        json.addProperty("queueSize", queue.size());
        json.addProperty("rating", rating(p.getUniqueId()));
        json.addProperty("wins", plugin.getConfig().getInt("pvp-records." + p.getUniqueId() + ".wins"));
        json.addProperty("losses", plugin.getConfig().getInt("pvp-records." + p.getUniqueId() + ".losses"));
        json.addProperty("world", "world");
        json.addProperty("lobbyX", X);
        json.addProperty("lobbyY", Y + 1);
        json.addProperty("lobbyZ", Z + 14);
        if (inMatch(p)) {
            Player opponent = Bukkit.getPlayer(match.other(p.getUniqueId()));
            json.addProperty("opponent", opponent == null ? "offline" : opponent.getName());
            json.addProperty("phase", match.live ? "fighting" : "countdown");
        }
        p.sendMessage("MC_PVP " + json);
    }

    private void status(Player p) {
        result(p, "status", built(), built() ? "ok" : "arena_not_built");
        p.sendMessage(built()
                ? ChatColor.GOLD + "PvP竞技场：同款铁剑、弓、锁链甲；180 秒限时，胜负记积分。"
                : ChatColor.RED + "PvP竞技场尚未建成。");
    }
    private void lobby(Player p) {
        if (!built() || world == null) { result(p, "lobby", false, "arena_not_built"); return; }
        if (inMatch(p)) { result(p, "lobby", false, "match_active"); return; }
        if (plugin.travelMagic().teleport(p, lobby(), "pvp:lobby", "竞技场传送术",
                TravelMagic.LOCAL_MANA)) result(p, "lobby", true, "teleported");
        else result(p, "lobby", false, "teleport_failed");
    }
    private void join(Player p) {
        if (!built() || world == null) { result(p, "join", false, "arena_not_built"); return; }
        if (!world.getPVP()) { result(p, "join", false, "server_pvp_disabled"); return; }
        if (!p.getItemOnCursor().getType().isAir()) {
            result(p, "join", false, "cursor_item_not_stored");
            p.sendMessage(ChatColor.RED + "先把鼠标光标上的物品放回背包，再加入匹配。");
            return;
        }
        if (p.getGameMode() == GameMode.SPECTATOR || p.isDead() || plugin.dungeonParticipant(p)) {
            result(p, "join", false, "not_eligible"); return;
        }
        if (queue.contains(p.getUniqueId()) || inMatch(p) || escrow().contains("players." + p.getUniqueId())) {
            result(p, "join", false, "already_joined_or_recovery_pending"); return;
        }
        if (!plugin.hasMana(p, TravelMagic.LOCAL_MANA)) {
            result(p, "join", false, "insufficient_mana"); return;
        }
        p.closeInventory();
        queueOrigins.put(p.getUniqueId(), p.getLocation().clone());
        queue.add(p.getUniqueId());
        if (!plugin.travelMagic().teleport(p, lobby(), "pvp:join", "竞技场入场术",
                TravelMagic.LOCAL_MANA)) {
            queue.remove(p.getUniqueId());
            queueOrigins.remove(p.getUniqueId());
            result(p, "join", false, "teleport_failed");
            return;
        }
        result(p, "join", true, "queued");
        p.sendMessage(ChatColor.AQUA + "已加入匹配；第二人加入后自动开始倒计时。退出用 /mycli pvp leave。");
        pair();
    }
    private void leave(Player p) {
        UUID id = p.getUniqueId();
        if (queue.remove(id)) {
            Location home = queueOrigins.remove(id);
            if (home != null) p.teleport(home);
            result(p, "leave", true, "queue_left");
        } else if (inMatch(p)) {
            finish(match.other(id), "forfeit");
            result(p, "leave", true, "forfeit");
        } else result(p, "leave", false, "not_participating");
    }

    private void pair() {
        if (match != null || queue.size() < 2) return;
        Player a = Bukkit.getPlayer(queue.remove(0)), b = Bukkit.getPlayer(queue.remove(0));
        if (a == null || b == null || !a.isOnline() || !b.isOnline()) { pair(); return; }
        try {
            snapshot(a);
            snapshot(b);
        } catch (Exception error) {
            plugin.getLogger().severe("PvP escrow failed; duel cancelled: " + error);
            restore(a); restore(b);
            queueOrigins.remove(a.getUniqueId()); queueOrigins.remove(b.getUniqueId());
            result(a, "join", false, "escrow_failed");
            result(b, "join", false, "escrow_failed");
            return;
        }
        queueOrigins.remove(a.getUniqueId()); queueOrigins.remove(b.getUniqueId());
        equip(a); equip(b);
        match = new Match(a, b);
        a.teleport(spawn(true)); b.teleport(spawn(false));
        a.sendMessage(ChatColor.GOLD + "对手 " + b.getName() + "；同款装备，5 秒后开战。");
        b.sendMessage(ChatColor.GOLD + "对手 " + a.getName() + "；同款装备，5 秒后开战。");
        countdown(match, 5);
    }
    private void countdown(Match expected, int seconds) {
        if (match != expected || expected.closing) return;
        if (seconds == 0) {
            expected.live = true;
            expected.damage.put(expected.a, 0.0);
            expected.damage.put(expected.b, 0.0);
            for (UUID id : List.of(expected.a, expected.b)) {
                Player p = Bukkit.getPlayer(id);
                if (p != null) {
                    p.sendTitle(ChatColor.RED + "开战！", ChatColor.GRAY + "180秒限时", 0, 30, 8);
                    p.playSound(p, Sound.ENTITY_ENDER_DRAGON_GROWL, .6f, 1.5f);
                }
            }
            Bukkit.getScheduler().runTaskLater(plugin, () -> timeout(expected), 20L * 180);
        } else {
            for (UUID id : List.of(expected.a, expected.b)) {
                Player p = Bukkit.getPlayer(id);
                if (p != null) p.sendTitle(ChatColor.GOLD + Integer.toString(seconds),
                        ChatColor.YELLOW + "准备对战", 0, 22, 0);
            }
            Bukkit.getScheduler().runTaskLater(plugin, () -> countdown(expected, seconds - 1), 20L);
        }
    }
    private void timeout(Match expected) {
        if (match != expected || !expected.live || expected.closing) return;
        Player a = Bukkit.getPlayer(expected.a), b = Bukkit.getPlayer(expected.b);
        if (a == null || b == null) { finish(a == null ? expected.b : expected.a, "disconnect"); return; }
        double gap = a.getHealth() - b.getHealth();
        finish(Math.abs(gap) < .5 ? null : gap > 0 ? expected.a : expected.b, "time_limit");
    }
    private int rating(UUID id) { return plugin.getConfig().getInt("pvp-records." + id + ".rating", 1000); }
    private void board(Player p) {
        ConfigurationSection records = plugin.getConfig().getConfigurationSection("pvp-records");
        if (records == null) { p.sendMessage(ChatColor.GRAY + "还没有已完成的对局。"); return; }
        List<String> ids = new ArrayList<>(records.getKeys(false));
        ids.sort(Comparator.comparingInt((String id) -> records.getInt(id + ".rating", 1000)).reversed());
        p.sendMessage(ChatColor.GOLD + "PvP排行榜（同款装备）：");
        for (int i = 0; i < Math.min(10, ids.size()); i++) {
            String id = ids.get(i);
            p.sendMessage("MC_PVP_RANK place=" + (i + 1) + " name=" + records.getString(id + ".name", id)
                    + " rating=" + records.getInt(id + ".rating", 1000)
                    + " wins=" + records.getInt(id + ".wins") + " losses=" + records.getInt(id + ".losses"));
        }
    }
    private void record(UUID id, Player p, int next, String field) {
        String path = "pvp-records." + id;
        plugin.getConfig().set(path + ".rating", next);
        plugin.getConfig().set(path + "." + field, plugin.getConfig().getInt(path + "." + field) + 1);
        if (p != null) plugin.getConfig().set(path + ".name", p.getName());
    }
    private void finish(UUID winner, String reason) {
        Match ended = match;
        if (ended == null || ended.closing) return;
        ended.closing = true;
        Player a = Bukkit.getPlayer(ended.a), b = Bukkit.getPlayer(ended.b);
        if (ended.live) {
            int ra = rating(ended.a), rb = rating(ended.b);
            double expectation = 1.0 / (1.0 + Math.pow(10, (rb - ra) / 400.0));
            double score = winner == null ? .5 : winner.equals(ended.a) ? 1 : 0;
            int delta = (int) Math.round(24 * (score - expectation));
            record(ended.a, a, ra + delta, winner == null ? "draws" : score == 1 ? "wins" : "losses");
            record(ended.b, b, rb - delta, winner == null ? "draws" : score == 0 ? "wins" : "losses");
            plugin.saveConfig();
        }
        for (UUID id : List.of(ended.a, ended.b)) {
            Player p = Bukkit.getPlayer(id);
            if (p == null || !p.isOnline()) continue;
            restore(p);
            String outcome = !ended.live ? "cancelled" : winner == null ? "draw" : winner.equals(id) ? "win" : "loss";
            p.sendTitle(outcome.equals("win") ? ChatColor.GOLD + "胜利" : ChatColor.AQUA + "对局结束",
                    ChatColor.GRAY + reason, 5, 50, 10);
            p.sendMessage("MC_PVP_RESULT outcome=" + outcome + " reason=" + reason
                    + " rating=" + rating(id) + " damage=" + ended.damage.getOrDefault(id, 0.0)
                    + " durationMs=" + (System.currentTimeMillis() - ended.createdAt));
        }
        match = null;
        Bukkit.getScheduler().runTaskLater(plugin, this::pair, 20L);
    }

    private YamlConfiguration escrow() { return YamlConfiguration.loadConfiguration(escrowPath.toFile()); }
    private void writeEscrow(YamlConfiguration data) throws IOException {
        Files.createDirectories(escrowPath.getParent());
        Path temp = escrowPath.resolveSibling("pvp-escrow.yml.tmp");
        Files.writeString(temp, data.saveToString(), StandardCharsets.UTF_8);
        try { Files.move(temp, escrowPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
        catch (java.nio.file.AtomicMoveNotSupportedException unsupported) {
            Files.move(temp, escrowPath, StandardCopyOption.REPLACE_EXISTING);
        }
    }
    private void snapshot(Player p) throws IOException {
        YamlConfiguration data = escrow();
        String root = "players." + p.getUniqueId();
        if (data.contains(root)) throw new IOException("Existing inventory escrow for " + p.getUniqueId());
        Location at = queueOrigins.getOrDefault(p.getUniqueId(), p.getLocation());
        data.set(root + ".world", at.getWorld().getName());
        data.set(root + ".x", at.getX()); data.set(root + ".y", at.getY()); data.set(root + ".z", at.getZ());
        data.set(root + ".yaw", at.getYaw()); data.set(root + ".pitch", at.getPitch());
        data.set(root + ".health", p.getHealth());
        data.set(root + ".food", p.getFoodLevel());
        data.set(root + ".saturation", p.getSaturation());
        data.set(root + ".gamemode", p.getGameMode().name());
        for (int slot = 0; slot < p.getInventory().getSize(); slot++)
            data.set(root + ".slots." + slot, p.getInventory().getItem(slot));
        data.set(root + ".effects", new ArrayList<>(p.getActivePotionEffects()));
        writeEscrow(data);
    }
    private void equip(Player p) {
        p.getInventory().clear();
        p.getInventory().setItem(0, new ItemStack(Material.IRON_SWORD));
        p.getInventory().setItem(1, new ItemStack(Material.BOW));
        p.getInventory().setItem(2, new ItemStack(Material.ARROW, 32));
        p.getInventory().setItem(3, new ItemStack(Material.BAKED_POTATO, 8));
        p.getInventory().setHelmet(new ItemStack(Material.CHAINMAIL_HELMET));
        p.getInventory().setChestplate(new ItemStack(Material.CHAINMAIL_CHESTPLATE));
        p.getInventory().setLeggings(new ItemStack(Material.CHAINMAIL_LEGGINGS));
        p.getInventory().setBoots(new ItemStack(Material.CHAINMAIL_BOOTS));
        p.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD));
        for (PotionEffect effect : p.getActivePotionEffects()) p.removePotionEffect(effect.getType());
        p.setGameMode(GameMode.ADVENTURE);
        p.setHealth(Math.min(20, p.getMaxHealth()));
        p.setFoodLevel(20); p.setSaturation(20); p.setFireTicks(0);
        p.updateInventory();
    }
    private void restore(Player p) {
        YamlConfiguration data = escrow();
        String root = "players." + p.getUniqueId();
        if (!data.contains(root + ".world")) return;
        try {
            World previous = Bukkit.getWorld(data.getString(root + ".world", "world"));
            if (previous == null) throw new IllegalStateException("Origin world missing");
            Location origin = new Location(previous, data.getDouble(root + ".x"), data.getDouble(root + ".y"),
                    data.getDouble(root + ".z"), (float) data.getDouble(root + ".yaw"),
                    (float) data.getDouble(root + ".pitch"));
            p.getInventory().clear();
            for (int slot = 0; slot < p.getInventory().getSize(); slot++)
                p.getInventory().setItem(slot, data.getItemStack(root + ".slots." + slot));
            for (PotionEffect effect : p.getActivePotionEffects()) p.removePotionEffect(effect.getType());
            for (Object value : data.getList(root + ".effects", List.of()))
                if (value instanceof PotionEffect effect) p.addPotionEffect(effect);
            p.setGameMode(GameMode.valueOf(data.getString(root + ".gamemode", "SURVIVAL")));
            p.setHealth(Math.min(p.getMaxHealth(), Math.max(1, data.getDouble(root + ".health", 20))));
            p.setFoodLevel(data.getInt(root + ".food", 20));
            p.setSaturation((float) data.getDouble(root + ".saturation", 5));
            p.setFireTicks(0);
            p.teleport(origin);
            p.updateInventory();
            data.set(root, null);
            writeEscrow(data);
            recovering.remove(p.getUniqueId());
        } catch (Exception error) {
            plugin.getLogger().severe("PvP inventory restore failed for " + p.getUniqueId()
                    + "; escrow retained: " + error);
            p.sendMessage(ChatColor.RED + "PvP原物品恢复失败，快照已保留；请联系服主。");
        }
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Player p = event.getPlayer();
        if (escrow().contains("players." + p.getUniqueId())) {
            recovering.add(p.getUniqueId());
            Bukkit.getScheduler().runTaskLater(plugin, () -> restore(p), 10L);
        }
    }
    @EventHandler public void onQuit(PlayerQuitEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        queue.remove(id); queueOrigins.remove(id);
        recovering.remove(id);
        if (match != null && match.has(id)) finish(match.other(id), "disconnect");
    }
    @EventHandler public void onTeleport(PlayerTeleportEvent event) {
        if (match != null && match.live && match.has(event.getPlayer().getUniqueId())
                && event.getTo() != null && !inRing(event.getTo()))
            finish(match.other(event.getPlayer().getUniqueId()), "left_arena");
    }
    @EventHandler public void onMove(PlayerMoveEvent event) {
        if (match == null || !match.has(event.getPlayer().getUniqueId()) || event.getTo() == null) return;
        if (!match.live && !match.closing && event.getFrom().distanceSquared(event.getTo()) > 0)
            event.setTo(event.getFrom());
        else if (match.live && !inRing(event.getTo()))
            finish(match.other(event.getPlayer().getUniqueId()), "left_arena");
    }
    private Player attacker(Entity entity) {
        if (entity instanceof Player p) return p;
        if (entity instanceof Projectile projectile) {
            ProjectileSource shooter = projectile.getShooter();
            if (shooter instanceof Player p) return p;
        }
        return null;
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player victim)) return;
        Player source = event instanceof EntityDamageByEntityEvent attack ? attacker(attack.getDamager()) : null;
        if (source == null) {
            if (inMatch(victim)) event.setCancelled(true);
            return;
        }
        if (match == null || !match.live || match.closing || !match.has(source.getUniqueId())
                || !match.has(victim.getUniqueId()) || source.equals(victim)
                || !inRing(source.getLocation()) || !inRing(victim.getLocation())) {
            event.setCancelled(true); // Global PvP gate, also covers player-fired arrows.
            return;
        }
        if (event.isCancelled()) return;
        if (victim.getHealth() - event.getFinalDamage() <= 0) {
            match.damage.merge(source.getUniqueId(), Math.max(0, victim.getHealth()), Double::sum);
            event.setCancelled(true);
            finish(source.getUniqueId(), "knockout");
        }
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamageRecorded(EntityDamageByEntityEvent event) {
        if (match == null || !match.live || !(event.getEntity() instanceof Player victim)) return;
        Player source = attacker(event.getDamager());
        if (source != null && match.has(source.getUniqueId()) && match.has(victim.getUniqueId()))
            match.damage.merge(source.getUniqueId(), Math.max(0, event.getFinalDamage()), Double::sum);
    }
    @EventHandler public void onDrop(PlayerDropItemEvent event) {
        if (inMatch(event.getPlayer()) || recovering.contains(event.getPlayer().getUniqueId())) event.setCancelled(true);
    }
    @EventHandler public void onPickup(PlayerPickupItemEvent event) {
        if (inMatch(event.getPlayer()) || recovering.contains(event.getPlayer().getUniqueId())) event.setCancelled(true);
    }
    @EventHandler public void onInventory(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player p
                && (inMatch(p) || recovering.contains(p.getUniqueId()))) event.setCancelled(true);
    }
    @EventHandler public void onCommand(PlayerCommandPreprocessEvent event) {
        if (recovering.contains(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
            event.getPlayer().sendMessage(ChatColor.RED + "PvP原物品正在恢复，请稍候；持续失败请联系服主。");
            return;
        }
        if (!inMatch(event.getPlayer())) return;
        String command = event.getMessage().toLowerCase(java.util.Locale.ROOT);
        if (command.equals("/mycli pvp") || command.startsWith("/mycli pvp ")
                || command.equals("/mycli status") || command.startsWith("/msg ")
                || command.startsWith("/tell ") || command.startsWith("/r ")) return;
        event.setCancelled(true);
        event.getPlayer().sendMessage(ChatColor.RED + "同款装备竞技中只能查看状态或退出，不可使用其他指令/法术。");
    }
    @EventHandler public void onPotion(EntityPotionEffectEvent event) {
        if (event.getEntity() instanceof Player p && inMatch(p) && match.live && !match.closing)
            event.setCancelled(true);
    }
    @EventHandler public void onHeal(EntityRegainHealthEvent event) {
        if (!(event.getEntity() instanceof Player p) || !inMatch(p)) return;
        double room = 20 - p.getHealth();
        if (room <= 0) event.setCancelled(true);
        else event.setAmount(Math.min(event.getAmount(), room));
    }
    @EventHandler public void onBreak(BlockBreakEvent event) {
        if (built() && event.getBlock().getWorld() == world
                && Math.abs(event.getBlock().getX() - X) <= 15
                && Math.abs(event.getBlock().getZ() - Z) <= 15
                && event.getBlock().getY() >= Y - 2 && event.getBlock().getY() <= Y + 8)
            event.setCancelled(true);
    }
    @EventHandler public void onPlace(BlockPlaceEvent event) {
        if (built() && event.getBlock().getWorld() == world
                && Math.abs(event.getBlock().getX() - X) <= 15
                && Math.abs(event.getBlock().getZ() - Z) <= 15
                && event.getBlock().getY() >= Y - 2 && event.getBlock().getY() <= Y + 8)
            event.setCancelled(true);
    }
    void shutdown() {
        if (match != null) {
            Match old = match; old.closing = true;
            for (UUID id : List.of(old.a, old.b)) {
                Player p = Bukkit.getPlayer(id);
                if (p != null) restore(p);
            }
            match = null;
        }
        queue.clear(); queueOrigins.clear();
    }

    void survey(CommandSender sender) {
        if (world == null) { sender.sendMessage("MC_PVP_SURVEY ok=false reason=world_missing"); return; }
        int occupied = 0;
        for (int dx = -15; dx <= 15; dx++)
            for (int dz = -15; dz <= 15; dz++)
                for (int dy = 0; dy <= 5; dy++)
                    if (!world.getBlockAt(X + dx, Y + dy, Z + dz).getType().isAir()) occupied++;
        sender.sendMessage("MC_PVP_SURVEY ok=" + (occupied == 0 && !built())
                + " occupied=" + occupied + " x=" + X + " y=" + Y + " z=" + Z
                + " region=" + (X - 16) + "," + (Y - 2) + "," + (Z - 16)
                + ".." + (X + 16) + "," + (Y + 8) + "," + (Z + 16));
    }
    void build(CommandSender sender) {
        if (built() || plugin.getConfig().getBoolean("pvp-arena.building", false)) {
            sender.sendMessage("竞技场已建或施工中断；拒绝重复建造。"); return;
        }
        if (world == null) { sender.sendMessage("主世界未加载。"); return; }
        for (int dx = -15; dx <= 15; dx++)
            for (int dz = -15; dz <= 15; dz++)
                for (int dy = 0; dy <= 5; dy++)
                    if (!world.getBlockAt(X + dx, Y + dy, Z + dz).getType().isAir()) {
                        sender.sendMessage("空间非空，未施工：" + (X + dx) + "," + (Y + dy) + "," + (Z + dz));
                        return;
                    }
        plugin.getConfig().set("pvp-arena.building", true);
        plugin.saveConfig();
        try {
            for (int dx = -15; dx <= 15; dx++)
                for (int dz = -15; dz <= 15; dz++) {
                    Material floor = Math.abs(dx) == 15 || Math.abs(dz) == 15
                            ? Material.DEEPSLATE_BRICKS
                            : dx == 0 || dz == 0 ? Material.POLISHED_ANDESITE : Material.SMOOTH_STONE;
                    world.getBlockAt(X + dx, Y, Z + dz).setType(floor, false);
                }
            for (int dx = -12; dx <= 12; dx++)
                for (int dz = -12; dz <= 12; dz++)
                    if (Math.abs(dx) == 12 || Math.abs(dz) == 12)
                        for (int dy = 1; dy <= 4; dy++)
                            world.getBlockAt(X + dx, Y + dy, Z + dz).setType(Material.IRON_BARS, false);
            for (int dx = -15; dx <= 15; dx++)
                for (int dz = -15; dz <= 15; dz++)
                    if (Math.abs(dx) == 15 || Math.abs(dz) == 15)
                        for (int dy = 1; dy <= 4; dy++)
                            world.getBlockAt(X + dx, Y + dy, Z + dz).setType(Material.GLASS_PANE, false);
            for (int dx : new int[]{-5, 5}) for (int dz : new int[]{-5, 5}) {
                world.getBlockAt(X + dx, Y + 1, Z + dz).setType(Material.DEEPSLATE_BRICKS, false);
                world.getBlockAt(X + dx, Y + 2, Z + dz).setType(Material.DEEPSLATE_BRICKS, false);
            }
            for (int dx : new int[]{-15, 15}) for (int dz : new int[]{-15, 15})
                for (int dy = 1; dy <= 3; dy++)
                    world.getBlockAt(X + dx, Y + dy, Z + dz).setType(Material.GLOWSTONE, false);
            world.getBlockAt(X + 3, Y + 1, Z + 14).setType(Material.LECTERN, false);
            plugin.getConfig().set("pvp-arena.built", true);
            plugin.getConfig().set("pvp-arena.building", false);
            plugin.saveConfig();
            sender.sendMessage("MC_PVP_BUILD ok=true x=" + X + " y=" + Y + " z=" + Z);
        } catch (Exception error) {
            plugin.getLogger().severe("PvP build interrupted; leave building marker for recovery: " + error);
            sender.sendMessage("施工失败；保留标记，请从备份恢复。");
        }
    }
}
