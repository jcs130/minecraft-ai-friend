package org.qiandengji.vortex;

import io.vortexcore.VortexCorePlugin;
import io.vortexcore.persistence.PlayerDataRepository;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.VortexClass;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import org.bukkit.*;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;

/** Only starts in a new loopback QA server with an explicit marker, and uses generated profiles. */
public final class SwordsmanPaperFixture extends JavaPlugin implements Listener {
    private static final UUID SWORD = UUID.fromString("26000000-0000-4000-8000-000000000280");
    private static final UUID RANGER = UUID.fromString("26000000-0000-4000-8000-000000000281");
    private final List<String> passed = new ArrayList<>();
    private VortexCorePlugin vortex;
    private Location arena;
    private UUID protectedTarget;
    private PlayerDataRepository repository;

    @Override public void onEnable() {
        if (!Files.isRegularFile(java.nio.file.Path.of(".swordsman-isolated")) || !"127.0.0.1".equals(Bukkit.getIp())) {
            throw new IllegalStateException("loopback fixture required");
        }
        vortex = (VortexCorePlugin) Bukkit.getPluginManager().getPlugin("VortexRPG");
        repository = new PlayerDataRepository(getLogger(), getDataFolder().toPath().resolve("profiles"), Duration.ofMinutes(3));
        Bukkit.getPluginManager().registerEvents(this, this);
        Bukkit.getScheduler().runTaskLater(this, () -> {
            boolean cold = Files.isRegularFile(getDataFolder().toPath().resolve("initial-pass"));
            try {
                (cold ? cold() : fresh()).whenComplete((ignored, error) ->
                        Bukkit.getScheduler().runTask(this, () -> report(cold, error)));
            } catch (Throwable error) {
                report(cold, error);
            }
        }, 20);
    }

    @Override public void onDisable() {
        if (repository != null) repository.close();
    }

    @EventHandler
    public void protection(EntityDamageByEntityEvent event) {
        if (event.getEntity().getUniqueId().equals(protectedTarget)) event.setCancelled(true);
    }

    private void check(String name, boolean condition) {
        if (!condition) throw new IllegalStateException(name);
        passed.add(name);
        getLogger().info("SWORD_CHECK " + name);
    }

    private void report(boolean cold, Throwable error) {
        if (error != null) getLogger().log(java.util.logging.Level.SEVERE, "SWORD_FAIL", error);
        else {
            getLogger().info("SWORD_PASS checks=" + passed.size() + " cold=" + cold);
            if (!cold) {
                try { Files.writeString(getDataFolder().toPath().resolve("initial-pass"), "passed"); }
                catch (java.io.IOException e) { getLogger().log(java.util.logging.Level.SEVERE, "SWORD_FAIL", e); }
            }
        }
        Bukkit.shutdown();
    }

