package org.qiandengji.vortex;

import io.vortexcore.VortexCorePlugin;
import io.vortexcore.magic.CompiledSpell;
import io.vortexcore.rpg.*;
import java.util.*;

/** Adapter to the pinned Vortex spell and class registries, with no second resource ledger. */
final class VortexSpellRegistration {
    private final VortexCorePlugin vortex;
    private final VortexSkillDefinition skill;
    private final Map<String, Object> spells;
    private final Map<String, VortexSkillDefinition> skills;
    private final Map<VortexClass, List<VortexSkillDefinition>> trees;
    private final Object spell;

    @SuppressWarnings("unchecked")
    VortexSpellRegistration(VortexCorePlugin vortex, VortexSkillDefinition skill, CompiledSpell compiled,
                            long cooldown, double mana, boolean equipmentAccess) throws ReflectiveOperationException {
        this.vortex = vortex;
        this.skill = skill;
        var book = vortex.spellbookService();
        var classes = vortex.classSkillService();
        spells = (Map<String, Object>) field(book, "spells");
        skills = (Map<String, VortexSkillDefinition>) field(classes, "skillsById");
        trees = (Map<VortexClass, List<VortexSkillDefinition>>) field(classes, "skillTrees");
        if (spells.containsKey(skill.id()) || skills.containsKey(skill.id())) throw new IllegalStateException("spell_id_conflict:"+skill.id());
        var owner = book.getClass().getClassLoader();
        var definition = Class.forName(SpellbookService.class.getName()+"$RegisteredSpell", false, owner);
        var rule = Class.forName(SpellbookService.class.getName()+"$SpellAccessRule", false, owner);
        // The engine requires a definition-level rule for equipment use; the owned
        // executor checks the actual held item again before doing anything.
        Object access = null;
        if (equipmentAccess) {
            var constructor = rule.getDeclaredConstructor(int.class, Set.class);
            constructor.setAccessible(true);
            access = constructor.newInstance(1, Set.of());
        }
        var constructor = definition.getDeclaredConstructor(String.class, String.class, long.class, CompiledSpell.class, rule);
        constructor.setAccessible(true);
        spell = constructor.newInstance(skill.id(), skill.displayName(), cooldown, compiled, access);
        var tree = new ArrayList<>(trees.getOrDefault(skill.archetype(), List.of()));
        tree.add(skill);
        trees.put(skill.archetype(), List.copyOf(tree));
        skills.put(skill.id(), skill);
        spells.put(skill.id(), spell);
        String manaKey = "qiandengji.spell-mana-costs."+skill.id();
        // ManaGate uses an explicit fallback, so set the configured value in memory.
        if (!vortex.getConfig().isSet(manaKey)) vortex.getConfig().set(manaKey, mana);
    }
    private static Object field(Object instance, String name) throws ReflectiveOperationException {
        var field = instance.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(instance);
    }
    boolean enabled() { return spells.get(skill.id()) == spell; }
    void maintain() { spells.putIfAbsent(skill.id(), spell); }
    void stop() {
        spells.remove(skill.id(), spell);
        skills.remove(skill.id(), skill);
        trees.computeIfPresent(skill.archetype(), (role, tree) -> tree.stream().filter(s -> s != skill).toList());
    }
}
