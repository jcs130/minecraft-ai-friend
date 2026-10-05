package dev.qiandeng.maw;

import com.google.gson.JsonObject;

import java.util.LinkedHashMap;

/** Current-login, per-player, bounded receipts. This is not a durable exactly-once ledger. */
final class MenuActionReplay {
    enum Outcome { NEW, REPLAY, CONFLICT, IN_PROGRESS }
    record Lookup(Outcome outcome, String response) {}
    private record Receipt(String fingerprint, String response) {}
    private static final int MAX_RECEIPTS = 32;
    private final LinkedHashMap<String, Receipt> receipts = new LinkedHashMap<>();

    Lookup begin(String requestId, JsonObject input) {
        // The shared canonicalizer includes every parameter and complete SNBT,
        // preserves JSON types/array order, and rejects malformed Unicode.
        String fingerprint = ColonyActionReplay.fingerprint(input);
        Receipt previous = receipts.get(requestId);
        if (previous != null) {
            if (!previous.fingerprint().equals(fingerprint)) return new Lookup(Outcome.CONFLICT, null);
            return previous.response() == null ? new Lookup(Outcome.IN_PROGRESS, null)
                    : new Lookup(Outcome.REPLAY, previous.response());
        }
        receipts.put(requestId, new Receipt(fingerprint, null));
        while (receipts.size() > MAX_RECEIPTS) receipts.remove(receipts.keySet().iterator().next());
        return new Lookup(Outcome.NEW, null);
    }

    boolean complete(String requestId, String response) {
        Receipt reserved = receipts.get(requestId);
        if (reserved == null || reserved.response() != null) return false;
        receipts.put(requestId, new Receipt(reserved.fingerprint(), response));
        return true;
    }
}
