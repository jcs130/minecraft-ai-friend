package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.api.event.MaidHurtTarget;
import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.init.InitEntities;
import com.google.gson.JsonObject;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import local.tlmcompat.hybrid.MaidGuardDecision.Mode;
import local.tlmcompat.hybrid.MaidGuardLoadout.Weapon;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.NeutralMob;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.entity.schedule.Activity;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;

/** One controller for the original companion; the fast scorer only ranks the local choices. */
final class NativeMaidCompanionSupport implements AutoCloseable {
    private static final String TASK_TAG = "qiandengji_auto_defence_task";
    private static final String SWAP_TAG = "qiandengji_guard_equipment";
    private static final String PROJECTILE_TAG = "qiandengji_guard_projectile";
    private static final NamespacedKey VORTEX_INSTANCE = new NamespacedKey("vortexrpg", "dungeon_instance_id");
    private static final long QUIET = 5_000_000_000L;
    private static final long MIN_QUERY_INTERVAL = 2_000_000_000L;
    private static final long MAX_REPLY_AGE = 1_500_000_000L;
    private final HybridMaidPlugin plugin;
    private final NativeMaidMagicSupport magic;
    private final MaidGuardDecision decision;
    private final Consumer<MaidHurtTarget.Pre> beforeMelee;
    private final Consumer<LivingIncomingDamageEvent> beforeDamage;
    private final Consumer<EntityJoinLevelEvent> onProjectile;
    private final Method dungeonCombat;
    private final Method dungeonPosition;
    // The existing brain routing admits one configured original maid.
    private Guard guard = new Guard();

