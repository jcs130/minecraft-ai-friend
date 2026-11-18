package org.qiandengji.vortex;

import io.vortexcore.VortexCorePlugin;
import io.vortexcore.combat.ManaGate;
import io.vortexcore.combat.PartySpellTargets;
import io.vortexcore.integration.protection.ProtectionAction;
import io.vortexcore.magic.*;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.*;
import java.lang.reflect.Method;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import org.bukkit.*;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.scheduler.BukkitTask;

/** One server-owned ground spell. Vortex still owns skill points, casting and resources. */
final class HealingCircle {
    static final String ID = "healing_circle";
    static final String NAME = "治愈之环";
    static final String DESCRIPTION = "瞄准12格内地面。半径4格、持续6秒，每秒为圈内本人和队友回复1点生命。";
    static final long COOLDOWN = 25_000;
    static final double RANGE = 12, RADIUS = 4;
    private static final int PULSE_TICKS = 20, PULSES = 6;
    private static final String UNLOCKED = "rpg.unlocked_skills";

    private record Key(UUID actor, UUID request) {}
    private record Attempt(Key key, Location center, String scene, double cost) {}
    private record Ally(Location center, double missing, boolean urgent) {}
    private record Suggestion(Location center, int injured, double missing) {}
    private static final class Circle {
        final Attempt cast;
        final Map<UUID, Double> recovered = new LinkedHashMap<>();
        long nextPulse;
        int pulses;
        String phase = "placed";
        Circle(Attempt cast, long tick) { this.cast = cast; nextPulse = tick + PULSE_TICKS; }
    }

    private final VortexBridge bridge;
    private final VortexCorePlugin vortex;
    private final Map<UUID, Attempt> pending = new HashMap<>();
    private final Map<UUID, Circle> active = new LinkedHashMap<>();
    private final Map<Key, Circle> effects = new LinkedHashMap<>();
    private final Map<UUID, Long> lastHealed = new HashMap<>();
    private final VortexSkillDefinition skill = new VortexSkillDefinition(ID, VortexClass.CLERIC,
        NAME, DESCRIPTION, Material.GLISTERING_MELON_SLICE, 3, 1, Map.of(), ID);
    private Method sceneMethod;
    private Method originalRequest;
    private Method eligibleReward;
    private VortexSpellRegistration registration;
    private BukkitTask heartbeat;
    private long tick;

    HealingCircle(VortexBridge bridge, VortexCorePlugin vortex) {
        this.bridge = bridge;
        this.vortex = vortex;
    }

    void install() throws ReflectiveOperationException {
        if (!configured()) return;
        var friend = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (friend == null || !friend.isEnabled()) throw new IllegalStateException("circle_party_rules_missing");
        var policy = friend.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.GroupSpellAccess");
        sceneMethod = policy.getMethod("circleScene", Player.class, Location.class);
        originalRequest = policy.getMethod("circleRequest", Player.class);
        eligibleReward = policy.getMethod("circleReward", Player.class);
        registration = new VortexSpellRegistration(vortex, skill, new CircleSpell(), COOLDOWN, 10d, false);
        heartbeat = Bukkit.getScheduler().runTaskTimer(bridge, this::tick, 1L, 1L);
    }

    private boolean configured() { return bridge.getConfig().getBoolean("healing-circle.enabled", false); }
    boolean enabled() { return registration != null && configured() && registration.enabled(); }
    boolean cleric(UnifiedPlayer state) {
        return vortex.classSkillService().selectedClass(state).orElse(null) == VortexClass.CLERIC;
    }
    boolean learned(UnifiedPlayer state) {
        return vortex.classSkillService().unlockedSkillIds(state).contains(ID);
    }
    boolean eligible(Player player) { return enabled() && Boolean.TRUE.equals(invoke(eligibleReward, player)); }
    private boolean resourcesReady(Player player, UnifiedPlayer state) {
        return learned(state) && vortex.spellbookService().qiandengjiCooldown(player.getUniqueId(), ID) <= 0
            && vortex.qiandengjiMana().hasMana(player.getUniqueId(), ManaGate.cost(vortex, ID));
    }
    boolean suggested(Player player, UnifiedPlayer state) {
        return cleric(state) && resourcesReady(player, state) && suggestion(player) != null;
    }

