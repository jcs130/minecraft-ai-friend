package dev.qiandeng.maw.saoforge;

import java.nio.charset.StandardCharsets;
import at.favre.lib.crypto.bcrypt.BCrypt;

/** Explicitly tagged old MixAuth hashes; never guesses plaintext or other formats. */
public final class SaoLegacyPasswords {
    public static final String PREFIX = "maw_mixauth_bcrypt:";
    public static Boolean verifyIfLegacy(String password, String storedHash) {
        if (storedHash == null || !storedHash.startsWith(PREFIX)) return null;
        String hash = storedHash.substring(PREFIX.length());
        if (password == null || password.getBytes(StandardCharsets.UTF_8).length > 72 ||
            !hash.matches("\\$2[aby]\\$(?:0[4-9]|1[0-6])\\$[./A-Za-z0-9]{53}")) return false;
        try { return BCrypt.verifyer().verify(password.toCharArray(), hash).verified; }
        catch (IllegalArgumentException malformed) { return false; }
    }
    private SaoLegacyPasswords() {}
}