    NativeMaidCompanionSupport(HybridMaidPlugin plugin) {
        this.plugin = plugin;
        magic = NativeMaidMagicSupport.create();
        dungeonCombat = dungeonAccess("mayGuardDungeonTarget", Player.class, org.bukkit.entity.Entity.class, org.bukkit.entity.Entity.class);
        dungeonPosition = dungeonAccess("companionCombatPosition", Player.class, Location.class);
        var config = plugin.getConfig();
        int port = config.getInt("companion.system-one-port", 8090);
        decision = config.getBoolean("companion.system-one", true) && port > 0 && port <= 65535
            ? new MaidGuardDecision(port) : null;
        beforeMelee = event -> {
            var maid = event.getMaid();
            if (automaticTask(maid) && !canHit(maid, event.getTarget())) {
                event.setCanceled(true);
                clearTarget(maid);
            }
        };
        beforeDamage = event -> {
            var source = event.getSource();
            boolean scopedProjectile = source.getDirectEntity() instanceof Projectile shot && shot.getTags().contains(PROJECTILE_TAG);
            if (scopedProjectile && !(source.getEntity() instanceof EntityMaid)) event.setCanceled(true);
            if (source.getEntity() instanceof EntityMaid maid && (scopedProjectile || automaticTask(maid))
                    && (!automaticTask(maid) || !canHit(maid, event.getEntity()))) event.setCanceled(true);
        };
        onProjectile = event -> {
            if (!event.getLevel().isClientSide() && event.getEntity() instanceof Projectile shot
                    && shot.getOwner() instanceof EntityMaid maid && automaticTask(maid)) shot.addTag(PROJECTILE_TAG);
        };
        NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.HIGHEST, false, beforeMelee);
        NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.HIGHEST, false, beforeDamage);
        NeoForge.EVENT_BUS.addListener(onProjectile);
    }

    @Override public void close() {
        NeoForge.EVENT_BUS.unregister(beforeMelee);
        NeoForge.EVENT_BUS.unregister(beforeDamage);
        NeoForge.EVENT_BUS.unregister(onProjectile);
        if (decision != null) decision.close();
    }

    private static boolean automaticTask(EntityMaid maid) {
        return maid.getTask() instanceof IAttackTask
            && maid.getPersistentData().getString(TASK_TAG).equals(maid.getTask().getUid().toString());
    }

    private boolean canHit(EntityMaid maid, net.minecraft.world.entity.Entity entity) {
        Player owner = owner(maid);
        return plugin.sharedDialogueEnabled(maid) && eligible(maid, owner) && !lowHealth(maid)
            && entity instanceof Mob mob && hostile(maid, owner, mob)
            && ((IAttackTask) maid.getTask()).canAttack(maid, mob);
    }

    private boolean hostile(EntityMaid maid, Player owner, Mob mob) {
        if (mob == maid || !mob.isAlive() || maid.distanceToSqr(mob) > 64) return false;
        var entity = mob.getBukkitEntity();
        if (entity.getPersistentDataContainer().has(VORTEX_INSTANCE)) return false;
        boolean siteMob = authoredMob(mob);
        if (siteMob && !currentDungeonTarget(maid, owner, mob)) return false;
        var target = mob.getTarget();
        boolean attackingPartner = target != null && (target == maid || target.getUUID().equals(maid.getOwnerUUID()));
        return MaidCompanionPolicy.hostileCandidate(attackingPartner || siteMob, mob instanceof Enemy, mob instanceof NeutralMob,
            maid.isAlliedTo(mob), !mob.isNoAi() && !mob.isInvulnerable() && !entity.hasMetadata("NPC"),
            maid.hasLineOfSight(mob), true, true);
    }

    private static boolean authoredMob(Mob mob) {
        var tags = mob.getBukkitEntity().getScoreboardTags();
        return tags.contains("afu_site_dungeon") || tags.contains("afu_dungeon_mob");
    }

    private static Method dungeonAccess(String name, Class<?>... parameters) {
        var game = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (game == null) return null;
        try {
            return Class.forName("org.afuhome.agentfriend.CompanionTravelAccess", false, game.getClass().getClassLoader())
                .getMethod(name, parameters);
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return null;
        }
    }

    boolean combatPosition(Player owner, Location position) {
        if (dungeonPosition == null) return false;
        try {
            return Boolean.TRUE.equals(dungeonPosition.invoke(null, owner, position));
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return false;
        }
    }

    boolean closingIn(EntityMaid maid) { return guard.maid == maid && guard.closingIn; }

    JsonObject provisionStaff(EntityMaid maid) {
        if (magic == null) throw new local.tlmcompat.core.CompatibilityException("rpg_unavailable", "Vortex 法杖服务未就绪。");
        return magic.provisionStaff(maid);
    }

    private boolean shouldCloseIn(EntityMaid maid, Player owner) {
        if (maid.getBukkitEntity().getLocation().distanceSquared(owner.getLocation()) <= 16) return false;
        if (MaidCompanionActions.activeGuardOrder(maid)) return true;
        if (!guardWeaponReady(maid)) return false;
        return combatPosition(owner, owner.getLocation()) || visibleAttackOnPartner(maid,owner);
    }

    boolean visibleAttackOnPartner(EntityMaid maid,Player owner){
        if (!(owner instanceof CraftPlayer craft)) return false;
        var body = craft.getHandle();
        return !body.level().getEntitiesOfClass(Mob.class, body.getBoundingBox().inflate(6), mob ->
            mob.isAlive() && mob.getTarget() == body && body.hasLineOfSight(mob)
                && !maid.isAlliedTo(mob) && !mob.isNoAi() && !mob.isInvulnerable()
                && !mob.getBukkitEntity().hasMetadata("NPC")
                && !authoredMob(mob) && !mob.getBukkitEntity().getPersistentDataContainer().has(VORTEX_INSTANCE)).isEmpty();
    }

    UUID visibleThreat(EntityMaid maid, Player owner) {
        if (!owner.getWorld().equals(maid.getBukkitEntity().getWorld()) || lowHealth(maid)) return null;
        return maid.level().getEntitiesOfClass(Mob.class, maid.getBoundingBox().inflate(8), mob -> hostile(maid,owner,mob))
            .stream().min(Comparator.comparing((Mob mob)->!attacksPartner(maid,mob)).thenComparingDouble(maid::distanceToSqr))
            .map(Mob::getUUID).orElse(null);
    }

    private boolean currentDungeonTarget(EntityMaid maid, Player owner, Mob mob) {
        if (owner == null || dungeonCombat == null) return false;
        try {
            return Boolean.TRUE.equals(dungeonCombat.invoke(null, owner, maid.getBukkitEntity(), mob.getBukkitEntity()));
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return false;
        }
    }

    private static void clearTarget(EntityMaid maid) {
        maid.getBrain().eraseMemory(MemoryModuleType.ATTACK_TARGET);
        maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        maid.getBrain().eraseMemory(MemoryModuleType.PATH);
        maid.getNavigation().stop();
    }

    private static Player owner(EntityMaid maid) {
        return maid.getOwnerUUID() == null ? null : Bukkit.getPlayer(maid.getOwnerUUID());
    }

    static IAttackTask weaponTask(EntityMaid maid) { return MaidGuardLoadout.equippedNativeTask(maid); }

    private static int partnerRange(EntityMaid maid) {
        try { return Math.max(16, NativeMaidFollowSupport.limits(maid).stopWithin() + 8); }
        catch (IllegalArgumentException invalid) { return 16; }
    }

    private boolean eligible(EntityMaid maid, Player owner) {
        int range = owner != null && combatPosition(owner, owner.getLocation()) ? Math.max(32, partnerRange(maid)) : partnerRange(maid);
        return owner != null && owner.isOnline() && !owner.isDead() && owner.getGameMode() != GameMode.SPECTATOR
            && owner.getWorld().equals(maid.getBukkitEntity().getWorld())
            && owner.getLocation().distanceSquared(maid.getBukkitEntity().getLocation()) <= range * range
            && maid.isAlive() && !maid.isRemoved() && !maid.isNoAi() && !maid.isMaidInSittingPose()
            && !maid.isHomeModeEnable() && !maid.isSleeping() && !maid.isPassenger() && maid.canBrainMoving()
            && !plugin.editingMaidInventory(maid) && !plugin.workshops().busy(maid.getUUID());
    }

    private static boolean lowHealth(EntityMaid maid) { return maid.getHealth() <= maid.getMaxHealth() * .3F; }

    void manual(EntityMaid maid) {
        if (!plugin.sharedDialogueEnabled(maid)) return;
        stopNative(maid);
        if (!plugin.editingMaidInventory(maid)) restoreHand(maid);
        clearPlan(maid);
    }

    void equipmentChanged(EntityMaid maid) {
        if (!plugin.sharedDialogueEnabled(maid)) return;
        stopNative(maid);
        if (!validSwap(maid, maid.getPersistentData().getCompound(SWAP_TAG)))
            maid.getPersistentData().remove(SWAP_TAG);
        clearPlan(maid);
    }

    private static void stopNative(EntityMaid maid) {
        if (automaticTask(maid)) {
            clearTarget(maid);
            maid.stopUsingItem();
            maid.setTask(TaskManager.getIdleTask());
        }
        maid.getPersistentData().remove(TASK_TAG);
    }

    private void clearPlan(EntityMaid maid) {
        if (guard.maid != maid) return;
        guard.pending = null;
        guard.plan = null;
        guard.requested = null;
        guard.mode = null;
        guard.target = null;
        guard.selectedAt = 0;
        guard.lastThreat = 0;
        guard.closingIn = false;
        guard.state = "following_ready";
    }

    void tick(EntityMaid maid) {
        if (!plugin.sharedDialogueEnabled(maid)) return;
        if (guard.maid != maid) {
            guard = new Guard();
            guard.maid = maid;
        }
        Player owner = owner(maid);
        guard.closingIn = false;
        boolean manualTask = !automaticTask(maid) && !maid.getTask().getUid().toString().equals(MaidCompanionActions.IDLE);
        if (manualTask || !eligible(maid, owner) || lowHealth(maid)) {
            stopNative(maid);
            if (!plugin.editingMaidInventory(maid) && !plugin.workshops().busy(maid.getUUID())) restoreHand(maid);
            clearPlan(maid);
            guard.state = manualTask ? "owner_selected_task" : lowHealth(maid) ? "recovering_near_owner" : "paused_by_owner_or_world";
            return;
        }

        long now = System.nanoTime();
        var threats = new ArrayList<>(maid.level().getEntitiesOfClass(Mob.class, maid.getBoundingBox().inflate(8), mob -> hostile(maid, owner, mob)));
        threats.sort(Comparator.comparing((Mob mob) -> !attacksPartner(maid, mob)).thenComparingDouble(maid::distanceToSqr));
        if (threats.isEmpty()) {
            if (guard.lastThreat == 0 || now - guard.lastThreat >= QUIET) {
                stopNative(maid);
                restoreHand(maid);
                clearPlan(maid);
            } else if (automaticTask(maid) && maid.getTarget() != null) clearTarget(maid);
            guard.pending = null;
            guard.plan = null;
            guard.requested = null;
            guard.target = null;
            guard.closingIn = shouldCloseIn(maid, owner);
            guard.state = guard.closingIn ? "closing_in_to_guard" : "following_ready";
            return;
        }

        guard.lastThreat = now;
        var choices = new EnumMap<Mode, Candidate>(Mode.class);
        String blocked = "following_needs_weapon";
        for (Weapon weapon : MaidGuardLoadout.weapons(maid, magic)) {
            if (choices.containsKey(weapon.mode())) continue;
            if (weapon.staff() != null) {
                var opportunity = magic.prepare(maid, owner, weapon.staff(), threats);
                if (opportunity.attempt() != null)
                    choices.put(Mode.MAGIC, new Candidate(weapon, opportunity.attempt().enemy(), opportunity.attempt()));
                else blocked = opportunity.state();
                continue;
            }
            for (Mob mob : threats) {
                if (weapon.task().canAttack(maid, mob)) {
                    choices.put(weapon.mode(), new Candidate(weapon, mob, null));
                    break;
                }
            }
        }
        if (choices.isEmpty()) {
            // Leave an equipped staff ready during its cooldown, but drop an old native target.
            stopNative(maid);
            guard.pending = null;
            guard.plan = null;
            guard.closingIn = shouldCloseIn(maid, owner);
            guard.state = guard.closingIn ? "closing_in_to_guard" : blocked;
            return;
        }

        Mob nearest = threats.getFirst();
        var scene = new Scene(owner, maid.level().dimension().location().toString(), MaidCompanionActions.revision(maid),
            nearest.getUUID(), attacksPartner(maid, nearest), band(maid, nearest), Set.copyOf(choices.keySet()));
        if (!scene.equals(guard.plan)) guard.plan = null;
        Mode previous = guard.mode;
        Mode suggested = consumeDecision(scene, choices, now);
        if (suggested != null) {
            guard.plan = scene;
            guard.mode = suggested;
            guard.decisionAt = Instant.now();
        }
        Mode selected = guard.plan != null ? guard.mode : fallback(choices, maid, previous, now);
        var candidate = choices.get(selected);
        if (previous != selected) guard.selectedAt = now;
        guard.mode = selected;
        if (!use(maid, candidate)) {
            guard.plan = null;
            guard.requested = null;
            guard.state = "guard_equipment_changed";
            return;
        }
        guard.target = candidate.target.getUUID();
        if (candidate.attempt != null) {
            stopNative(maid);
            guard.state = magic.cast(maid, candidate.attempt);
        } else {
            activateNative(maid, candidate);
            guard.state = "native_defence";
        }
        requestDecision(scene, choices, maid, nearest, now);
    }

    private static boolean attacksPartner(EntityMaid maid, Mob mob) {
        var target = mob.getTarget();
        return target != null && (target == maid || target.getUUID().equals(maid.getOwnerUUID()));
    }

    private static int band(EntityMaid maid, Mob mob) {
        if (mob.getY() - maid.getY() > 2) return 2;
        return maid.distanceToSqr(mob) <= 9 ? 0 : 1;
    }

    private Mode fallback(Map<Mode, Candidate> choices, EntityMaid maid, Mode previous, long now) {
        if (previous != null && choices.containsKey(previous) && now - guard.selectedAt < MIN_QUERY_INTERVAL) return previous;
        var melee = choices.get(Mode.MELEE);
        if (melee != null && band(maid, melee.target) == 0) return Mode.MELEE;
        if (choices.containsKey(Mode.MAGIC)) return Mode.MAGIC;
        return choices.containsKey(Mode.RANGED) ? Mode.RANGED : Mode.MELEE;
    }

    private Mode consumeDecision(Scene scene, Map<Mode, Candidate> choices, long now) {
        Pending pending = guard.pending;
        if (pending == null || !pending.result.isDone()) return null;
        guard.pending = null;
        var result = pending.result.getNow(new MaidGuardDecision.Result(null, "unavailable"));
        var candidate = result.choice() == null ? null : choices.get(result.choice());
        boolean current = pending.scene.equals(scene) && now - pending.started <= MAX_REPLY_AGE
            && candidate != null && pending.options.get(result.choice()).matches(candidate);
        guard.systemOne = current ? result.status() : result.choice() == null ? result.status() : "stale";
        if (!current) return null;
        return result.choice();
    }

    private void requestDecision(Scene scene, Map<Mode, Candidate> choices, EntityMaid maid, Mob nearest, long now) {
        if (decision == null || choices.size() < 2 || guard.pending != null || scene.equals(guard.requested)
                || now - guard.requestedAt < MIN_QUERY_INTERVAL) return;
        var state = new JsonObject();
        state.addProperty("distance", Math.round(Math.sqrt(maid.distanceToSqr(nearest)) * 10) / 10.0);
        state.addProperty("airborne", scene.band == 2);
        state.addProperty("hostileType", BuiltInRegistries.ENTITY_TYPE.getKey(nearest.getType()).toString());
        state.addProperty("targetingCompanions", scene.attackingPartner);
        state.addProperty("healthPercent", Math.round(100 * maid.getHealth() / maid.getMaxHealth()));
        state.addProperty("currentMode", guard.mode.id);
        var options = new JsonObject();
        var bindings = new EnumMap<Mode, Option>(Mode.class);
        for (var entry : choices.entrySet()) {
            Candidate choice = entry.getValue();
            var option = new JsonObject();
            option.addProperty("item", choice.weapon.itemId());
            option.addProperty("distance", Math.round(Math.sqrt(maid.distanceToSqr(choice.target)) * 10) / 10.0);
            if (entry.getKey() == Mode.RANGED) option.addProperty("ammunitionReady", true);
            if (choice.attempt != null) option.addProperty("manaCost", choice.attempt.cost());
            options.add(entry.getKey().id, option);
            bindings.put(entry.getKey(), new Option(choice.target.getUUID(), comparable(choice.weapon.item())));
        }
        state.add("ready", options);
        guard.pending = new Pending(scene, bindings, now, decision.request(state, scene.modes));
        guard.requested = scene;
        guard.requestedAt = now;
        guard.systemOne = "pending";
    }

    private boolean use(EntityMaid maid, Candidate choice) {
        Weapon weapon = choice.weapon;
        if (weapon.slot() < 0) return true;
        if (maid.isUsingItem()) {
            // Discard the previous draw before changing modes.
            maid.stopUsingItem();
        }
        if (!NativeMaidInventory.acceptsEquipmentSwap(maid, weapon.slot(), maid.getMainHandItem())
                || !ItemStack.matches(weapon.item(), maid.getMaidInv().getStackInSlot(weapon.slot()))) return false;
        var data = maid.getPersistentData();
        var backup = data.getCompound(SWAP_TAG);
        boolean originalInSlot = validSwap(maid, backup);
        boolean returningOriginal = originalInSlot && backup.getInt("slot") == weapon.slot();
        if (!originalInSlot) {
            backup = new CompoundTag();
            backup.putInt("slot", weapon.slot());
            backup.put("item", maid.getMainHandItem().saveOptional(maid.registryAccess()));
        }
        NativeMaidInventory.swapEquipment(maid, EquipmentSlot.MAINHAND, weapon.slot());
        if (weapon.task() != null && !MaidGuardLoadout.ammoReady(maid, weapon.task())) {
            NativeMaidInventory.swapEquipment(maid, EquipmentSlot.MAINHAND, weapon.slot());
            return false;
        }
        if (returningOriginal) data.remove(SWAP_TAG);
        else {
            backup.put("weapon", comparable(maid.getMainHandItem()).saveOptional(maid.registryAccess()));
            data.put(SWAP_TAG, backup);
        }
        guard.equippedAt = Instant.now();
        return true;
    }

    private static ItemStack comparable(ItemStack item) {
        ItemStack copy = item.copy();
        if (!copy.isEmpty()) {
            copy.remove(DataComponents.DAMAGE);
            copy.remove(DataComponents.CHARGED_PROJECTILES);
        }
        return copy;
    }

    private static boolean validSwap(EntityMaid maid, CompoundTag backup) {
        int slot = backup.getInt("slot");
        return backup.contains("slot") && backup.contains("weapon")
            && slot >= 0 && slot < NativeMaidInventory.capacity(maid)
            && ItemStack.matches(comparable(maid.getMainHandItem()), ItemStack.parseOptional(maid.registryAccess(), backup.getCompound("weapon")))
            && ItemStack.matches(maid.getMaidInv().getStackInSlot(slot),
                ItemStack.parseOptional(maid.registryAccess(), backup.getCompound("item")));
    }

    private static void restoreHand(EntityMaid maid) {
        var data = maid.getPersistentData();
        if (!data.contains(SWAP_TAG)) return;
        var backup = data.getCompound(SWAP_TAG);
        int slot = backup.getInt("slot");
        if (validSwap(maid, backup)
                && NativeMaidInventory.acceptsEquipmentSwap(maid, slot, maid.getMainHandItem())) {
            NativeMaidInventory.swapEquipment(maid, EquipmentSlot.MAINHAND, slot);
        }
        data.remove(SWAP_TAG);
    }

    private static void activateNative(EntityMaid maid, Candidate candidate) {
        IAttackTask task = candidate.weapon.task();
        if (maid.getTask() != task) {
            clearTarget(maid);
            maid.setTask(task);
        }
        maid.getPersistentData().putString(TASK_TAG, task.getUid().toString());
        // Native combat activities run under WORK; the owner's saved schedule is left intact.
        maid.getBrain().setSchedule(InitEntities.MAID_ALL_DAY_SCHEDULES.get());
        maid.getBrain().setActiveActivityIfPossible(Activity.WORK);
        maid.getBrain().setMemory(MemoryModuleType.ATTACK_TARGET, candidate.target);
    }

    boolean guardWeaponReady(EntityMaid maid) {
        return !MaidGuardLoadout.weapons(maid, magic).isEmpty();
    }

    JsonObject describe(EntityMaid maid) {
        var out = new JsonObject();
        boolean scoped = plugin.sharedDialogueEnabled(maid);
        boolean current = scoped && guard.maid == maid;
        out.addProperty("enabled", scoped);
        out.addProperty("state", !scoped ? "disabled" : current ? guard.state : "awaiting_native_tick");
        out.addProperty("automaticTask", maid.getPersistentData().getString(TASK_TAG));
        var armed = weaponTask(maid);
        if (armed != null) out.addProperty("equippedAttackTask", armed.getUid().toString());
        out.add("mainHand", HybridMaidPlugin.item(maid.getMainHandItem()));
        out.addProperty("partnerRange", partnerRange(maid));
        out.addProperty("explicitGuard", scoped && MaidCompanionActions.activeGuardOrder(maid));
        if (!scoped) return out;
        out.addProperty("systemOneEnabled", decision != null);
        out.addProperty("systemOneStatus", current ? guard.systemOne : "idle");
        if (current && guard.mode != null) out.addProperty("guardMode", guard.mode.id);
        if (current && guard.target != null && guard.mode != null) out.addProperty("targetId", guard.target.toString());
        if (current && guard.decisionAt != null) out.addProperty("lastSystemOneSelectionAt", guard.decisionAt.toString());
        if (current && guard.equippedAt != null) out.addProperty("lastEquipmentSwapAt", guard.equippedAt.toString());
        if (magic != null && (magic.staff(maid) != null || magic.hasHistory(maid))) out.add("rpg", magic.describe(maid));
        out.addProperty("nextStep", guardWeaponReady(maid)
            ? "随行时自动护卫，可从自己的背包换武器，攻击8格内可见敌怪和伙伴当前参战房间的怪物。请核对实际命中。"
            : "请把可用近战武器、带弹药的弓弩或 Vortex 学徒法杖放入女仆已解锁的背包槽。先查 inventory；武器可由护卫自动换上。");
        return out;
    }

    private record Candidate(Weapon weapon, Mob target, NativeMaidMagicSupport.Attempt attempt) {}
    private record Scene(Player owner, String dimension, long revision, UUID target, boolean attackingPartner, int band, Set<Mode> modes) {}
    private record Option(UUID target, ItemStack weapon) {
        boolean matches(Candidate candidate) {
            return target.equals(candidate.target.getUUID()) && ItemStack.matches(weapon, comparable(candidate.weapon.item()));
        }
    }
    private record Pending(Scene scene, Map<Mode, Option> options, long started, CompletableFuture<MaidGuardDecision.Result> result) {}

    private static final class Guard {
        EntityMaid maid;
        UUID target;
        Mode mode;
        Pending pending;
        Scene plan, requested;
        long lastThreat, selectedAt, requestedAt;
        Instant decisionAt, equippedAt;
        boolean closingIn;
        String state = "awaiting_native_tick", systemOne = "idle";
    }
}
