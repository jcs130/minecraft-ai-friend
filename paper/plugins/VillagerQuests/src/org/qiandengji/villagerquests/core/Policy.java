package org.qiandengji.villagerquests.core;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Who may ask for what, how much, and what it pays. Same shape and rules as the bridge's {@code QuestPolicy}
 * (policy.example.json), plus per-player limits. Violations are rejected, never silently adjusted.
 */
public final class Policy {
    public static final List<String> DIFFICULTIES = List.of("easy", "normal", "hard");

    public record Villager(String id, String name, String npcId, Set<QuestType> types, int maxOpen, int dailyQuota) {}

    public static final class Violation extends Exception {
        public final String code;
        public Violation(String code, String detail) {
            super(detail == null || detail.isEmpty() ? code : code + ": " + detail);
            this.code = code;
        }
    }

    public final Map<String, Villager> villagers;
    public final Map<QuestType, Set<String>> targets;
    public final Map<String, Integer> maxQuantity;
    public final Map<String, Reward> rewards;
    public final int deadlineMin, deadlineMax, maxOpenTotal, maxActivePerPlayer;

    public Policy(Map<String, Villager> villagers, Map<QuestType, Set<String>> targets, Map<String, Integer> maxQuantity,
                  Map<String, Reward> rewards, int deadlineMin, int deadlineMax, int maxOpenTotal, int maxActivePerPlayer) {
        this.villagers = Map.copyOf(villagers);
        this.targets = Map.copyOf(targets);
        this.maxQuantity = Map.copyOf(maxQuantity);
        this.rewards = Map.copyOf(rewards);
        this.deadlineMin = deadlineMin;
        this.deadlineMax = deadlineMax;
        this.maxOpenTotal = maxOpenTotal;
        this.maxActivePerPlayer = maxActivePerPlayer;
        for (String id : villagers.keySet())
            if (!Commission.LOCAL_ID.matcher(id).matches()) throw new IllegalArgumentException("villager id " + id);
        for (Set<String> ids : targets.values())
            for (String t : ids) if (!Commission.NAMESPACED_ID.matcher(t).matches()) throw new IllegalArgumentException("target " + t);
        if (deadlineMin < 1 || deadlineMax > 10080 || deadlineMin > deadlineMax) throw new IllegalArgumentException("deadline bounds");
    }

    /** Parses the {@code policy} section (YAML converted to JSON, camelCase keys like the bridge). */
    public static Policy fromJson(JsonObject o) {
        Map<String, Villager> villagers = new LinkedHashMap<>();
        for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("villagers").entrySet()) {
            JsonObject v = e.getValue().getAsJsonObject();
            EnumSet<QuestType> types = EnumSet.noneOf(QuestType.class);
            if (v.has("types")) v.getAsJsonArray("types").forEach(t -> types.add(QuestType.parse(t.getAsString())));
            else types.add(QuestType.SLAY);
            villagers.put(e.getKey(), new Villager(e.getKey(), Text.clean(str(v, "name", e.getKey()), 32),
                    v.has("npcId") ? v.get("npcId").getAsString() : null, types, intOr(v, "maxOpen", 1), intOr(v, "dailyQuota", 3)));
        }
        Map<QuestType, Set<String>> targets = new EnumMap<>(QuestType.class);
        if (o.has("targets")) for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("targets").entrySet()) {
            Set<String> ids = new TreeSet<>();
            e.getValue().getAsJsonArray().forEach(t -> ids.add(t.getAsString()));
            targets.put(QuestType.parse(e.getKey()), ids);
        }
        Map<String, Integer> maxQuantity = new LinkedHashMap<>(Map.of("easy", 5, "normal", 10, "hard", 20));
        if (o.has("maxQuantity")) o.getAsJsonObject("maxQuantity").entrySet().forEach(e -> maxQuantity.put(e.getKey(), e.getValue().getAsInt()));
        Map<String, Reward> rewards = new LinkedHashMap<>();
        for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("rewards").entrySet()) {
            JsonObject r = e.getValue().getAsJsonObject();
            rewards.put(e.getKey(), new Reward(intOr(r, "emeralds", 0), intOr(r, "vortexXp", 0), intOr(r, "fame", 0)));
        }
        JsonObject d = o.has("deadlineMinutes") ? o.getAsJsonObject("deadlineMinutes") : new JsonObject();
        return new Policy(villagers, targets, maxQuantity, rewards, intOr(d, "min", 10), intOr(d, "max", 1440),
                intOr(o, "maxOpenTotal", 6), intOr(o, "maxActivePerPlayer", 1));
    }

    private static int intOr(JsonObject o, String key, int fallback) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsInt() : fallback;
    }

    private static String str(JsonObject o, String key, String fallback) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : fallback;
    }

    public Villager villager(String id) throws Violation {
        Villager v = villagers.get(id);
        if (v == null) throw new Violation("unknown_issuer", id);
        return v;
    }

    /** Throws if the commission may not be posted now. Counts come from the board (rolling 24 h for the quota). */
    public void check(Commission c, int openForIssuer, int openTotal, int issuedLast24h) throws Violation {
        Villager v = villager(c.issuer());
        if (!v.types().contains(c.type())) throw new Violation("type_not_allowed", c.issuer() + " may not issue " + c.type().wire());
        if (c.type() != QuestType.REACH && !targets.getOrDefault(c.type(), Set.of()).contains(c.target()))
            throw new Violation("target_not_allowed", c.target());
        Integer limit = maxQuantity.get(c.difficulty());
        if (limit == null || c.quantity() > limit) throw new Violation("quantity_over_limit", c.quantity() + " > " + limit);
        if (!rewards.containsKey(c.difficulty())) throw new Violation("no_reward_tier", c.difficulty());
        if (c.deadlineMinutes() < deadlineMin || c.deadlineMinutes() > deadlineMax)
            throw new Violation("deadline_out_of_range", String.valueOf(c.deadlineMinutes()));
        if ((c.type() == QuestType.SLAY || c.type() == QuestType.REACH) && c.area() == null)
            throw new Violation("area_required", c.type().wire());
        if (openForIssuer >= v.maxOpen()) throw new Violation("issuer_open_limit", c.issuer());
        if (openTotal >= maxOpenTotal) throw new Violation("global_open_limit", "");
        if (issuedLast24h >= v.dailyQuota()) throw new Violation("daily_quota", c.issuer());
    }

    /** The table row for a difficulty, or {@code null} if a reload removed it. */
    public Reward rewardFor(String difficulty) {
        return rewards.get(difficulty);
    }
}
