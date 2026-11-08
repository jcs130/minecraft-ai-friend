import com.google.gson.*;

/** Synthetic receipts only: no running server, player identity, or receipt replay. */
public final class ReceiptClassificationQa {
    private static int checks;
    private static void check(String name, String json, boolean expected) {
        JsonObject receipt = JsonParser.parseString(json).getAsJsonObject();
        boolean actual;
        try {
            actual = MaidReceiptClassifierUnderTest.visitorReceipt(receipt);
        } catch (RuntimeException error) {
            throw new AssertionError(name + " must not throw while routing a receipt", error);
        }
        if (actual != expected) throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        checks++;
    }
    public static void main(String[] args) {
        for (String action : new String[]{"follow", "stay", "sit", "task", "schedule", "pickup"}) {
            check(action + " with structured conversation context", "{\"action\":\"" + action + "\",\"status\":\"applied\",\"observation\":{\"conversation\":{\"nearbyRange\":8,\"addressExample\":\"同伴，你好\"}}}", false);
        }
        check("owner native chat", "{\"action\":\"chat\",\"observation\":{\"reply\":\"好的\"}}", false);
        for (String status : new String[]{"pending", "replied", "failed", "unknown"}) {
            check("visitor chat " + status, "{\"action\":\"chat\",\"status\":\"" + status + "\",\"observation\":{\"conversation\":\"nearby_visitor\"}}", true);
        }
        check("another conversation kind", "{\"action\":\"chat\",\"observation\":{\"conversation\":\"owner\"}}", false);
        check("non-chat with visitor marker", "{\"action\":\"follow\",\"observation\":{\"conversation\":\"nearby_visitor\"}}", false);
        check("no observation", "{\"action\":\"chat\"}", false);
        check("empty observation", "{\"action\":\"chat\",\"observation\":{}}", false);
        for (String value : new String[]{"null", "{}", "[]", "42", "true"}) {
            check("non-string conversation " + value, "{\"action\":\"chat\",\"observation\":{\"conversation\":" + value + "}}", false);
        }
        for (String value : new String[]{"null", "[]", "42", "true", "\"text\""}) {
            check("non-object observation " + value, "{\"action\":\"chat\",\"observation\":" + value + "}", false);
        }
        check("no action", "{\"observation\":{\"conversation\":\"nearby_visitor\"}}", false);
        for (String value : new String[]{"null", "{}", "[]", "42", "true"}) {
            check("non-string action " + value, "{\"action\":" + value + ",\"observation\":{\"conversation\":\"nearby_visitor\"}}", false);
        }
        if (MaidReceiptClassifierUnderTest.visitorReceipt(null)) throw new AssertionError("null receipt must not be a visitor receipt");
        checks++;
        System.out.println("Receipt classification: " + checks + " checks passed (production method, real Gson).");
    }
}
