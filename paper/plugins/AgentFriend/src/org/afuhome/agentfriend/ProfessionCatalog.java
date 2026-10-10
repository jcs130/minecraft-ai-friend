package org.afuhome.agentfriend;

import java.io.File;
import java.util.*;
import org.bukkit.Material;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

/** The three content files are validated and swapped as a single catalog. */
final class ProfessionCatalog {
    record Role(String id, String title, boolean combat, Material icon, List<String> starters) { }
    record Skill(String id, String title, String role, String effect, Material icon, String equipment,
            int mana, long cooldown, double range, int targets, double power, int ticks,
            boolean legacy, int worldLimit, String description, String origin) {
        SpellGuide.Entry guide() {
            return new SpellGuide.Entry(id, title, legacy ? "传承" : "职业", icon, "/mycli cast " + id,
                    description, "详见效果说明；不伤害玩家、村民或宠物", mana, (int) (cooldown / 1000),
                    "选择职业 " + role + "，已学会并准备；装备要求 " + equipment,
                    "资格/装备/目标/保护检查失败不收费；冷却跨重启保留", "技能点升级；各级费用和实际效果：/mycli skills info " + id, origin);
        }
    }
    record Unlock(String id, String source, String sourceId, List<String> skills) { }
    static final Set<String> EFFECTS = Set.of("sword_thrust", "sword_parry", "sword_cone", "sword_step",
            "sword_beam", "sword_combo", "arcane_bolt", "frost_cone", "flame_cone", "ward", "mark", "mend", "cleanse", "haste", "growth", "warmth",
            "sky_leap", "soar", "blessing");
    final Map<String, Role> roles;
    final Map<String, Skill> skills;
    final List<Unlock> unlocks;
    final ProfessionProgression progression;

