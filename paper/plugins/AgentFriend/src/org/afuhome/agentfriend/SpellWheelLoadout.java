package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Eight personal shortcuts; this never grants a spell or changes its casting authority. */
final class SpellWheelLoadout {
    static final int SIZE = 8;
    private static final List<String> COMMON_DEFAULTS = List.of(
            "selfheal", "frostnova", "blink", "team", "food", "home", "night", "feather");

    private SpellWheelLoadout() { }

    static List<String> defaults(List<String> learned) {
        var result = new ArrayList<String>();
        for (String id : learned) {
            if (valid(id) && !result.contains(id)) result.add(id);
            if (result.size() == 4) break;
        }
        for (String id : COMMON_DEFAULTS) {
            if (result.size() == SIZE) break;
            if (!result.contains(id)) result.add(id);
        }
        return List.copyOf(result);
    }

    static List<String> read(Object stored, List<String> learned) {
        if (stored == null) return defaults(learned);
        if (!(stored instanceof List<?> values) || values.size() != SIZE)
            throw new IllegalArgumentException("invalid_wheel_preferences");
        var result = new ArrayList<String>();
        for (Object value : values) {
            if (!(value instanceof String id) || !id.isEmpty() && !valid(id))
                throw new IllegalArgumentException("invalid_wheel_preferences");
            result.add(id);
        }
        return List.copyOf(result);
    }

    static List<String> assign(List<String> before, int slot, String spell, List<String> available) {
        if (slot < 0 || slot >= SIZE || before.size() != SIZE)
            throw new IllegalArgumentException("invalid_wheel_slot");
        if (!spell.isEmpty() && (!valid(spell) || !available.contains(spell)))
            throw new IllegalArgumentException("wheel_spell_unavailable");
        var next = new ArrayList<>(before);
        // Moving an existing shortcut keeps one clear position for each spell.
        if (!spell.isEmpty()) Collections.replaceAll(next, spell, "");
        next.set(slot, spell);
        return List.copyOf(next);
    }

    private static boolean valid(String id) { return id != null && id.matches("[a-z0-9_]{1,48}"); }
}
