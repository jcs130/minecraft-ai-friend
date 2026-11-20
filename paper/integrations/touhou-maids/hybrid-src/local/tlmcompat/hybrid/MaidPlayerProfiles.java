package local.tlmcompat.hybrid;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;
import java.util.function.Function;
import java.util.function.Supplier;

/** An explicit game-server pairing for reading an existing player's profile from a native maid. */
final class MaidPlayerProfiles {
    record Profile(UUID id, int level, long experience, String profession) {}

    private final Map<UUID, UUID> byBody;

    private MaidPlayerProfiles(Map<UUID, UUID> byBody) {
        this.byBody = Map.copyOf(byBody);
    }

    static MaidPlayerProfiles from(JsonArray rows) {
        var bodies = new HashSet<UUID>();
        var players = new HashSet<UUID>();
        var pairs = new HashMap<UUID, UUID>();
        for (var value : rows) {
            var row = value.getAsJsonObject();
            var body = MaidBodyControl.uuid(row, "maidId");
            if (!bodies.add(body)) throw new IllegalArgumentException("duplicate_body");
            if (!row.has("playerProfileId")) continue;
            var player = MaidBodyControl.uuid(row, "playerProfileId");
            if (!player.equals(MaidBodyControl.uuid(row, "ownerId")) || !players.add(player))
                throw new IllegalArgumentException("invalid_player_body_pair");
            pairs.put(body, player);
        }
        if (!Collections.disjoint(bodies, players)) throw new IllegalArgumentException("body_player_id_collision");
        return new MaidPlayerProfiles(pairs);
    }

    String issue(UUID player, UUID maid, Supplier<UUID> originalOwner) {
        if (player == null || maid == null || !player.equals(byBody.get(maid)))
            return "player_body_not_paired";
        UUID observed = originalOwner.get();
        if (observed == null) return "original_body_unavailable";
        return player.equals(observed) ? null : "original_body_owner_changed";
    }

    JsonObject read(UUID player, UUID maid, Supplier<UUID> originalOwner, Function<UUID, Profile> cached) {
        String issue = issue(player, maid, originalOwner);
        return issue == null ? view(player, maid, cached.apply(player)) : unavailable(issue);
    }

    static JsonObject saved(UUID player, UUID maid, Profile profile, long revision, Instant savedAt) {
        if (revision <= 0 || savedAt == null) return unavailable("no_saved_player_profile");
        var view = view(player, maid, profile);
        if (view.get("available").getAsBoolean()) {
            view.addProperty("source", "last_saved_vortex_snapshot");
            view.addProperty("revision", revision);
            view.addProperty("savedAt", savedAt.toString());
        }
        return view;
    }

    private static JsonObject view(UUID player, UUID maid, Profile profile) {
        if (profile == null || !player.equals(profile.id())) return unavailable("player_profile_unavailable");
        var view = new JsonObject();
        view.addProperty("available", true);
        view.addProperty("playerId", player.toString());
        view.addProperty("maidId", maid.toString());
        view.addProperty("level", profile.level());
        view.addProperty("experience", profile.experience());
        view.addProperty("profession", profile.profession());
        return view;
    }

    static JsonObject unavailable(String reason) {
        var view = new JsonObject();
        view.addProperty("available", false);
        view.addProperty("reason", reason);
        return view;
    }
}
