package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import dev.aurelium.auraskills.api.skill.Skills;
import org.bukkit.ChatColor;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

/** Bounded, server-side combat spells using only vanilla packets and hostile targets. */
final class CombatSpells {
    private final AgentFriendPlugin plugin;
    private final Map<String, Long> cooldowns = new HashMap<>();

    CombatSpells(AgentFriendPlugin plugin) { this.plugin = plugin; }

    void clear() { cooldowns.clear(); }

    long remainingCooldownMs(Player caster, String spell) {
        return Math.max(0L, cooldowns.getOrDefault(key(caster, spell), 0L) - System.currentTimeMillis());
    }

    void cast(Player caster, String spell) {
        if (caster.getGameMode() == org.bukkit.GameMode.SPECTATOR) {
            caster.sendMessage(ChatColor.RED + "旁观者不能施法。");
            return;
        }
        switch (spell) {
            case "starbolt" -> starbolt(caster);
            case "frostnova" -> frostnova(caster);
            case "flamewave" -> flamewave(caster);
            default -> throw new IllegalArgumentException("Unknown combat spell " + spell);
        }
    }

    private boolean ready(Player caster, String spell) {
        long remaining = remainingCooldownMs(caster, spell);
        if (remaining <= 0) return true;
        caster.sendMessage(ChatColor.RED + "此法术还需 " + ((remaining + 999) / 1000) + " 秒。");
        return false;
    }

    private boolean begin(Player caster, String spell, int mana, int cooldownSeconds) {
        if (!plugin.spendMana(caster, mana)) return false;
        cooldowns.put(key(caster, spell), System.currentTimeMillis() + cooldownSeconds * 1000L);
        plugin.presentSpell(caster, spell);
        return true;
    }

    private String key(Player caster, String spell) { return caster.getUniqueId() + ":" + spell; }

    private int damage(Player caster, String spell, int base) {
        int mastery = plugin.mastery().rank(caster, spell) - 1;
        int fighting = Math.min(2, plugin.auraLevel(caster, Skills.FIGHTING) / 20);
        return base + mastery + fighting;
    }

    private boolean hostile(Entity entity) {
        return entity instanceof Enemy && entity.isValid() && !entity.isDead();
    }

    private double clearDistance(Location start, Vector direction, double range) {
        RayTraceResult block = start.getWorld().rayTraceBlocks(start, direction, range,
                FluidCollisionMode.NEVER, true);
        return block == null ? range : Math.max(0, block.getHitPosition().distance(start.toVector()) - 0.05);
    }

    private void starbolt(Player caster) {
        if (!ready(caster, "starbolt")) return;
        Location eye = caster.getEyeLocation();
        World world = caster.getWorld();
        Vector direction = eye.getDirection().normalize();
        double range = clearDistance(eye, direction, 18);
        RayTraceResult hit = range <= 0 ? null : world.rayTraceEntities(eye, direction,
                range, 0.35, this::hostile);
        Enemy enemy = hit != null && hit.getHitEntity() instanceof Enemy aimed
                ? aimed : nearestVisibleHostile(caster, 12);
        if (enemy == null) {
            caster.sendMessage(ChatColor.YELLOW + "18 格准星和 12 格自动锁定都没找到怪物；未消耗魔力。");
            return;
        }
        if (!begin(caster, "starbolt", 4, 3)) return;
        Vector start = eye.toVector();
        Vector end = hit != null && hit.getHitEntity() == enemy
                ? hit.getHitPosition() : enemy.getEyeLocation().toVector();
        Vector line = end.clone().subtract(start);
        int steps = Math.min(16, Math.max(1, (int) Math.ceil(line.length() / 1.2)));
        for (int i = 0; i <= steps; i++) {
            Location point = start.clone().add(line.clone().multiply(i / (double) steps)).toLocation(world);
            world.spawnParticle(i % 2 == 0 ? Particle.END_ROD : Particle.ELECTRIC_SPARK,
                    point, 2, 0.08, 0.08, 0.08, 0.01);
        }
        world.spawnParticle(Particle.CRIT, enemy.getLocation().add(0, 1, 0),
                24, 0.35, 0.45, 0.35, 0.1);
        world.playSound(eye, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 1.0f, 1.3f);
        int damage = damage(caster, "starbolt", 5);
        enemy.damage(damage, caster);
        plugin.mastery().successfulCast(caster, "starbolt");
        caster.sendMessage(ChatColor.LIGHT_PURPLE + "星芒箭命中 " + enemy.getName()
                + "〔" + hostileTypeLabel(enemy.getType()) + "〕（4 魔力）。");
    }

    private String hostileTypeLabel(EntityType type) {
        String id = type.getKey().toString();
        String chinese = switch (type) {
            case PILLAGER -> "掠夺者";
            case VINDICATOR -> "卫道士";
            case EVOKER -> "唤魔者";
            case RAVAGER -> "劫掠兽";
            case ZOMBIE -> "僵尸";
            case ZOMBIE_VILLAGER -> "僵尸村民";
            case HUSK -> "尸壳";
            case DROWNED -> "溺尸";
            case SKELETON -> "骷髅";
            case STRAY -> "流浪者";
            case SPIDER -> "蜘蛛";
            case CAVE_SPIDER -> "洞穴蜘蛛";
            case CREEPER -> "苦力怕";
            case WITCH -> "女巫";
            case BLAZE -> "烈焰人";
            case MAGMA_CUBE -> "岩浆怪";
            case ENDERMAN -> "末影人";
            default -> null;
        };
        return chinese == null ? id : chinese + " / " + id;
    }

