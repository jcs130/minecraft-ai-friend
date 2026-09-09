package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import java.nio.file.Files;
import java.util.UUID;

/** Interrupted claim/reply, durable terminal replay and identity collision; zero game/model actions. */
public final class RescueJournalTest {
    private static int checks;
    private static void check(boolean result) { checks++; if (!result) throw new AssertionError("rescue journal " + checks); }
    private static JsonObject obj(String phase) { var out = new JsonObject(); out.addProperty("phase", phase); return out; }
    private static void failure(String code, Checked action) throws Exception {
        try { action.run(); throw new AssertionError("expected " + code); }
        catch (BridgeProtocol.Failure actual) { check(actual.code.equals(code)); }
    }
    private interface Checked { void run() throws Exception; }
    public static void main(String[] args) throws Exception {
        var path = Files.createTempDirectory("rescue-journal-test");
        var journal = new RescueJournal(path); UUID action = UUID.randomUUID(), quote = UUID.randomUUID();
        var input = obj("input"); var unknown = obj("unknown"); var done = obj("completed");
        check(journal.status(action) == null);
        check(journal.claim(action, "exact1", input, unknown) == null);
        check(journal.status(action).equals(unknown));
        var reopened = new RescueJournal(path);
        check(reopened.claim(action, "exact1", input, unknown).equals(unknown));
        failure("request_id_conflict", () -> reopened.claim(action, "different", input, unknown));
        failure("request_id_conflict", () -> reopened.finish(action, "different", input, done));
        failure("request_id_conflict", () -> reopened.finish(UUID.randomUUID(), "exact1", input, done));
        reopened.finish(action, "exact1", input, done);
        check(new RescueJournal(path).status(action).equals(done));
        check(reopened.claim(action, "exact1", input, unknown).equals(done));
        reopened.finish(action, "exact1", input, done); check(reopened.status(action).equals(done));
        failure("receipt_already_terminal", () -> reopened.finish(action, "exact1", input, unknown));
        check(journal.quote(quote) == null); journal.putQuote(quote, input);
        check(new RescueJournal(path).quote(quote).equals(input));
        journal.putQuote(quote, input); check(journal.quote(quote).equals(input));
        failure("quote_id_conflict", () -> journal.putQuote(quote, done));
        var reply = journal.status(action); reply.addProperty("changed", true);
        check(journal.status(action).equals(done));
        System.out.println("{\"ok\":true,\"suite\":\"rescue-journal\",\"checks\":" + checks + "}");
    }
}
