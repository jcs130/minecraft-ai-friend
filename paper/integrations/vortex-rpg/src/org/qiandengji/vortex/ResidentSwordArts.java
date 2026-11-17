package org.qiandengji.vortex;

import io.vortexcore.VortexCorePlugin;
import io.vortexcore.combat.PlayerStateGate;
import io.vortexcore.integration.protection.ProtectionAction;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.ResidentActors;
import io.vortexcore.rpg.SwordsmanSkills;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.Particle;
import org.bukkit.Tag;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

import static io.vortexcore.rpg.SwordsmanSkills.*;

/** Resident CLI arts use the original Vortex profile, mana manager and spellbook clock. */
final class ResidentSwordArts {
    private static final String COOLDOWN = "qiandengji.swordsman.ready.";
    private static final String MANA_AFTER = "qiandengji.swordsman.manaAfter";
    private static final List<Art> ARTS = List.of(
            new Art(SWORD_STEP, "剑步", 1, 4, 5_000, 5, 0, false, 0),
            new Art(HORIZONTAL, "水平方阵斩", 3, 8, 12_000, 3.25, 2, false, .8),
            new Art(STARBURST, "星爆气流斩", 8, 24, 45_000, 3.25, 16, true, .5));

    record Art(String id, String name, int level, double mana, long cooldown, double range,
               int strikes, boolean dual, double scale) {}

    private final VortexCorePlugin vortex;
    private final VortexBridge bridge;
    private final Map<UUID, Cast> active = new HashMap<>();

    ResidentSwordArts(VortexCorePlugin vortex, VortexBridge bridge) {
        this.vortex = vortex;
        this.bridge = bridge;
    }

    static Art find(String id) {
        return ARTS.stream().filter(art -> art.id().equals(id)).findFirst().orElse(null);
    }

    boolean isSwordsman(UnifiedPlayer profile) {
        return vortex.classSkillService().selectedClassDefinition(profile)
                .map(c -> CLASS_ID.equals(c.id())).orElse(false);
    }

    private boolean learned(UnifiedPlayer profile, Art art) {
        return isSwordsman(profile) && profile.level() >= art.level()
                && vortex.classSkillService().availableSpellIds(profile).contains(art.id())
                && (!art.dual() || SwordsmanSkills.prerequisites(vortex.classSkillService(), profile));
    }

    List<Map<String, Object>> abilities(Player actor, UnifiedPlayer profile) {
        if (!ResidentActors.registered(actor.getUniqueId()) || !isSwordsman(profile)) return List.of();
        return ARTS.stream().filter(art -> learned(profile, art)).map(art -> info(actor, profile, art)).toList();
    }

    Map<String, Object> info(Player actor, UnifiedPlayer profile, Art art) {
        var out = new LinkedHashMap<String, Object>();
        out.put("id", "mycli:" + art.id());
        out.put("name", art.name());
        out.put("level", 1);
        out.put("minimumLevel", art.level());
        out.put("skillPoints", vortex.classSkillService().unspentSkillPoints(profile));
        vortex.classSkillService().skillsFor(profile).stream().filter(node -> node.id().equals(art.id())).findFirst()
                .ifPresent(node -> out.put("learnCost", node.cost()));
        out.put("classId", CLASS_ID);
        out.put("learned", learned(profile, art));
        out.put("requiredEquipment", art.dual() ? List.of("mainhand:sword", "offhand:sword") : List.of("mainhand:sword"));
        out.put("prerequisites", art.dual() ? List.of(HORIZONTAL, DUAL_BLADES) : List.of());
        out.put("manaCost", art.mana());
        out.put("cooldownMs", art.cooldown());
        out.put("cooldownRemainingMs", remaining(actor.getUniqueId(), art));
        out.put("range", art.range());
        out.put("maximumDamageStrikes", art.strikes());
        String next = learned(profile, art) ? "/mycli cast " + art.id() : "/mycli skills list";
        if (!learned(profile, art) && out.containsKey("learnCost")) next = "/mycli skills learn " + art.id();
        out.put("nextCommand", next);
        out.put("summary", art.name() + "；需要Lv" + art.level() + "、" + (art.dual() ? "双剑及二刀流专精" : "主手剑")
                + "；" + art.mana() + "魔力，冷却" + art.cooldown()/1000 + "秒。");
        return out;
    }

