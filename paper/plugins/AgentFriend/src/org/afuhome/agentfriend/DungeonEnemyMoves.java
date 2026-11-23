package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Color;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.Vector;

/** Encounter-owned moves that use vanilla telegraphs and the original damage event. */
final class DungeonEnemyMoves implements Listener {
    enum Move {
        CRYPT_BARRAGE("crypt_barrage", "寒骨齐射", "横移离开蓝色射线", 32, 24, 180, 8, 1, 4, Color.AQUA),
        CRYPT_MIASMA("crypt_miasma", "毒雾仪式", "撤出绿色预警圈，读条后反击", 44, 32, 220, 3.2, 0, 5, Color.LIME),
        GRAVE_CLEAVE("grave_cleave", "封印重劈", "从侧面或背后绕开扇形", 34, 22, 240, 4.5, 55, 6, Color.ORANGE),
        FORGE_SWEEP("forge_sweep", "炉卫横扫", "绕到监工身后或退到橙色弧线外", 40, 26, 260, 5, 65, 7, Color.fromRGB(255, 100, 35)),
        FROST_LINE("frost_line", "霜痕直劈", "横移出霜线", 28, 18, 220, 5.5, .8, 4, Color.AQUA),
        ECHO_NOVA("echo_nova", "虚空震荡", "撤出紫色圆圈", 40, 26, 120, 5, 0, 8, Color.FUCHSIA),
        ECHO_BEAM("echo_beam", "回响贯穿", "横移离开紫色光带", 32, 22, 108, 7, 1.25, 8, Color.FUCHSIA);

        final String id;
        final String name;
        final String response;
        final int windup;
        final int recovery;
        final int interval;
        final double reach;
        final double spread;
        final double damage;
        final Particle.DustOptions warning;

        Move(String id, String name, String response, int windup, int recovery, int interval,
             double reach, double spread, double damage, Color color) {
            this.id = id;
            this.name = name;
            this.response = response;
            this.windup = windup;
            this.recovery = recovery;
            this.interval = interval;
            this.reach = reach;
            this.spread = spread;
            this.damage = damage;
            this.warning = new Particle.DustOptions(color, 1.1f);
        }

        String shape() {
            return switch (this) {
                case ECHO_NOVA, CRYPT_MIASMA -> "circle";
                case FROST_LINE, ECHO_BEAM, CRYPT_BARRAGE -> "line";
                default -> "arc";
            };
        }

        boolean covers(double forward, double side, double height) {
            if (Math.abs(height) > 1.75) return false;
            if (shape().equals("circle")) return forward * forward + side * side <= reach * reach;
            if (forward < 0 || forward > reach) return false;
            if (shape().equals("line")) return Math.abs(side) <= spread;
            return forward * forward + side * side <= reach * reach
                && Math.abs(side) <= forward * Math.tan(Math.toRadians(spread));
        }
    }

    record Scope(BooleanSupplier active, Supplier<List<Player>> participants, Predicate<Location> inRoom) { }

    private static final class Actor {
        final Mob mob;
        final Move move;
        final Scope scope;
        long next;
        long impact;
        long recoveryEnds;
        Location origin;
        Vector direction;
        AttributeModifier hold;
        boolean hitFrame;
        boolean resolving;

        Actor(Mob mob, Move move, Scope scope, long next) {
            this.mob = mob;
            this.move = move;
            this.scope = scope;
            this.next = next;
        }
    }

    private final AgentFriendPlugin plugin;
    private final Map<UUID, Actor> actors = new LinkedHashMap<>();
    private BukkitTask task;
    private long tick;

    DungeonEnemyMoves(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    boolean enabled() {
        return plugin.getConfig().getBoolean("dungeon-enemy-moves.enabled", false);
    }

    void register(Mob mob, Move move, Scope scope) {
        if (!enabled()) return;
        long initialDelay = move == Move.ECHO_NOVA || move == Move.ECHO_BEAM ? 20 : 60;
        actors.putIfAbsent(mob.getUniqueId(), new Actor(mob, move, scope, tick + initialDelay));
        if (task == null) task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 2L, 2L);
    }

    void changeMove(Mob mob,Move move,Scope scope){
        Actor previous=actors.remove(mob.getUniqueId());if(previous!=null)reset(previous);
        register(mob,move,scope);
        Actor next=actors.get(mob.getUniqueId());if(next!=null)next.next=tick+2; // Keep the full windup, not a second idle delay at the phase break.
    }
    void shutdown() {
        actors.values().forEach(this::reset);
        actors.clear();
        stopScheduler();
    }

    @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
    public void ordinaryMelee(EntityDamageByEntityEvent event) {
        Actor actor = actors.get(event.getDamager().getUniqueId());
        if (actor != null && actor.origin != null && !actor.resolving && actor.scope.active().getAsBoolean()) {
            event.setCancelled(true);
        }
    }

