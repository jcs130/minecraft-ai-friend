package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/** Same public body directory for the skill compass, player CLI and authenticated NPC bridge. */
public final class CharacterLocationAccess {
    private static final int PAGE_SIZE = 8;
    private static final String DIRECTORY = "/mycli locate list --json";

    private CharacterLocationAccess() {}

    static JsonObject result(UUID actorId, String action) {
        var out = new JsonObject();
        out.addProperty("action", action);
        out.addProperty("actorUuid", actorId.toString());
        out.addProperty("sampledAt", Instant.now().toString());
        return out;
    }

    static JsonObject fail(JsonObject out, String reason, String next) {
        out.addProperty("ok", false);
        out.addProperty("reason", reason);
        out.addProperty("nextCommand", next);
        return out;
    }

    static JsonObject position(Location at) {
        var out = new JsonObject();
        out.addProperty("dimension", at.getWorld().getKey().toString());
        out.addProperty("x", at.getX());
        out.addProperty("y", at.getY());
        out.addProperty("z", at.getZ());
        return out;
    }

    static JsonObject describe(LivingEntity actor, TeammateDirectory.Target target) {
        Location at = target.body().getLocation();
        var out = position(at);
        String id = target.id().toString();
        out.addProperty("uuid", id);
        out.addProperty("name", target.name());
        out.addProperty("displayName", target.displayName());
        var aliases = new JsonArray();
        target.aliases().forEach(aliases::add);
        out.add("aliases", aliases);
        out.addProperty("kind", target.body() instanceof Player ? "player" : "companion");
        out.addProperty("live", true);
        boolean same = actor.getWorld().equals(at.getWorld());
        out.addProperty("sameWorld", same);
        if (same) out.addProperty("distance", actor.getLocation().distance(at));
        out.addProperty("lookupCommand", "/mycli locate info " + id + " --json");
        out.addProperty("teleportCommand", "/mycli locate tp " + id + " --json");
        return out;
    }

    private static LivingEntity actor(UUID id) {
        if (!Bukkit.isPrimaryThread()) throw new IllegalStateException("primary_thread_required");
        return TeammateDirectory.registeredActor(id);
    }

    public static LivingEntity target(UUID actorId, UUID targetId) {
        var viewer = actor(actorId);
        var found = viewer == null ? null : TeammateDirectory.find(viewer, targetId);
        return found == null ? null : found.body();
    }

    public static String list(UUID actorId) { return directory(actorId, null).toString(); }
    public static String list(UUID actorId, int page) { return directory(actorId, page).toString(); }
    public static String info(UUID actorId, UUID targetId) { return lookup(actorId, targetId.toString()).toString(); }

    static JsonObject directory(UUID actorId, Integer page) {
        var out = result(actorId, "list");
        var viewer = actor(actorId);
        if (viewer == null) return fail(out, "actor_unavailable", "/mycli status");
        var visible = TeammateDirectory.list(viewer);
        int pages = Math.max(1, (visible.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        out.addProperty("totalCount", visible.size());
        if (page != null) {
            out.addProperty("totalPages", pages);
            if (page < 1 || page > pages) return fail(out, "page_out_of_range", DIRECTORY);
            out.addProperty("page", page);
            if (page < pages) out.addProperty("nextCommand", "/mycli locate list " + (page + 1) + " --json");
            visible = visible.subList((page - 1) * PAGE_SIZE, Math.min(page * PAGE_SIZE, visible.size()));
        }
        var rows = new JsonArray();
        for (var person : visible) rows.add(describe(viewer, person));
        out.add("characters", rows);
        out.addProperty("ok", true);
        return out;
    }

    static JsonObject lookup(UUID actorId, String key) {
        var out = result(actorId, "info");
        var viewer = actor(actorId);
        if (viewer == null) return fail(out, "actor_unavailable", "/mycli status");
        var matches = TeammateDirectory.named(TeammateDirectory.list(viewer), key);
        if (matches.size() != 1) return ambiguous(out, viewer, matches);
        out.add("character", describe(viewer, matches.getFirst()));
        out.addProperty("ok", true);
        return out;
    }

    static JsonObject ambiguous(JsonObject out, LivingEntity viewer, List<TeammateDirectory.Target> matches) {
        if (matches.isEmpty()) return fail(out, "unknown_or_hidden", DIRECTORY);
        var choices = new JsonArray();
        for (var person : matches.stream().limit(PAGE_SIZE).toList()) choices.add(describe(viewer, person));
        out.add("candidates", choices);
        out.addProperty("matchCount", matches.size());
        return fail(out, "ambiguous_name", DIRECTORY);
    }
}
