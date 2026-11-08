package org.qiandengji.geyserlan;

import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/** Xbox LAN interoperability only. Does not authorize a player or alter login validation. */
final class LanAnswerPolicy {
    private static final int LIMIT = 256;
    private static final long TTL_MS = 60_000;
    private static final String RESPONSE = "CONNECTRESPONSE ";
    private static final Pattern IDENTITY = Pattern.compile("(?m)^a=identity:[^\\r\\n]*(?:\\r?\\n|$)");
    private record Peer(String connection, String network) {}
    private final Map<Peer, Long> unsigned = new HashMap<>();
    private final LongSupplier clock;

    LanAnswerPolicy() { this(System::currentTimeMillis); }
    LanAnswerPolicy(LongSupplier clock) { this.clock = clock; }

    synchronized void offered(String connection, String network, String offer, boolean allowedLan, boolean validatedIdentity) {
        prune();
        Peer peer = new Peer(connection, network);
        unsigned.remove(peer);
        if (!allowedLan || validatedIdentity || connection == null || network == null || offer == null
                || connection.isEmpty() || connection.length() > 128 || network.length() > 32
                || offer.lines().anyMatch(line -> line.startsWith("a=identity:")) || unsigned.size() >= LIMIT) return;
        unsigned.put(peer, clock.getAsLong());
    }

    synchronized String answer(String network, String signal) {
        prune();
        if (signal == null || !signal.startsWith(RESPONSE)) return signal;
        int separator = signal.indexOf(' ', RESPONSE.length());
        if (separator < 0 || !unsigned.containsKey(new Peer(signal.substring(RESPONSE.length(), separator), network))) return signal;
        // Preserve every other byte of the SDP, including ICE credentials, candidates and DTLS fingerprint.
        // Signed offers and HTTP/NXS never enter this compatibility branch.
        return signal.substring(0, separator + 1) + IDENTITY.matcher(signal.substring(separator + 1)).replaceAll("");
    }

    synchronized void closed(String connection) { unsigned.keySet().removeIf(peer -> peer.connection.equals(connection)); }
    synchronized void clear() { unsigned.clear(); }
    private void prune() { long now = clock.getAsLong(); unsigned.values().removeIf(at -> now - at > TTL_MS || now < at); }
}
