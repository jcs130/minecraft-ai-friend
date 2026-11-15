package local.tlmcompat.hybrid;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** A bounded nearby exchange, shared by named messages, implicit replies and ASR. */
final class MaidConversationWindow {
    static final int MAX_REQUESTS = 6;
    static final long DURATION = 120_000_000_000L;
    record Admission(boolean allowed, int retryAfterSeconds) {}
    private static final Admission ACCEPT = new Admission(true, 0);
    private static final Admission IGNORE = new Admission(false, 0);
    private static final Set<String> CLOSINGS = Set.of(
        "好", "好的", "好呀", "好嘞", "嗯", "嗯嗯", "收到", "明白了", "知道了", "谢谢", "谢谢你", "辛苦了",
        "再见", "拜拜", "回头聊", "晚点聊", "晚点再聊", "先不聊了", "聊到这儿", "就这样", "晚安",
        "谢谢回头聊", "好了我先忙了", "我先忙了", "你先忙", "谢谢晚点聊");

    private static final class Turn {
        final UUID maid, world;
        final Object connection;
        final long until;
        long lastActivity, quietUntil = Long.MIN_VALUE;
        int requests;
        boolean listening, quietReported;
        String lastReply = "";

        Turn(UUID maid, UUID world, Object connection, long now) {
            this.maid = maid;
            this.world = world;
            this.connection = connection;
            this.until = now + DURATION;
            this.lastActivity = now;
        }
    }

    private final Map<UUID, Turn> turns = new LinkedHashMap<>();

    private Turn current(UUID actor, UUID maid, UUID world, Object connection, long now) {
        Turn turn = turns.get(actor);
        if (turn == null || !turn.maid.equals(maid)) return null;
        boolean quiet = turn.quietUntil != Long.MIN_VALUE;
        if (!turn.world.equals(world) || turn.connection != connection
                || (quiet ? now >= turn.quietUntil : now >= turn.until && now - turn.lastActivity >= DURATION)) {
            turns.remove(actor);
            return null;
        }
        return turn;
    }

    private Turn begin(UUID actor, UUID maid, UUID world, Object connection, long now) {
        Turn turn = new Turn(maid, world, connection, now);
        turns.put(actor, turn);
        while (turns.size() > 64) turns.remove(turns.keySet().iterator().next());
        return turn;
    }

    /** Validate after delivery and proximity checks. Only admitted calls spend a turn. */
    Admission admit(UUID actor, UUID maid, UUID world, Object connection, String text, boolean namedPartner, long now) {
        Turn turn = current(actor, maid, world, connection, now);
        String normalized = normalize(text);
        if (CLOSINGS.contains(normalized)) {
            close(actor, maid, world, connection, now);
            return IGNORE;
        }
        if (turn != null) {
            if (normalized.equals(turn.lastReply) && !normalized.isEmpty()) return IGNORE;
            if (turn.quietUntil == Long.MIN_VALUE && (now >= turn.until || turn.requests >= MAX_REQUESTS)) {
                turn.quietUntil = Math.min(now, turn.until) + DURATION;
            }
            if (turn.quietUntil != Long.MIN_VALUE) {
                if (!namedPartner || turn.quietReported) return IGNORE;
                turn.quietReported = true;
                int seconds = (int) Math.ceilDiv(turn.quietUntil - now, 1_000_000_000L);
                return new Admission(false, seconds);
            }
        }
        return ACCEPT;
    }

    boolean started(UUID actor, UUID maid, UUID world, Object connection, long now) {
        Turn turn = current(actor, maid, world, connection, now);
        if (turn == null) turn = begin(actor, maid, world, connection, now);
        turn.lastActivity = now;
        return ++turn.requests >= MAX_REQUESTS;
    }

    void replied(UUID actor, UUID maid, UUID world, Object connection, String reply, boolean proactive, long now) {
        Turn turn = current(actor, maid, world, connection, now);
        if (turn == null && proactive) turn = begin(actor, maid, world, connection, now);
        if (turn == null || turn.quietUntil != Long.MIN_VALUE) return;
        turn.lastActivity = now;
        if (now >= turn.until || turn.requests >= MAX_REQUESTS || CLOSINGS.contains(normalize(reply))) {
            turn.quietUntil = now + DURATION;
            return;
        }
        turn.lastReply = normalize(reply);
        turn.listening = true;
    }

    void close(UUID actor, UUID maid, UUID world, Object connection, long now) {
        Turn turn = current(actor, maid, world, connection, now);
        if (turn == null) turn = begin(actor, maid, world, connection, now);
        if (turn.quietUntil == Long.MIN_VALUE) turn.quietUntil = now + DURATION;
    }

    boolean mayInitiate(UUID actor, UUID maid, UUID world, Object connection, long now) {
        return current(actor, maid, world, connection, now) == null;
    }

    void reset(UUID actor) { turns.remove(actor); }

    String followup(UUID actor, UUID maid, UUID world, Object connection, String text, long now) {
        Turn turn = current(actor, maid, world, connection, now);
        if (turn == null || !turn.listening || turn.quietUntil != Long.MIN_VALUE || now >= turn.until
                || turn.requests >= MAX_REQUESTS) return null;
        String value = text == null ? "" : text.strip();
        if (value.isEmpty() || value.length() > 140 || value.startsWith("/") || value.startsWith("!")
                || value.startsWith("@") || value.codePoints().anyMatch(c -> Character.isISOControl(c) || c == 0xA7)) return null;
        return value;
    }

    private static String normalize(String text) {
        return text == null ? "" : text.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }
}
