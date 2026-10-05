package dev.qiandeng.maw;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.nio.charset.StandardCharsets;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.CharBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.TreeMap;

/** Bounded per-player receipt ledger; an ID can only replay its original complete action payload. */
final class ColonyActionReplay {
    enum Outcome { NEW, REPLAY, CONFLICT, IN_PROGRESS }
    record Lookup(Outcome outcome, String response) {}
    private record Receipt(String fingerprint, String response) {}
    private final LinkedHashMap<String, Receipt> receipts = new LinkedHashMap<>();
    private static final int MAX_RECEIPTS = 32;

    Lookup begin(String requestId, JsonObject input) {
        String fingerprint = fingerprint(input);
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

    static String fingerprint(JsonObject input) {
        StringBuilder canonical = new StringBuilder();
        append(input, canonical, 0, new int[]{0});
        try {
            // Never replace distinct malformed UTF-16 strings with the same UTF-8 '?'.
            var bytes = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(canonical));
            if (bytes.remaining() > 65536) throw new IllegalArgumentException("canonical colony action too large");
            var digest = MessageDigest.getInstance("SHA-256");
            digest.update(bytes);
            return HexFormat.of().formatHex(digest.digest());
        } catch (CharacterCodingException invalidString) {
            throw new IllegalArgumentException("colony action contains malformed Unicode", invalidString);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static void append(JsonElement value, StringBuilder out, int depth, int[] nodes) {
        if (depth > 32 || ++nodes[0] > 4096 || out.length() > 65536) {
            throw new IllegalArgumentException("colony action fingerprint budget exceeded");
        }
        if (value.isJsonObject()) {
            out.append('{');
            boolean first = true;
            for (var entry : new TreeMap<>(value.getAsJsonObject().asMap()).entrySet()) {
                if (depth == 0 && entry.getKey().equals("requestId")) continue;
                if (!first) out.append(',');
                first = false;
                out.append(new com.google.gson.JsonPrimitive(entry.getKey())).append(':');
                append(entry.getValue(), out, depth + 1, nodes);
            }
            out.append('}');
        } else if (value.isJsonArray()) {
            out.append('[');
            boolean first = true;
            for (JsonElement entry : value.getAsJsonArray()) {
                if (!first) out.append(',');
                first = false;
                append(entry, out, depth + 1, nodes);
            }
            out.append(']');
        } else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) {
            var number = value.getAsBigDecimal().stripTrailingZeros();
            // Plain ordinary coordinates/counts; enormous exponents stay compact.
            out.append(number.scale() >= -32 && number.scale() <= 32 ? number.toPlainString() : number.toString());
        } else {
            // Gson preserves the full parsed string, including SNBT and component contents.
            out.append(value);
        }
    }
}
