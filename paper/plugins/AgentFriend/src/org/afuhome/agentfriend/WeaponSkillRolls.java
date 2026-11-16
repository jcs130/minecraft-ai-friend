package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.random.RandomGenerator;

/** Separate automatic triggers from deliberate uses. A binding contains IDs only. */
final class WeaponSkillRolls {
    static final List<String> ON_HIT = List.of("selfheal", "food", "night");
    static final List<String> ACTIVE = List.of("starbolt", "frostnova", "blink", "selfheal", "food",
            "leap", "feather", "night", "prospect", "starlight", "fireworks");
    private static final Set<String> MENU_OR_LONG_TRAVEL = Set.of("give", "team", "travel", "home", "support");

    record Binding(String hit, String use, String sneakUse) {
        Binding {
            if (hit == null || !ON_HIT.contains(hit) || !validActive(use) || !validActive(sneakUse)
                    || hit.equals(use) || hit.equals(sneakUse) || use.equals(sneakUse))
                throw new IllegalArgumentException("invalid_weapon_skill");
        }
        String encode() { return hit + ":" + use + ":" + sneakUse; }
        String spell(boolean sneaking) { return sneaking ? sneakUse : use; }
    }

    static Binding decode(String value) {
        if (value == null || value.length() > 146) return null;
        String[] fields = value.split(":", -1);
        if (fields.length != 3) return null;
        try { return new Binding(fields[0], fields[1], fields[2]); }
        catch (IllegalArgumentException invalid) { return null; }
    }

    static Binding roll(List<String> nativeIds, Binding previous, RandomGenerator random) {
        String hit = ON_HIT.get(random.nextInt(ON_HIT.size()));
        var choices = new LinkedHashSet<>(ACTIVE);
        for (String id : nativeIds) if (validActive(id)) choices.add(id);
        choices.remove(hit);
        List<String> active = new ArrayList<>(choices);
        String use = active.remove(random.nextInt(active.size()));
        if (previous != null && hit.equals(previous.hit()) && use.equals(previous.use())) active.remove(previous.sneakUse());
        return new Binding(hit, use, active.get(random.nextInt(active.size())));
    }

    static int rewardChance(int floor, String tier) {
        if (floor < 6) return 0;
        return switch (tier) {
            case "rare" -> 20;
            case "excellent" -> 50;
            case "legendary" -> 100;
            default -> 0;
        };
    }

    private static boolean validActive(String id) {
        return id != null && id.matches("[a-z0-9_]{1,48}") && !MENU_OR_LONG_TRAVEL.contains(id);
    }
    private WeaponSkillRolls() { }
}
