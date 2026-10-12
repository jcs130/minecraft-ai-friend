package org.afuhome.cortieye;

import com.google.gson.JsonParser;
import java.util.regex.Pattern;

/** MC_* JSON and legacy key=value receipts belong to the body connection.
 * Ordinary player chat (including a quoted MC_* string) must still be mirrored. */
final class MachineChatReceipts {
    private static final Pattern PREFIX = Pattern.compile("MC_[A-Z0-9_]+\\s+");
    // Legacy dungeon, waypoint and player-location responses use key=value
    // rather than JSON. Require a real field at the start, not ordinary prose.
    private static final Pattern FIELD = Pattern.compile("[A-Za-z][A-Za-z0-9_]*=[^\\s]+(?:\\s|$)");
    private MachineChatReceipts() { }

    static boolean matches(String text) {
        if (text == null || !text.startsWith("MC_")) return false;
        var matcher = PREFIX.matcher(text);
        if (!matcher.lookingAt()) return false;
        String body = text.substring(matcher.end());
        if (!body.startsWith("{")) return FIELD.matcher(body).lookingAt();
        try { return JsonParser.parseString(body).isJsonObject(); }
        catch (RuntimeException invalid) { return false; }
    }
}
