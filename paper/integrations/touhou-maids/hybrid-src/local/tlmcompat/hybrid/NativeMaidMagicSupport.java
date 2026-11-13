package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.combat.ManaGate;
import io.vortexcore.combat.PlayerStateGate;
import io.vortexcore.integration.protection.ProtectionAction;
import io.vortexcore.item.CustomItemDefinition;
import io.vortexcore.magic.SpellContext;
import io.vortexcore.magic.SpellTarget;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.progression.VortexAttribute;
import io.vortexcore.rpg.NpcSpellAccess;
import io.vortexcore.rpg.VortexClass;
import local.tlmcompat.core.CompatibilityException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.item.ItemStack;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/** Server-side staff casting during the existing companion guard tick. */
final class NativeMaidMagicSupport {
    private static final String STAFF = "mage_apprentice_staff";
    private static final String MAGE = "mage";
    private static final String STARTER_ISSUED = "qiandengji_mage_starter_issued";
    private static final double GUARD_RANGE = 8;
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
        if (threats.isEmpty()) return new Opportunity("following_ready", null);
        if (!PlayerStateGate.allowed(owner) || !owner.canSee(maid.getBukkitEntity()))
            return new Opportunity("paused_by_owner_or_world", null);
        var caster = (LivingEntity) maid.getBukkitEntity();
        var origin = caster.getLocation();
        var protection = vortex.protectionHookService();
        if (!protection.allows(owner, origin, ProtectionAction.SPELL_CAST))
            return new Opportunity("rpg_protected_area", null);

        var mage = vortex.classSkillService().classProfile(MAGE).filter(role -> role.archetype() == VortexClass.MAGE).orElse(null);
        if (mage == null) return new Opportunity("rpg_spell_unavailable", null);
        var spellbook = vortex.spellbookService();
        // Right-click starter skill takes precedence, then the staff's basic attack.
        var spells = new ArrayList<Cast>(2);
        for (var binding : List.of(staff.rightClickAbility(), staff.leftClickAbility())) {
            String id = binding.useActiveSpell() ? mage.starterSpellId() : binding.useSpellId();
            if (id == null || id.isBlank()) continue;
            var spell = spellbook.qiandengjiNpcSpell(id);
            if (spell == null) continue;
            double reach = Math.min(GUARD_RANGE, spell.hostileRange());
            if (reach <= 0) continue;
            boolean aimed = "ray".equals(spell.definition().targeters().getFirst().get("type"));
            spells.add(new Cast(spell, reach * reach, Math.max(binding.useCooldownMillis(), spell.definition().cooldownMillis()), aimed));
        }
        if (spells.isEmpty()) return new Opportunity("rpg_spell_unavailable", null);
        var targets = threats.stream().filter(mob -> maid.canAttack(mob))
            .filter(mob -> protection.allows(owner, mob.getBukkitEntity().getLocation(), ProtectionAction.SPELL_TARGET)).toList();
        if (targets.isEmpty()) return new Opportunity("rpg_protected_area", null);

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

        String blocked = "rpg_no_clear_target";
        for (Cast cast : spells) {
            String spellId = cast.spell.definition().id();
            Mob enemy = targets.stream().filter(mob -> maid.distanceToSqr(mob) <= cast.rangeSquared)
                .filter(mob -> !cast.aimed || clearRay(caster, (LivingEntity) mob.getBukkitEntity())).findFirst().orElse(null);
            if (enemy == null || !(enemy.getBukkitEntity() instanceof LivingEntity target)) continue;
            if (mana.cooldowns.getOrDefault(spellId, Long.MIN_VALUE) > now) {
                if (!blocked.equals("rpg_mana_low")) blocked = "rpg_spell_cooldown";
                continue;
            }
            double cost = ManaGate.cost(vortex, spellId);
            if (mana.current < cost) {
                blocked = "rpg_mana_low";
                continue;
            }
            return new Opportunity("rpg_ready", new Attempt(cast, enemy, stats, mana, cost, now));
        }
        return new Opportunity(blocked, null);
    }

    String cast(EntityMaid maid, Attempt attempt) {
        var caster = (LivingEntity) maid.getBukkitEntity();
        var target = (LivingEntity) attempt.enemy.getBukkitEntity();
        var cast = attempt.cast;
        var context = new SpellContext(UUID.randomUUID(), attempt.stats, caster.getLocation(), vortex.nexusBus(), caster);
        var hit = new SpellTarget(SpellTarget.TargetKind.ENTITY, target.getUniqueId(), target.getLocation().add(0, target.getHeight() * .5, 0));
        double damage = cast.spell.damage(context, hit);
        if (!Double.isFinite(damage) || damage <= 0) return "rpg_spell_unavailable";
        double before = target.getHealth() + target.getAbsorptionAmount();
        target.damage(damage, caster);
        attempt.mana.cooldowns.put(cast.spell.definition().id(), attempt.now + cast.cooldownMillis);
        if (!target.isDead() && target.getHealth() + target.getAbsorptionAmount() >= before) return "rpg_hit_blocked";
        attempt.mana.current -= attempt.cost;
        attempt.mana.lastSpell = cast.spell.definition().id();
        attempt.mana.lastHit = target.getUniqueId();
        attempt.mana.lastCastAt = Instant.now();
        maid.getLookControl().setLookAt(attempt.enemy);
        maid.swing(InteractionHand.MAIN_HAND);
        cast.spell.play(context, hit, caster);
        return "rpg_cast_hit";
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
        var mana = manaByMaid.get(maid.getUUID());
        if (mana != null) {
            data.addProperty("manaAtLastCombatCheck", mana.current);
            if (mana.lastCastAt != null) {
                data.addProperty("lastHitSpellId", mana.lastSpell);
                data.addProperty("lastHitTargetId", mana.lastHit.toString());
                data.addProperty("lastHitAt", mana.lastCastAt.toString());
            }
        }
        return data;
    }

    boolean hasHistory(EntityMaid maid) {
        var mana = manaByMaid.get(maid.getUUID());
        return mana != null && mana.lastCastAt != null;
    }

    private record Cast(NpcSpellAccess spell, double rangeSquared, long cooldownMillis, boolean aimed) {}

    record Attempt(Cast cast, Mob enemy, UnifiedPlayer stats, Mana mana, double cost, long now) {}

    private static final class Mana {
        final Map<String, Long> cooldowns = new HashMap<>();
        double current;
        Long observedAt;
        String lastSpell;
        UUID lastHit;
        Instant lastCastAt;

        void regenerate(long now, double maximum, double perSecond) {
            current = observedAt == null ? maximum : Math.min(maximum, current + (now - observedAt) / 1000.0 * perSecond);
            observedAt = now;
        }
    }
}
