package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Frozen, optional conditions for KILLS. Facts come from native damage/death events only. */
final class CombatObjectives {
    // Deliberately excludes players, residents and animals. Unknown IDs fail configuration
    // validation instead of silently turning a targeted contract into an unrestricted kill.
    private static final Set<String> MOBS = Set.of("ZOMBIE", "HUSK", "DROWNED", "ZOMBIE_VILLAGER",
            "SKELETON", "STRAY", "WITHER_SKELETON", "BOGGED", "SPIDER", "CAVE_SPIDER", "CREEPER",
            "WITCH", "PILLAGER", "VINDICATOR", "EVOKER", "VEX", "RAVAGER", "PHANTOM", "ENDERMAN",
            "ENDERMITE", "SILVERFISH", "SLIME", "MAGMA_CUBE", "BLAZE", "GHAST", "PIGLIN",
            "PIGLIN_BRUTE", "ZOMBIFIED_PIGLIN", "HOGLIN", "ZOGLIN", "GUARDIAN", "ELDER_GUARDIAN",
            "SHULKER", "BREEZE", "WARDEN", "WITHER", "ENDER_DRAGON");
    private static final Set<String> TIERS = Set.of("WOODEN", "STONE", "IRON", "GOLDEN", "DIAMOND", "NETHERITE");
    private static final Set<String> FAMILIES = Set.of("SWORD", "AXE", "BOW", "CROSSBOW", "TRIDENT", "MACE", "ANY");
    record Spec(Set<String> mobs, Set<String> weapons, String attack) {
        Spec { mobs = Set.copyOf(mobs); weapons = Set.copyOf(weapons); }
        boolean matches(String mob, String weapon, String actualAttack) {
            return mobs.contains(mob) && (attack.equals("any") || attack.equals(actualAttack))
                    && weapon != null && !weapon.isEmpty() && (weapons.contains("ANY") || weapons.contains(weapon)
                    || weapons.contains(family(weapon)));
        }
        String mismatch(String mob, String weapon, String actualAttack) {
            if (!mobs.contains(mob)) return "TARGET_MISMATCH";
            if (!attack.equals("any") && !attack.equals(actualAttack)) return "ATTACK_METHOD_MISMATCH";
            if (weapon == null || weapon.isEmpty() || !(weapons.contains("ANY") || weapons.contains(weapon)
                    || weapons.contains(family(weapon)))) return "WEAPON_MISMATCH";
            return "";
        }
        JsonObject json() {
            JsonObject out = new JsonObject(); JsonArray m = new JsonArray(), w = new JsonArray();
            mobs.stream().sorted().forEach(m::add); weapons.stream().sorted().forEach(w::add);
            out.add("mobs", m); out.add("weapons", w); out.addProperty("attack", attack);
            out.addProperty("source", "native_lethal_damage");
            out.addProperty("projectileWeapon", "captured_at_shot"); return out;
        }
    }
    private CombatObjectives() { }
    private static String family(String weapon) {
        for (String tier : TIERS) for (String suffix : List.of("SWORD", "AXE"))
            if (weapon.equals(tier + "_" + suffix)) return suffix;
        return FAMILIES.contains(weapon) ? weapon : "";
    }
    private static String key(Object value) {
        if (!(value instanceof String text)) throw new IllegalArgumentException("combat IDs must be strings");
        String id = text.toUpperCase(Locale.ROOT);
        if (id.startsWith("MINECRAFT:")) id = id.substring(10);
        return id;
    }
    private static Set<String> ids(Object raw, String field) {
        if (!(raw instanceof List<?> list) || list.isEmpty() || list.size() > 16)
            throw new IllegalArgumentException("combat " + field + " needs 1..16 IDs");
        Set<String> result = new LinkedHashSet<>();
        for (Object value : list) result.add(key(value));
        return result;
    }
    static Spec parse(Object value) {
        if (value == null) return null;
        if (!(value instanceof Map<?, ?> row) || !Set.of("mobs", "weapons", "attack").containsAll(row.keySet()))
            throw new IllegalArgumentException("combat fields: mobs, weapons, attack");
        Set<String> mobs = ids(row.get("mobs"), "mobs"), weapons = ids(row.get("weapons"), "weapons");
        if (!MOBS.containsAll(mobs)) throw new IllegalArgumentException("combat mob must be a supported hostile entity ID");
        for (String weapon : weapons) if (!FAMILIES.contains(weapon) && family(weapon).isEmpty())
            throw new IllegalArgumentException("combat unknown weapon " + weapon);
        if (row.containsKey("attack") && !(row.get("attack") instanceof String)) throw new IllegalArgumentException("combat attack must be a string");
        String attack = row.containsKey("attack") ? (String) row.get("attack") : "any";
        if (!Set.of("melee", "projectile", "any").contains(attack)) throw new IllegalArgumentException("combat attack: melee/projectile/any");
        if (attack.equals("projectile") && weapons.stream().noneMatch(w -> Set.of("ANY", "BOW", "CROSSBOW", "TRIDENT").contains(w)))
            throw new IllegalArgumentException("combat projectile needs bow/crossbow/trident");
        if (attack.equals("melee") && weapons.stream().allMatch(w -> Set.of("BOW", "CROSSBOW").contains(w)))
            throw new IllegalArgumentException("combat melee needs a melee weapon");
        return new Spec(mobs, weapons, attack);
    }
}
