package org.afuhome.cortieye;

import com.google.gson.JsonParser;
import java.util.regex.Pattern;

/** The reserved MC_* system-message namespace and protection guidance belong to the body connection,
 * including plain command hints and incomplete/older receipts. This is a
 * presentation boundary, not JSON validation. Player chat is handled separately. */
final class MachineChatReceipts {
    private static final Pattern PREFIX = Pattern.compile("(?:MC_[A-Z0-9_]+|\\[MC_[A-Z0-9_]+\\])(?=\\s|$)");
    private static final Pattern FORMAT = Pattern.compile("§[0-9A-FK-ORXa-fk-orx]");
    private MachineChatReceipts() { }

    static boolean matches(String text) {
        if (text == null) return false;
        // Some plugins embed legacy section formatting in otherwise plain text.
        String plain = text.indexOf('§') < 0 ? text : FORMAT.matcher(text).replaceAll("");
        plain = plain.stripLeading();
        if (PREFIX.matcher(plain).lookingAt()) return true;
        if (plain.startsWith("{")) {
            try {
                var data = JsonParser.parseString(plain).getAsJsonObject();
                var type = data.get("type");
                if (data.has("schemaVersion") && data.get("schemaVersion").getAsInt() == 1
                        && type != null && type.isJsonPrimitive() && type.getAsJsonPrimitive().isString()
                        && type.getAsString().matches("MC_[A-Z0-9_]+")) return true;
            } catch (RuntimeException invalid) { /* Ordinary JSON/prose is not a reserved receipt. */ }
        }
        // These are the actor's command/failure explanations, not world speech.
        // In particular, human-format protection queries must not become a
        // second spectator chat feed when the actor isn't an ag_ account.
        return plain.startsWith("【保护查询】") || plain.startsWith("【保护范围】")
                || plain.startsWith("【操作未执行】") || plain.startsWith("【正确做法】")
                || plain.startsWith("【操作未完成】")
                || plain.startsWith("【委托未计数】") || plain.startsWith("【委托进度】")
                || plain.startsWith("[生活挑战]") || plain.startsWith("[公共档案馆]")
                || plain.startsWith("「") && plain.contains("（含边界）；请停止未授权操作。");
    }
}
