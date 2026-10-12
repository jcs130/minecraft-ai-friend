package org.afuhome.cortieye;

import com.google.gson.JsonParser;
import java.util.regex.Pattern;

/** MC_* JSON is machine feedback for the body connection, not livestream chat.
 * Ordinary player chat (including a quoted MC_* string) must still be mirrored. */
final class MachineChatReceipts {
    private static final Pattern PREFIX = Pattern.compile("MC_[A-Z0-9_]+\\s+");
    private MachineChatReceipts() { }

    static boolean matches(String text) {
        if (text == null || !text.startsWith("MC_")) return false;
        var matcher = PREFIX.matcher(text);
        if (!matcher.lookingAt()) return false;
        String body = text.substring(matcher.end());
        if (!body.startsWith("{")) return false;
        try { return JsonParser.parseString(body).isJsonObject(); }
        catch (RuntimeException invalid) { return false; }
    }
}
