package local.hosting;

import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.storage.LevelResource;

/** Login and packet fences derived from the persistent native slot, including when its RPC is down. */
public final class NativePlayerCustody {
    static final Set<String> PLAYER_KINDS = Set.of("mineflayer", "numen");
    static final Set<String> NATIVE_KINDS = Set.of("maid", "villager");
    private static final String NUMEN_CLASS = "com.dwinovo.numen.hosted.api.entity.NumenPlayer";
    private static final long MAX_PLAYER_DATA = 32L * 1024 * 1024;
    private static volatile Map<UUID, Seat> seats = Map.of();

    record PlayerBody(String kind, String bodyId, UUID uuid, String name, UUID nativeOwner) {}
    record Seat(String character, Map<String, PlayerBody> bodies, String active, boolean frozen,
                String reserved, long admittedUntil) {
        PlayerBody original() { return bodies.values().iterator().next(); }
        boolean accepts(String kind) {
            return bodies.containsKey(kind) && (!frozen && active.equals(kind)
                    || reserved.equals(kind) && admittedUntil != 0 && admittedUntil-System.nanoTime()>0);
        }
        boolean acceptsGameplay(String kind) { return !frozen && active.equals(kind); }
    }

    private NativePlayerCustody() {}

    static Map<String, PlayerBody> bindings(JsonObject scope) {
        var bodies = new HashMap<String, PlayerBody>();
        for (String kind : PLAYER_KINDS) {
            if (!scope.has(kind)) continue;
            var entry = scope.getAsJsonObject(kind);
            var uuid = NativeResidentSlots.uuid(entry, "entityUuid");
            var name = NativeResidentSlots.text(entry, "playerName");
            var bodyId = NativeResidentSlots.text(entry, "bodyId");
            if (!name.matches("[A-Za-z0-9_]{1,16}") || !bodyId.matches("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}"))
                throw new IllegalArgumentException("Invalid original player enrollment");
            UUID owner = kind.equals("numen") ? NativeResidentSlots.uuid(entry, "nativeOwner") : null;
            if (uuid.equals(owner)) throw new IllegalArgumentException("Original player and Numen owner must differ");
            bodies.put(kind, new PlayerBody(kind, bodyId, uuid, name, owner));
        }
        if (bodies.size() == 2) {
            var first = bodies.get("mineflayer");
            var second = bodies.get("numen");
            if (!first.uuid.equals(second.uuid) || !first.name.equals(second.name)
                    || first.bodyId.equals(second.bodyId))
                throw new IllegalArgumentException("Player variants must bind the same original character");
        }
        return Map.copyOf(bodies);
    }

