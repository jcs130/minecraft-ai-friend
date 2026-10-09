package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffectType;

/** Optional real native traversal evidence, with no movement/interaction/teleport on the player's behalf. */
final class NativeTraversalPractice implements Listener {
    private record Opened(Location door, BlockFace normal, double side, long at) { }
    private static final class Session {
        Opened opened;
        Location ladder;
        double minY;
        long began;
        int samples;
        void clear() { opened = null; ladder = null; samples = 0; }
    }
    private final AgentFriendPlugin plugin;
    private final NamespacedKey active, doorProof, ladderProof;
    private final Map<UUID, Session> sessions = new HashMap<>();
    NativeTraversalPractice(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        active = new NamespacedKey(plugin, "traversal_practice_active");
        doorProof = new NamespacedKey(plugin, "traversal_door_proof");
        ladderProof = new NamespacedKey(plugin, "traversal_ladder_proof");
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    private boolean eligible(Player p) {
        return (p.getGameMode() == GameMode.SURVIVAL || p.getGameMode() == GameMode.ADVENTURE)
                && !p.isDead() && !p.isFlying() && !p.isGliding() && !p.isInsideVehicle()
                && !p.hasPotionEffect(PotionEffectType.LEVITATION);
    }
    private boolean running(Player p) { return p.getPersistentDataContainer().getOrDefault(active, PersistentDataType.BYTE, (byte) 0) == 1; }
    private Session session(Player p) { return running(p) ? sessions.computeIfAbsent(p.getUniqueId(), ignored -> new Session()) : null; }
    private JsonObject proof(Player p, NamespacedKey key) {
        String value = p.getPersistentDataContainer().get(key, PersistentDataType.STRING);
        if (value == null) return null;
        try { return JsonParser.parseString(value).getAsJsonObject(); } catch (RuntimeException bad) { return null; }
    }
    void command(Player p, String action) {
        if (!List.of("start", "status", "stop").contains(action)) {
            p.sendMessage("§e用法：/mycli world practice start|status|stop；练习不代替你操作。"); return;
        }
        if (action.equals("start")) {
            if (!eligible(p)) { p.sendMessage("§e请在生存或冒险模式、落地且未飞行时开始通行实练；观战和魔法位移不算。"); return; }
            p.getPersistentDataContainer().set(active, PersistentDataType.BYTE, (byte) 1);
            sessions.computeIfAbsent(p.getUniqueId(), ignored -> new Session());
        } else if (action.equals("stop")) {
            p.getPersistentDataContainer().remove(active); sessions.remove(p.getUniqueId());
        }
        status(p);
    }
    void status(Player p) {
        JsonObject out = new JsonObject(); out.addProperty("type", "practice"); out.addProperty("schemaVersion", 1);
        out.addProperty("active", running(p));
        JsonArray steps = new JsonArray();
        NamespacedKey[] keys = {doorProof, ladderProof};
        String[] ids = {"door_passage", "ladder_ascent"};
        String[] hints = {"走近合法木门，使用键/原有方块交互打开，再实际走到门另一侧；铁门应使用原有按钮/拉杆，不拆门。",
                "贴住现有梯子朝梯面向前移动，可按跳跃上爬；沿同一梯井连续爬升至少3格。不拆梯、不挖墙、不垫块、不飞行或传送。"};
        int done = 0;
        for (int i = 0; i < keys.length; i++) {
            JsonObject step = new JsonObject(), evidence = proof(p, keys[i]);
            step.addProperty("id", ids[i]); step.addProperty("done", evidence != null); step.addProperty("instruction", hints[i]);
            if (evidence != null) { done++; step.add("evidence", evidence); }
            steps.add(step);
        }
        out.add("steps", steps); out.addProperty("verifiedSteps", done); out.addProperty("completed", done == 2);
        out.addProperty("active", running(p) && done != 2);
        out.addProperty("nextAction", "用本人原有交互/移动能力实做；卡住先观察门、楼梯或梯井。保护拒绝则停止拆建，用 /mycli protect use <x> <y> <z> 查询门/机关权限。");
        out.addProperty("statusCommand", "/mycli world practice status");
        out.addProperty("source", "server_observed_native_action");
        out.addProperty("scope", "一次实际操作证明，不代表长期掌握；没有额外奖励、技能资格或自动操作。");
        p.sendMessage("MC_WORLD " + out);
        p.sendMessage("§b通行实练 " + done + "/2：打开木门并穿过；沿现有梯子连续爬升3格。/mycli world practice status 查进度，stop 暂停。");
        if (done == 2) { p.getPersistentDataContainer().remove(active); sessions.remove(p.getUniqueId()); }
    }
    private void record(Player p, NamespacedKey key, String id, Location start, Location end, double height) {
        if (proof(p, key) != null) return;
        JsonObject evidence = new JsonObject(); evidence.addProperty("world", start.getWorld().getKey().toString());
        evidence.addProperty("at", System.currentTimeMillis()); evidence.addProperty("source", "server_observed_native_action");
        JsonArray from = new JsonArray(), to = new JsonArray();
        from.add(start.getX()); from.add(start.getY()); from.add(start.getZ());
        to.add(end.getX()); to.add(end.getY()); to.add(end.getZ());
        evidence.add("from", from); evidence.add("to", to);
        if (height > 0) evidence.addProperty("ascent", height);
        p.getPersistentDataContainer().set(key, PersistentDataType.STRING, evidence.toString());
        JsonObject out = new JsonObject(); out.addProperty("type", "practice_progress"); out.addProperty("lesson", id);
        out.addProperty("status", "verified"); out.add("evidence", evidence);
        p.sendMessage("MC_WORLD " + out); status(p);
    }
    private static double side(Location p, Location door, BlockFace normal) {
        return (p.getX() - door.getX() - .5) * normal.getModX() + (p.getZ() - door.getZ() - .5) * normal.getModZ();
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void opened(PlayerInteractEvent e) {
        Player p = e.getPlayer(); Session s = session(p); Block clicked = e.getClickedBlock();
        if (s == null || !eligible(p) || proof(p, doorProof) != null || clicked == null || e.getHand() != EquipmentSlot.HAND
                || e.getAction() != Action.RIGHT_CLICK_BLOCK || e.useInteractedBlock() == org.bukkit.event.Event.Result.DENY
                || !(clicked.getBlockData() instanceof Door d) || d.isOpen() || clicked.getType() == Material.IRON_DOOR) return;
        Block lower = d.getHalf() == Bisected.Half.TOP ? clicked.getRelative(BlockFace.DOWN) : clicked;
        Location at = lower.getLocation(); double before = side(p.getLocation(), at, d.getFacing());
        if (Math.abs(before) < .25 || p.getLocation().distanceSquared(at.clone().add(.5, 1, .5)) > 36) return;
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!p.isOnline() || !eligible(p) || !running(p) || sessions.get(p.getUniqueId()) != s || p.getWorld() != at.getWorld()
                    || !at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4)) return;
            if (at.getBlock().getBlockData() instanceof Door after && after.isOpen()) s.opened = new Opened(at, after.getFacing(), before, System.currentTimeMillis());
        });
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void moved(PlayerMoveEvent e) {
        Player p = e.getPlayer(); Session s = session(p); Location to = e.getTo();
        if (s == null || to == null) return;
        if (e instanceof PlayerTeleportEvent || !eligible(p) || e.getFrom().getWorld() != to.getWorld()
                || e.getFrom().distanceSquared(to) > 2.56) { s.clear(); return; }
        if (s.opened != null) {
            Opened opened = s.opened;
            if (System.currentTimeMillis() - opened.at > 20000 || opened.door.getWorld() != to.getWorld()) s.opened = null;
            else {
                double before = side(e.getFrom(), opened.door, opened.normal), after = side(to, opened.door, opened.normal);
                if (before * opened.side >= 0 && after * opened.side < -.002 && Math.abs(before - after) > .01) {
                    double t = before / (before - after);
                    Location cross = e.getFrom().clone().add(to.toVector().subtract(e.getFrom().toVector()).multiply(t));
                    double lateral = -(cross.getX() - opened.door.getX() - .5) * opened.normal.getModZ()
                            + (cross.getZ() - opened.door.getZ() - .5) * opened.normal.getModX();
                    if (Math.abs(lateral) <= .45 && Math.abs(cross.getY() - opened.door.getY()) < 1.2
                            && opened.door.getBlock().getBlockData() instanceof Door d && d.isOpen()) {
                        record(p, doorProof, "door_passage", opened.door, to, 0); s.opened = null;
                    }
                }
            }
        }
        if (!running(p) || proof(p, ladderProof) != null) return;
        Block foot = to.getBlock();
        Block ladder = foot.getType() == Material.LADDER ? foot : foot.getRelative(BlockFace.UP).getType() == Material.LADDER ? foot.getRelative(BlockFace.UP) : null;
        if (ladder == null || !p.isClimbing()) { s.ladder = null; s.samples = 0; return; }
        if (s.ladder == null || s.ladder.getWorld() != to.getWorld() || s.ladder.getBlockX() != ladder.getX() || s.ladder.getBlockZ() != ladder.getZ()) {
            s.ladder = ladder.getLocation(); s.minY = Math.min(e.getFrom().getY(), to.getY()); s.began = System.currentTimeMillis(); s.samples = 0;
        }
        s.minY = Math.min(s.minY, to.getY());
        if (to.getY() > e.getFrom().getY() + .01) s.samples++;
        if (to.getY() - s.minY >= 3 && s.samples >= 12 && System.currentTimeMillis() - s.began >= 600) {
            record(p, ladderProof, "ladder_ascent", new Location(to.getWorld(), s.ladder.getX(), s.minY, s.ladder.getZ()), to, to.getY() - s.minY); s.ladder = null;
        }
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void teleported(PlayerTeleportEvent e) { Session s = sessions.get(e.getPlayer().getUniqueId()); if (s != null) s.clear(); }
    @EventHandler public void quit(PlayerQuitEvent e) { sessions.remove(e.getPlayer().getUniqueId()); }
}