    String reflex(Player actor, UnifiedPlayer profile, UUID targetId) {
        if (!isSwordsman(profile) || !(Bukkit.getEntity(targetId) instanceof LivingEntity target)) return "";
        var equipment = actor.getInventory();
        if (!sword(equipment.getItemInMainHand())) return "";
        UUID id = actor.getUniqueId();
        for (Art art : ARTS.reversed()) {
            if (!learned(profile, art) || remaining(id, art) > 0 || !vortex.qiandengjiMana().hasMana(id, art.mana())
                    || art.dual() && !sword(equipment.getItemInOffHand())) continue;
            if (art.strikes() == 0 && actor.getLocation().distanceSquared(target.getLocation()) <= 6.25) continue;
            if (Boolean.TRUE.equals(nativeBody("visibleHostile", new Class<?>[]{UUID.class, UUID.class, double.class},
                    id, targetId, art.range()))) return art.id();
        }
        return "";
    }

    private long remaining(UUID id, Art art) {
        return vortex.spellbookService().qiandengjiCooldown(id, art.id());
    }

    private void deadline(UUID id, Art art, long when) {
        vortex.spellbookService().qiandengjiSetSwordDeadline(id, art.id(), when);
    }

    void restore(Player actor, UnifiedPlayer profile) {
        if (!isSwordsman(profile)) return;
        var metadata = profile.metadata();
        UUID id = actor.getUniqueId();
        long now = System.currentTimeMillis();
        boolean active = false;
        for (Art art : ARTS) {
            long time = Long.parseLong(metadata.getOrDefault(COOLDOWN + art.id(), "0"));
            if (time > now) {
                deadline(id, art, Math.min(time, now + art.cooldown()));
                active = true;
            }
        }
        if (active) {
            double mana = Double.parseDouble(metadata.getOrDefault(MANA_AFTER, "0"));
            if (!Double.isFinite(mana) || mana < 0) throw new IllegalStateException("invalid_sword_mana_checkpoint");
            vortex.qiandengjiMana().setMana(id, mana);
        }
    }

    void cast(Player actor, UnifiedPlayer profile, Art art, java.util.function.Consumer<Map<String, Object>> complete) {
        UUID id = actor.getUniqueId();
        if (!ResidentActors.registered(id)) { complete.accept(blocked(art, "native_resident_required")); return; }
        if (!learned(profile, art)) { complete.accept(blocked(art, "skill_locked")); return; }
        if (remaining(id, art) > 0) { complete.accept(blocked(art, "skill_cooldown")); return; }

        var cast = new Cast(actor, profile, art, complete);
        if (cast.refusal != null) { complete.accept(blocked(art, cast.refusal)); return; }
        var mana = vortex.qiandengjiMana();
        if (!mana.consumeMana(id, art.mana())) { complete.accept(blocked(art, "insufficient_mana")); return; }

        // The durable resource checkpoint precedes all movement, visuals and damage.
        long readyAt = System.currentTimeMillis() + art.cooldown();
        deadline(id, art, readyAt);
        profile.putMetadata(COOLDOWN + art.id(), Long.toString(readyAt));
        profile.putMetadata(MANA_AFTER, Double.toString(mana.getMana(id)));
        active.put(id, cast);
        try {
            vortex.playerProfileService().qiandengjiSave(actor).whenComplete((saved, error) ->
                    Bukkit.getScheduler().runTask(bridge, () -> {
                        if (error != null) cast.unknown("resource_save_unconfirmed");
                        else cast.start();
                    }));
        } catch (RuntimeException failure) {
            cast.unknown("resource_save_unconfirmed");
        }
    }

    void stop() {
        for (Cast cast : List.copyOf(active.values())) {
            if (cast.resourcesSaved) cast.finish("server_stopping", 0);
            else cast.unknown("resource_save_unconfirmed_at_shutdown");
        }
    }

    private Map<String, Object> blocked(Art art, String reason) {
        return Map.of("success", false, "changed", false, "skill", art.id(), "reason", reason,
                "manaConsumed", 0, "effectiveHits", 0, "visualSwings", 0);
    }

