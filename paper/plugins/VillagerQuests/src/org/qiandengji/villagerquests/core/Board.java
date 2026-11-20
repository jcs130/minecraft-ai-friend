package org.qiandengji.villagerquests.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The plugin's commission board: posting with caps, player accept/abandon, hand-off to heroes, evidence and
 * the reward ledger. No Bukkit types; time is passed in (epoch millis) so every rule is unit-testable.
 *
 * <p>Rules (design.md §0): only server-observed evidence advances a quest; each evidence id counts once;
 * evidence counts only for the assignee, after acceptance, before the deadline and inside the area; rewards
 * come only from the policy table and each reward key is paid once.
 *
 * <p>Not thread-safe: the plugin only touches it on the server main thread.
 */
public final class Board {
    public enum Status { OPEN, ACCEPTED, HERO, COMPLETED, FAILED, EXPIRED, CANCELLED;
        public boolean open() { return this == OPEN || this == ACCEPTED || this == HERO; } }

    public enum EvidenceKind { KILL, DELIVER, REACH;
        QuestType type() { return switch (this) { case KILL -> QuestType.SLAY; case DELIVER -> QuestType.GATHER; case REACH -> QuestType.REACH; }; } }

    /** A server-observed fact. {@code id} must be unique per real event (entity UUID, delivery serial...). */
    public record Evidence(String id, EvidenceKind kind, String actor, String target, String world,
                           double x, double y, double z, int count, long at, String recipient) {}

    /** A reward the plugin owes. {@code key} is the idempotency key; it is paid at most once. */
    public record Grant(String key, String questId, String recipient, Reward reward) {}

    public record Outcome(String code, Quest quest, int counted) {
        public boolean completed() { return "completed".equals(code); }
        /** Hero quests: the caller writes this evidence to signals.jsonl; the bridge decides completion. */
        public boolean forward() { return "forward".equals(code); }
    }

    public static final class Quest {
        public final String id;
        public final Commission commission;
        public Status status = Status.OPEN;
        public final long createdAt, deadlineAt;
        public String assignee, assigneeName;
        public long acceptedAt;
        public int progress;
        public final List<String> evidence = new ArrayList<>();

        Quest(String id, Commission commission, long createdAt, long deadlineAt) {
            this.id = id;
            this.commission = commission;
            this.createdAt = createdAt;
            this.deadlineAt = deadlineAt;
        }

        public int remaining() { return commission.quantity() - progress; }
    }

    private static final int SEEN_LIMIT = 20_000;
    private static final long DAY = 24L * 60 * 60 * 1000;

    private Policy policy;
    private final Map<String, Quest> quests = new LinkedHashMap<>();
    private final List<Map.Entry<String, Long>> issued = new ArrayList<>();
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private final Map<String, Grant> owed = new LinkedHashMap<>();
    private final LinkedHashSet<String> paid = new LinkedHashSet<>();
    private Set<String> heroBodies;

    public Board(Policy policy, Collection<String> heroBodies) {
        this.policy = policy;
        this.heroBodies = Set.copyOf(heroBodies);
    }

    public void reconfigure(Policy newPolicy, Collection<String> newHeroBodies) {
        this.policy = newPolicy;
        this.heroBodies = Set.copyOf(newHeroBodies);
    }

    public Policy policy() { return policy; }

    public boolean isHero(String uuid) { return uuid != null && heroBodies.contains(uuid); }

    /** Same id the bridge derives: {@code "vq_" + sha256(commissionId)[:16]}. */
    public static String questId(String commissionId) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(commissionId.getBytes(StandardCharsets.UTF_8));
            return "vq_" + HexFormat.of().formatHex(h).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- queries -------------------------------------------------------------------------------------
    public Quest get(String id) { return quests.get(id); }

    public Collection<Quest> all() { return Collections.unmodifiableCollection(quests.values()); }

    public List<Quest> open() { return quests.values().stream().filter(q -> q.status == Status.OPEN).toList(); }

    public List<Quest> activeFor(String player) {
        return quests.values().stream().filter(q -> q.status == Status.ACCEPTED && player.equals(q.assignee)).toList();
    }

    public int openCount(String issuer) {
        return (int) quests.values().stream().filter(q -> q.status.open() && (issuer == null || q.commission.issuer().equals(issuer))).count();
    }

