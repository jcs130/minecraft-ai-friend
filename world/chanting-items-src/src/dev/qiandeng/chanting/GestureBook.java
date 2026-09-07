package dev.qiandeng.chanting;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Pure, single server-thread input gate. It never executes or refunds a spell. */
public final class GestureBook {
    public static final Set<String> ITEMS = Set.of("qiandeng_chanting:whispering_staff", "qiandeng_chanting:resonance_staff");
    public static final long CLOCK_SKEW_MS = 5_000, RELEASE_GRACE_MS = 8_000, RECORDING_TAIL_MS = 2_000;
    public static final long MAX_RECORDING_AGE_MS = 125_000, RETENTION_MS = 130_000;
    public record Held(String itemId, Object identity) {}
    public record Pose(boolean eligible, Map<String, Held> hands, String usingHand) {
        public boolean holding() { return hands.values().stream().anyMatch(h -> ITEMS.contains(h.itemId())); }
        public boolean using() {
            Held h = hands.get(usingHand);
            return eligible && h != null && ITEMS.contains(h.itemId());
        }
    }
    public record Snapshot(String id, String itemId, String hand, long startedAt, Long releasedAt,
                           boolean active, boolean claimed, String invalidCode, int slot) {}
    public record Result(boolean ok, String code, Snapshot gesture) {}
    private static final class Gesture {
        String id, hand, itemId, invalidCode;
        Object identity;
        long start;
        Long release;
        boolean claimed;
        int slot;
        long modeChangedAt;
        Snapshot snapshot() { return new Snapshot(id, itemId, hand, start, release, release == null, claimed, invalidCode, slot); }
    }
    private final Map<String, List<Gesture>> history = new HashMap<>();
    private final String prefix;
    private final long startedAt;
    private long sequence;
    public GestureBook(String prefix, long startedAt) { this.prefix = prefix; this.startedAt = startedAt; }

    public Snapshot begin(String actor, Pose pose, long now) {
        observe(actor, pose, now);
        if (!pose.using()) return null;
        Held held = pose.hands().get(pose.usingHand());
        List<Gesture> rows = history.computeIfAbsent(actor, unused -> new ArrayList<>());
        if (!rows.isEmpty()) {
            Gesture last = rows.getLast();
            if (last.release == null && last.identity == held.identity() && last.hand.equals(pose.usingHand())) return last.snapshot();
        }
        Gesture g = new Gesture();
        g.id = prefix + "-" + (++sequence); g.start = now; g.hand = pose.usingHand();
        g.itemId = held.itemId(); g.identity = held.identity();
        rows.add(g);
        return g.snapshot();
    }

    public void release(String actor, String hand, Object identity, long now) {
        List<Gesture> rows = history.get(actor);
        if (rows == null || rows.isEmpty()) return;
        Gesture g = rows.getLast();
        if (g.release == null && g.identity == identity && g.hand.equals(hand)) g.release = Math.max(g.start, now);
    }

    public void cancel(String actor, long now) {
        for (Gesture g : history.getOrDefault(actor, List.of())) {
            if (g.invalidCode == null) g.invalidCode = "gesture_cancelled";
            if (g.release == null) g.release = Math.max(g.start, now);
        }
    }

    public void select(String actor, int slot, Pose pose, long now) {
        if (slot < 0 || slot > 8) return;
        observe(actor, pose, now);
        List<Gesture> rows = history.get(actor);
        if (rows == null || rows.isEmpty()) return;
        Gesture g = rows.getLast();
        if (g.release == null && g.invalidCode == null && !g.claimed && pose.using() && g.slot != slot) {
            g.slot = slot; g.modeChangedAt = now;
        }
    }

    public void observe(String actor, Pose pose, long now) {
        List<Gesture> rows = history.get(actor);
        if (rows == null) return;
        for (Gesture g : rows) {
            Held current = pose.hands().get(g.hand);
            if (g.invalidCode == null) {
                if (!pose.eligible()) g.invalidCode = "actor_unavailable";
                else if (current == null || current.identity() != g.identity || !g.itemId.equals(current.itemId())) g.invalidCode = "staff_changed";
            }
            if (g.release == null && (g.invalidCode != null || !g.hand.equals(pose.usingHand()))) g.release = Math.max(g.start, now);
        }
    }

    public Snapshot status(String actor, Pose pose, long now) {
        observe(actor, pose, now);
        List<Gesture> rows = history.get(actor);
        return rows == null || rows.isEmpty() ? null : rows.getLast().snapshot();
    }

    public Result claim(String actor, long recordedAt, long recordingEndedAt, int slot, Pose pose, long now) {
        observe(actor, pose, now);
        if (recordedAt <= 0 || recordedAt < now - MAX_RECORDING_AGE_MS || recordingEndedAt < recordedAt || recordingEndedAt > now + CLOCK_SKEW_MS || slot < 0 || slot > 8)
            return new Result(false, "invalid_recorded_at", null);
        // A restart must not turn a pre-restart staff recording into direct voice.
        if (recordedAt < startedAt) return new Result(false, "server_restarted", null);
        if (!pose.eligible()) return new Result(false, "actor_unavailable", null);
        Gesture match = null;
        boolean intersects = false;
        for (Gesture g : history.getOrDefault(actor, List.of())) {
            long end = g.release == null ? Long.MAX_VALUE : g.release + RECORDING_TAIL_MS;
            if (recordingEndedAt >= g.start && recordedAt <= end) intersects = true;
            // Capture and gestures use the same Minecraft host clock. Never
            // infer a new gesture from audio that began before it existed.
            if (g.start > recordedAt && g.start <= recordingEndedAt) return new Result(false, "ambiguous_gesture", null);
            if (recordedAt < g.start || recordingEndedAt > end) continue;
            if (match != null) return new Result(false, "ambiguous_gesture", null);
            match = g;
        }
        if (match == null) return new Result(!pose.holding() && !intersects, intersects ? "recording_crossed_gesture" : pose.holding() ? "gesture_required" : "direct_voice", null);
        if (match.claimed) return new Result(false, "gesture_consumed", match.snapshot());
        if (match.invalidCode != null) return new Result(false, match.invalidCode, match.snapshot());
        if (slot != match.slot) return new Result(false, slot == 0 ? "shortcut_selected" : "slot_changed", match.snapshot());
        if (slot == 0 && recordedAt < match.modeChangedAt) return new Result(false, "gesture_mode_changed", match.snapshot());
        if (match.release == null) return new Result(false, "gesture_pending", match.snapshot());
        if (match.release != null && now - match.release > RELEASE_GRACE_MS)
            return new Result(false, "gesture_expired", match.snapshot());
        match.claimed = true; // Consume BEFORE the caller dispatches any skill.
        return new Result(true, "claimed", match.snapshot());
    }

    public void prune(long now) {
        history.values().forEach(rows -> rows.removeIf(g -> g.release != null && now - g.release > RETENTION_MS));
        history.entrySet().removeIf(e -> e.getValue().isEmpty());
    }
}
