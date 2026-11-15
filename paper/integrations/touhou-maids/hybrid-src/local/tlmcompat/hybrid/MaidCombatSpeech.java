package local.tlmcompat.hybrid;

/** Short, low-priority reactions to observed damage, never an instruction to attack. */
final class MaidCombatSpeech {
    static final long GAP = 30_000_000_000L, MAX_AGE = 12_000_000_000L;
    private long next = Long.MIN_VALUE;
    private int sequence;

    String hit(long now, float damage, String mode, boolean audience, boolean busy) {
        if (!Float.isFinite(damage) || damage <= 0 || !audience || busy || now < next) return null;
        String[] lines = switch (mode) {
            case "MAGIC" -> new String[]{"法术命中了，继续！", "这一下打中了！"};
            case "RANGED" -> new String[]{"远处这只，打中了！", "中了，留意身边！"};
            default -> new String[]{"打中了，继续！", "这一击中了！"};
        };
        next = now + GAP;
        return lines[sequence++ % lines.length];
    }

    static boolean fresh(long created, long now) { return now - created >= 0 && now - created <= MAX_AGE; }
    static boolean lowPriority(String kind) { return kind.equals("ambient") || kind.equals("combat"); }
}
