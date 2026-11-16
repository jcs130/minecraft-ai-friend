package local.tlmcompat.hybrid;

/** Short, low-priority reactions to observed damage, never an instruction to attack. */
final class MaidCombatSpeech {
    static final long GAP = 30_000_000_000L, MAX_AGE = 12_000_000_000L;
    private enum Reactions {
        MAGIC("法术命中了！", "这一发中了。", "咒术奏效了。", "打到它了！"),
        RANGED("我射中了。", "这发打到了。", "远程命中了。", "好，这发没打偏。"),
        MELEE("这一击中了。", "我打到它了。", "这一下打实了。", "近身那一下中了。");

        final String[] lines;

        Reactions(String... lines) { this.lines = lines; }
    }

    private long next = Long.MIN_VALUE;
    private final int[] nextLine = new int[Reactions.values().length];

    String hit(long now, float damage, String mode, boolean audience, boolean busy) {
        if (!Float.isFinite(damage) || damage <= 0 || !audience || busy || now < next) return null;
        Reactions reactions = switch (mode) {
            case "MAGIC" -> Reactions.MAGIC;
            case "RANGED" -> Reactions.RANGED;
            default -> Reactions.MELEE;
        };
        int type = reactions.ordinal();
        int line = nextLine[type];
        nextLine[type] = (line + 1) % reactions.lines.length;
        next = now + GAP;
        return reactions.lines[line];
    }

    static boolean fresh(long created, long now) { return now - created >= 0 && now - created <= MAX_AGE; }
    static boolean lowPriority(String kind) { return kind.equals("ambient") || kind.equals("combat"); }
}