    private Enemy nearestVisibleHostile(Player caster, double radius) {
        Location eye = caster.getEyeLocation();
        Enemy nearest = null;
        double nearestDistanceSquared = radius * radius;
        for (Entity entity : caster.getNearbyEntities(radius, radius, radius)) {
            if (!hostile(entity) || !(entity instanceof Enemy enemy)
                    || !caster.hasLineOfSight(enemy)) continue;
            Vector to = enemy.getEyeLocation().toVector().subtract(eye.toVector());
            double distanceSquared = to.lengthSquared();
            if (distanceSquared >= nearestDistanceSquared || distanceSquared < 0.01) continue;
            double distance = Math.sqrt(distanceSquared);
            if (clearDistance(eye, to.normalize(), distance) < distance - 0.35) continue;
            nearest = enemy;
            nearestDistanceSquared = distanceSquared;
        }
        return nearest;
    }

    private void frostnova(Player caster) {
        if (!ready(caster, "frostnova")) return;
        List<Enemy> enemies = nearbyHostiles(caster, 5.5, 4);
        if (enemies.isEmpty()) {
            caster.sendMessage(ChatColor.YELLOW + "霜环附近没有看得见的怪物；未消耗魔力。");
            return;
        }
        if (!begin(caster, "frostnova", 7, 14)) return;
        World world = caster.getWorld();
        Location center = caster.getLocation().add(0, 0.8, 0);
        for (int i = 0; i < 24; i++) {
            double angle = i * Math.PI / 12;
            Location point = center.clone().add(Math.cos(angle) * 5, 0.2, Math.sin(angle) * 5);
            world.spawnParticle(i % 3 == 0 ? Particle.END_ROD : Particle.SNOWFLAKE,
                    point, 2, 0.1, 0.25, 0.1, 0.01);
        }
        world.spawnParticle(Particle.CLOUD, center, 32, 2.4, 0.3, 2.4, 0.01);
        world.playSound(center, Sound.BLOCK_GLASS_BREAK, 0.8f, 1.4f);
        int damage = damage(caster, "frostnova", 2);
        int slowTicks = 80 + (plugin.mastery().rank(caster, "frostnova") - 1) * 20;
        for (Enemy enemy : enemies) {
            enemy.damage(damage, caster);
            if (enemy.isValid() && !enemy.isDead())
                enemy.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, slowTicks, 1, false, true));
        }
        plugin.mastery().successfulCast(caster, "frostnova");
        caster.sendMessage(ChatColor.AQUA + "霜环命中 " + enemies.size() + " 只怪物并减速（7 魔力）。");
    }

    private void flamewave(Player caster) {
        if (!ready(caster, "flamewave")) return;
        Location eye = caster.getEyeLocation();
        Vector forward = eye.getDirection().normalize();
        List<Enemy> enemies = new ArrayList<>();
        for (Entity entity : caster.getNearbyEntities(9, 5, 9)) {
            if (!hostile(entity) || !(entity instanceof Enemy enemy) || !caster.hasLineOfSight(enemy)) continue;
            Vector to = enemy.getEyeLocation().toVector().subtract(eye.toVector());
            double distance = to.length();
            if (distance > 9 || distance < 0.01 || forward.dot(to.normalize()) < 0.72) continue;
            enemies.add(enemy);
        }
        enemies.sort(Comparator.comparingDouble(enemy -> enemy.getLocation().distanceSquared(caster.getLocation())));
        if (enemies.isEmpty()) {
            caster.sendMessage(ChatColor.YELLOW + "焰浪前方没有看得见的怪物；未消耗魔力。");
            return;
        }
        if (!begin(caster, "flamewave", 8, 10)) return;
        World world = caster.getWorld();
        Vector side = new Vector(-forward.getZ(), 0, forward.getX());
        if (side.lengthSquared() < 0.01) side = new Vector(1, 0, 0);
        side.normalize();
        int visualSteps = (int) Math.floor(Math.min(9, clearDistance(eye, forward, 9)));
        for (int step = 1; step <= visualSteps; step++) {
            Vector middle = eye.toVector().add(forward.clone().multiply(step));
            double width = Math.min(2.3, step * 0.28);
            for (int wing = -1; wing <= 1; wing++) {
                Location point = middle.clone().add(side.clone().multiply(wing * width)).toLocation(world);
                world.spawnParticle(Particle.FLAME, point, 4, 0.18, 0.22, 0.18, 0.02);
            }
        }
        world.playSound(eye, Sound.ITEM_FIRECHARGE_USE, 0.9f, 1.1f);
        int hit = 0;
        int damage = damage(caster, "flamewave", 4);
        int fireTicks = 60 + (plugin.mastery().rank(caster, "flamewave") - 1) * 20;
        for (Enemy enemy : enemies) {
            if (hit == 4) break;
            enemy.damage(damage, caster);
            if (enemy.isValid() && !enemy.isDead())
                enemy.setFireTicks(Math.max(enemy.getFireTicks(), fireTicks));
            hit++;
        }
        plugin.mastery().successfulCast(caster, "flamewave");
        caster.sendMessage(ChatColor.GOLD + "焰浪命中 " + hit + " 只怪物（8 魔力）。");
    }

    private List<Enemy> nearbyHostiles(Player caster, double radius, int maxTargets) {
        List<Enemy> enemies = new ArrayList<>();
        Location center = caster.getLocation();
        for (Entity entity : caster.getNearbyEntities(radius, 3, radius)) {
            if (hostile(entity) && entity instanceof Enemy enemy
                    && entity.getLocation().distanceSquared(center) <= radius * radius
                    && caster.hasLineOfSight(enemy)) enemies.add(enemy);
        }
        enemies.sort(Comparator.comparingDouble(enemy -> enemy.getLocation().distanceSquared(center)));
        if (enemies.size() > maxTargets) return List.copyOf(enemies.subList(0, maxTargets));
        return enemies;
    }
}