    CompletableFuture<?> learnFromReward(Player player, UnifiedPlayer state) {
        if (!eligible(player) || !cleric(state) || scene(player, player.getLocation()) == null)
            return CompletableFuture.failedFuture(new IllegalArgumentException("[circle_reward_locked] 需要牧师职业及翠藤古神祭坛首通资格。"));
        var skills = new LinkedHashSet<>(vortex.classSkillService().unlockedSkillIds(state));
        if (skills.add(ID)) state.putMetadata(UNLOCKED, String.join(",", skills));
        // The original profile owns the unlock. Retaining the proof makes a save retry idempotent.
        return vortex.playerProfileService().qiandengjiSave(player);
    }

    Map<String, Object> describe(Player player, UnifiedPlayer state) {
        if (!enabled() || !cleric(state)) return Map.of();
        var data = new LinkedHashMap<String, Object>();
        data.put("learned", learned(state));
        data.put("rewardEligible", eligible(player));
        data.put("target", "ground");
        data.put("range", RANGE);
        data.put("radius", RADIUS);
        data.put("durationTicks", PULSES * PULSE_TICKS);
        var recent = effects.values().stream().filter(c -> c.cast.key.actor.equals(player.getUniqueId())).toList();
        data.put("effects", recent.subList(Math.max(0, recent.size()-4), recent.size()).stream().map(this::receipt).toList());
        if (resourcesReady(player, state)) {
            var ready = suggestion(player);
            if (ready != null) data.put("suggestion", Map.of("id", ID, "effect", "group_heal", "ready", true,
                "ground", point(ready.center), "injuredAllies", ready.injured, "invocation", "/mycli cast "+ID+" --json"));
        }
        return data;
    }

    CompletableFuture<Map<String, Object>> cast(Player player, UnifiedPlayer state, Location aim, boolean assist) {
        UUID id = player.getUniqueId();
        Object original = invoke(originalRequest, player);
        var key = new Key(id, original instanceof UUID request ? request : UUID.randomUUID());
        Circle prior = effects.get(key);
        if (prior != null) return CompletableFuture.completedFuture(receipt(prior));
        if (pending.containsKey(id)) return denied("circle_busy", "上一道法阵仍在确认，请查原结果。");
        if (!enabled() || !cleric(state) || !learned(state))
            return denied("skill_locked", "治愈之环是牧师技能。到职业技能页学习，或在翠藤古神祭坛领取首通资格。");
        var site = assist ? suggestion(player) : null;
        if (assist && site == null) return denied("circle_no_support_target", "当前没有适合铺环的伤员落点。等队友进入可见安全位置后再施放。");
        var center = site != null ? site.center : aimed(aim == null ? player.getEyeLocation() : aim);
        String scene = validate(player, center);
        if (scene == null) return denied("circle_invalid_ground", "请瞄准同场次12格内的可见地面；墙面、隔墙和场外无法放置。");
        Attempt cast = new Attempt(key, center, scene, ManaGate.cost(vortex, ID));
        pending.put(id, cast);
        try {
            return vortex.spellbookService().cast(player, state, ID).thenApply(ignored -> {
                Circle placed = effects.get(key);
                if (placed == null) throw new IllegalStateException("circle_result_unknown");
                return receipt(placed);
            }).whenComplete((result, failure) -> pending.remove(id, cast));
        } catch (RuntimeException failure) {
            pending.remove(id, cast);
            return CompletableFuture.failedFuture(failure);
        }
    }

    private static CompletableFuture<Map<String, Object>> denied(String reason, String detail) {
        return CompletableFuture.completedFuture(Map.of("success", false, "changed", false, "reason", reason,
            "summary", detail, "nextCommand", "/mycli skills info " + ID));
    }

    private final class CircleSpell implements CompiledSpell {
        @Override public String id() { return ID; }
        @Override public TriggerType triggerType() { return TriggerType.CAST; }
        @Override public List<SpellTargeter> targeters() { return List.of(); }
        @Override public List<SpellCondition> conditions() { return List.of(); }
        @Override public List<SpellMechanic> mechanics() { return List.of(); }