    public int issuedSince(String issuer, long since) {
        return (int) issued.stream().filter(e -> e.getKey().equals(issuer) && e.getValue() > since).count();
    }

    /** Resolves a full id, or a unique prefix of at least 4 characters (with or without {@code vq_}). */
    public Quest resolve(String token) {
        if (token == null) return null;
        String t = token.startsWith("vq_") ? token : "vq_" + token;
        if (quests.containsKey(t)) return quests.get(t);
        if (t.length() < 7) return null;
        List<Quest> m = quests.values().stream().filter(q -> q.id.startsWith(t)).toList();
        return m.size() == 1 ? m.get(0) : null;
    }

    // ---- posting -------------------------------------------------------------------------------------
    /** Posts a commission. A known commissionId returns the existing quest unchanged (idempotent). */
    public Quest post(Commission c, long now) throws Policy.Violation {
        String id = questId(c.commissionId());
        Quest known = quests.get(id);
        if (known != null) return known;
        policy.check(c, openCount(c.issuer()), openCount(null), issuedSince(c.issuer(), now - DAY));
        Quest q = new Quest(id, c, now, now + c.deadlineMinutes() * 60_000L);
        quests.put(id, q);
        issued.add(Map.entry(c.issuer(), now));
        return q;
    }

    // ---- players -------------------------------------------------------------------------------------
    public Quest accept(String questId, String player, String playerName, long now) throws Policy.Violation {
        Quest q = quests.get(questId);
        if (q == null) throw new Policy.Violation("unknown_quest", questId);
        if (q.status == Status.HERO) throw new Policy.Violation("taken_by_hero", questId);
        if (q.status != Status.OPEN) throw new Policy.Violation("not_open", q.status.name());
        if (now >= q.deadlineAt) throw new Policy.Violation("expired", questId);
        if (isHero(player)) throw new Policy.Violation("hero_uses_bridge", "heroes receive commissions through the bridge");
        if (activeFor(player).size() >= policy.maxActivePerPlayer) throw new Policy.Violation("player_limit", String.valueOf(policy.maxActivePerPlayer));
        q.status = Status.ACCEPTED;
        q.assignee = player;
        q.assigneeName = playerName;
        q.acceptedAt = now;
        q.progress = 0;
        return q;
    }

    /** The player gives up: the commission goes back on the board (progress reset; counted evidence stays spent). */
    public Quest abandon(String questId, String player) throws Policy.Violation {
        Quest q = quests.get(questId);
        if (q == null || q.status != Status.ACCEPTED || !player.equals(q.assignee)) throw new Policy.Violation("not_yours", questId);
        q.status = Status.OPEN;
        q.assignee = null;
        q.assigneeName = null;
        q.acceptedAt = 0;
        q.progress = 0;
        q.evidence.clear();
        return q;
    }

    // ---- heroes --------------------------------------------------------------------------------------
    /** Open, hero-capable commissions nobody took within {@code graceMs}. */
    public List<Quest> dueForHandoff(long now, long graceMs) {
        return quests.values().stream().filter(q -> q.status == Status.OPEN && q.commission.type().heroCapable()
                && now - q.createdAt >= graceMs && now < q.deadlineAt).toList();
    }

    /**
     * Marks the commission as handed to the hero bridge and returns what to write to the inbox: the same
     * commission with {@code deadlineMinutes} set to the time actually left (the bridge restarts the clock).
     */
    public Commission handoff(String questId, long now) throws Policy.Violation {
        Quest q = quests.get(questId);
        if (q == null) throw new Policy.Violation("unknown_quest", questId);
        if (q.status != Status.OPEN) throw new Policy.Violation("not_open", q.status.name());
        if (!q.commission.type().heroCapable()) throw new Policy.Violation("type_not_for_heroes", q.commission.type().wire());
        int left = (int) ((q.deadlineAt - now) / 60_000L);
        if (left < policy.deadlineMin) throw new Policy.Violation("too_late_for_heroes", left + " min left");
        q.status = Status.HERO;
        q.acceptedAt = now;
        q.progress = 0;
        return q.commission.withDeadlineMinutes(left);
    }

    /** The inbox write failed: put the commission back on the board for players. */
    public void revertHandoff(String questId) {
        Quest q = quests.get(questId);
        if (q == null || q.status != Status.HERO) return;
        q.status = Status.OPEN;
        q.acceptedAt = 0;
        q.progress = 0;
    }

