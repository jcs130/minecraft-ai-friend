package io.vortexcore.rpg;

import io.vortexcore.persistence.PlayerDataRepository;
import io.vortexcore.persistence.model.PlayerSnapshot;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.scheduling.FoliaExecutionFacade;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Desktop Paper only. Capture on the owning main thread; IO never reapplies live state. */
public final class NativeProfileSnapshots {
    private NativeProfileSnapshots() {}

    public static CompletableFuture<PlayerSnapshot> batch(PlayerProfileService service,
            PlayerDataRepository repository, Player player, UnifiedPlayer expected, Map<String, String> changes) {
        if (!Bukkit.isPrimaryThread()) return failed("main_thread_required");
        if (repository == null) return failed("durable_repository_unavailable");
        if (player == null || !player.isOnline()) return failed("actor_offline");
        UUID actor = player.getUniqueId();
        if (expected == null || !actor.equals(expected.uniqueId())
                || service.qiandengjiLoading(actor) || service.profile(actor).orElse(null) != expected)
            return failed("original_profile_not_ready");
        // Validate/copy everything before the first write. No grant callback/autosave between these puts.
        Map<String, String> update = Map.copyOf(changes);
        update.forEach(expected::putMetadata);
        return service.qiandengjiSave(player);
    }

    public static CompletableFuture<PlayerSnapshot> queue(FoliaExecutionFacade scheduler,
            PlayerDataRepository repository, Map<UUID, CompletableFuture<PlayerSnapshot>> pending,
            Set<UUID> loading, java.util.logging.Logger logger, UUID actor, UnifiedPlayer profile) {
        if (!Bukkit.isPrimaryThread()) {
            var result = new CompletableFuture<PlayerSnapshot>();
            try {
                scheduler.runGlobal("qd-owned-profile-save", () -> {
                    // No Folia global-thread fallback: this API is explicitly desktop/main-thread only.
                    if (!Bukkit.isPrimaryThread()) { result.completeExceptionally(new IllegalStateException("main_thread_required")); return; }
                    queue(scheduler, repository, pending, loading, logger, actor, profile)
                        .whenComplete((saved, error) -> finish(result, saved, error));
                });
            } catch (RuntimeException error) { result.completeExceptionally(error); }
            return result;
        }
        if (repository == null) return failed("durable_repository_unavailable");
        if (loading.contains(actor)) return failed("original_profile_loading");
        if (!actor.equals(profile.uniqueId())) return failed("actor_mismatch");
        // Capture NOW, not in a thenCompose running on the previous IO completion thread.
        PlayerSnapshot captured = profile.toSnapshot();
        var result = new CompletableFuture<PlayerSnapshot>();
        CompletableFuture<PlayerSnapshot> previous;
        synchronized (pending) { previous = pending.put(actor, result); }
        CompletableFuture<?> gate = previous == null ? CompletableFuture.completedFuture(null) : previous;
        gate.handle((saved, error) -> null).thenCompose(ignored -> {
            // Only revision is rebased after the preceding durable ack. All gameplay fields are immutable.
            var snapshot = new PlayerSnapshot(actor, profile.snapshotRevision(), captured.level(),
                captured.experience(), captured.stats(), captured.metadata(), captured.updatedAt());
            return repository.saveAtomically(snapshot);
        }).whenComplete((saved, error) -> {
            Throwable failure = error;
            if (failure == null) {
                if (saved == null || !actor.equals(saved.playerId())
                        || !captured.metadata().equals(saved.metadata()) || captured.level() != saved.level()
                        || captured.experience() != saved.experience() || !captured.stats().equals(saved.stats()))
                    failure = new IllegalStateException("saved_snapshot_mismatch");
                else profile.qiandengjiSavedRevision(saved.revision());
            }
            synchronized (pending) { pending.remove(actor, result); }
            if (failure != null && logger != null)
                logger.warning("Native profile save not confirmed: " + failure.getClass().getSimpleName());
            finish(result, saved, failure);
        });
        return result;
    }

    public static void acknowledge(java.util.concurrent.atomic.AtomicLong revision, long saved) {
        revision.accumulateAndGet(saved, Math::max);
    }

    private static CompletableFuture<PlayerSnapshot> failed(String reason) {
        return CompletableFuture.failedFuture(new IllegalStateException(reason));
    }
    private static void finish(CompletableFuture<PlayerSnapshot> result, PlayerSnapshot saved, Throwable error) {
        if (error == null) result.complete(saved); else result.completeExceptionally(error);
    }
}
