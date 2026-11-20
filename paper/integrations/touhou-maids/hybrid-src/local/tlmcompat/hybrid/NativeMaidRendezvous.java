package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.LivingEntity;

/** A caster always moves its own leased body; the character directory supplies targets only. */
final class NativeMaidRendezvous {
    private static final String NEXT_CAST = "qiandengji_team_rendezvous_ready_at";
    private static Class<?> service(String type) throws ReflectiveOperationException {
        var af = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (af == null || !af.isEnabled()) throw new ClassNotFoundException("AgentFriend unavailable");
        return af.getClass().getClassLoader().loadClass("org.afuhome.agentfriend." + type);
    }

    static void describe(UUID id, JsonObject context) {
        try {
            var raw = service("CharacterLocationAccess").getMethod("list", UUID.class).invoke(null, id);
            var page = JsonParser.parseString((String) raw).getAsJsonObject();
            if (!page.get("ok").getAsBoolean()) {
                context.addProperty("characterDirectoryUnavailable", true);
                return;
            }
            var rows = new JsonArray();
            for (var element : page.getAsJsonArray("characters")) {
                var entry = element.getAsJsonObject();
                var row = new JsonObject();
                for (String key : new String[]{"uuid","name","dimension","kind","displayName","aliases"})
                    if (entry.has(key)) row.add(key, entry.get(key));
                var position = new JsonObject();
                for (String axis : new String[]{"x","y","z"}) position.add(axis, entry.get(axis));
                row.add("position", position);
                rows.add(row);
            }
            context.add("characterDirectory", rows);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError unavailable) {
            context.addProperty("characterDirectoryUnavailable", true);
        }
    }

    static JsonObject cast(HybridMaidPlugin plugin, EntityMaid maid, UUID targetId) throws ReflectiveOperationException {
        UUID id = maid.getUUID();
        Class<?> access;
        JsonObject plan;
        try {
            access = service("MaidRendezvousAccess");
            plan = JsonParser.parseString((String) access.getMethod("prepare", UUID.class, UUID.class)
                    .invoke(null, id, targetId)).getAsJsonObject();
        } catch (ReflectiveOperationException | RuntimeException | LinkageError unavailable) {
            return denied("character_location_service_unavailable");
        }
        if (!plan.get("ok").getAsBoolean()) return denied(plan.get("reason").getAsString());
        long now = System.currentTimeMillis();
        long remaining = maid.getPersistentData().getLong(NEXT_CAST) - now;
        if (remaining > 0) {
            var refusal = denied("team_cooldown");
            refusal.addProperty("retryAfterMs", remaining);
            return refusal;
        }
        int cost = plan.get("manaCost").getAsInt();
        if (!plugin.travelMana(maid, cost, false)) return denied("insufficient_mana");
        var world = Bukkit.getWorld(UUID.fromString(plan.get("world").getAsString()));
        if (world == null) return denied("team_target_unavailable");
        var destination = new Location(world, plan.get("x").getAsDouble(), plan.get("y").getAsDouble(),
                plan.get("z").getAsDouble(), maid.getYRot(), maid.getXRot());
        var origin = maid.getBukkitEntity().getLocation();
        boolean moved = plugin.moveForRendezvous(maid, destination);
        EntityMaid actual = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
        if (!moved && atOrigin(actual, origin)) return denied("teleport_cancelled");
        if (actual == null || !maid.getOwnerUUID().equals(actual.getOwnerUUID())) throw new IllegalStateException("body_unconfirmed");
        boolean valid = moved && Boolean.TRUE.equals(access.getMethod("accepts", UUID.class, UUID.class, Location.class, Location.class)
                .invoke(null, id, targetId, origin, destination));
        if (!valid || !plugin.travelMana(actual, cost, true)) {
            if (plugin.moveForRendezvous(actual, origin) && atOrigin(HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id)), origin))
                return denied(valid ? "insufficient_mana" : "team_admission_unconfirmed_returned");
            throw new IllegalStateException("return_unconfirmed");
        }
        long cooldown = plan.get("cooldownMillis").getAsLong();
        actual.getPersistentData().putLong(NEXT_CAST, now + cooldown);
        var arrived = actual.getBukkitEntity().getLocation();
        if (!(Bukkit.getEntity(targetId) instanceof LivingEntity target) || target.getWorld() != arrived.getWorld())
            throw new IllegalStateException("target_moved_during_settlement");
        var result = new JsonObject();
        result.addProperty("effectsApplied", true);
        result.addProperty("arrived", true);
        result.addProperty("targetUuid", targetId.toString());
        result.add("actualPosition", position(arrived));
        result.add("targetPosition", position(target.getLocation()));
        result.addProperty("distance", arrived.distance(target.getLocation()));
        result.addProperty("manaCost", cost);
        result.addProperty("cooldownSeconds", cooldown / 1000);
        return result;
    }

    static boolean walkingNear(UUID id, UUID targetId, Location destination) {
        try {
            var target = service("CharacterLocationAccess").getMethod("target", UUID.class, UUID.class)
                    .invoke(null, id, targetId);
            if (!(target instanceof LivingEntity body) || body.getWorld() != destination.getWorld()) return false;
            Location at = body.getLocation();
            if (at.distanceSquared(destination) <= 16) return true;
            if (!(Bukkit.getEntity(id) instanceof LivingEntity caster) || caster.getWorld() != at.getWorld()) return false;
            Location origin = caster.getLocation();
            if (origin.distanceSquared(at) <= 96 * 96 || origin.distanceSquared(destination) > 36 * 36) return false;
            var leg = at.toVector().subtract(origin.toVector()).normalize().multiply(32);
            return origin.add(leg).distanceSquared(destination) <= 16;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError unavailable) {
            return false;
        }
    }

    private static boolean atOrigin(EntityMaid actual, Location origin) {
        if (actual == null) return false;
        Location at = actual.getBukkitEntity().getLocation();
        return at.getWorld() == origin.getWorld() && at.distanceSquared(origin) <= .01;
    }

    private static JsonObject position(Location at) {
        var out = new JsonObject();
        out.addProperty("dimension", at.getWorld().getKey().toString());
        out.addProperty("x", at.getX());
        out.addProperty("y", at.getY());
        out.addProperty("z", at.getZ());
        return out;
    }

    private static JsonObject denied(String reason) {
        var out = new JsonObject();
        out.addProperty("reason", reason);
        out.addProperty("effectsApplied", false);
        out.addProperty("arrived", false);
        return out;
    }

    private NativeMaidRendezvous() { }
}