    private static boolean sword(ItemStack item) {
        return item != null && item.getAmount() == 1 && Tag.ITEMS_SWORDS.isTagged(item.getType());
    }

    private static Object nativeBody(String operation, Class<?>[] types, Object... arguments) {
        try {
            return Class.forName("local.qdj.maids.brain.ResidentBodyAccess")
                    .getMethod(operation, types).invoke(null, arguments);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("resident_sword_body_unavailable", error);
        }
    }

    private final class Cast implements SwordSequence.Body {
        private final Player actor;
        private final Art art;
        private final UnifiedPlayer profile;
        private final UUID id;
        private final String control;
        private final UUID targetId;
        private final UUID worldId;
        private final ItemStack main;
        private final ItemStack off;
        private final double health;
        private final SwordSequence sequence;
        private final java.util.function.Consumer<Map<String, Object>> complete;
        private String refusal;
        private org.bukkit.scheduler.BukkitTask task;
        private boolean finished;
        private boolean resourcesSaved;

        Cast(Player actor, UnifiedPlayer profile, Art art, java.util.function.Consumer<Map<String, Object>> complete) {
            this.actor = actor;
            this.profile = profile;
            this.art = art;
            this.complete = complete;
            id = actor.getUniqueId();
            control = control();
            var source = body();
            worldId = source == null ? null : source.getWorld().getUID();
            health = source == null ? 0 : source.getHealth() + source.getAbsorptionAmount();
            main = actor.getInventory().getItemInMainHand().clone();
            off = actor.getInventory().getItemInOffHand().clone();
            sequence = new SwordSequence(art.strikes(), 16 + art.strikes() * 23, art.dual());
            if (control.isBlank() || source == null || !PlayerStateGate.allowed(actor)) refusal = "body_controlled_or_unavailable";
            else if (!sword(main) || art.dual() && !sword(off)) refusal = art.dual() ? "two_swords_required" : "mainhand_sword_required";
            else if (!vortex.protectionHookService().allows(actor, source.getLocation(), ProtectionAction.SPELL_CAST)) refusal = "cast_area_protected";
            LivingEntity selected = refusal == null ? target(source) : null;
            targetId = selected == null ? null : selected.getUniqueId();
            if (refusal == null && targetId == null) refusal = "no_visible_hostile";
            if (refusal == null && art.strikes() == 0 && step(false) < .15) refusal = "no_safe_step";
        }

        private String control() {
            return (String) nativeBody("swordControl", new Class<?>[]{UUID.class}, id);
        }

        private LivingEntity body() {
            return Bukkit.getEntity(id) instanceof LivingEntity entity && entity.isValid() && !entity.isDead() ? entity : null;
        }

        private LivingEntity target() {
            return Bukkit.getEntity(targetId) instanceof LivingEntity entity && entity.isValid() && !entity.isDead() ? entity : null;
        }

        private LivingEntity target(LivingEntity source) {
            var origin = source.getLocation();
            return source.getNearbyEntities(art.range(), art.range(), art.range()).stream()
                    .filter(LivingEntity.class::isInstance).map(LivingEntity.class::cast)
                    .filter(this::attackable)
                    .min(Comparator.<LivingEntity>comparingDouble(e -> e.getLocation().distanceSquared(origin))
                            .thenComparing(LivingEntity::getUniqueId)).orElse(null);
        }

        private boolean attackable(LivingEntity target) {
            return Boolean.TRUE.equals(nativeBody("visibleHostile", new Class<?>[]{UUID.class, UUID.class, double.class},
                    id, target.getUniqueId(), art.range())) && (art.strikes() == 0 || vortex.protectionHookService()
                    .allows(actor, target.getLocation(), ProtectionAction.SPELL_TARGET));
        }