    /**
     * Applies one bridge feedback line for a hero quest. {@code completed} with a grant owes the table reward of
     * this quest's difficulty to the grant's recipient body (the amount in the line is ignored).
     */
    public Outcome heroFeedback(String questId, String kind, String grantKey, String recipientBody) {
        Quest q = quests.get(questId);
        if (q == null) return new Outcome("unknown_quest", null, 0);
        if (q.status != Status.HERO) return new Outcome("not_hero_quest", q, 0);
        switch (kind) {
            case "completed" -> {
                q.status = Status.COMPLETED;
                if (grantKey != null && recipientBody != null) {
                    if (!isHero(recipientBody)) return new Outcome("recipient_not_hero", q, 0);
                    owe(new Grant(grantKey, q.id, recipientBody, policy.rewardFor(q.commission.difficulty())));
                }
                return new Outcome("completed", q, 0);
            }
            case "failed" -> { q.status = Status.FAILED; return new Outcome("failed", q, 0); }
            case "expired" -> { q.status = Status.EXPIRED; return new Outcome("expired", q, 0); }
            case "cancelled" -> { q.status = Status.CANCELLED; return new Outcome("cancelled", q, 0); }
            default -> { return new Outcome("ignored", q, 0); }
        }
    }

    // ---- evidence ------------------------------------------------------------------------------------
    public Outcome evidence(Evidence e) {
        if (seen.contains(e.id())) return new Outcome("duplicate", null, 0);
        for (Quest q : quests.values()) {
            if (!matches(q, e)) continue;
            int counted = Math.max(0, Math.min(e.count(), q.remaining()));
            if (counted == 0 && q.status != Status.HERO) continue;
            remember(e.id());
            q.progress += counted;
            q.evidence.add(e.id());
            if (q.status == Status.HERO) return new Outcome("forward", q, counted);
            if (q.remaining() <= 0) {
                q.status = Status.COMPLETED;
                owe(new Grant(q.id, q.id, q.assignee, policy.rewardFor(q.commission.difficulty())));
                return new Outcome("completed", q, counted);
            }
            return new Outcome("counted", q, counted);
        }
        return new Outcome("no_match", null, 0);
    }

    private boolean matches(Quest q, Evidence e) {
        Commission c = q.commission;
        if (q.status == Status.ACCEPTED) {
            if (!e.actor().equals(q.assignee)) return false;
        } else if (q.status == Status.HERO) {
            if (!isHero(e.actor())) return false;
        } else return false;
        if (e.kind().type() != c.type()) return false;
        if (e.kind() != EvidenceKind.REACH && !c.target().equals(e.target())) return false;
        if (e.at() < q.acceptedAt || e.at() > q.deadlineAt) return false;
        if (e.count() < 1) return false;
        return switch (e.kind()) {
            case KILL, REACH -> c.area() != null && c.area().contains(e.world(), e.x(), e.y(), e.z());
            case DELIVER -> c.issuer().equals(e.recipient());
        };
    }

    private void remember(String id) {
        seen.add(id);
        if (seen.size() > SEEN_LIMIT) {
            Iterator<String> it = seen.iterator();
            it.next();
            it.remove();
        }
    }

    // ---- time and admin ------------------------------------------------------------------------------
    public List<Quest> expire(long now) {
        List<Quest> out = new ArrayList<>();
        for (Quest q : quests.values()) if (q.status.open() && now >= q.deadlineAt) { q.status = Status.EXPIRED; out.add(q); }
        return out;
    }

    public Quest cancel(String questId) {
        Quest q = quests.get(questId);
        if (q != null && q.status.open()) q.status = Status.CANCELLED;
        return q;
    }

    /** Drops finished quests older than {@code keepMs} and issuance records older than a day. */
    public void prune(long now, long keepMs) {
        quests.values().removeIf(q -> !q.status.open() && now - q.deadlineAt > keepMs && !owedFor(q.id));
        issued.removeIf(e -> e.getValue() <= now - DAY);
    }

    private boolean owedFor(String questId) {
        return owed.values().stream().anyMatch(g -> g.questId().equals(questId));
    }

    // ---- reward ledger -------------------------------------------------------------------------------
    private void owe(Grant g) {
        if (g.reward() == null) return; // tier removed by a reload: nothing is owed rather than an invented amount
        if (paid.contains(g.key()) || owed.containsKey(g.key())) return;
        owed.put(g.key(), g);
    }

