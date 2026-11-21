package local.hosting;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.Marker;
import net.minecraft.world.level.storage.LevelResource;
import net.neoforged.neoforge.event.entity.EntityJoinLevelEvent;
import net.neoforged.neoforge.event.server.ServerAboutToStartEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;

/**
 * Early world-wide admission guard for bodies put in custody. An absent entity (including
 * an unloaded dimension) must never be interpreted as authorization to recreate it.
 * The local checkpoint is an original entity save, not data supplied by a model.
 */
public final class NativeCustodyFence {
    private static final String DIRECTORY = "qiandengji-native-custody";
    private static final long MAX_BYTES = 8L * 1024 * 1024;
    private static volatile Set<UUID> held = Set.of();
    private static net.minecraft.world.entity.Entity restoring;
    private static final ThreadLocal<net.minecraft.world.entity.Entity> claiming = new ThreadLocal<>();
    /** Only the synchronous, already authorized successor may run its ordinary bind while held. */
    public static boolean heldForDriver(UUID id) {
        return isHeld(id) && !claimingDriver(id);
    }
    public static boolean claimingDriver(UUID id) {
        var approved=claiming.get();
        return approved != null && approved.getUUID().equals(id);
    }
    static void activateDriver(NativeShellCustody.Driver driver, NativeShellCustody.Binding binding,
                               NativeShellCustody.Operation operation, net.minecraft.world.entity.Entity entity) throws Exception {
        if (claiming.get()!=null || !isHeld(binding.entityUuid()) || !binding.entityUuid().equals(entity.getUUID()))
            throw new IllegalStateException("Invalid native controller admission");
        claiming.set(entity);
        try { driver.activate(binding, operation, entity); }
        finally { claiming.remove(); }
    }
    private NativeCustodyFence() {}

    /** Controller and original-body recovery code can consult the same active guard. */
    public static boolean isHeld(UUID nativeUuid) {
        return held.contains(nativeUuid);
    }

    static void beforeWorlds(ServerAboutToStartEvent event) {
        try {
            held = readCheckpoints(directory(event.getServer()));
            NativePlayerCustody.load(directory(event.getServer()).resolve("role-slots"));
        } catch (Exception failure) {
            // Starting with an empty map here could admit competing bodies, or lose the
            // only recoverable copy of an entity. Fail before level entities start loading.
            throw new IllegalStateException("Invalid native body custody checkpoints", failure);
        }
    }

    static void stopped(ServerStoppedEvent event) {
        held = Set.of();
        NativePlayerCustody.clear();
    }

    static void onJoin(EntityJoinLevelEvent event) {
        var entity = event.getEntity();
        if (!event.getLevel().isClientSide() && !(entity instanceof Marker) && entity != restoring && isHeld(entity.getUUID())) {
            event.setCanceled(true);
        }
    }

    /** Install the guard after the custodian has durably written the original preimage. */
    public static void registerCheckpoint(MinecraftServer server, UUID nativeUuid) throws IOException {
        if (!server.isSameThread()) throw new IllegalStateException("Server thread required");
        verify(directory(server).resolve(nativeUuid + ".nbt"), nativeUuid);
        var updated = new HashSet<>(held);
        updated.add(nativeUuid);
        held = Set.copyOf(updated);
    }

    static void addOriginal(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.Entity original) {
        if (!level.getServer().isSameThread() || restoring != null || !isHeld(original.getUUID()))
            throw new IllegalStateException("No exclusive native restore");
        restoring = original;
        try {
            if (!level.addFreshEntity(original) || level.getEntity(original.getUUID()) != original)
                throw new IllegalStateException("Original entity admission not confirmed");
        } finally { restoring = null; }
    }

    static void finishRestore(net.minecraft.server.level.ServerLevel level, net.minecraft.world.entity.Entity original,
                              Path archive, String expectedDigest) throws IOException {
        if (!level.getServer().isSameThread() || !isHeld(original.getUUID()) || level.getEntity(original.getUUID()) != original)
            throw new IllegalStateException("Original entity changed before commit");
        // Preserve the immutable preimage for reconciliation, outside the active guard namespace.
        Path history=archive.getParent().resolve("restored");
        Files.createDirectories(history);
        Files.move(archive, history.resolve(expectedDigest + ".nbt"), java.nio.file.StandardCopyOption.ATOMIC_MOVE);
        var updated = new HashSet<>(held);
        updated.remove(original.getUUID());
        held = Set.copyOf(updated);
    }

    static Path directory(MinecraftServer server) {
        return server.getWorldPath(LevelResource.ROOT).resolve(DIRECTORY);
    }

    static Set<UUID> readCheckpoints(Path directory) throws IOException {
        var found = new HashSet<UUID>();
        try (var files = Files.newDirectoryStream(directory, "*.nbt")) {
            for (Path file : files) {
                String name = file.getFileName().toString();
                UUID id = UUID.fromString(name.substring(0, name.length() - 4));
                if (!name.equals(id + ".nbt")) throw new IOException("Invalid native body checkpoint name");
                verify(file, id);
                found.add(id);
            }
        } catch (NoSuchFileException missing) {
            if (!directory.toString().equals(missing.getFile())) throw missing;
        }
        return Set.copyOf(found);
    }

    static void verify(Path file, UUID expected) throws IOException {
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS) || Files.size(file) > MAX_BYTES) {
            throw new IOException("Invalid native body save");
        }
        CompoundTag snapshot = NbtIo.readCompressed(file, NbtAccounter.create(MAX_BYTES));
        String kind = snapshot.getString("id");
        if (!Set.of("touhou_little_maid:maid", "minecraft:villager").contains(kind) ||
            !snapshot.hasUUID("UUID") || !expected.equals(snapshot.getUUID("UUID"))) {
            throw new IOException("Native body save identity mismatch");
        }
    }
}
