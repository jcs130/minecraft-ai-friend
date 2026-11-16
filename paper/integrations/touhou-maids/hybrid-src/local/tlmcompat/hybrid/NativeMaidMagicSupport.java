package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.combat.ManaGate;
import io.vortexcore.combat.PartySpellTargets;
import io.vortexcore.combat.PlayerStateGate;
import io.vortexcore.integration.protection.ProtectionAction;
import io.vortexcore.item.CustomItemDefinition;
import io.vortexcore.magic.SpellContext;
import io.vortexcore.magic.SpellTarget;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.progression.VortexAttribute;
import io.vortexcore.rpg.VortexClass;
import local.tlmcompat.core.CompatibilityException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.item.ItemStack;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityRegainHealthEvent;

/** Server-side staff casting during the existing companion guard tick. */
final class NativeMaidMagicSupport {
    private static final String STAFF = "mage_apprentice_staff";
    private static final String MAGE = "mage";
    private static final String STARTER_ISSUED = "qiandengji_mage_starter_issued";
    private static final double GUARD_RANGE = 8;
    private static final long STAFF_INTERVAL = 650;
    private final VortexCorePlugin vortex;
    private final Map<UUID, Mana> manaByMaid = new HashMap<>();

    private NativeMaidMagicSupport(VortexCorePlugin vortex) {
        this.vortex = vortex;
    }

    static NativeMaidMagicSupport create() {
        var plugin = Bukkit.getPluginManager().getPlugin("VortexRPG");
        if (plugin == null || !plugin.isEnabled()) return null;
        try {
            plugin.getClass().getMethod("spellbookService").getReturnType().getMethod("qiandengjiNpcSpell", String.class);
            return plugin instanceof VortexCorePlugin vortex ? new NativeMaidMagicSupport(vortex) : null;
        } catch (ReflectiveOperationException | LinkageError unavailable) {
            return null;
        }
    }

    CustomItemDefinition staff(EntityMaid maid) {
        return staff(maid.getMainHandItem());
    }

    CustomItemDefinition staff(ItemStack stack) {
        if (!vortex.isEnabled() || stack.isEmpty()) return null;
        var hand = CraftItemStack.asCraftMirror(stack);
        var items = vortex.qiandengjiItems();
        if (!STAFF.equals(items.resolveId(hand))) return null;
        return items.definition(STAFF).filter(item -> item.material() == hand.getType()
            && MAGE.equals(item.requiredClassId())).orElse(null);
    }

    CustomItemDefinition availableStaff(EntityMaid maid) {
        var equipped = staff(maid);
        if (equipped != null) return equipped;
        for (int slot = 0; slot < NativeMaidInventory.capacity(maid); slot++) {
            var packed = staff(maid.getMaidInv().getStackInSlot(slot));
            if (packed != null) return packed;
        }
        return null;
    }

    JsonObject provisionStaff(EntityMaid maid) {
        var inventory = maid.getMaidInv();
        var out = new JsonObject();
        out.addProperty("maidId", maid.getUUID().toString());
        out.addProperty("staffId", STAFF);
        if (staff(maid.getMainHandItem()) != null || staff(maid.getOffhandItem()) != null) {
            out.addProperty("status", "already_equipped");
            return out;
        }
        int free = -1;
        for (int slot = 0; slot < inventory.getSlots(); slot++) {
            var item = inventory.getStackInSlot(slot);
            if (staff(item) != null) {
                out.addProperty("status", "already_present");
                out.addProperty("slot", slot);
                return out;
            }
            if (free < 0 && item.isEmpty() && slot < NativeMaidInventory.capacity(maid)) free = slot;
        }
        if (maid.getPersistentData().getBoolean(STARTER_ISSUED)) {
            throw new CompatibilityException("starter_already_issued", "已有初始法杖发放记录。请从个人箱或商城补充法杖。");
        }
        if (free < 0) throw new CompatibilityException("maid_inventory_full", "女仆已解锁背包没有空位。请先整理背包。");
        var item = CraftItemStack.asNMSCopy(vortex.qiandengjiItems().create(STAFF, 1));
        if (staff(item) == null || !inventory.isItemValid(free, item)) {
            throw new CompatibilityException("rpg_item_unavailable", "当前 Vortex 配置未提供可用学徒法杖。");
        }
        inventory.setStackInSlot(free, item);
        maid.getPersistentData().putBoolean(STARTER_ISSUED, true);
        out.addProperty("status", "issued");
        out.addProperty("slot", free);
        return out;
    }

