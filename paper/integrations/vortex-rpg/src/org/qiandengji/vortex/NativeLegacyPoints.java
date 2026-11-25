package org.qiandengji.vortex;

import com.google.gson.JsonObject;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.PlayerProfileService;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Receipt + learning-point credit use ONE native snapshot; no void grant API or balance inference. */
final class NativeLegacyPoints {
    private record Flight(LegacyPointMigration.Source source, CompletableFuture<JsonObject> future) {}
    private final Map<UUID, Flight> inFlight = new java.util.concurrent.ConcurrentHashMap<>();

    CompletableFuture<JsonObject> migrate(Player player, LegacyPointMigration.Source source,
            PlayerProfileService profiles, io.vortexcore.rpg.ClassSkillService skills) {
        if (!Bukkit.isPrimaryThread()) return done(source, "main_thread_required", false);
        if (player == null || !source.actor().equals(player.getUniqueId())) return done(source, "actor_mismatch", true);
        if (!player.isOnline()) return done(source, "actor_offline", false);
        UUID actor = source.actor();
        if (profiles.qiandengjiLoading(actor)) return done(source, "profile_loading", false);
        UnifiedPlayer state = profiles.profile(actor).orElse(null);
        if (state == null) return done(source, "original_profile_not_loaded", false);
        if (!actor.equals(state.uniqueId())) return done(source, "actor_mismatch", true);
        Flight existing = inFlight.get(actor);
        if (existing != null && !existing.future().isDone())
            return existing.source().equals(source) ? existing.future() : done(source, "transfer_payload_mismatch", true);
        if (!skills.hasClass(state)) {
            var result = source.result("class_required", false, false);
            result.addProperty("nextCommand", "/mycli profession list");
            return CompletableFuture.completedFuture(result);
        }
        String marker = state.metadata().get(LegacyPointMigration.RECEIPT_FIELD);
        if (marker != null && !marker.equals(source.receipt())) return done(source, "receipt_payload_mismatch", true);
        var result = new CompletableFuture<JsonObject>();
        var flight = new Flight(source, result);
        inFlight.put(actor, flight);
        result.whenComplete((value, error) -> inFlight.remove(actor, flight));
        try {
            Map<String, String> update = Map.of();
            if (marker == null) {
                // Reject malformed/native negative balances rather than treating parse fallbacks as zero.
                String raw = state.metadata().get("rpg.skill_points");
                int balance = raw == null ? skills.unspentSkillPoints(state) : Integer.parseInt(raw);
                if (balance < 0) throw new IllegalArgumentException("invalid_native_points");
                int credited = Math.addExact(balance, source.amount());
                update = Map.of("rpg.skill_points", Integer.toString(credited),
                    LegacyPointMigration.RECEIPT_FIELD, source.receipt());
            }
            // On a live unknown save OR after a cold load, only save/reconcile the SAME receipt.
            // Never call grant again; never assume a matching balance or an in-memory marker is durable.
            profiles.qiandengjiSaveMetadata(player, state, update).whenComplete((saved, error) -> {
                boolean verified = error == null && saved != null && actor.equals(saved.playerId())
                    && source.receipt().equals(saved.metadata().get(LegacyPointMigration.RECEIPT_FIELD));
                result.complete(source.result(verified ? "native_snapshot_confirmed" : "target_save_unknown", verified, false));
            });
        } catch (ArithmeticException error) { result.complete(source.result("integer_overflow", false, true)); }
        catch (IllegalArgumentException error) { result.complete(source.result("invalid_native_points", false, true)); }
        catch (RuntimeException | LinkageError error) { result.complete(source.result("target_api_or_save_unavailable", false, false)); }
        return result;
    }

    private static CompletableFuture<JsonObject> done(LegacyPointMigration.Source source, String reason, boolean rejected) {
        return CompletableFuture.completedFuture(source.result(reason, false, rejected));
    }
}
