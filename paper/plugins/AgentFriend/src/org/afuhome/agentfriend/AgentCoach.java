package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.scheduler.BukkitTask;

/** Personal, low-frequency hints. No movement, inventory or skill action is performed. */
final class AgentCoach implements Listener {
    private static final class Session {
        long lastActivity;
        long lastMycli;
        boolean idleSent;
        boolean unusedSent;
        Session(long now) { lastActivity = now; lastMycli = now; }
    }

    private final AgentFriendPlugin plugin;
    private final Map<UUID, Session> sessions = new HashMap<>();
    private final NamespacedKey enabledKey;
    private final NamespacedKey deathStartKey;
    private final NamespacedKey deathCountKey;
    private final NamespacedKey pendingDeathKey;
    private final NamespacedKey lastHintKey;
    private BukkitTask timer;

    AgentCoach(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        enabledKey = new NamespacedKey(plugin, "coach_enabled");
        deathStartKey = new NamespacedKey(plugin, "coach_death_start");
        deathCountKey = new NamespacedKey(plugin, "coach_death_count");
        pendingDeathKey = new NamespacedKey(plugin, "coach_pending_death");
        lastHintKey = new NamespacedKey(plugin, "coach_last_hint");
    }

    void start() {
        Bukkit.getPluginManager().registerEvents(this, plugin);
        long now = System.currentTimeMillis();
        for (Player player : Bukkit.getOnlinePlayers()) sessions.put(player.getUniqueId(), new Session(now));
        timer = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 20L);
    }

    void stop() {
        if (timer != null) timer.cancel();
        sessions.clear();
    }

    private long seconds(String key, long fallback) {
        return Math.max(1L, plugin.getConfig().getLong("coach." + key, fallback)) * 1000L;
    }

    private int deathThreshold() {
        return Math.max(2, plugin.getConfig().getInt("coach.death-threshold", 3));
    }

    private Session session(Player player) {
        return sessions.computeIfAbsent(player.getUniqueId(), unused -> new Session(System.currentTimeMillis()));
    }

    private boolean enabled(Player player) {
        if (player.getGameMode() == GameMode.SPECTATOR || !plugin.getConfig().getBoolean("coach.enabled", true))
            return false;
        Byte choice = player.getPersistentDataContainer().get(enabledKey, PersistentDataType.BYTE);
        if (choice != null) return choice != 0;
        boolean bedrock = Bukkit.getPluginManager().isPluginEnabled("floodgate")
                && plugin.floodgatePlayer(player.getUniqueId());
        return plugin.getConfig().getBoolean(bedrock ? "coach.default-bedrock" : "coach.default-java", !bedrock);
    }

    private void activity(Player player) {
        Session state = session(player);
        state.lastActivity = System.currentTimeMillis();
        state.idleSent = false;
    }

    void mycliUsed(Player player) {
        activity(player);
        Session state = session(player);
        state.lastMycli = System.currentTimeMillis();
        state.unusedSent = false;
    }

    void command(Player player, String[] args) {
        if (args.length > 2) { commandError(player, "INVALID_ARGUMENT"); return; }
        String action = args.length > 1 ? args[1].toLowerCase(java.util.Locale.ROOT) : "status";
        switch (action) {
            case "status" -> status(player);
            case "on", "off" -> {
                boolean on = action.equals("on");
                if (on && player.getGameMode() == GameMode.SPECTATOR) {
                    commandError(player, "SPECTATOR"); return;
                }
                player.getPersistentDataContainer().set(enabledKey, PersistentDataType.BYTE, (byte) (on ? 1 : 0));
                player.getPersistentDataContainer().remove(pendingDeathKey);
                player.getPersistentDataContainer().remove(deathCountKey);
                player.getPersistentDataContainer().remove(deathStartKey);
                Session state = session(player);
                state.lastActivity = System.currentTimeMillis();
                state.lastMycli = state.lastActivity;
                state.idleSent = false;
                state.unusedSent = false;
                status(player);
            }
            default -> commandError(player, "UNKNOWN_ACTION");
        }
    }

    private void commandError(Player player, String code) {
        JsonObject error = new JsonObject();
        error.addProperty("schemaVersion", 1);
        error.addProperty("code", code);
        error.addProperty("usage", "/mycli coach status|on|off");
        player.sendMessage("MC_COACH_ERROR " + error);
    }

    private void status(Player player) {
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("type", "status");
        result.addProperty("enabled", enabled(player));
        result.addProperty("deathThreshold", deathThreshold());
        result.addProperty("deathWindowSeconds", seconds("death-window-seconds", 1800) / 1000);
        result.addProperty("idleSeconds", seconds("idle-seconds", 900) / 1000);
        result.addProperty("unusedSeconds", seconds("unused-seconds", 2700) / 1000);
        result.addProperty("cooldownSeconds", seconds("cooldown-seconds", 1800) / 1000);
        player.sendMessage("MC_COACH " + result);
    }

    private int deaths(Player player, long now) {
        Long start = player.getPersistentDataContainer().get(deathStartKey, PersistentDataType.LONG);
        if (start == null || now - start > seconds("death-window-seconds", 1800)) return 0;
        return player.getPersistentDataContainer().getOrDefault(deathCountKey, PersistentDataType.INTEGER, 0);
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        sessions.put(event.getPlayer().getUniqueId(), new Session(System.currentTimeMillis()));
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        sessions.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.MONITOR) public void onDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        if (!enabled(player)) return;
        long now = System.currentTimeMillis();
        int count = deaths(player, now);
        if (count == 0) player.getPersistentDataContainer().set(deathStartKey, PersistentDataType.LONG, now);
        count++;
        player.getPersistentDataContainer().set(deathCountKey, PersistentDataType.INTEGER, count);
        if (count >= deathThreshold())
            player.getPersistentDataContainer().set(pendingDeathKey, PersistentDataType.BYTE, (byte) 1);
    }

    @EventHandler public void onRespawn(PlayerRespawnEvent event) {
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (player.isOnline()) activity(player);
        }, 20L);
    }

    @EventHandler(ignoreCancelled = true) public void onMove(PlayerMoveEvent event) {
        if (event.getTo() == null || event.getFrom().getBlockX() == event.getTo().getBlockX()
                && event.getFrom().getBlockY() == event.getTo().getBlockY()
                && event.getFrom().getBlockZ() == event.getTo().getBlockZ()
                && event.getFrom().getWorld() == event.getTo().getWorld()) return;
        activity(event.getPlayer());
    }

    @EventHandler(ignoreCancelled = true) public void onInteract(PlayerInteractEvent event) {
        activity(event.getPlayer());
    }

    @EventHandler(ignoreCancelled = true) public void onInventory(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player player) activity(player);
    }

    @EventHandler(ignoreCancelled = true) public void onOtherCommand(PlayerCommandPreprocessEvent event) {
        activity(event.getPlayer());
    }

    private void tick() {
        long now = System.currentTimeMillis();
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (!player.isOnline() || player.isDead() || !enabled(player)) continue;
            Session state = session(player);
            if (player.getPersistentDataContainer().has(pendingDeathKey, PersistentDataType.BYTE)) {
                if (deaths(player, now) == 0) player.getPersistentDataContainer().remove(pendingDeathKey);
                else if (send(player, now, "deaths", deaths(player, now),
                        "连续死亡后先检查状态和可用技能；必要时回出生村整理装备。",
                        "/mycli status", "/mycli spells explain selfheal", "/mycli goto village")) {
                    player.getPersistentDataContainer().remove(pendingDeathKey);
                    state.idleSent = true;
                    state.unusedSent = true;
                }
                continue;
            }
            if (!state.idleSent && now - state.lastActivity >= seconds("idle-seconds", 900)) {
                if (send(player, now, "idle", 0,
                        "停留较久，可以查看世界能力和下一步路线。",
                        "/mycli list", "/mycli guide start", "/mycli waypoint"))
                    state.idleSent = true;
                continue;
            }
            if (!state.idleSent && !state.unusedSent
                    && now - state.lastMycli >= seconds("unused-seconds", 2700)
                    && now - state.lastActivity < Math.min(seconds("idle-seconds", 900), 120_000L)) {
                if (send(player, now, "mycli_unused", 0,
                        "已游玩一段时间；可先列出命令和法术，再查看单项用法。",
                        "/mycli list", "/mycli spells list", "/mycli spells explain <ID>"))
                    state.unusedSent = true;
            }
        }
    }

    private boolean send(Player player, long now, String reason, int count, String message, String... commands) {
        long last = player.getPersistentDataContainer().getOrDefault(lastHintKey, PersistentDataType.LONG, 0L);
        if (now - last < seconds("cooldown-seconds", 1800)) return false;
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("type", "reminder");
        result.addProperty("reason", reason);
        if (count > 0) result.addProperty("deaths", count);
        result.addProperty("message", message);
        JsonArray options = new JsonArray();
        for (String command : commands) options.add(command);
        result.add("commands", options);
        player.sendMessage("MC_COACH " + result);
        player.getPersistentDataContainer().set(lastHintKey, PersistentDataType.LONG, now);
        return true;
    }
}