    private CompletableFuture<Void> fresh() {
        var classes = vortex.classSkillService();
        check("seven_native_archetypes", VortexClass.values().length == 7 && VortexClass.SWORDSMAN.ordinal() == 6
                && classes.registeredClassIds().contains("swordsman"));
        check("sword_base_dexterity_over_strength", VortexClass.SWORDSMAN.baseStats().get(io.vortexcore.progression.VortexAttribute.DEXTERITY)
                > VortexClass.SWORDSMAN.baseStats().get(io.vortexcore.progression.VortexAttribute.STRENGTH));
        arena = Bukkit.getWorlds().getFirst().getSpawnLocation().add(0, 8, 0);
        var body = spawn(0);
        var actor = actor(body);
        var profile = new UnifiedPlayer(SWORD, "qa_swordsman");
        var old = new UnifiedPlayer(RANGER, "qa_ranger");
        old.putMetadata("rpg.class", "ranger");
        old.putMetadata("rpg.unlocked_skills", "eagle_eye");
        old.putMetadata("rpg.skill_points", "3");
        old.putMetadata("qa_preserved_marker", "old_identity");
        var oldMetadata = old.metadata();
        check("ranger_has_original_tree", classes.selectedClass(old).orElseThrow() == VortexClass.RANGER
                && classes.skillsFor(old).size() == 3 && classes.availableSpellIds(old).contains("hunter_mark"));
        check("native_cast_cannot_bypass_resident_cli", vortex.spellbookService().cast(actor, profile, "starburst_stream").isCompletedExceptionally());

        return classes.chooseClass(actor, profile, "swordsman").thenCompose(ignored -> {
            check("native_choose_on_unselected_profile", classes.selectedClass(profile).orElseThrow() == VortexClass.SWORDSMAN
                    && profile.uniqueId().equals(SWORD));
            check("starter_sword_step", classes.availableSpellIds(profile).equals(Set.of("sword_step")));
            check("own_tree_only", classes.skillsFor(profile).stream().map(node -> node.id()).toList()
                    .equals(List.of("horizontal_square", "dual_blades", "starburst_stream")));
            return classes.unlockSkill(actor, profile, "horizontal_square");
        }).thenCompose(result -> {
            check("level_gate_and_no_debit", !result.success() && classes.unspentSkillPoints(profile) == 1);
            var curve = vortex.playerProfileService().experienceCurve();
            var progression = profile.grantExperience(curve.totalExperienceToReach(8), curve);
            classes.grantSkillPoints(actor, profile, progression.levelsGained());
            check("native_curve_and_skill_points", profile.level() == 8 && classes.unspentSkillPoints(profile) == 8);
            return classes.unlockSkill(actor, profile, "starburst_stream");
        }).thenCompose(result -> {
            check("starburst_prerequisites", !result.success() && classes.unspentSkillPoints(profile) == 8);
            return classes.unlockSkill(actor, profile, "horizontal_square");
        }).thenCompose(result -> {
            check("horizontal_learned", result.success() && classes.unspentSkillPoints(profile) == 7);
            return classes.unlockSkill(actor, profile, "dual_blades");
        }).thenCompose(result -> {
            check("specialization_learned", result.success() && classes.unspentSkillPoints(profile) == 5);
            return classes.unlockSkill(actor, profile, "starburst_stream");
        }).thenCompose(result -> {
            check("starburst_learned", result.success() && classes.unspentSkillPoints(profile) == 3
                    && classes.availableSpellIds(profile).contains("starburst_stream"));
            return classes.unlockSkill(actor, profile, "starburst_stream");
        }).thenCompose(result -> {
            check("duplicate_learning_uncharged", !result.success() && classes.unspentSkillPoints(profile) == 3);
            return classes.unlockSkill(actor, old, "horizontal_square");
        }).thenCompose(result -> {
            check("ranger_rejects_sword_skill", !result.success() && oldMetadata.equals(old.metadata()));
            return classes.chooseClass(actor, old, "swordsman").handle((ignored, error) -> {
                check("existing_ranger_cannot_be_reselected", error != null && oldMetadata.equals(old.metadata()));
                return null;
            });
        }).thenCompose(ignored -> {
            long deadline = System.currentTimeMillis() + 45_000;
            vortex.spellbookService().qiandengjiSetSwordDeadline(actor.getUniqueId(), "starburst_stream", deadline);
            profile.putMetadata("qiandengji.swordsman.ready.starburst_stream", Long.toString(deadline));
            profile.putMetadata("qiandengji.swordsman.manaAfter", "12.5");
            return repository.saveAtomically(profile.toSnapshot()).thenCompose(saved -> repository.saveAtomically(old.toSnapshot()));
        }).thenCompose(saved -> onMain(() -> damageChecks(body)));
    }

    private CompletableFuture<Void> cold() {
        return repository.loadPlayer(SWORD).thenCombine(repository.loadPlayer(RANGER), (sword, ranger) -> {
            var classes = vortex.classSkillService();
            var profile = new UnifiedPlayer(SWORD, "qa_swordsman");
            profile.applySnapshot(sword);
            check("cold_profile_level_and_points", profile.level() == 8 && classes.unspentSkillPoints(profile) == 3);
            check("cold_skill_and_class", classes.selectedClass(profile).orElseThrow() == VortexClass.SWORDSMAN
                    && classes.availableSpellIds(profile).contains("starburst_stream"));
            check("cold_resource_checkpoint_stored_in_native_profile", profile.metadata().get("qiandengji.swordsman.manaAfter").equals("12.5")
                    && Long.parseLong(profile.metadata().get("qiandengji.swordsman.ready.starburst_stream")) > 0);
            var old = new UnifiedPlayer(RANGER, "qa_ranger");
            old.applySnapshot(ranger);
            check("cold_ranger_unchanged", classes.selectedClass(old).orElseThrow() == VortexClass.RANGER
                    && classes.unspentSkillPoints(old) == 3 && old.metadata().get("qa_preserved_marker").equals("old_identity"));
            return null;
        });
    }