    record Opportunity(String state, Attempt attempt) {}

    Opportunity prepare(EntityMaid maid, Player owner, CustomItemDefinition staff, List<Mob> threats) {
        return prepare(maid, owner, staff, threats, null);
    }

    Opportunity prepare(EntityMaid maid, Player owner, CustomItemDefinition staff, List<Mob> threats, String requested) {
        if (threats.isEmpty() && requested == null) return new Opportunity("following_ready", null);
        if (!PlayerStateGate.allowed(owner) || !owner.canSee(maid.getBukkitEntity()))
            return new Opportunity("paused_by_owner_or_world", null);
        var caster = (LivingEntity) maid.getBukkitEntity();
        var origin = caster.getLocation();
        var protection = vortex.protectionHookService();
        if (!protection.allows(owner, origin, ProtectionAction.SPELL_CAST))
            return new Opportunity("rpg_protected_area", null);

        var mage = vortex.classSkillService().classProfile(MAGE).filter(role -> role.archetype() == VortexClass.MAGE).orElse(null);
        if (mage == null) return new Opportunity("rpg_spell_unavailable", null);
        var spells = spells(staff, mage.starterSpellId()).stream()
                .filter(spell -> requested == null || requested.equals(spell.id())).toList();
        if (spells.isEmpty()) return new Opportunity("rpg_spell_unavailable", null);
        var targets = threats.stream().filter(maid::canAttack)
            .filter(mob -> protection.allows(owner, mob.getBukkitEntity().getLocation(), ProtectionAction.SPELL_TARGET)).toList();

        // This stat snapshot is local to the cast. The RPG player repository only sees players.
        var stats = new UnifiedPlayer(maid.getUUID(), maid.getName().getString());
        mage.baseStats().forEach((attribute, base) -> stats.stat(attribute).setBase(base));
        staff.attributeBonuses().forEach((attribute, bonus) -> stats.stat(attribute).addFlat(bonus));
        staff.attributeMultipliers().forEach((attribute, bonus) -> stats.stat(attribute).addMultiplier(bonus));
        double wisdom = stats.stat(VortexAttribute.WISDOM).current();
        double intelligence = stats.stat(VortexAttribute.INTELLIGENCE).current();
        long now = System.nanoTime() / 1_000_000L;
        var mana = manaByMaid.computeIfAbsent(maid.getUUID(), ignored -> new Mana());
        mana.regenerate(now, Math.max(0, 20 + (wisdom + intelligence) * 4), Math.max(0, .5 + wisdom * .075));
        if (now < mana.nextStaffCast) return new Opportunity("rpg_spell_cooldown", null);

        String blocked = "rpg_no_clear_target";
        int level = ownerLevel(owner);
        Attempt best = null;
        for (var spell : spells) {
            if (spell.minLevel() > level) {
                if (requested != null) return new Opportunity("rpg_spell_level_required", null);
                continue;
            }
            var enemies = targets.stream().filter(mob -> maid.distanceToSqr(mob) <= spell.range() * spell.range())
                .filter(mob -> !spell.aimed() || clearRay(caster, (LivingEntity) mob.getBukkitEntity()))
                .limit(spell.targetLimit()).toList();
            var friends = healTargets(owner, caster, spell.allyRange());
            if (enemies.isEmpty() && (requested == null || friends.isEmpty())) continue;
            int priority = preference(spell, enemies, friends, requested != null);
            if (priority < 0) continue;
            if (mana.cooldowns.getOrDefault(spell.id(), Long.MIN_VALUE) > now) {
                if (!blocked.equals("rpg_mana_low")) blocked = "rpg_spell_cooldown";
                continue;
            }
            double cost = ManaGate.cost(vortex, spell.id());
            if (!Double.isFinite(cost) || cost < 0) continue;
            if (mana.current < cost) {
                blocked = "rpg_mana_low";
                continue;
            }
            if (best == null || priority > best.priority) {
                best = new Attempt(spell, enemies, friends, owner, stats, mana, cost, now, priority);
            }
        }
        if (best != null) return new Opportunity("rpg_ready", best);
        if (!threats.isEmpty() && targets.isEmpty() && blocked.equals("rpg_no_clear_target")) blocked = "rpg_protected_area";
        return new Opportunity(blocked, null);
    }

