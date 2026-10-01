package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.IronGolem;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.Vector;

/** Bounded vanilla-protocol movement, guardian, and hostile-sensing spells. */
final class UtilitySpells implements Listener {
    private static final String GOLEM_TAG = "afu_spell_guardian";
    private static final int SENSE_BASE_RANGE = 24;
    private final AgentFriendPlugin plugin;
    private final Map<String, Long> cooldowns = new HashMap<>();
    private final Map<UUID, Flight> flights = new HashMap<>();
    private final Map<UUID, Guardian> guardians = new HashMap<>();
    private final Map<UUID, Sense> senses = new HashMap<>();
    private BukkitTask task;

    private record Flight(boolean allowed, boolean flying, float speed, long expiresAt) { }
    private record Guardian(UUID entityId, long expiresAt) { }
    private record Sense(BossBar bar, long expiresAt) { }

    UtilitySpells(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 10L, 10L);
    }

    long remainingCooldownMs(Player player, String spell) {
        return Math.max(0L, cooldowns.getOrDefault(player.getUniqueId() + ":" + spell, 0L)
                - System.currentTimeMillis());
    }

    void cast(Player player, String spell) {
        if (player.getGameMode() == GameMode.SPECTATOR) {
            player.sendMessage(ChatColor.RED + "旁观者不能施法。");
            return;
        }
        switch (spell) {
            case "leap" -> leap(player);
            case "flight" -> flight(player);
            case "golem" -> golem(player);
            case "sense" -> sense(player);
            default -> throw new IllegalArgumentException("Unknown utility spell " + spell);
        }
    }

    private boolean ready(Player player, String spell) {
        long wait = remainingCooldownMs(player, spell);
        if (wait <= 0) return true;
        player.sendMessage(ChatColor.YELLOW + "这项法术还需 " + ((wait + 999) / 1000) + " 秒。");
        return false;
    }

    private boolean begin(Player player, String spell, int mana, int cooldownSeconds) {
        if (!plugin.spendMana(player, mana)) return false;
        cooldowns.put(player.getUniqueId() + ":" + spell,
                System.currentTimeMillis() + cooldownSeconds * 1000L);
        plugin.presentSpell(player, spell);
        return true;
    }

    private void leap(Player player) {
        if (!ready(player, "leap")) return;
        if (!player.isOnGround() || player.isInsideVehicle() || player.isFlying()) {
            player.sendMessage(ChatColor.YELLOW + "请站稳在地上，再使用跃空术。");
            return;
        }
        if (!begin(player, "leap", 4, 8)) return;
        int rank = plugin.mastery().rank(player, "leap");
        Vector velocity = player.getVelocity();
        velocity.setY(1.12 + (rank - 1) * 0.04);
        player.setVelocity(velocity);
        player.setFallDistance(0);
        player.addPotionEffect(new PotionEffect(PotionEffectType.SLOW_FALLING,
                180 + (rank - 1) * 40, 0, false, true));
        player.getWorld().spawnParticle(Particle.CLOUD, player.getLocation(), 22, 0.4, 0.2, 0.4, 0.05);
        player.getWorld().playSound(player.getLocation(), Sound.ENTITY_BREEZE_JUMP, 0.8f, 1.25f);
        plugin.mastery().successfulCast(player, "leap");
        plugin.publishSkill(player, "leap", "高高跃起", player.getLocation());
        player.sendMessage(ChatColor.AQUA + "✦ 跃空术：高高跳起，缓缓落地（4 魔力；8 秒冷却）。");
    }

    private void flight(Player player) {
        if (!ready(player, "flight")) return;
        if (player.getGameMode() == GameMode.CREATIVE) {
            player.sendMessage(ChatColor.YELLOW + "创造模式本来就能飞行。");
            return;
        }
        if (flights.containsKey(player.getUniqueId())) {
            player.sendMessage(ChatColor.YELLOW + "飞行术仍在生效。");
            return;
        }
        if (!begin(player, "flight", 10, 90)) return;
        int seconds = 15 + (plugin.mastery().rank(player, "flight") - 1) * 3;
        flights.put(player.getUniqueId(), new Flight(player.getAllowFlight(), player.isFlying(),
                player.getFlySpeed(), System.currentTimeMillis() + seconds * 1000L));
        player.setAllowFlight(true);
        player.setFlySpeed(0.07f);
        player.setFlying(true);
        player.setFallDistance(0);
        player.getWorld().spawnParticle(Particle.END_ROD, player.getLocation().add(0, 1, 0),
                24, 0.4, 0.7, 0.4, 0.03);
        plugin.mastery().successfulCast(player, "flight");
        plugin.publishSkill(player, "flight", "飞行 " + seconds + " 秒", player.getLocation());
        player.sendMessage(ChatColor.LIGHT_PURPLE + "✦ 飞行术持续 " + seconds + " 秒；若未立即起飞，可双按跳跃键。结束后会缓降（10 魔力；90 秒冷却）。");
    }

    private Location safeGolemSpot(Player player) {
        Location at = player.getLocation();
        int[][] offsets = {{2,0},{-2,0},{0,2},{0,-2},{2,2},{-2,-2},{2,-2},{-2,2}};
        for (int[] offset : offsets) {
            Location spot = at.clone().add(offset[0], 0, offset[1]).getBlock().getLocation();
            if (spot.getBlock().isPassable() && spot.clone().add(0,1,0).getBlock().isPassable()
                    && spot.clone().add(0,2,0).getBlock().isPassable()
                    && spot.clone().add(0,-1,0).getBlock().getType().isSolid())
                return spot.add(0.5, 0, 0.5);
        }
        return null;
    }

    private void golem(Player player) {
        if (!ready(player, "golem")) return;
        Guardian old = guardians.get(player.getUniqueId());
        if (old != null && Bukkit.getEntity(old.entityId()) != null) {
            player.sendMessage(ChatColor.YELLOW + "你的守护傀儡已经在身边了。");
            return;
        }
        Location spot = safeGolemSpot(player);
        if (spot == null) {
            player.sendMessage(ChatColor.YELLOW + "附近没有足够宽敞的落脚处召唤铁傀儡；未消耗魔力。");
            return;
        }
        if (!begin(player, "golem", 12, 75)) return;
        int seconds = 45 + (plugin.mastery().rank(player, "golem") - 1) * 5;
        IronGolem guardian = player.getWorld().spawn(spot, IronGolem.class, entity -> {
            entity.setPlayerCreated(true);
            entity.setPersistent(false);
            entity.setRemoveWhenFarAway(false);
            entity.addScoreboardTag(GOLEM_TAG);
            entity.setCustomName(ChatColor.GOLD + player.getName() + "的守护傀儡");
            entity.setCustomNameVisible(true);
        });
        guardians.put(player.getUniqueId(), new Guardian(guardian.getUniqueId(), System.currentTimeMillis() + seconds * 1000L));
        player.getWorld().spawnParticle(Particle.END_ROD, spot.clone().add(0, 1, 0),
                35, 0.7, 1, 0.7, 0.05);
        plugin.mastery().successfulCast(player, "golem");
        plugin.publishSkill(player, "golem", "守护傀儡已召唤", spot);
        player.sendMessage(ChatColor.GOLD + "✦ 守护傀儡会帮你攻击附近的怪物，" + seconds + " 秒后离开（12 魔力；75 秒冷却）。");
    }

    private List<Enemy> nearbyHostiles(Player player) {
        List<Enemy> found = new ArrayList<>();
        Location at = player.getLocation();
        int range = SENSE_BASE_RANGE + (plugin.mastery().rank(player, "sense") - 1) * 4;
        for (Entity entity : player.getNearbyEntities(range, range, range)) {
            if (entity instanceof Enemy enemy && entity.isValid() && !entity.isDead()
                    && entity.getLocation().distanceSquared(at) <= range * range)
                found.add(enemy);
        }
        found.sort(Comparator.comparingDouble(enemy -> enemy.getLocation().distanceSquared(at)));
        return found;
    }

    private void sense(Player player) {
        if (!ready(player, "sense")) return;
        List<Enemy> hostiles = nearbyHostiles(player);
        if (hostiles.isEmpty()) {
            player.sendMessage(ChatColor.GREEN + "" + (SENSE_BASE_RANGE + (plugin.mastery().rank(player, "sense") - 1) * 4)
                    + " 格内没有发现怪物；未消耗魔力，也未进入冷却。");
            return;
        }
        if (!begin(player, "sense", 3, 15)) return;
        removeSense(player.getUniqueId());
        BossBar bar = Bukkit.createBossBar("探敌术", BarColor.BLUE, BarStyle.SOLID);
        bar.addPlayer(player);
        senses.put(player.getUniqueId(), new Sense(bar, System.currentTimeMillis() + 8_000L));
        plugin.mastery().successfulCast(player, "sense");
        plugin.publishSkill(player, "sense", "发现 " + hostiles.size() + " 只怪物",
                ((Entity) hostiles.get(0)).getLocation());
        player.sendMessage(ChatColor.AQUA + "✦ 探敌术发现附近 " + hostiles.size()
                + " 只怪物；顶部方向提示持续 8 秒（3 魔力；15 秒冷却）。");
        for (int i = 0; i < Math.min(5, hostiles.size()); i++) {
            Enemy enemy = hostiles.get(i);
            player.sendMessage("MC_HOSTILE type=" + ((Entity) enemy).getType().name().toLowerCase(java.util.Locale.ROOT)
                    + " " + LocationOutput.fields(((Entity) enemy).getLocation()));
        }
        updateSense(player, senses.get(player.getUniqueId()), hostiles);
    }

    private String enemyName(Enemy enemy) {
        return switch (((Entity) enemy).getType()) {
            case ZOMBIE -> "僵尸"; case SKELETON -> "骷髅"; case CREEPER -> "苦力怕";
            case SPIDER -> "蜘蛛"; case DROWNED -> "溺尸"; case HUSK -> "尸壳";
            case WITCH -> "女巫"; case ENDERMAN -> "末影人"; case SLIME -> "史莱姆";
            default -> ((Entity) enemy).getType().name().toLowerCase();
        };
    }

    private void updateSense(Player player, Sense sense, List<Enemy> hostiles) {
        if (hostiles.isEmpty()) {
            sense.bar().setTitle("§b✦ 探敌：周围暂时没有怪物");
            return;
        }
        Enemy nearest = hostiles.get(0);
        Location at = player.getLocation(), target = ((Entity) nearest).getLocation();
        double dx = target.getX() - at.getX(), dz = target.getZ() - at.getZ();
        double yaw = Math.toDegrees(Math.atan2(-dx, dz));
        double delta = ((yaw - at.getYaw() + 540) % 360) - 180;
        String[] sectors = {"前 ↑", "右前 ↗", "右 →", "右后 ↘", "后 ↓", "左后 ↙", "左 ←", "左前 ↖"};
        String direction = sectors[Math.floorMod((int) Math.round(delta / 45), 8)];
        int dy = target.getBlockY() - at.getBlockY();
        String height = Math.abs(dy) <= 1 ? "同层" : (dy > 0 ? "上" : "下") + Math.abs(dy) + "格";
        sense.bar().setTitle("§b✦ 探敌 " + hostiles.size() + "只 · 最近" + enemyName(nearest)
                + " §f" + direction + " · " + Math.round(at.distance(target)) + "格 · " + height
                + " · " + LocationOutput.shortForm(target));
        sense.bar().setProgress(Math.max(0, Math.min(1,
                (sense.expiresAt() - System.currentTimeMillis()) / 8000.0)));
        Vector toward = target.toVector().subtract(player.getEyeLocation().toVector());
        if (toward.lengthSquared() > 0.01) {
            Location hint = player.getEyeLocation().add(toward.normalize().multiply(1.5));
            player.spawnParticle(Particle.END_ROD, hint, 4, 0.12, 0.12, 0.12, 0.01);
        }
    }

    private void tick() {
        long now = System.currentTimeMillis();
        for (UUID id : new ArrayList<>(flights.keySet())) {
            Player player = Bukkit.getPlayer(id);
            Flight flight = flights.get(id);
            if (player == null || !player.isOnline() || player.isDead() || now >= flight.expiresAt())
                endFlight(id, true);
        }
        for (UUID id : new ArrayList<>(guardians.keySet())) {
            Guardian guard = guardians.get(id);
            Player owner = Bukkit.getPlayer(id);
            Entity entity = Bukkit.getEntity(guard.entityId());
            if (!(entity instanceof IronGolem golem) || !golem.isValid() || owner == null
                    || !owner.isOnline() || owner.isDead() || owner.getWorld() != golem.getWorld()
                    || now >= guard.expiresAt()) {
                removeGuardian(id);
                continue;
            }
            Enemy target = nearbyHostiles(owner).stream().filter(enemy ->
                    ((Entity) enemy).getLocation().distanceSquared(golem.getLocation()) <= 18 * 18)
                    .findFirst().orElse(null);
            if (target instanceof LivingEntity living) golem.setTarget(living);
            else {
                golem.setTarget(null);
                if (golem.getLocation().distanceSquared(owner.getLocation()) > 12 * 12) {
                    Location spot = safeGolemSpot(owner);
                    if (spot != null) golem.teleport(spot);
                }
            }
        }
        for (UUID id : new ArrayList<>(senses.keySet())) {
            Player player = Bukkit.getPlayer(id);
            Sense sense = senses.get(id);
            if (player == null || !player.isOnline() || player.isDead() || now >= sense.expiresAt()) {
                removeSense(id);
                continue;
            }
            updateSense(player, sense, nearbyHostiles(player));
        }
    }

    private void endFlight(UUID id, boolean slowFall) {
        endFlight(id, Bukkit.getPlayer(id), slowFall);
    }

    private void endFlight(UUID id, Player player, boolean slowFall) {
        Flight saved = flights.remove(id);
        if (saved == null) return;
        if (player == null) return;
        player.setFlySpeed(saved.speed());
        if (player.getGameMode() != GameMode.CREATIVE && player.getGameMode() != GameMode.SPECTATOR) {
            player.setFlying(saved.flying() && saved.allowed());
            player.setAllowFlight(saved.allowed());
            player.setFallDistance(0);
            if (slowFall && !player.isDead())
                player.addPotionEffect(new PotionEffect(PotionEffectType.SLOW_FALLING, 160, 0, false, true));
        }
    }

    private void removeGuardian(UUID id) {
        Guardian guard = guardians.remove(id);
        if (guard == null) return;
        Entity entity = Bukkit.getEntity(guard.entityId());
        if (entity != null) entity.remove();
    }

    private void removeSense(UUID id) {
        Sense sense = senses.remove(id);
        if (sense != null) sense.bar().removeAll();
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        endFlight(id, event.getPlayer(), false);
        removeGuardian(id);
        removeSense(id);
    }

    @EventHandler public void onDeath(PlayerDeathEvent event) {
        UUID id = event.getEntity().getUniqueId();
        endFlight(id, event.getEntity(), false);
        removeGuardian(id);
        removeSense(id);
    }

    @EventHandler public void onGameModeChange(PlayerGameModeChangeEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        if (flights.containsKey(id)) Bukkit.getScheduler().runTask(plugin, () -> endFlight(id, true));
    }

    @EventHandler public void onGuardianDamage(EntityDamageByEntityEvent event) {
        if (event.getDamager().getScoreboardTags().contains(GOLEM_TAG)
                && !(event.getEntity() instanceof Enemy)) event.setCancelled(true);
        if (event.getEntity().getScoreboardTags().contains(GOLEM_TAG)
                && event.getDamager() instanceof Player) event.setCancelled(true);
    }

    void clear() {
        if (task != null) task.cancel();
        for (UUID id : new ArrayList<>(flights.keySet())) endFlight(id, true);
        for (UUID id : new ArrayList<>(guardians.keySet())) removeGuardian(id);
        for (UUID id : new ArrayList<>(senses.keySet())) removeSense(id);
        cooldowns.clear();
    }
}
