package dev.qiandeng.irons;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Stable quotes bind the merchant and exact components, but not restock counters. */
public final class TradeRules {
    private TradeRules() {}
    public static String quote(String merchant, int index, String costA, String costB, String result) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(
                (merchant + "\n" + index + "\n" + costA + "\n" + costB + "\n" + result)
                    .getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public static boolean validQuote(String quote) { return quote != null && quote.matches("[0-9a-f]{64}"); }
    public static boolean validIndex(int index, int size) { return index >= 0 && index < Math.min(size, 20); }
}