        @Override public CompletionStage<Void> execute(SpellContext context) {
            if (!(context.triggerSource() instanceof Player player) || !enabled() || !cleric(context.caster()) || !learned(context.caster()))
                return CompletableFuture.failedFuture(new IllegalStateException("[skill_locked] 需要学会治愈之环。"));
            UUID actor = player.getUniqueId();
            Attempt cast = pending.get(actor);
            if (cast == null) {
                // Vortex's own equipped-skill path uses the same ground rules and resource executor.
                Location center = aimed(player.getEyeLocation());
                String scene = validate(player, center);
                if (scene != null) cast = new Attempt(new Key(actor, context.executionId()), center, scene, ManaGate.cost(vortex, ID));
            }
            if (cast == null || !cast.scene.equals(validate(player, cast.center)))
                return CompletableFuture.failedFuture(new IllegalArgumentException("[circle_invalid_ground] 落点变化；重新瞄准同场次12格内的可见地面。"));
            Circle circle = new Circle(cast, tick);
            Circle replaced = active.put(actor, circle);
            if (replaced != null) replaced.phase = "ended";
            effects.put(cast.key, circle);
            return CompletableFuture.completedFuture(null);
        }
    }

    private static Map<String, Object> point(Location center) {
        return Map.of("world", center.getWorld().getName(), "x", center.getX(), "y", center.getY(), "z", center.getZ());
    }
    private Map<String, Object> receipt(Circle c) {
        return Map.ofEntries(Map.entry("success",true),Map.entry("reason","circle_placed"),Map.entry("changed",true),
            Map.entry("placed",true),Map.entry("requestId",c.cast.key.request.toString()),Map.entry("actorUuid",c.cast.key.actor.toString()),
            Map.entry("phase",c.phase),Map.entry("ground",point(c.cast.center)),Map.entry("resourceSpent",c.cast.cost),
            Map.entry("healing",c.recovered.values().stream().mapToDouble(Double::doubleValue).sum()),
            Map.entry("healedActors",c.recovered.entrySet().stream().map(e->Map.of("uuid",e.getKey().toString(),"healing",e.getValue())).toList()));
    }

    private Suggestion suggestion(Player caster) {
        var allies = PartySpellTargets.allies(caster, RANGE + RADIUS).stream()
            .filter(p -> p.getHealth() <= p.getMaxHealth() - 2 || p.getHealth() < p.getMaxHealth() * .6)
            .sorted(Comparator.<Player>comparingDouble(p -> p.getMaxHealth()-p.getHealth()).reversed()
                .thenComparing(Player::getUniqueId)).limit(8)
            .map(p -> new Ally(p.getLocation(), p.getMaxHealth()-p.getHealth(), p.getHealth()<p.getMaxHealth()*.6)).toList();
        Suggestion best = null;
        for (int i = 0; i < allies.size(); i++) {
            Location at = allies.get(i).center;
            for (int j = i; j < allies.size(); j++) {
                Location middle = at.clone().add(allies.get(j).center.toVector()).multiply(.5).add(0, .35, 0);
                Location ground = aimed(middle, new org.bukkit.util.Vector(0, -1, 0), 1.5);
                if (validate(caster, ground) == null) continue;
                var covered = allies.stream().filter(a -> inRing(ground, a.center) && visible(ground.clone().add(0, .12, 0), a.center.clone().add(0, .25, 0))).toList();
                if (covered.size() < 2 && covered.stream().noneMatch(Ally::urgent)) continue;
                double missing = covered.stream().mapToDouble(Ally::missing).sum();
                if (best == null || covered.size() > best.injured || covered.size() == best.injured && missing > best.missing)
                    best = new Suggestion(ground, covered.size(), missing);
            }
        }
        return best;
    }

    private String validate(Player p, Location center) {
        Location eye = p.getEyeLocation();
        if (center == null || !eye.getWorld().equals(center.getWorld()) || !loaded(center)
                || eye.distanceSquared(center) > RANGE * RANGE + .05
                || !center.getBlock().isPassable() || center.getBlock().isLiquid()
                || !visible(eye, center) || !vortex.protectionHookService().allows(p, center, ProtectionAction.SPELL_TARGET)) return null;
        return scene(p, center);
    }

