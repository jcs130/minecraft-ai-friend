package local.tlmcompat.hybrid;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.UUID;
import java.time.Instant;
import java.util.function.Function;
import java.util.function.Supplier;

public final class MaidPlayerProfilesTest {
    private static final UUID PLAYER = UUID.randomUUID(), MAID = UUID.randomUUID(), OTHER = UUID.randomUUID();
    private static JsonObject row(UUID maid, UUID owner, UUID profile) {
        var row = new JsonObject();
        row.addProperty("maidId", maid.toString());
        row.addProperty("ownerId", owner.toString());
        if (profile != null) row.addProperty("playerProfileId", profile.toString());
        return row;
    }
    private static JsonArray rows(JsonObject... rows) {
        var result = new JsonArray();
        for (var row : rows) result.add(row);
        return result;
    }
    private static void require(boolean valid) { if (!valid) throw new AssertionError(); }
    private static void rejected(JsonArray rows) {
        try { MaidPlayerProfiles.from(rows); throw new AssertionError("ambiguous configuration accepted"); }
        catch (IllegalArgumentException expected) { }
    }
    private static void reason(JsonObject value, String reason) {
        require(value.size() == 2 && !value.get("available").getAsBoolean() && value.get("reason").getAsString().equals(reason));
    }
    public static void main(String[] args) {
        var pairs = MaidPlayerProfiles.from(rows(row(MAID, PLAYER, PLAYER)));
        Supplier<UUID> noBodyCheck = () -> { throw new AssertionError("inspected an unpaired body"); };
        Function<UUID,MaidPlayerProfiles.Profile> noRead = id -> { throw new AssertionError("profile accessed before identity check"); };
        reason(MaidPlayerProfiles.from(rows(row(MAID, PLAYER, null))).read(PLAYER, MAID, noBodyCheck, noRead), "player_body_not_paired");
        reason(pairs.read(OTHER, MAID, noBodyCheck, noRead), "player_body_not_paired");
        reason(pairs.read(PLAYER, OTHER, noBodyCheck, noRead), "player_body_not_paired");
        reason(pairs.read(PLAYER, MAID, () -> null, noRead), "original_body_unavailable");
        reason(pairs.read(PLAYER, MAID, () -> OTHER, noRead), "original_body_owner_changed");
        reason(pairs.read(PLAYER, MAID, () -> PLAYER, id -> null), "player_profile_unavailable");
        reason(pairs.read(PLAYER, MAID, () -> PLAYER, id -> new MaidPlayerProfiles.Profile(OTHER, 7, 82L, "mage")), "player_profile_unavailable");
        var view = pairs.read(PLAYER, MAID, () -> PLAYER, id -> {
            require(id.equals(PLAYER));
            return new MaidPlayerProfiles.Profile(id, 14, 2384L, "mage");
        });
        require(view.get("available").getAsBoolean() && view.get("playerId").getAsString().equals(PLAYER.toString()));
        require(view.get("maidId").getAsString().equals(MAID.toString()) && view.get("level").getAsInt() == 14);
        require(view.get("experience").getAsLong() == 2384L && view.get("profession").getAsString().equals("mage"));
        require(view.size() == 6);
        var stored = new MaidPlayerProfiles.Profile(PLAYER, 14, 2384L, "mage");
        var stamp = Instant.parse("2026-11-20T10:13:45Z");
        reason(MaidPlayerProfiles.saved(PLAYER, MAID, stored, 0, stamp), "no_saved_player_profile");
        reason(MaidPlayerProfiles.saved(PLAYER, MAID, stored, 1, null), "no_saved_player_profile");
        reason(MaidPlayerProfiles.saved(OTHER, MAID, stored, 10, stamp), "player_profile_unavailable");
        var saved = MaidPlayerProfiles.saved(PLAYER, MAID, stored, 4, stamp);
        require(saved.size() == 9 && saved.get("revision").getAsLong() == 4);
        require(saved.get("source").getAsString().equals("last_saved_vortex_snapshot"));
        require(saved.get("savedAt").getAsString().equals(stamp.toString()));
        require(saved.get("level").equals(view.get("level")) && saved.get("experience").equals(view.get("experience")));
        rejected(rows(row(MAID, PLAYER, OTHER)));
        rejected(rows(row(MAID, PLAYER, PLAYER), row(OTHER, PLAYER, PLAYER)));
        rejected(rows(row(MAID, PLAYER, PLAYER), row(MAID, OTHER, OTHER)));
        rejected(rows(row(MAID, PLAYER, PLAYER), row(PLAYER, OTHER, null)));
        rejected(rows(row(PLAYER, PLAYER, PLAYER)));
        var bad = row(MAID, PLAYER, PLAYER);
        bad.addProperty("playerProfileId", "not-a-uuid");
        try {
            MaidPlayerProfiles.from(rows(bad));
            throw new AssertionError("accepted malformed player UUID");
        } catch (MaidBodyControl.Fault expected) {
            require(expected.code.equals("INVALID_playerProfileId"));
        }
        var injected = new JsonObject();
        injected.addProperty("action", "context");
        injected.addProperty("playerProfileId", PLAYER.toString());
        try {
            MaidBodyControl.validateShape(injected);
            throw new AssertionError("accepted a player profile selector over the body protocol");
        } catch (MaidBodyControl.Fault expected) {
            require(expected.code.equals("UNEXPECTED_FIELD"));
        }
        System.out.println("Maid player profile binding, live owner and cached projection checks passed");
    }
}