    public List<Grant> owedTo(String recipient) {
        return owed.values().stream().filter(g -> g.recipient().equals(recipient)).toList();
    }

    public Collection<Grant> owed() { return Collections.unmodifiableCollection(owed.values()); }

    /** Call after the reward was actually handed out. Returns false if it was already paid (do not pay twice). */
    public boolean markPaid(String key) {
        if (paid.contains(key)) return false;
        if (owed.remove(key) == null) return false;
        paid.add(key);
        return true;
    }

    public boolean isPaid(String key) { return paid.contains(key); }

    // ---- persistence ---------------------------------------------------------------------------------
    public JsonObject toJson() {
        JsonObject root = new JsonObject();
        root.addProperty("version", 1);
        JsonArray qs = new JsonArray();
        for (Quest q : quests.values()) {
            JsonObject o = new JsonObject();
            o.addProperty("id", q.id);
            o.add("commission", q.commission.toJson());
            o.addProperty("status", q.status.name());
            o.addProperty("createdAt", q.createdAt);
            o.addProperty("deadlineAt", q.deadlineAt);
            if (q.assignee != null) o.addProperty("assignee", q.assignee);
            if (q.assigneeName != null) o.addProperty("assigneeName", q.assigneeName);
            o.addProperty("acceptedAt", q.acceptedAt);
            o.addProperty("progress", q.progress);
            JsonArray ev = new JsonArray();
            q.evidence.forEach(ev::add);
            o.add("evidence", ev);
            qs.add(o);
        }
        root.add("quests", qs);
        JsonArray is = new JsonArray();
        for (Map.Entry<String, Long> e : issued) { JsonObject o = new JsonObject(); o.addProperty("issuer", e.getKey()); o.addProperty("at", e.getValue()); is.add(o); }
        root.add("issued", is);
        JsonArray s = new JsonArray(); seen.forEach(s::add); root.add("seen", s);
        JsonArray p = new JsonArray(); paid.forEach(p::add); root.add("paid", p);
        JsonArray ow = new JsonArray();
        for (Grant g : owed.values()) {
            JsonObject o = new JsonObject();
            o.addProperty("key", g.key()); o.addProperty("questId", g.questId()); o.addProperty("recipient", g.recipient());
            o.add("reward", g.reward().toJson());
            ow.add(o);
        }
        root.add("owed", ow);
        return root;
    }

    public void load(JsonObject root) {
        quests.clear(); issued.clear(); seen.clear(); paid.clear(); owed.clear();
        if (root == null) return;
        for (JsonElement el : root.getAsJsonArray("quests")) {
            JsonObject o = el.getAsJsonObject();
            Quest q = new Quest(o.get("id").getAsString(), Commission.fromJson(o.getAsJsonObject("commission")),
                    o.get("createdAt").getAsLong(), o.get("deadlineAt").getAsLong());
            q.status = Status.valueOf(o.get("status").getAsString());
            q.assignee = o.has("assignee") ? o.get("assignee").getAsString() : null;
            q.assigneeName = o.has("assigneeName") ? o.get("assigneeName").getAsString() : null;
            q.acceptedAt = o.get("acceptedAt").getAsLong();
            q.progress = o.get("progress").getAsInt();
            o.getAsJsonArray("evidence").forEach(x -> q.evidence.add(x.getAsString()));
            quests.put(q.id, q);
        }
        root.getAsJsonArray("issued").forEach(x -> issued.add(Map.entry(x.getAsJsonObject().get("issuer").getAsString(), x.getAsJsonObject().get("at").getAsLong())));
        root.getAsJsonArray("seen").forEach(x -> seen.add(x.getAsString()));
        root.getAsJsonArray("paid").forEach(x -> paid.add(x.getAsString()));
        for (JsonElement el : root.getAsJsonArray("owed")) {
            JsonObject o = el.getAsJsonObject(), r = o.getAsJsonObject("reward");
            owed.put(o.get("key").getAsString(), new Grant(o.get("key").getAsString(), o.get("questId").getAsString(),
                    o.get("recipient").getAsString(), new Reward(r.get("emeralds").getAsInt(), r.get("vortexXp").getAsInt(), r.get("fame").getAsInt())));
        }
    }
}