        @Override public String interruption() {
            var source = body();
            if (source == null) return "caster_dead_or_unloaded";
            if (!worldId.equals(source.getWorld().getUID()) || !control.equals(control()) || !PlayerStateGate.allowed(actor))
                return "body_control_or_dimension_changed";
            if (!learned(profile, art)) return "profession_or_skill_changed";
            if (!main.equals(actor.getInventory().getItemInMainHand()) ||
                    art.dual() && !off.equals(actor.getInventory().getItemInOffHand())) return "equipment_changed";
            if (source.getHealth() + source.getAbsorptionAmount() < health) return "caster_damaged";
            if (!vortex.protectionHookService().allows(actor, source.getLocation(), ProtectionAction.SPELL_CAST))
                return "cast_area_protected";
            var target = target();
            if (target == null) return "target_dead_or_unloaded";
            if (!attackable(target)) return "target_no_longer_eligible";
            return null;
        }

        @Override public boolean inHurtInterval() {
            var target = target();
            return target.getNoDamageTicks() > target.getMaximumNoDamageTicks() / 2;
        }

        @Override public SwordSequence.Strike strike(boolean offHand) {
            var target = target();
            var weapon = offHand ? off : main;
            var modifiers = weapon.getItemMeta().getAttributeModifiers(EquipmentSlot.HAND);
            var damage = modifiers == null || modifiers.isEmpty() ? weapon.getType().getDefaultAttributeModifiers(EquipmentSlot.HAND) : modifiers;
            double base = damage.get(Attribute.GENERIC_ATTACK_DAMAGE).stream().mapToDouble(m -> m.getAmount()).sum();
            double scaled = Math.max(1, Math.min(12, (1 + base) * art.scale()));
            double healthBefore = target.getHealth(), absorptionBefore = target.getAbsorptionAmount();
            target.damage(scaled, body());
            return new SwordSequence.Strike(Math.max(0, healthBefore - target.getHealth()),
                    Math.max(0, absorptionBefore - target.getAbsorptionAmount()));
        }

        @Override public boolean visual(boolean offHand) {
            try {
                var source = body();
                if (source == null) return false;
                if (offHand) source.swingOffHand(); else source.swingMainHand();
                var at = source.getEyeLocation().add(source.getLocation().getDirection().multiply(1));
                source.getWorld().spawnParticle(Particle.SWEEP_ATTACK, at, 1);
                return true;
            } catch (RuntimeException unavailable) {
                return false;
            }
        }

        private double step(boolean move) {
            return ((Number) nativeBody("swordStep", new Class<?>[]{UUID.class, UUID.class, boolean.class},
                    id, targetId, move)).doubleValue();
        }

        void start() {
            if (finished) return;
            resourcesSaved = true;
            try {
                if (art.strikes() == 0) {
                    String interrupted = interruption();
                    double distance = interrupted == null ? step(true) : 0;
                    finish(interrupted != null ? interrupted : distance > .05 ? "completed" : "no_safe_step", distance);
                } else {
                    task = Bukkit.getScheduler().runTaskTimer(bridge, () -> {
                        try {
                            if (sequence.tick(this)) finish(sequence.terminal(), 0);
                        } catch (RuntimeException error) {
                            unknown("damage_result_unconfirmed");
                        }
                    }, 1, 1);
                }
            } catch (RuntimeException error) {
                unknown("sword_result_unconfirmed");
            }
        }

        void unknown(String reason) {
            if (finished) return;
            finished = true;
            active.remove(id, this);
            if (task != null) task.cancel();
            complete.accept(Map.of("success", false, "changed", true, "status", "unknown",
                    "reason", reason, "skill", art.id()));
        }

        private void finish(String reason, double distance) {
            if (finished) return;
            finished = true;
            active.remove(id, this);
            if (task != null) task.cancel();
            var hits = sequence.hits();
            boolean success = reason.equals("completed");
            var out = new LinkedHashMap<String, Object>(Map.of(
                    "success", success, "changed", true, "reason", reason, "skill", art.id(),
                    "outcome", success ? "completed" : hits.isEmpty() ? "interrupted" : "partial",
                    "manaConsumed", art.mana(), "cooldownRemainingMs", remaining(id, art),
                    "targetId", targetId.toString(), "effectiveHits", hits.size(), "hits", hits));
            out.put("strikeAttempts", sequence.attempts());
            out.put("visualSwings", sequence.visualSwings());
            out.put("hurtWaitTicks", sequence.hurtWaitTicks());
            out.put("distanceMoved", distance);
            complete.accept(out);
        }
    }
}