    List<Map<String, Object>> hazards(Player viewer) {
        var out = new ArrayList<Map<String, Object>>();
        for (Actor actor : actors.values()) {
            if (actor.origin == null || !actor.scope.active().getAsBoolean() || !valid(actor, viewer)
                    || viewer.getWorld() != actor.origin.getWorld() || viewer.getLocation().distanceSquared(actor.origin) > 144
                    || !viewer.hasLineOfSight(actor.mob)) continue;
            var move = actor.move;
            out.add(Map.ofEntries(
                Map.entry("id", move.id),
                Map.entry("name", move.name),
                Map.entry("sourceUuid", actor.mob.getUniqueId().toString()),
                Map.entry("phase", actor.hitFrame ? "recovery" : "windup"),
                Map.entry("remainingTicks", Math.max(0, (actor.hitFrame ? actor.recoveryEnds : actor.impact) - tick)),
                Map.entry("origin", List.of(actor.origin.getX(), actor.origin.getY(), actor.origin.getZ())),
                Map.entry("direction", List.of(actor.direction.getX(), actor.direction.getZ())),
                Map.entry("world", actor.origin.getWorld().getName()),
                Map.entry("shape", move.shape()),
                Map.entry("reach", move.reach),
                Map.entry(switch(move.shape()){case "line" -> "halfWidth"; case "circle" -> "radius"; default -> "halfAngleDegrees";},
                    move.shape().equals("circle") ? move.reach : move.spread),
                Map.entry("response", move.response)));
        }
        return List.copyOf(out);
    }

    private boolean valid(Actor actor, Player player) {
        return plugin.nativeRpgMayAct(player) && actor.scope.inRoom().test(player.getLocation())
            && actor.scope.participants().get().stream().anyMatch(member -> member.getUniqueId().equals(player.getUniqueId()));
    }

    private void tick() {
        tick += 2;
        for (var iterator = actors.values().iterator(); iterator.hasNext();) {
            Actor actor = iterator.next();
            if (!enabled() || !actor.mob.isValid() || actor.mob.isDead() || !actor.scope.active().getAsBoolean()) {
                reset(actor);
                iterator.remove();
                continue;
            }
            if (actor.origin == null && tick < actor.next) continue;
            try {
                advance(actor);
            } catch (RuntimeException | LinkageError failure) {
                iterator.remove();
                reset(actor);
                plugin.getLogger().log(java.util.logging.Level.WARNING,
                    "Disabled enemy move " + actor.move.id + " for " + actor.mob.getUniqueId(), failure);
            }
        }
        if (actors.isEmpty()) stopScheduler();
    }

    private void stopScheduler() {
        if (task == null) return;
        task.cancel();
        task = null;
    }

    private void advance(Actor actor) {
        if (actor.origin == null) {
            begin(actor);
            return;
        }
        Location actual = actor.mob.getLocation();
        if (!actor.scope.inRoom().test(actual) || actual.getWorld() != actor.origin.getWorld()
                || actual.distanceSquared(actor.origin) > 1.44) {
            reset(actor);
            return;
        }
        if (actor.hitFrame) {
            if (tick >= actor.recoveryEnds) reset(actor);
            return;
        }
        if (actor.scope.participants().get().stream().noneMatch(plugin::nativeRpgMayAct)) {
            reset(actor);
            return;
        }
        faceWindup(actor);
        if (tick >= actor.impact) {
            strike(actor);
            return;
        }
        if (tick % 6 == 0) outline(actor);
    }

