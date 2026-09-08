package dev.qiandeng.irons;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;

/** Exact name/UUID lookup shared by real and Numen ServerPlayers. */
public final class ActorLookup {
    private ActorLookup() {}
    public record Result<T>(T actor, String code) {}

    public static <T> Result<T> resolve(String query, List<T> actors,
            Function<T, UUID> uuid, Function<T, String> name) {
        UUID requestedId = null;
        try { requestedId = UUID.fromString(query); } catch (IllegalArgumentException ignored) {}
        var matches = new LinkedHashMap<UUID, T>();
        for (T actor : actors) {
            UUID id = uuid.apply(actor);
            if (requestedId != null ? requestedId.equals(id) : name.apply(actor).equalsIgnoreCase(query)) {
                matches.putIfAbsent(id, actor);
            }
        }
        if (matches.isEmpty()) return new Result<>(null, "actor_not_found");
        if (matches.size() > 1) return new Result<>(null, "ambiguous_actor");
        return new Result<>(matches.values().iterator().next(), "ok");
    }
}
