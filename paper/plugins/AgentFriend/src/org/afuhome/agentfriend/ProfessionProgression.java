package org.afuhome.agentfriend;

import java.io.File;
import java.util.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

/** Learning prices and bounded ranks, swapped with the effect catalog. */
final class ProfessionProgression {
    record Rank(int cost, ProfessionCatalog.Skill effect, int wardTicks, double wardCap, int immuneTicks) { }
    final int initial, cap, levelsPerPoint;
    final int respecMana, respecSeconds;
    final Map<String, List<Rank>> ranks;
    private ProfessionProgression(int initial, int cap, int levelsPerPoint, int respecMana, int respecSeconds, Map<String, List<Rank>> ranks) {
        this.initial = initial; this.cap = cap; this.levelsPerPoint = levelsPerPoint; this.ranks = Map.copyOf(ranks);
        this.respecMana=respecMana; this.respecSeconds=respecSeconds;
    }
    static ProfessionProgression load(File dir, Map<String, ProfessionCatalog.Skill> skills) throws Exception {
        YamlConfiguration y = new YamlConfiguration(); y.load(new File(dir, "skill-points.yml"));
        if (y.getInt("schema-version") != 1) throw new IllegalArgumentException("skill-points schema");
        int cap = integer(y, "pool.cap", 1, 200), initial = integer(y, "pool.initial", 0, cap),
                interval = integer(y, "pool.aura-levels-per-point", 1, 100);
        int basicCost = integer(y, "basic-cost", 1, 30);
        Map<String, List<Rank>> ranks = new LinkedHashMap<>();
        for (String id : SpellGuide.baseIds()) ranks.put(id, List.of(new Rank(basicCost, null, 0, 0, 0)));
        ConfigurationSection rows = y.getConfigurationSection("ranks");
        if (rows == null || !rows.getKeys(false).equals(skills.keySet())) throw new IllegalArgumentException("ranks must cover all profession skills");
        for (var entry : skills.entrySet()) {
            String id = entry.getKey(); ProfessionCatalog.Skill s = entry.getValue();
            List<Map<?, ?>> levels = rows.getMapList(id);
            if (levels.isEmpty() || levels.size() > 3) throw new IllegalArgumentException(id + " ranks count");
            List<Rank> values = new ArrayList<>(); int previousCost = 0;
            for (Map<?, ?> raw : levels) {
                YamlConfiguration row = new YamlConfiguration(); raw.forEach((k,v) -> row.set(k.toString(), v));
                int cost = integer(row, "cost", 1, 30), mana = integer(row, "mana", 1, 30),
                        targets = integer(row, "targets", 1, 4), duration = integer(row, "duration-seconds", 1, 60);
                if (cost < previousCost) throw new IllegalArgumentException(id + " rank prices must not decrease");
                previousCost = cost;
                double range = number(row, "range", 1, 12), power = number(row, "power", .1, 16);
                ProfessionCatalog.Skill effective = new ProfessionCatalog.Skill(s.id(), s.title(), s.role(), s.effect(), s.icon(),
                        s.equipment(), mana, s.cooldown(), range, targets, power, duration * 20, s.legacy(), s.worldLimit(), s.description(), s.origin());
                ProfessionCatalog.validateEffect(effective);
                int ward = row.contains("ward-seconds") ? integer(row, "ward-seconds", 0, 8) * 20 : 0;
                double wardCap = ward > 0 ? number(row, "ward-cap", .1, 6) : 0;
                int immune = row.contains("immunity-seconds") ? (int)Math.round(number(row, "immunity-seconds", 0, 2) * 20) : 0;
                if ((ward > 0 || immune > 0) && !s.effect().equals("mend")) throw new IllegalArgumentException("healing protection only");
                values.add(new Rank(cost, effective, ward, wardCap, immune));
            }
            ranks.put(id, List.copyOf(values));
        }
        return new ProfessionProgression(initial, cap, interval, integer(y,"pool.respec-mana",1,30),integer(y,"pool.respec-cooldown-seconds",60,86400),ranks);
    }
    private static double number(ConfigurationSection row, String key, double min, double max) {
        Object raw = row.get(key); if (!(raw instanceof Number n)) throw new IllegalArgumentException(key + " number");
        double value = n.doubleValue(); if (!Double.isFinite(value) || value < min || value > max) throw new IllegalArgumentException(key + " bounds");
        return value;
    }
    private static int integer(ConfigurationSection row, String key, int min, int max) {
        double v = number(row, key, min, max); if (v != Math.rint(v)) throw new IllegalArgumentException(key + " integer"); return (int)v;
    }
}
