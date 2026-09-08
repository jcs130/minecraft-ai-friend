package dev.qiandeng.maid;

import com.google.gson.JsonObject;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Flow;

/** Offline tests: real wire validation, owner isolation, HMAC and crash-safe replay rules. */
public final class BridgeContractTest {
    private static int checks;
    private static final String MAID = "00000000-0000-0000-0000-000000000001";
    private static final String OWNER = "00000000-0000-0000-0000-000000000002";
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("check " + checks); }
    private static void failure(String code, Runnable action) {
        try { action.run(); throw new AssertionError("expected " + code); }
        catch (BridgeProtocol.Failure actual) { check(actual.code.equals(code)); }
    }
    private static JsonObject body(String operation, JsonObject args) {
        JsonObject body = new JsonObject();
        body.addProperty("schema", 1); body.addProperty("requestId", "contract-request-0001");
        body.addProperty("maidUuid", MAID); body.addProperty("ownerUuid", OWNER);
        body.addProperty("operation", operation); body.add("args", args); return body;
    }
    private static BridgeProtocol.Request request(JsonObject body) {
        return BridgeProtocol.decode(Base64.getUrlEncoder().withoutPadding().encodeToString(body.toString().getBytes(StandardCharsets.UTF_8)));
    }
    public static void main(String[] args) throws Exception {
        var identity = request(body("identity", new JsonObject()));
        check(identity.maidUuid().equals(UUID.fromString(MAID)));
        check(identity.ownerUuid().equals(UUID.fromString(OWNER)));
        check(BridgeProtocol.READS.size() == 3 && BridgeProtocol.WRITES.size() == 4);
        failure("invalid_request", () -> BridgeProtocol.decode("../../../escape"));
        failure("invalid_request", () -> BridgeProtocol.decode("A".repeat(1401)));
        var input = body("identity", new JsonObject()); input.addProperty("ownerUuid", "0-0-0-0-2");
        failure("invalid_uuid", () -> request(input));
        var injected = body("identity", new JsonObject()); injected.addProperty("command", "op somebody");
        failure("unexpected_field", () -> request(injected));
        var invalidSchema = body("identity", new JsonObject()); invalidSchema.addProperty("schema", "1");
        failure("invalid_schema", () -> request(invalidSchema));
        failure("unknown_operation", () -> request(body("attack", new JsonObject())));
        var sit = new JsonObject(); sit.addProperty("sit", true);
        check(request(body("sit", sit)).args().get("sit").getAsBoolean());
        var wrongSit = new JsonObject(); wrongSit.addProperty("sit", "false");
        failure("invalid_sit", () -> request(body("sit", wrongSit)));
        var follow = new JsonObject(); follow.addProperty("follow", false);
        check(!request(body("follow", follow)).args().get("follow").getAsBoolean());
        var schedule = new JsonObject(); schedule.addProperty("schedule", "ALL");
        check(request(body("schedule", schedule)).operation().equals("schedule"));
        schedule.addProperty("schedule", "midnight");
        failure("invalid_schedule", () -> request(body("schedule", schedule)));
        var work = new JsonObject(); work.addProperty("taskId", "touhou_little_maid:idle");
        check(request(body("work", work)).operation().equals("work"));
        work.addProperty("entityId", 123);
        failure("unexpected_field", () -> request(body("work", work)));
        var offset = new JsonObject(); offset.addProperty("offset", 1.5);
        failure("invalid_offset", () -> request(body("task_catalog", offset)));
        offset.addProperty("offset", 0);
        check(request(body("task_catalog", offset)).args().get("offset").getAsInt() == 0);
        var context = new JsonObject(); context.addProperty("category", "self");
        check(request(body("context", context)).operation().equals("context"));
        BridgeProtocol.requireOwner(identity.ownerUuid(), identity.ownerUuid()); check(true);
        failure("owner_changed", () -> BridgeProtocol.requireOwner(identity.ownerUuid(), identity.maidUuid()));
        failure("unowned_maid", () -> BridgeProtocol.requireOwner(identity.ownerUuid(), null));
        byte[] key = "0123456789abcdef0123456789abcdef".getBytes(StandardCharsets.US_ASCII);
        byte[] raw = ("{\"qd_identity\":{\"maidUuid\":\"" + MAID + "\"}}").getBytes(StandardCharsets.UTF_8);
        var sig = BridgeProtocol.signature(key, "test-request-000001", "1788825600000", raw);
        check(sig.equals("89b02953054b0c27fe176ab88ffd03bded9dd8d0f190cbcb145a39e152db7f6d"));
        check(!sig.equals(BridgeProtocol.signature(key, "test-request-000002", "1788825600000", raw)));
        check(!sig.equals(BridgeProtocol.signature(key, "test-request-000001", "1788825600001", raw)));
        check(!sig.equals(BridgeProtocol.signature(key, "test-request-000001", "1788825600000", "{}".getBytes())));
        failure("identity_key_invalid", () -> BridgeProtocol.signature(new byte[4], "r", "1", raw));
        byte[] textReply = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"Hello\"}}]}".getBytes(StandardCharsets.UTF_8);
        check(BridgeProtocol.replyText(textReply).equals("Hello"));
        failure("invalid_reply", () -> BridgeProtocol.replyText("{\"choices\":[]}".getBytes()));
        failure("tool_reply_rejected", () -> BridgeProtocol.replyText("{\"choices\":[{\"message\":{\"role\":\"tool\",\"content\":\"x\"}}]}".getBytes()));
        failure("tool_reply_rejected", () -> BridgeProtocol.replyText("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"x\",\"tool_calls\":[]}}]}".getBytes()));
        failure("response_too_large", () -> BridgeProtocol.replyText(new byte[16385]));

        var root = Files.createTempDirectory("qd-maid-journal-test-");
        try {
            var journal = new ReceiptJournal(root);
            var req = request(body("sit", sit));
            check(journal.claim(req) == null);
            failure("outcome_unknown", () -> {
                try { new ReceiptJournal(root).claim(req); } catch (java.io.IOException e) { throw new AssertionError(e); }
            });
            var result = new JsonObject(); result.addProperty("ok", true); result.addProperty("code", "state_applied");
            journal.finish(req, result);
            var replay = new ReceiptJournal(root).claim(req);
            check(replay.get("replayedReceipt").getAsBoolean());
            check(replay.get("code").getAsString().equals("state_applied"));
            check(!result.has("replayedReceipt"));
            var conflicting = body("follow", follow);
            failure("request_id_conflict", () -> {
                try { journal.claim(request(conflicting)); } catch (java.io.IOException e) { throw new AssertionError(e); }
            });
        } finally {
            var absolute = root.toAbsolutePath().normalize();
            if (!absolute.startsWith(java.nio.file.Path.of(System.getProperty("java.io.tmpdir")).toAbsolutePath().normalize())
                || !absolute.getFileName().toString().startsWith("qd-maid-journal-test-")) throw new AssertionError("bad temporary root");
            try (var files = Files.walk(absolute)) {
                for (var file : files.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(file);
            }
        }

        var subscription = new TestSubscription();
        var bounded = new BoundedResponse(4); bounded.onSubscribe(subscription);
        bounded.onNext(List.of(ByteBuffer.wrap(new byte[]{1,2}), ByteBuffer.wrap(new byte[]{3,4}))); bounded.onComplete();
        check(bounded.getBody().toCompletableFuture().join().length == 4 && !subscription.cancelled);
        var excessive = new BoundedResponse(4); var second = new TestSubscription(); excessive.onSubscribe(second);
        excessive.onNext(List.of(ByteBuffer.wrap(new byte[5])));
        check(second.cancelled && excessive.getBody().toCompletableFuture().isCompletedExceptionally());
        check(subscription.requested == 2);
        System.out.println("{\"ok\":true,\"suite\":\"maid-bridge-contract\",\"checks\":" + checks + "}");
    }
    private static final class TestSubscription implements Flow.Subscription {
        long requested; boolean cancelled;
        public void request(long n) { requested += n; }
        public void cancel() { cancelled = true; }
    }
}