    private ProfessionCatalog(Map<String, Role> roles, Map<String, Skill> skills, List<Unlock> unlocks, ProfessionProgression progression) {
        this.roles = Collections.unmodifiableMap(roles); this.skills = Collections.unmodifiableMap(skills);
        this.unlocks = List.copyOf(unlocks); this.progression = progression;
    }
    static ProfessionCatalog load(File directory) throws Exception {
        YamlConfiguration professions = yaml(directory, "professions.yml"), definitions = yaml(directory, "skills.yml"),
                rules = yaml(directory, "skill-unlocks.yml");
        Map<String, Role> roles = new LinkedHashMap<>(); Map<String, Skill> skills = new LinkedHashMap<>();
        ConfigurationSection rows = section(professions, "professions", 12);
        for (String id : rows.getKeys(false)) {
            id(id); ConfigurationSection row = section(rows, id, 10);
            String kind = row.getString("kind");
            if (!Set.of("combat", "life").contains(kind)) throw new IllegalArgumentException(id + " kind");
            List<String> starters = strings(row, "starter-skills", 4);
            roles.put(id, new Role(id, text(row, "title", 24), kind.equals("combat"), icon(row), starters));
        }
        // The old guide keeps its original slots. At most 20 additions fit its vanilla 54-slot menu.
        rows = section(definitions, "skills", 20);
        for (String id : rows.getKeys(false)) {
            id(id); if (SpellGuide.baseIds().contains(id)) throw new IllegalArgumentException("reserved skill " + id);
            ConfigurationSection row = section(rows, id, 20);
            String role = row.getString("profession"), effect = row.getString("effect"), equipment = row.getString("equipment", "none");
            if (!roles.containsKey(role) || !EFFECTS.contains(effect)
                    || !Set.of("none", "sword", "two_swords", "shield", "bow", "pickaxe", "axe", "hoe").contains(equipment))
                throw new IllegalArgumentException(id + " role/effect/equipment");
            int mana = integer(row, "mana", 1, 30), seconds = integer(row, "cooldown-seconds", 1, 3600),
                    targets = integer(row, "limits.targets", 1, 4), duration = integer(row, "limits.duration-seconds", 1, 60);
            double range = number(row, "limits.range", 1, 12), power = number(row, "limits.power", 0.1, 16);
            boolean legacy = row.getBoolean("legacy", false); int worldLimit = row.getInt("world-limit", 0);
            if (worldLimit < 0 || worldLimit > 1 || worldLimit == 1 && !legacy) throw new IllegalArgumentException(id + " world-limit");
            skills.put(id, new Skill(id, text(row, "title", 24), role, effect, icon(row), equipment, mana,
                    seconds * 1000L, range, targets, power, duration * 20, legacy, worldLimit,
                    text(row, "description", 180), text(row, "origin", 160)));
        }
        for (Role role : roles.values()) for (String starter : role.starters) {
            Skill skill = skills.get(starter);
            if (skill == null || !skill.role.equals(role.id) || skill.legacy || skill.worldLimit != 0)
                throw new IllegalArgumentException(role.id + " invalid starter " + starter);
        }
        List<Unlock> unlocks = new ArrayList<>(); rows = section(rules, "unlocks", 64);
        for (String id : rows.getKeys(false)) {
            id(id); ConfigurationSection row = section(rows, id, 8);
            String source = row.getString("source"), sourceId = text(row, "source-id", 64);
            if (!Set.of("guild_contract", "raid_victory").contains(source)
                    || !sourceId.matches("[a-z0-9_]{2,64}") || !row.getString("repeat", "once_per_player").equals("once_per_player"))
                throw new IllegalArgumentException(id + " source/repeat");
            List<String> grants = strings(row, "skills", 4);
            if (grants.isEmpty() || !skills.keySet().containsAll(grants)) throw new IllegalArgumentException(id + " missing skills");
            unlocks.add(new Unlock(id, source, sourceId, grants));
        }
        skills.values().forEach(ProfessionCatalog::validateEffect);
        return new ProfessionCatalog(roles, skills, unlocks, ProfessionProgression.load(directory, skills));
    }
    static void validateEffect(Skill skill) {
        String effect = skill.effect(); double range = skill.range(), power = skill.power();
        int targets = skill.targets(), duration = skill.ticks() / 20;
    if (effect.equals("sword_cone") && (range > 3.5 || targets > 3 || power > 4)
            || effect.equals("sword_thrust") && (range > 3.5 || targets != 1 || power > 8)
            || effect.equals("sword_step") && (range > 3 || targets != 1 || power > 6)
            || effect.equals("sword_beam") && (range > 10 || targets != 1 || power > 6)
            || effect.equals("sword_combo") && (range > 3.5 || targets != 1 || power > 16 || duration > 2)
            || Set.of("sword_parry", "ward").contains(effect) && (power > 6 || duration > 8)
            || effect.equals("growth") && (range > 3 || targets > 4 || power > 2))
        throw new IllegalArgumentException(skill.id() + " exceeds primitive safety limits");
    if (effect.equals("arcane_bolt") && (range > 12 || targets != 1 || power > 6)
            || effect.equals("frost_cone") && (range > 5 || targets > 3 || power > 3 || duration > 3)
            || effect.equals("flame_cone") && (range > 4 || targets > 3 || power > 4))
        throw new IllegalArgumentException(skill.id() + " exceeds elemental safety limits");
    if (effect.equals("sky_leap") && (targets != 1 || power < 6 || power > 16 || duration > 20)
            || effect.equals("soar") && (targets != 1 || duration > 40)
            || effect.equals("blessing") && (range > 8 || duration > 16 || power > 1))
        throw new IllegalArgumentException(skill.id() + " exceeds mobility/support safety limits");
    }
    List<String> rewards(String source, String id) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        unlocks.stream().filter(rule -> rule.source.equals(source) && rule.sourceId.equals(id)).forEach(rule -> result.addAll(rule.skills));
        return List.copyOf(result);
    }
    private static YamlConfiguration yaml(File dir, String name) throws Exception {
        YamlConfiguration yaml = new YamlConfiguration(); yaml.load(new File(dir, name));
        if (yaml.getInt("schema-version") != 1) throw new IllegalArgumentException(name + " schema-version"); return yaml;
    }
    private static ConfigurationSection section(ConfigurationSection parent, String key, int limit) {
        ConfigurationSection value = parent.getConfigurationSection(key);
        if (value == null || value.getKeys(false).size() > limit) throw new IllegalArgumentException(key + " section/count"); return value;
    }
    private static String text(ConfigurationSection row, String key, int limit) {
        String value = row.getString(key, "");
        if (value.isBlank() || value.length() > limit || value.chars().anyMatch(c -> c < 32)) throw new IllegalArgumentException(key + " text"); return value;
    }
    private static List<String> strings(ConfigurationSection row, String key, int limit) {
        List<String> value = row.getStringList(key);
        if (value.size() > limit || new HashSet<>(value).size() != value.size()) throw new IllegalArgumentException(key + " count/duplicate");
        value.forEach(ProfessionCatalog::id); return List.copyOf(value);
    }
    private static void id(String value) { if (!value.matches("[a-z0-9_]{2,40}")) throw new IllegalArgumentException("invalid ID"); }
    private static Material icon(ConfigurationSection row) {
        Material icon = Material.matchMaterial(row.getString("icon", ""));
        if (icon == null || !icon.isItem() || icon.isAir()) throw new IllegalArgumentException("icon"); return icon;
    }
    private static int integer(ConfigurationSection row, String key, int min, int max) {
        double value = number(row, key, min, max);
        if (value != Math.rint(value)) throw new IllegalArgumentException(key + " integer"); return (int) value;
    }
    private static double number(ConfigurationSection row, String key, double min, double max) {
        Object raw = row.get(key);
        if (!(raw instanceof Number number)) throw new IllegalArgumentException(key + " number");
        double value = number.doubleValue();
        if (!Double.isFinite(value) || value < min || value > max) throw new IllegalArgumentException(key + " bounds"); return value;
    }
}
