package dev.qiandeng.irons;

/** Offline quote-contract checks; no Minecraft classes, world or inventories. */
public final class TradeRulesTest {
    private static int checks;
    private static final String MERCHANT = "00000000-0000-0000-0000-000000000001";
    private static final String COST_A = "{id:\"minecraft:emerald\",count:12}";
    private static final String COST_B = "{id:\"minecraft:book\",count:1}";
    private static final String RESULT = "{id:\"minecraft:enchanted_book\",count:1,components:{\"minecraft:stored_enchantments\":{levels:{\"minecraft:mending\":1}}}}";

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
        checks++;
    }
    private static String quote(String merchant, int index, String costA, String costB, String result) {
        return TradeRules.quote(merchant, index, costA, costB, result);
    }
    public static void main(String[] args) {
        String original = quote(MERCHANT, 0, COST_A, COST_B, RESULT);
        check(TradeRules.validQuote(original), "Producer emits a valid 64-character lowercase quote");
        check(original.equals(quote(MERCHANT, 0, COST_A, COST_B, RESULT)), "Unchanged offer has stable identity");
        check(!original.equals(quote("00000000-0000-0000-0000-000000000002", 0, COST_A, COST_B, RESULT)),
            "Quote from a different merchant cannot be reused");
        check(!original.equals(quote(MERCHANT, 1, COST_A, COST_B, RESULT)), "Offer index is bound even for identical stacks");
        check(!original.equals(quote(MERCHANT, 0, COST_A.replace("12", "13"), COST_B, RESULT)), "Price increase changes quote");
        check(!original.equals(quote(MERCHANT, 0, COST_A.replace("12", "11"), COST_B, RESULT)), "Price decrease also has a new exact quote");
        check(!original.equals(quote(MERCHANT, 0, COST_A.replace("emerald", "diamond"), COST_B, RESULT)), "Payment item is bound");
        check(!original.equals(quote(MERCHANT, 0, COST_A, "{}", RESULT)), "Secondary payment is bound");
        check(!original.equals(quote(MERCHANT, 0, COST_B, COST_A, RESULT)), "Payment order is bound");
        check(!original.equals(quote(MERCHANT, 0, COST_A, COST_B, RESULT.replace("mending", "unbreaking"))),
            "Same output item/count with different enchantment components is a different offer");
        check(!original.equals(quote(MERCHANT, 0, COST_A, COST_B, RESULT.replace("count:1", "count:2"))),
            "Output count is bound");
        check(!original.equals(quote(MERCHANT, 0, COST_A + "{components:{name:\"特殊材料\"}}", COST_B, RESULT)),
            "Payment component changes cannot retain an earlier quote");
        check(TradeRules.validIndex(0, 1), "First actual offer can be selected");
        check(TradeRules.validIndex(19, 20), "Last exposed offer can be selected");
        check(TradeRules.validIndex(19, Integer.MAX_VALUE), "Large merchant menus keep the same visible bound");
        check(!TradeRules.validIndex(20, 21), "Hidden offer cannot be selected by guessing its index");
        check(!TradeRules.validIndex(-1, 20), "Negative selection refused");
        check(!TradeRules.validIndex(0, 0), "No trade on an empty merchant");
        check(!TradeRules.validIndex(1, 1), "One-past-last offer refused");
        check(!TradeRules.validIndex(0, -1), "Malformed negative size refused");
        check(!TradeRules.validQuote(null), "Missing quote refused");
        check(!TradeRules.validQuote(original.substring(1)), "Truncated quote refused");
        check(!TradeRules.validQuote(original + "0"), "Extra hash bytes refused");
        check(!TradeRules.validQuote(original.toUpperCase(java.util.Locale.ROOT)), "Only canonical lowercase hash accepted");
        check(!TradeRules.validQuote("g".repeat(64)), "Nonhex characters refused");
        check(!TradeRules.validQuote(original + "\n"), "Trailing newline cannot smuggle a second command");
        check(!TradeRules.validQuote(" " + original), "Leading whitespace refused");
        System.out.println("{\"ok\":true,\"checks\":" + checks + ",\"suite\":\"trade-rules\",\"liveTradeTest\":false}");
    }
}