    static void load(Path roleSlots) throws Exception {
        var loaded = new HashMap<UUID, Seat>();
        var names = new java.util.HashSet<String>();
        BasicFileAttributes attributes;
        try { attributes=Files.readAttributes(roleSlots,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS); }
        catch (NoSuchFileException missing) {
            seats=Map.of();
            return;
        }
        if (!attributes.isDirectory()) throw new IOException("Invalid native role slots directory");
        try (var children = Files.list(roleSlots)) {
            for (Path directory : children.toList()) {
                if (!directory.getFileName().toString().matches("[a-f0-9]{64}")
                        || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS))
                    throw new IOException("Invalid native role slot path");
                JsonObject state = NativeResidentHandoffPort.read(directory.resolve("slot.json"), 65536);
                JsonObject scope = state.getAsJsonObject("scope");
                var bodies = bindings(scope);
                if (bodies.isEmpty()) continue;
                String character = NativeResidentSlots.text(scope, "characterId");
                if (!directory.getFileName().toString().equals(NativeResidentSlots.hash(character)))
                    throw new IOException("Native role slot path does not match its role");
                Seat seat = fromState(character, bodies, state, 0);
                if (bodies.containsKey(seat.active)) requireNativeHolds(scope, state);
                if (loaded.putIfAbsent(seat.original().uuid, seat) != null
                        || !names.add(seat.original().name.toLowerCase(Locale.ROOT)))
                    throw new IOException("Duplicate original player custody");
            }
        }
        seats = Map.copyOf(loaded);
    }

    static void clear() { seats = Map.of(); }

    static void requireNativeHolds(JsonObject scope, JsonObject state) {
        var held=state.getAsJsonObject("held");
        for (String kind : NATIVE_KINDS) {
            if (!scope.has(kind)) continue;
            var original=NativeResidentSlots.uuid(scope.getAsJsonObject(kind),"entityUuid");
            if (!NativeCustodyFence.isHeld(original) || !NativeResidentSlots.text(held,kind).matches("[a-f0-9]{64}"))
                throw new IllegalStateException("Player admission requires all original native shells in custody");
        }
    }

    static Seat fromState(String character, Map<String, PlayerBody> bodies, JsonObject state, long liveUntil) {
        String active = NativeResidentSlots.text(state, "activeKind");
        String reserved = "";
        boolean frozen = state.has("playerGate") || state.has("pending") || state.has("transfer");
        if (state.has("playerGate")) {
            JsonObject gate = state.getAsJsonObject("playerGate");
            if ("admitted".equals(NativeResidentSlots.text(gate, "mode")) && active.isEmpty())
                reserved = NativeResidentSlots.text(gate, "kind");
        }
        if (!active.isEmpty() && !bodies.containsKey(active) && !NATIVE_KINDS.contains(active)
                || !reserved.isEmpty() && !bodies.containsKey(reserved))
            throw new IllegalArgumentException("Unenrolled active player variant");
        return new Seat(character, bodies, active, frozen, reserved, liveUntil);
    }

    static void requireRegistered(String character, Map<String, PlayerBody> bodies) {
        if (bodies.isEmpty()) return;
        Seat seat = seats.get(bodies.values().iterator().next().uuid);
        if (seat == null || !seat.character.equals(character) || !seat.bodies.equals(bodies))
            throw new IllegalStateException("Player custody must be enrolled before the server starts");
    }

    static void publish(String character, Map<String, PlayerBody> bodies, JsonObject state, long liveUntil) {
        if (bodies.isEmpty()) return;
        requireRegistered(character, bodies);
        Seat next = fromState(character, bodies, state, liveUntil);
        var updated = new HashMap<>(seats);
        updated.put(next.original().uuid, next);
        seats = Map.copyOf(updated);
    }

    private static Seat seat(GameProfile profile) {
        var snapshot = seats;
        Seat exact = snapshot.get(profile.getId());
        if (exact != null) return exact;
        for (Seat alternative : snapshot.values()) {
            if (alternative.original().name.equalsIgnoreCase(profile.getName())) return alternative;
        }
        return null;
    }

    public static boolean enrolled(GameProfile profile) { return seat(profile) != null; }

    static boolean admissionOpen(PlayerBody body) {
        Seat seat = seats.get(body.uuid);
        return seat != null && seat.reserved.equals(body.kind) && seat.accepts(body.kind);
    }

    private static boolean admits(GameProfile profile, String kind, UUID owner) {
        Seat seat = seat(profile);
        if (seat == null) return true;
        PlayerBody body = seat.bodies.get(kind);
        return body != null && body.uuid.equals(profile.getId()) && body.name.equals(profile.getName())
                && java.util.Objects.equals(body.nativeOwner, owner) && seat.accepts(kind);
    }

    public static boolean admitsMineflayer(GameProfile profile) { return admits(profile, "mineflayer", null); }
    public static boolean admitsNumen(GameProfile profile, UUID owner) { return admits(profile, "numen", owner); }

    public static boolean admitsPlayer(ServerPlayer player) {
        GameProfile profile = player.getGameProfile();
        if (seat(profile) == null) return true;
        if (player.getClass() == ServerPlayer.class) return admitsMineflayer(profile);
        return isNumen(player) && admitsNumen(profile, numenOwner(player));
    }

    public static boolean acceptsPlayerInput(ServerPlayer player) {
        Seat seat = seat(player.getGameProfile());
        return seat == null || player.getClass() == ServerPlayer.class && seat.acceptsGameplay("mineflayer")
                || isNumen(player) && seat.acceptsGameplay("numen");
    }

    static void protectPendingPlayer(net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent event) {
        if (event.getEntity() instanceof ServerPlayer player && !acceptsPlayerInput(player)) event.setCanceled(true);
    }

    static void preventPendingPickup(net.neoforged.neoforge.event.entity.player.ItemEntityPickupEvent.Pre event) {
        if (event.getPlayer() instanceof ServerPlayer player && !acceptsPlayerInput(player))
            event.setCanPickup(net.neoforged.neoforge.common.util.TriState.FALSE);
    }

    static boolean joined(MinecraftServer game, PlayerBody body) {
        var list = game.getPlayerList();
        ServerPlayer player = list.getPlayer(body.uuid);
        return player != null && !player.isRemoved() && player == list.getPlayerByName(body.name)
                && player.getGameProfile().getName().equals(body.name) && player.connection != null
                && (body.kind.equals("mineflayer") ? player.getClass() == ServerPlayer.class
                    : isNumen(player) && body.nativeOwner.equals(numenOwner(player)));
    }

    static boolean offline(MinecraftServer game, PlayerBody body) {
        var list = game.getPlayerList();
        return list.getPlayer(body.uuid) == null && list.getPlayerByName(body.name) == null;
    }

    private static boolean isNumen(ServerPlayer player) {
        return player.getClass().getName().equals(NUMEN_CLASS);
    }

    private static UUID numenOwner(ServerPlayer player) {
        try {
            return (UUID) player.getClass().getMethod("getOwnerUuid").invoke(player);
        } catch (ReflectiveOperationException | LinkageError unavailable) { return null; }
    }

    static String savedDigest(MinecraftServer game, PlayerBody body) throws Exception {
        Path file = game.getWorldPath(LevelResource.PLAYER_DATA_DIR).resolve(body.uuid + ".dat");
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_PLAYER_DATA)
            throw new IOException("Original player save is unavailable");
        byte[] bytes;
        try (var input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
            bytes = input.readNBytes((int) MAX_PLAYER_DATA + 1);
        }
        if (bytes.length > MAX_PLAYER_DATA) throw new IOException("Original player save exceeds its limit");
        var tag = NbtIo.readCompressed(new ByteArrayInputStream(bytes), NbtAccounter.create(MAX_PLAYER_DATA));
        if (!tag.hasUUID("UUID") || !body.uuid.equals(tag.getUUID("UUID")))
            throw new IOException("Original player save UUID does not match");
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
