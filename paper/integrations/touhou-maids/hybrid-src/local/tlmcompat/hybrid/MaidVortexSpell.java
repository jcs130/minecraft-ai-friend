package local.tlmcompat.hybrid;

import io.vortexcore.magic.ConditionType;
import io.vortexcore.magic.SpellContext;
import io.vortexcore.magic.SpellMechanic;
import io.vortexcore.magic.SpellTarget;
import io.vortexcore.rpg.NpcSpellAccess;
import io.vortexcore.progression.VortexAttribute;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.bukkit.entity.LivingEntity;

/** A native spell whose targets and mechanics can be safely executed by the maid. */
record MaidVortexSpell(NpcSpellAccess nativeSpell, double range, int targetLimit, boolean aimed,
                       double allyRange, long cooldown, NpcSpellAccess.Damage damage,
                       Healing heal, SpellMechanic bleed, List<SpellMechanic> presentation) {
    record Healing(double base, VortexAttribute attribute, double scale) {
        static Healing from(Map<String, Object> config) {
            if (!(config.get("base") instanceof Number base) || !Double.isFinite(base.doubleValue())
                    || !(config.get("scale") instanceof Number scale) || !Double.isFinite(scale.doubleValue())
                    || !(config.get("scaling-attribute") instanceof String attribute)) return null;
            try {
                return new Healing(base.doubleValue(), VortexAttribute.valueOf(attribute.toUpperCase(Locale.ROOT)), scale.doubleValue());
            } catch (IllegalArgumentException invalidAttribute) {
                return null;
            }
        }

        double amount(SpellContext context) {
            return base + context.caster().stat(attribute).current() * scale;
        }
    }

    static MaidVortexSpell from(NpcSpellAccess spell, double cap, long bindingCooldown) {
        if (spell == null || !spell.definition().requiredClasses().contains("mage")
                || spell.compiled().conditions().stream().anyMatch(condition -> condition.type() != ConditionType.HAS_TARGET)) return null;
        var definition = spell.definition();
        double range = 0, allyRange = 0;
        boolean aimed = false;
        int limit = 1;
        for (var targeter : definition.targeters()) {
            if (!(targeter.get("range") instanceof Number distance) || !Double.isFinite(distance.doubleValue())
                    || distance.doubleValue() <= 0) return null;
            double reach = Math.min(cap, distance.doubleValue());
            switch (String.valueOf(targeter.get("type"))) {
                case "ray", "nearby_monster" -> {
                    if (range > 0) return null;
                    range = reach;
                    aimed = "ray".equals(targeter.get("type"));
                    if (!aimed) {
                        if (!(targeter.get("limit") instanceof Number count) || count.doubleValue() != count.intValue()
                                || count.intValue() < 1 || count.intValue() > 3) return null;
                        limit = count.intValue();
                    }
                }
                case "nearby_player" -> {
                    if (allyRange > 0) return null;
                    allyRange = reach;
                }
                default -> { return null; }
            }
        }
        if (range <= 0) return null;
        List<Map<String, Object>> configured = definition.mechanics();
        List<SpellMechanic> compiled = spell.compiled().mechanics();
        if (configured.size() != compiled.size()) return null;
        NpcSpellAccess.Damage damage = null;
        Healing heal = null;
        SpellMechanic bleed = null;
        var presentation = new ArrayList<SpellMechanic>();
        for (int i = 0; i < compiled.size(); i++) {
            SpellMechanic mechanic = compiled.get(i);
            SpellMechanic inner = mechanic instanceof NpcSpellAccess.Scoped scope ? scope.delegate() : mechanic;
            Map<String, Object> config = configured.get(i);
            Object filter = config.get("target-filter");
            switch (mechanic.type()) {
                case DAMAGE -> {
                    if (damage != null || !(inner instanceof NpcSpellAccess.Damage amount)
                            || !(filter == null && allyRange == 0 || "mobs".equals(filter))) return null;
                    damage = amount;
                }
                case HEAL -> {
                    if (heal != null || allyRange == 0 || !"players".equals(filter)) return null;
                    heal = Healing.from(config);
                    if (heal == null) return null;
                }
                case APPLY_STATUS -> {
                    if (bleed != null || !"apply_effect".equals(config.get("type"))
                            || !"bleed".equals(config.get("effect")) || !"mobs".equals(filter)) return null;
                    bleed = mechanic;
                }
                case SPAWN_PARTICLES, PLAY_SOUND -> presentation.add(mechanic);
                case SEND_MESSAGE -> { }
                default -> { return null; }
            }
        }
        if (damage == null || (allyRange > 0) != (heal != null)) return null;
        return new MaidVortexSpell(spell, range, limit, aimed, allyRange,
                Math.max(bindingCooldown, definition.cooldownMillis()), damage, heal, bleed, List.copyOf(presentation));
    }

    String id() { return nativeSpell.definition().id(); }
    int minLevel() { return nativeSpell.definition().minLevel(); }
    String use() {
        if (heal != null) return "group_damage_and_heal";
        if (bleed != null) return "single_target_with_bleed";
        return targetLimit > 1 ? "group_damage" : "single_target";
    }

    boolean permits(SpellContext context, SpellTarget target) {
        return nativeSpell.compiled().conditions().stream().allMatch(condition -> condition.test(context, target));
    }

    void play(SpellContext context, SpellTarget impact, LivingEntity caster) {
        // The original single-target path includes the custom staff beam and impact visuals.
        if (nativeSpell.hostileRange() > 0 && targetLimit == 1) {
            nativeSpell.play(context, impact, caster);
            return;
        }
        for (var effect : presentation) effect.apply(context, impact);
    }
}
