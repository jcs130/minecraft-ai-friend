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
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.NeutralMob;
import net.minecraft.world.entity.monster.Enemy;
import org.bukkit.Bukkit;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/** Server-side staff casting during the existing companion guard tick. */
final class NativeMaidMagicSupport {
    private static final String STAFF = "mage_apprentice_staff";
    private static final String MAGE = "mage";
    private static final double GUARD_RANGE = 8;
    private final VortexCorePlugin vortex;
    private final NamespacedKey vortexEncounter;
    private final Map<UUID, Mana> manaByMaid = new HashMap<>();

    private NativeMaidMagicSupport(VortexCorePlugin vortex) {
        this.vortex = vortex;
        vortexEncounter = new NamespacedKey(vortex, "dungeon_instance_id");
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
        if (!vortex.isEnabled() || !(maid.getBukkitEntity() instanceof LivingEntity caster)
                || caster.getEquipment() == null) return null;
        var hand = caster.getEquipment().getItemInMainHand();
        var items = vortex.qiandengjiItems();
        if (!STAFF.equals(items.resolveId(hand))) return null;
        return items.definition(STAFF).filter(item -> item.material() == hand.getType()
            && MAGE.equals(item.requiredClassId())).orElse(null);
    }

    String defend(EntityMaid maid, Player owner, CustomItemDefinition staff) {
        if (!PlayerStateGate.allowed(owner) || !owner.canSee(maid.getBukkitEntity())) return "paused_by_owner_or_world";
        var caster = (LivingEntity) maid.getBukkitEntity();
        var origin = caster.getLocation();
        var protection = vortex.protectionHookService();
        if (!protection.allows(owner, origin, ProtectionAction.SPELL_CAST)) return "rpg_protected_area";

        var mage = vortex.classSkillService().classProfile(MAGE).filter(role -> role.archetype() == VortexClass.MAGE).orElse(null);
        if (mage == null) return "rpg_spell_unavailable";
        var spellbook = vortex.spellbookService();
        double range = 0;
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
            range = Math.max(range, reach);
        }
        if (spells.isEmpty()) return "rpg_spell_unavailable";
        double rangeSquared = range * range;
        var targets = maid.level().getEntitiesOfClass(Mob.class, maid.getBoundingBox().inflate(range), mob ->
            mob != maid && mob.isAlive() && maid.distanceToSqr(mob) <= rangeSquared && hostile(maid, mob, owner)
                && protection.allows(owner, mob.getBukkitEntity().getLocation(), ProtectionAction.SPELL_TARGET));
        if (targets.isEmpty()) return "following_ready";
        targets.sort(java.util.Comparator.comparingDouble(maid::distanceToSqr));

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
            var context = new SpellContext(UUID.randomUUID(), stats, origin, vortex.nexusBus(), caster);
            var hit = new SpellTarget(SpellTarget.TargetKind.ENTITY, target.getUniqueId(), target.getLocation().add(0, target.getHeight() * .5, 0));
            double damage = cast.spell.damage(context, hit);
            if (!Double.isFinite(damage) || damage <= 0) return "rpg_spell_unavailable";
            double before = target.getHealth() + target.getAbsorptionAmount();
            target.damage(damage, caster);
            mana.current -= cost;
            mana.cooldowns.put(spellId, now + cast.cooldownMillis);
            if (!target.isDead() && target.getHealth() + target.getAbsorptionAmount() >= before) {
                mana.current += cost;
                return "rpg_hit_blocked";
            }
            mana.lastSpell = spellId;
            mana.lastHit = target.getUniqueId();
            mana.lastCastAt = Instant.now();
            maid.getLookControl().setLookAt(enemy);
            maid.swing(InteractionHand.MAIN_HAND);
            cast.spell.play(context, hit, caster);
            return "rpg_cast_hit";
        }
        return blocked;
    }

    private static boolean clearRay(LivingEntity caster, LivingEntity target) {
        var eye = caster.getEyeLocation();
        var direction = target.getBoundingBox().getCenter().subtract(eye.toVector());
        if (direction.lengthSquared() < 1.0E-6) return true;
        var first = caster.getWorld().rayTraceEntities(eye, direction, direction.length(), .3,
            entity -> entity instanceof LivingEntity living && living.isValid() && !living.isDead() && !entity.equals(caster));
        return first != null && target.equals(first.getHitEntity());
    }

    private boolean hostile(EntityMaid maid, Mob mob, Player owner) {
        var target = mob.getTarget();
        boolean attacking = target != null && (target == maid || target.getUUID().equals(owner.getUniqueId()));
        var entity = mob.getBukkitEntity();
        // Encounter-owned mobs require the instance's participant and reward accounting.
        var tags = entity.getScoreboardTags();
        if (tags.contains("afu_site_dungeon") || tags.contains("afu_dungeon_mob")
                || entity.getPersistentDataContainer().has(vortexEncounter)) return false;
        return MaidCompanionPolicy.hostileCandidate(attacking, mob instanceof Enemy, mob instanceof NeutralMob,
            maid.isAlliedTo(mob), !mob.isNoAi() && !mob.isInvulnerable() && !entity.hasMetadata("NPC"),
            maid.hasLineOfSight(mob), true, maid.canAttack(mob));
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

    private record Cast(NpcSpellAccess spell, double rangeSquared, long cooldownMillis, boolean aimed) {}

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