    private String scene(Player p, Location at) {
        Object value = invoke(sceneMethod, p, at);
        return value instanceof String scene ? scene : null;
    }
    private static Object invoke(Method method, Object... arguments) {
        if (method == null) return null;
        try { return method.invoke(null, arguments); }
        catch (ReflectiveOperationException | RuntimeException unavailable) { return null; }
    }
    private static Location aimed(Location eye) { return aimed(eye, eye.getDirection(), RANGE); }
    private static Location aimed(Location from, org.bukkit.util.Vector direction, double distance) {
        if (from.getWorld() == null || !loaded(from)) return null;
        var hit = from.getWorld().rayTraceBlocks(from, direction, distance, FluidCollisionMode.NEVER, true);
        if (hit == null || hit.getHitBlockFace() != BlockFace.UP) return null;
        return hit.getHitPosition().toLocation(from.getWorld()).add(0, .04, 0);
    }
    private static boolean loaded(Location p) { return p.getWorld().isChunkLoaded(p.getBlockX() >> 4, p.getBlockZ() >> 4); }
    private static boolean visible(Location from, Location to) {
        var delta = to.toVector().subtract(from.toVector());
        double length = delta.length();
        return length < .09 || from.getWorld().rayTraceBlocks(from, delta, length-.04, FluidCollisionMode.NEVER, true) == null;
    }
    private static boolean inRing(Location center, Location target) {
        if (!center.getWorld().equals(target.getWorld()) || Math.abs(center.getY()-target.getY()) > 1.5) return false;
        double dx = center.getX()-target.getX(), dz = center.getZ()-target.getZ();
        return dx*dx + dz*dz <= RADIUS*RADIUS;
    }

    private void tick() {
        tick++;
        // Vortex's spell editor rebuilds its in-memory registry when reloading custom spells.
        if (configured()) registration.maintain();
        for (var iterator = active.entrySet().iterator(); iterator.hasNext();) {
            var row = iterator.next();
            Circle c = row.getValue();
            Player caster = ResidentActors.player(row.getKey());
            Location center = c.cast.center;
            if (!enabled() || caster == null || !loaded(center) || !c.cast.scene.equals(scene(caster, center))) {
                c.phase = "ended";
                iterator.remove();
                continue;
            }
            if (tick < c.nextPulse) {
                if (tick == c.nextPulse-PULSE_TICKS+1) draw(center);
                continue;
            }
            pulse(caster, c);
            if (++c.pulses >= PULSES) {
                c.phase = "finished";
                iterator.remove();
            } else {
                c.nextPulse += PULSE_TICKS;
            }
        }
        if (tick % PULSE_TICKS != 0) return;
        lastHealed.values().removeIf(last -> tick-last >= PULSE_TICKS);
        var iterator = effects.values().iterator();
        while (effects.size() > 256 && iterator.hasNext()) {
            if (!iterator.next().phase.equals("placed")) iterator.remove();
        }
    }
    private void pulse(Player caster, Circle circle) {
        Location center = circle.cast.center;
        var targets = new ArrayList<>(PartySpellTargets.allies(caster, RANGE + RADIUS));
        targets.addFirst(caster);
        for (Player target : targets) {
            UUID id = target.getUniqueId();
            if (!inRing(center, target.getLocation()) || tick-lastHealed.getOrDefault(id, -(long) PULSE_TICKS) < PULSE_TICKS
                    || !visible(center.clone().add(0, .12, 0), target.getLocation().add(0, .25, 0))
                    || !vortex.protectionHookService().allows(caster, target.getLocation(), ProtectionAction.SPELL_TARGET)
                    || !(ResidentActors.source(target) instanceof LivingEntity body) || body.isDead() || body.getHealth() >= body.getMaxHealth()) continue;
            double before = body.getHealth();
            body.heal(1, EntityRegainHealthEvent.RegainReason.MAGIC);
            double increase = body.getHealth()-before;
            if (increase <= 0) continue;
            lastHealed.put(id, tick);
            circle.recovered.merge(id, increase, Double::sum);
        }
    }
    private static void draw(Location center) {
        for (int i = 0; i < 24; i++) {
            double angle = i*Math.PI/12;
            center.getWorld().spawnParticle(Particle.HAPPY_VILLAGER,
                center.clone().add(RADIUS*Math.cos(angle), .15, RADIUS*Math.sin(angle)), 1, 0, 0, 0, 0);
        }
    }
    void stop() {
        if (heartbeat != null) heartbeat.cancel();
        active.clear();
        pending.clear();
        if (registration != null) registration.stop();
    }
}
