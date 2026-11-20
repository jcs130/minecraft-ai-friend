package org.qiandengji.villagerquests.core;

import java.util.regex.Pattern;

/**
 * Cleans any text that did not come from this plugin's own templates (model output, outbox lines).
 * Same rules as {@code agent_mc_harness.quests.policy.clean_text}: color / MiniMessage codes and control
 * characters are dropped, whitespace collapsed, a leading command slash removed, length capped.
 */
public final class Text {
    private static final Pattern COLOR = Pattern.compile(
            "(?:[\u00a7&]#[0-9a-f]{6})|(?:[\u00a7&][0-9a-fk-orx])|<[^<>]{1,40}>", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f\\u2028\\u2029]+");
    private static final Pattern SPACE = Pattern.compile("\\s+");

    private Text() {}

    public static String clean(String value, int limit) {
        if (value == null) return "";
        String text = value;
        // Repeat so that nested tricks like "&&aa" or "<<b>b>" cannot rebuild a code after one pass.
        for (int i = 0; i < 4; i++) {
            String next = COLOR.matcher(text).replaceAll("");
            if (next.equals(text)) break;
            text = next;
        }
        text = CONTROL.matcher(text).replaceAll(" ");
        text = SPACE.matcher(text).replaceAll(" ").strip();
        while (text.startsWith("/") || text.startsWith("\u00a7") || text.startsWith("&")) text = text.substring(1).strip();
        text = text.replace("\u00a7", "");
        return truncate(text, limit);
    }

    public static String truncate(String text, int limit) {
        if (text.codePointCount(0, text.length()) <= limit) return text;
        return text.substring(0, text.offsetByCodePoints(0, limit));
    }
}