    private void begin(Actor actor) {
        Location origin = actor.mob.getLocation();
        if (!actor.scope.inRoom().test(origin)) {
            actor.next = tick + 16;
            return;
        }
        double nearest = (actor.move.reach + .75) * (actor.move.reach + .75);
        Vector direction = null;
        List<Player> present = actor.scope.participants().get();
        for (Player player : present) {
            LivingEntity target = ResidentCli.living(player);
            if (target == null || !plugin.nativeRpgMayAct(player) || target.getWorld() != origin.getWorld()
                    || !actor.mob.hasLineOfSight(target)) continue;
            Vector toward = target.getLocation().toVector().subtract(origin.toVector());
            double distance = toward.lengthSquared();
            toward.setY(0);
            if (distance >= nearest || toward.lengthSquared() < .05) continue;
            direction = toward.normalize();
            nearest = distance;
        }
        if (direction == null) {
            actor.next = tick + 16;
            return;
        }
        actor.origin = origin;
        actor.direction = direction;
        actor.impact = tick + actor.move.windup;
        actor.next = tick + actor.move.interval;
        actor.recoveryEnds = actor.impact + actor.move.recovery;
        var speed = actor.mob.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED);
        if (speed != null) {
            actor.hold = new AttributeModifier(UUID.randomUUID(), "qdj_enemy_windup", -1,
                AttributeModifier.Operation.MULTIPLY_SCALAR_1);
            speed.addTransientModifier(actor.hold);
        }
        faceWindup(actor);
        origin.getWorld().playSound(origin, Sound.BLOCK_ANVIL_PLACE, .55f, .7f);
        for (Player player : present) {
            if (plugin.nativeRpgMayAct(player) && player.getWorld() == origin.getWorld()
                    && player.getLocation().distanceSquared(origin) <= 144
                    && player.hasLineOfSight(actor.mob)) {
                player.sendTitle("", ChatColor.GOLD + actor.move.name + " · " + actor.move.response, 0, actor.move.windup, 5);
                if (player.getListeningPluginChannels().contains(AgentStatePublisher.CHANNEL)) {
                    plugin.refreshAgentState(player);
                }
            }
        }
        outline(actor);
    }

    private void faceWindup(Actor actor) {
        // Use the Bukkit rotation API. Youer does not expose Paper's mob pathfinder.
        actor.mob.setRotation(actor.origin.clone().setDirection(actor.direction).getYaw(), 0);
    }

    private void strike(Actor actor) {
        actor.hitFrame = true;
        actor.mob.swingMainHand();
        actor.mob.getWorld().playSound(actor.origin, Sound.ENTITY_PLAYER_ATTACK_SWEEP, 1, .75f);
        actor.mob.getWorld().spawnParticle(Particle.SWEEP_ATTACK, at(actor, 1, 0, 1), 1);
        Vector right = new Vector(-actor.direction.getZ(), 0, actor.direction.getX());
        for (Player player : actor.scope.participants().get()) {
            if (!actor.scope.active().getAsBoolean()) break;
            LivingEntity target = ResidentCli.living(player);
            if (target == null || !plugin.nativeRpgMayAct(player) || target.getWorld() != actor.origin.getWorld()) continue;
            Location feet = target.getLocation();
            Vector delta = feet.toVector().subtract(actor.origin.toVector());
            if (!actor.scope.inRoom().test(feet) || !actor.move.covers(delta.dot(actor.direction), delta.dot(right), delta.getY())
                    || !clear(actor.origin.clone().add(0, 1, 0), feet.clone().add(0, 1, 0))) continue;
            double before = target.getHealth();
            actor.resolving = true;
            try {
                target.damage(actor.move.damage, actor.mob);
            } finally {
                actor.resolving = false;
            }
            if (actor.move == Move.FROST_LINE && target.isValid() && !target.isDead() && !plugin.isDowned(player)
                    && target.getHealth() < before) {
                target.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, 50, 0));
            }
        }
    }

    private void outline(Actor actor) {
        Move move = actor.move;
        if (move.shape().equals("circle")) {
            for (int i = 0; i < 20; i++) {
                double angle = i * Math.PI / 10;
                mark(actor, at(actor, move.reach * Math.cos(angle), move.reach * Math.sin(angle), .18));
            }
            return;
        }
        if (move.shape().equals("line")) {
            for (int i = 1; i <= 7; i++) {
                double ahead = move.reach * i / 7;
                mark(actor, at(actor, ahead, -move.spread, .18));
                mark(actor, at(actor, ahead, move.spread, .18));
            }
            return;
        }
        for (int i = -5; i <= 5; i++) {
            double angle = Math.toRadians(move.spread * i / 5);
            mark(actor, at(actor, move.reach * Math.cos(angle), move.reach * Math.sin(angle), .18));
        }
        double boundary = Math.toRadians(move.spread);
        for (int i = 1; i <= 3; i++) {
            double radius = move.reach * i / 4;
            mark(actor, at(actor, radius * Math.cos(boundary), radius * Math.sin(boundary), .18));
            mark(actor, at(actor, radius * Math.cos(boundary), -radius * Math.sin(boundary), .18));
        }
    }

    private void mark(Actor actor, Location point) {
        if (actor.scope.inRoom().test(point) && clear(actor.origin.clone().add(0, 1, 0), point)) {
            point.getWorld().spawnParticle(Particle.DUST, point, 1, 0, 0, 0, 0, actor.move.warning);
        }
    }

    private Location at(Actor actor, double forward, double side, double height) {
        Vector direction = actor.direction;
        return actor.origin.clone().add(direction.getX() * forward - direction.getZ() * side,
            height, direction.getZ() * forward + direction.getX() * side);
    }

    private static boolean clear(Location from, Location to) {
        Vector delta = to.toVector().subtract(from.toVector());
        double distance = delta.length();
        return distance < .08
            || from.getWorld().rayTraceBlocks(from, delta, distance - .04, FluidCollisionMode.NEVER, true) == null;
    }

    private void reset(Actor actor) {
        if (actor.hold != null) {
            var speed = actor.mob.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED);
            if (speed != null) speed.removeModifier(actor.hold);
            actor.hold = null;
        }
        actor.origin = null;
        actor.direction = null;
        actor.hitFrame = false;
        actor.resolving = false;
    }
}
