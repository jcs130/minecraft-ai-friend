package org.afuhome.identity;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Authenticates the proxy's original Java identity on exactly one backend login. */
public final class IdentityHandoff {
    private static final String PREFIX = "qdj1-";
    private static final int BODY_LENGTH = 20;
    private static final int TAG_LENGTH = 16;
    private static final int ENCODED_LENGTH = 48;
    private static final long LIFETIME_MS = 20_000;

    private final SecretKeySpec key;
    private final byte[] identity;
    private final SecureRandom random = new SecureRandom();
    private final ConcurrentHashMap<String, Long> consumed = new ConcurrentHashMap<>();

    public static IdentityHandoff read(Path keyFile, PlatformIdentity identity) throws IOException {
        String hex = Files.readString(keyFile).strip();
        if (!hex.matches("[0-9a-fA-F]{64}")) throw new IllegalArgumentException("Invalid identity handoff key");
        return new IdentityHandoff(HexFormat.of().parseHex(hex), identity);
    }

    public IdentityHandoff(byte[] key, PlatformIdentity link) {
        if (key.length != 32) throw new IllegalArgumentException("A 32-byte identity handoff key is required");
        this.key = new SecretKeySpec(key, "HmacSHA256");
        identity = String.join("\0", "qiandengji-java-identity-v1", "paper", link.javaName(), link.premiumUuid().toString(),
            link.bedrockName(), link.bedrockUuid().toString()).getBytes(StandardCharsets.UTF_8);
    }

    public String signHostname(String originalHostname, long now) {
        byte[] nonce = new byte[BODY_LENGTH - Long.BYTES];
        random.nextBytes(nonce);
        byte[] body = ByteBuffer.allocate(BODY_LENGTH).putLong(now + LIFETIME_MS).put(nonce).array();
        byte[] ticket = ByteBuffer.allocate(BODY_LENGTH + TAG_LENGTH).put(body).put(tag(body)).array();
        String hostname = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(ticket) + "." + originalHostname;
        // Leave any existing Forge handshake suffix untouched.
        if (hostname.length() > 255) throw new IllegalArgumentException("Identity handoff hostname is too long");
        return hostname;
    }

    public boolean consumeHostname(String hostname, long now) {
        int end = PREFIX.length() + ENCODED_LENGTH;
        if (hostname == null || !hostname.startsWith(PREFIX) || hostname.length() <= end || hostname.charAt(end) != '.') return false;
        String encoded = hostname.substring(PREFIX.length(), end);
        byte[] ticket;
        try {
            ticket = Base64.getUrlDecoder().decode(encoded);
        } catch (IllegalArgumentException invalid) {
            return false;
        }
        if (ticket.length != BODY_LENGTH + TAG_LENGTH) return false;
        long expiry = ByteBuffer.wrap(ticket).getLong();
        if (expiry <= now || expiry - now > LIFETIME_MS) return false;
        if (!MessageDigest.isEqual(tag(Arrays.copyOf(ticket, BODY_LENGTH)), Arrays.copyOfRange(ticket, BODY_LENGTH, ticket.length))) {
            return false;
        }
        consumed.values().removeIf(previous -> previous <= now);
        return consumed.putIfAbsent(encoded, expiry) == null;
    }

    private byte[] tag(byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            mac.update(identity);
            return Arrays.copyOf(mac.doFinal(body), TAG_LENGTH);
        } catch (GeneralSecurityException unavailable) {
            throw new IllegalStateException("Identity handoff authentication unavailable", unavailable);
        }
    }
}
