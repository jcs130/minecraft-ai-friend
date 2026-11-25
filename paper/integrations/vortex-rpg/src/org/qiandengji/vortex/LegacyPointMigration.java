package org.qiandengji.vortex;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/** Typed source-store handoff. No balance store and no legacy earned/spent/skill/level edits. */
public final class LegacyPointMigration {
    public static final String VERSION = "legacy-points-v1";
    public static final String RECEIPT_FIELD = "qdj.legacy_points.v1.receipt";
    private LegacyPointMigration() {}

    /** sourceHash: SHA-256 of the frozen legacy profile, EXCLUDING migration intent/receipt fields. */
    public record Source(UUID actor, int earned, int spent, String sourceHash, String transferId) {
        public Source {
            Objects.requireNonNull(actor);
            if (earned < 0 || spent < 0) throw new IllegalArgumentException("negative_legacy_points");
            if (sourceHash == null || !sourceHash.matches("[0-9a-f]{64}"))
                throw new IllegalArgumentException("source_sha256_required");
            if (!LegacyPointMigration.transferId(actor, sourceHash).equals(transferId))
                throw new IllegalArgumentException("transfer_actor_or_hash_mismatch");
        }
        public int amount() { return (int) Math.max((long) earned - spent, 0L); }
        public String receipt() {
            var out = payload();
            out.addProperty("actor", actor.toString());
            return out.toString();
        }
        private JsonObject payload() {
            var out = new JsonObject();
            out.addProperty("version", VERSION); out.addProperty("ratio", "1:1");
            out.addProperty("earned", earned); out.addProperty("spent", spent); out.addProperty("amount", amount());
            out.addProperty("sourceHash", sourceHash); out.addProperty("transferId", transferId);
            return out;
        }
        public JsonObject result(String reason, boolean confirmed, boolean rejected) {
            var out = payload();
            out.addProperty("confirmed", confirmed); out.addProperty("pending", !confirmed && !rejected);
            out.addProperty("status", confirmed ? "confirmed" : rejected ? "rejected" : "pending");
            out.addProperty("reason", reason); out.addProperty("backend", "vortex");
            out.addProperty("sourceReceiptRequired", confirmed);
            out.addProperty("nextCommand", "/mycli profession");
            return out;
        }
    }

    public static String transferId(UUID actor, String sourceHash) {
        Objects.requireNonNull(actor); Objects.requireNonNull(sourceHash);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                (VERSION + "\n" + actor + "\n" + sourceHash).getBytes(StandardCharsets.UTF_8));
            return VERSION + ":" + HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }

    public interface SourceStore {
        /** Durably freeze/compare the ORIGINAL actor's source and intent before completing.
         * Existing intents must return the same frozen Source, never recalculate from a later ledger.
         * Unknown saves fail the future; no target call until intent durability is confirmed. */
        CompletableFuture<Source> prepare(Source requested);
        /** Only persist the receipt, preserving earned/spent, levels and historical skills.
         * Must be idempotent and reject a different source/transfer. Called after a verified native save. */
        CompletableFuture<Void> confirm(Source source, JsonObject targetConfirmation);
    }

    /** Target may be VortexBridge.migrateLegacyPoints via reflection; invoke it on the actor/main thread.
     * This coordinator can complete on IO threads: the supplied target must marshal to that thread.
     * Re-entry always uses the original transfer; target receipt reconciliation never replays a grant. */
    public static CompletableFuture<JsonObject> migrate(Source requested, SourceStore store,
            Function<Source, CompletableFuture<JsonObject>> target) {
        try {
            return store.prepare(requested).thenCompose(frozen -> {
                if (!requested.equals(frozen)) return CompletableFuture.completedFuture(
                    requested.result("source_intent_payload_mismatch", false, true));
                return target.apply(frozen).thenCompose(result -> {
                    if (!validConfirmation(frozen, result)) {
                        boolean safelyPending = matchesPayload(frozen, result) && result.has("confirmed")
                            && !result.get("confirmed").getAsBoolean();
                        return CompletableFuture.completedFuture(safelyPending ? result
                            : frozen.result("target_confirmation_invalid", false, false));
                    }
                    CompletableFuture<Void> confirmation;
                    try { confirmation = Objects.requireNonNull(store.confirm(frozen, result.deepCopy())); }
                    catch (RuntimeException error) { confirmation = CompletableFuture.failedFuture(error); }
                    return confirmation.handle((ignored, error) -> {
                        var out = result.deepCopy();
                        out.addProperty("sourceConfirmed", error == null);
                        out.addProperty("sourceReceiptRequired", error != null);
                        out.addProperty("pending", error != null);
                        if (error != null) { out.addProperty("status", "pending"); out.addProperty("reason", "target_confirmed_source_unknown"); }
                        return out;
                    });
                });
            }).exceptionally(error -> requested.result("intent_or_target_unknown", false, false));
        } catch (RuntimeException error) {
            return CompletableFuture.completedFuture(requested.result("intent_or_target_unknown", false, false));
        }
    }

    private static boolean validConfirmation(Source source, JsonObject result) {
        return matchesPayload(source, result) && result.has("confirmed") && result.get("confirmed").getAsBoolean();
    }
    private static boolean matchesPayload(Source source, JsonObject result) {
        if (result == null) return false;
        for (var entry : source.payload().entrySet())
            if (!entry.getValue().equals(result.get(entry.getKey()))) return false;
        return true;
    }
}