    private List<MaidVortexSpell> spells(CustomItemDefinition staff, String starter) {
        var spellbook = vortex.spellbookService();
        var ids = new LinkedHashMap<String, Long>();
        for (var binding : List.of(staff.rightClickAbility(), staff.leftClickAbility())) {
            String id = binding.useActiveSpell() ? starter : binding.useSpellId();
            if (id != null && !id.isBlank()) ids.merge(id, binding.useCooldownMillis(), Math::max);
        }
        // Additional offensive/support spells are read from the same live mage spellbook as players.
        spellbook.editorSpellSnapshots().stream().filter(row -> row.requiredClasses().contains(MAGE))
                .limit(32).forEach(row -> ids.putIfAbsent(row.id(), 0L));
        var spells = new ArrayList<MaidVortexSpell>();
        ids.forEach((id, binding) -> {
            var spell = MaidVortexSpell.from(spellbook.qiandengjiNpcSpell(id), GUARD_RANGE, binding);
            if (spell != null) spells.add(spell);
        });
        return spells;
    }

    private static int preference(MaidVortexSpell spell, List<Mob> enemies, List<Player> friends, boolean requested) {
        if (requested) return 0;
        if (spell.heal() != null || spell.targetLimit() > 1) return enemies.size() > 1 || !friends.isEmpty() ? 3 : -1;
        if (spell.bleed() != null) return !enemies.isEmpty() && enemies.getFirst().getHealth() >= 12 ? 2 : -1;
        return 1;
    }

    private int ownerLevel(Player owner) {
        if (owner == null) return 1;
        return vortex.playerProfileService().profile(owner.getUniqueId()).map(UnifiedPlayer::level).orElse(1);
    }

    private List<Player> healTargets(Player owner, LivingEntity caster, double range) {
        if (range <= 0) return List.of();
        var possible = new ArrayList<Player>();
        possible.add(owner);
        double ownerDistance = owner.getLocation().distance(caster.getLocation());
        possible.addAll(PartySpellTargets.allies(owner, ownerDistance + range));
        return possible.stream().filter(ally -> canHeal(owner, caster, ally, range)).limit(5).toList();
    }

    private boolean canHeal(Player owner, LivingEntity caster, Player ally, double range) {
        return ally.isOnline() && PlayerStateGate.allowed(ally)
                && ally.getWorld().equals(caster.getWorld()) && !ally.isDead()
                && ally.getLocation().distanceSquared(caster.getLocation()) <= range * range
                && caster.hasLineOfSight(ally) && owner.canSee(ally)
                && ally.getAttribute(Attribute.GENERIC_MAX_HEALTH) != null
                && ally.getHealth() < ally.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue()
                && vortex.protectionHookService().allows(owner, ally.getLocation(), ProtectionAction.SPELL_TARGET);
    }

    record Result(String state, String spellId, List<UUID> hits, List<UUID> healed, double mana) {
        boolean applied() { return !hits.isEmpty() || !healed.isEmpty(); }
        JsonObject describe() {
            var data = new JsonObject();
            data.addProperty("state", state);
            data.addProperty("spellId", spellId);
            data.addProperty("manaRemaining", mana);
            data.addProperty("effectsApplied", applied());
            data.add("hitTargetIds", jsonIds(hits));
            data.add("healedTargetIds", jsonIds(healed));
            return data;
        }
    }

