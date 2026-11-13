package io.vortexcore.rpg;

import io.vortexcore.magic.CompiledSpell;
import io.vortexcore.magic.ConditionType;
import io.vortexcore.magic.MechanicType;
import io.vortexcore.magic.SpellContext;
import io.vortexcore.magic.SpellMechanic;
import io.vortexcore.magic.SpellTarget;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.LivingEntity;

/** Read access to the live registry for the companion's single-target mage spells. */
public record NpcSpellAccess(SpellbookService.EditorSpellSnapshot definition,
                             CompiledSpell compiled, Visuals visuals) {
    private static final Set<String> TARGETERS = Set.of("ray", "nearby_monster");
    private static final Set<MechanicType> PRESENTATION = Set.of(
        MechanicType.SPAWN_PARTICLES, MechanicType.PLAY_SOUND, MechanicType.SEND_MESSAGE);

    public interface Damage {
        double amount(SpellContext context);
    }

    public interface Scoped {
        SpellMechanic delegate();
    }

    public interface Visuals {
        Sound castSound();
        Particle castParticle();
        Particle beamParticle();
        Particle impactParticle();
        Sound impactSound();
    }

    public double hostileRange() {
        if (definition.minLevel() != 1 || !definition.requiredClasses().contains("mage")
                || definition.targeters().size() != 1 || compiled.mechanics().isEmpty()
                || damageMechanic() == null
                || compiled.conditions().stream().anyMatch(condition -> condition.type() != ConditionType.HAS_TARGET)
                || compiled.mechanics().stream().skip(1).anyMatch(mechanic -> !PRESENTATION.contains(mechanic.type()))) {
            return 0;
        }
        var targeter = definition.targeters().getFirst();
        if (!TARGETERS.contains(targeter.get("type")) || !(targeter.get("range") instanceof Number range)
                || ("nearby_monster".equals(targeter.get("type")) && !Integer.valueOf(1).equals(targeter.get("limit")))
                || !Double.isFinite(range.doubleValue())) return 0;
        return Math.max(0, range.doubleValue());
    }

    public double damage(SpellContext context, SpellTarget target) {
        if (compiled.conditions().stream().anyMatch(condition -> !condition.test(context, target))) return 0;
        Damage damage = damageMechanic();
        return damage == null ? 0 : damage.amount(context);
    }

    private Damage damageMechanic() {
        Object scope = definition.mechanics().getFirst().get("target-filter");
        if (scope != null && !scope.equals("mobs")) return null;
        SpellMechanic first = compiled.mechanics().getFirst();
        return (first instanceof Scoped scoped ? scoped.delegate() : first) instanceof Damage damage ? damage : null;
    }

    public void play(SpellContext context, SpellTarget target, LivingEntity caster) {
        if (visuals != null) {
            Location start = caster.getEyeLocation();
            Location end = target.location();
            World world = start.getWorld();
            if (visuals.castSound() != null) world.playSound(start, visuals.castSound(), 0.9F, 1.0F);
            if (visuals.castParticle() != null) world.spawnParticle(visuals.castParticle(), start, 12, .25, .25, .25, .04);
            if (visuals.beamParticle() != null) {
                var offset = end.toVector().subtract(start.toVector());
                int steps = Math.clamp((int) (offset.length() * 5), 1, 48);
                var step = offset.multiply(1.0 / steps);
                for (int i = 0; i < steps; i++) world.spawnParticle(visuals.beamParticle(), start.add(step), 1, 0, 0, 0, 0);
            }
            if (visuals.impactParticle() != null) world.spawnParticle(visuals.impactParticle(), end, 16, .3, .3, .3, .06);
            if (visuals.impactSound() != null) world.playSound(end, visuals.impactSound(), 0.9F, 1.05F);
        }
        for (var mechanic : compiled.mechanics().subList(1, compiled.mechanics().size())) {
            if (mechanic.type() != MechanicType.SEND_MESSAGE) mechanic.apply(context, target);
        }
    }
}