    private CompletableFuture<Void> damageChecks(LivingEntity source) {
        var target = spawn(2);
        var full = new SwordSequence(16, 384, true);
        return runCombo(full, source, target, false).thenCompose(ignored -> {
            check("sixteen_actual_health_losses", full.hits().size() == 16 && target.getHealth() == 160);
            check("native_hurt_window_waited", full.hurtWaitTicks() >= 135 && full.attempts() == 16);
            check("alternating_damage_and_separate_visual_count", full.hits().get(1).get("hand").equals("offhand")
                    && full.hits().get(1).get("healthLost").equals(3.0) && full.visualSwings() == 0);
            var protectedMob = spawn(3);
            protectedTarget = protectedMob.getUniqueId();
            var blocked = new SwordSequence(16, 384, true);
            return runCombo(blocked, source, protectedMob, false).thenRun(() ->
                    check("bukkit_cancelled_hit_zero_damage_separate_swing", blocked.hits().isEmpty() && blocked.visualSwings() == 1
                            && protectedMob.getHealth() == 200 && blocked.terminal().equals("damage_not_applied")));
        }).thenCompose(ignored -> {
            var interrupted = new SwordSequence(16, 384, true);
            return runCombo(interrupted, source, spawn(4), true).thenRun(() ->
                    check("dead_source_leaves_only_applied_hit", interrupted.hits().size() == 1
                            && interrupted.attempts() == 1 && interrupted.terminal().equals("caster_dead_or_unloaded")));
        });
    }

    private CompletableFuture<Void> runCombo(SwordSequence sequence, LivingEntity source, LivingEntity target, boolean killAfterFirst) {
        var future = new CompletableFuture<Void>();
        new BukkitRunnable() {
            @Override public void run() {
                try {
                    var body = new SwordSequence.Body() {
                        public String interruption() { return source.isDead() ? "caster_dead_or_unloaded" : null; }
                        public boolean inHurtInterval() { return target.getNoDamageTicks() > target.getMaximumNoDamageTicks() / 2; }
                        public SwordSequence.Strike strike(boolean offHand) {
                            double before = target.getHealth();
                            target.damage(offHand ? 3 : 2, source);
                            if (killAfterFirst) source.setHealth(0);
                            return new SwordSequence.Strike(before - target.getHealth(), 0);
                        }
                        public boolean visual(boolean offHand) { return target.getUniqueId().equals(protectedTarget); }
                    };
                    if (sequence.tick(body)) { cancel(); future.complete(null); }
                } catch (Throwable error) { cancel(); future.completeExceptionally(error); }
            }
        }.runTaskTimer(this, 1, 1);
        return future;
    }

    private LivingEntity spawn(int offset) {
        var entity = arena.getWorld().spawn(arena.clone().add(offset, 0, 0), Zombie.class);
        entity.setAI(false);
        entity.setGravity(false);
        entity.setSilent(true);
        entity.setShouldBurnInDay(false);
        entity.getEquipment().clear();
        entity.getAttribute(Attribute.GENERIC_ARMOR).setBaseValue(0);
        entity.getAttribute(Attribute.GENERIC_MAX_HEALTH).setBaseValue(200);
        entity.setHealth(200);
        return entity;
    }

    private Player actor(LivingEntity body) {
        return (Player) Proxy.newProxyInstance(getClassLoader(), new Class<?>[]{Player.class}, (proxy, method, args) -> {
            return switch (method.getName()) {
                case "getUniqueId" -> body.getUniqueId();
                case "getName" -> "qa_swordsman";
                case "isOnline" -> body.isValid();
                case "hasPermission", "isOp" -> false;
                case "sendMessage", "sendActionBar", "playSound", "sendTitle" -> null;
                default -> method.getDeclaringClass().isInstance(body) ? method.invoke(body, args) : null;
            };
        });
    }

    private CompletableFuture<Void> onMain(java.util.function.Supplier<CompletableFuture<Void>> supplier) {
        var result = new CompletableFuture<Void>();
        Bukkit.getScheduler().runTask(this, () -> {
            try {
                supplier.get().whenComplete((ignored, error) -> {
                    if (error == null) result.complete(null);
                    else result.completeExceptionally(error);
                });
            } catch (Throwable error) { result.completeExceptionally(error); }
        });
        return result;
    }
}