    Result cast(EntityMaid maid, Attempt attempt, Predicate<Mob> hostile) {
        var caster = (LivingEntity) maid.getBukkitEntity();
        var spell = attempt.spell;
        var context = new SpellContext(UUID.randomUUID(), attempt.stats, caster.getLocation(), vortex.nexusBus(), caster);
        var mana = attempt.mana;
        mana.cooldowns.put(spell.id(), attempt.now + spell.cooldown());
        mana.nextStaffCast = attempt.now + STAFF_INTERVAL;
        mana.current -= attempt.cost;
        var hits = new ArrayList<UUID>();
        var healed = new ArrayList<UUID>();
        SpellTarget impact = null;
        for (Mob enemy : attempt.enemies) {
            if (!hostile.test(enemy) || maid.distanceToSqr(enemy) > spell.range() * spell.range()) continue;
            var target = (LivingEntity) enemy.getBukkitEntity();
            if (!vortex.protectionHookService().allows(attempt.owner, target.getLocation(), ProtectionAction.SPELL_TARGET)
                    || spell.aimed() && !clearRay(caster, target)) continue;
            var hit = target(target);
            if (!spell.permits(context, hit)) continue;
            double damage = spell.damage().amount(context);
            if (!Double.isFinite(damage) || damage <= 0) continue;
            double before = target.getHealth() + target.getAbsorptionAmount();
            target.damage(damage, caster);
            if (!target.isDead() && target.getHealth() + target.getAbsorptionAmount() >= before) continue;
            hits.add(target.getUniqueId());
            if (impact == null) impact = hit;
            if (spell.bleed() != null && !target.isDead() && hostile.test(enemy)) spell.bleed().apply(context, hit);
        }
        var eligibleFriends = attempt.friends.isEmpty() ? List.<Player>of() : healTargets(attempt.owner, caster, spell.allyRange());
        for (Player ally : attempt.friends) {
            if (!eligibleFriends.contains(ally)) continue;
            if (!canHeal(attempt.owner, caster, ally, spell.allyRange())) continue;
            var healTarget = target(ally);
            if (!spell.permits(context, healTarget) || !heal(context, spell, attempt.owner, caster, ally)) continue;
            healed.add(ally.getUniqueId());
            if (impact == null) impact = healTarget;
        }
        if (impact == null) {
            mana.current += attempt.cost;
            return new Result("rpg_hit_blocked", spell.id(), List.of(), List.of(), mana.current);
        }
        var now = Instant.now();
        if (!hits.isEmpty()) {
            mana.lastHit = hits.getFirst();
            mana.lastHitSpell = spell.id();
            mana.lastHitAt = now;
        }
        String state = hits.isEmpty() ? "rpg_cast_healed" : "rpg_cast_hit";
        mana.lastCast = new Result(state, spell.id(), List.copyOf(hits), List.copyOf(healed), mana.current);
        mana.lastCastAt = now;
        if (attempt.enemy() != null) maid.getLookControl().setLookAt(attempt.enemy());
        maid.swing(InteractionHand.MAIN_HAND);
        spell.play(context, impact, caster);
        return mana.lastCast;
    }

    private boolean heal(SpellContext context, MaidVortexSpell spell, Player owner, LivingEntity caster, Player ally) {
        double amount = spell.heal().amount(context);
        if (!Double.isFinite(amount) || amount <= 0) return false;
        var event = new EntityRegainHealthEvent(ally, amount, EntityRegainHealthEvent.RegainReason.MAGIC);
        Bukkit.getPluginManager().callEvent(event);
        if (event.isCancelled() || !Double.isFinite(event.getAmount()) || event.getAmount() <= 0
                || !canHeal(owner, caster, ally, spell.allyRange())) return false;
        double before = ally.getHealth();
        ally.setHealth(Math.min(ally.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue(), before + event.getAmount()));
        return ally.getHealth() > before;
    }

    private static SpellTarget target(LivingEntity target) {
        return new SpellTarget(SpellTarget.TargetKind.ENTITY, target.getUniqueId(),
                target.getLocation().add(0, target.getHeight() * .5, 0));
    }

    private static JsonArray jsonIds(List<UUID> ids) {
        var values = new JsonArray();
        ids.forEach(id -> values.add(id.toString()));
        return values;
    }

    private static boolean clearRay(LivingEntity caster, LivingEntity target) {
        var eye = caster.getEyeLocation();
        var direction = target.getBoundingBox().getCenter().subtract(eye.toVector());
        if (direction.lengthSquared() < 1.0E-6) return true;
        var first = caster.getWorld().rayTraceEntities(eye, direction, direction.length(), .3,
            entity -> entity instanceof LivingEntity living && living.isValid() && !living.isDead() && !entity.equals(caster));
        return first != null && target.equals(first.getHitEntity());
    }

    JsonObject describe(EntityMaid maid) {
        var data = new JsonObject();
        data.addProperty("classId", MAGE);
        data.addProperty("staffId", STAFF);
        var owner = Bukkit.getPlayer(maid.getOwnerUUID());
        int level = ownerLevel(owner);
        data.addProperty("spellLevel", level);
        data.addProperty("spellLevelSource", "owner_vortex_level");
        data.addProperty("staffEquipped", staff(maid) != null);
        var choices = new JsonArray();
        var staff = availableStaff(maid);
        data.addProperty("staffAvailable", staff != null);
        var mana = manaByMaid.get(maid.getUUID());
        long time = System.nanoTime() / 1_000_000L;
        var mage = vortex.classSkillService().classProfile(MAGE).orElse(null);
        if (staff != null && mage != null) {
            for (var spell : spells(staff, mage.starterSpellId())) {
                var row = new JsonObject();
                row.addProperty("id", spell.id());
                row.addProperty("name", spell.nativeSpell().definition().displayName());
                row.addProperty("minLevel", spell.minLevel());
                row.addProperty("unlocked", level >= spell.minLevel());
                row.addProperty("manaCost", ManaGate.cost(vortex, spell.id()));
                row.addProperty("cooldownMillis", spell.cooldown());
                row.addProperty("cooldownRemainingMillis", mana == null ? 0 :
                        Math.max(0, Math.max(mana.nextStaffCast, mana.cooldowns.getOrDefault(spell.id(), time)) - time));
                row.addProperty("hostileRange", spell.range());
                row.addProperty("maxHostileTargets", spell.targetLimit());
                row.addProperty("allyRange", spell.allyRange());
                row.addProperty("use", spell.use());
                choices.add(row);
            }
        }
        data.add("spells", choices);
        data.addProperty("nextCommand", "/qdmaid cast " + maid.getUUID() + " <requestId> <spellId>");
        if (mana != null) {
            data.addProperty("manaAtLastCombatCheck", mana.current);
            if (mana.lastCastAt != null) {
                data.addProperty("lastCastAt", mana.lastCastAt.toString());
                data.add("lastCast", mana.lastCast.describe());
            }
            if (mana.lastHitAt != null) {
                data.addProperty("lastHitSpellId", mana.lastHitSpell);
                data.addProperty("lastHitTargetId", mana.lastHit.toString());
                data.addProperty("lastHitAt", mana.lastHitAt.toString());
            }
        }
        return data;
    }

    record Attempt(MaidVortexSpell spell, List<Mob> enemies, List<Player> friends, Player owner,
                   UnifiedPlayer stats, Mana mana, double cost, long now, int priority) {
        Mob enemy() { return enemies.isEmpty() ? null : enemies.getFirst(); }
    }

    private static final class Mana {
        final Map<String, Long> cooldowns = new HashMap<>();
        double current;
        Long observedAt;
        long nextStaffCast = Long.MIN_VALUE;
        String lastHitSpell;
        UUID lastHit;
        Instant lastHitAt;
        Result lastCast;
        Instant lastCastAt;

        void regenerate(long now, double maximum, double perSecond) {
            current = observedAt == null ? maximum : Math.min(maximum, current + (now - observedAt) / 1000.0 * perSecond);
            observedAt = now;
        }
    }
}
