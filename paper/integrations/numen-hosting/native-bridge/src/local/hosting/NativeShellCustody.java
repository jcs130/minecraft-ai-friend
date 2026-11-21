package local.hosting;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.TamableAnimal;
import net.minecraft.world.entity.npc.AbstractVillager;
import net.minecraft.world.level.ChunkPos;

/**
 * A game-thread participant. The driver owns admission, outstanding submitted actions and
 * controller credentials. No public command or network listener constructs these calls.
 */
public final class NativeShellCustody {
    private NativeShellCustody() {}
    private static final Pattern LABEL = Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}");
    private static final String META = "QiandengjiShellCustodyV1";

    public record Binding(String characterId, UUID ownerId, String bodyId, UUID entityUuid, String nativeType, UUID nativeOwner) {
        public Binding {
            Objects.requireNonNull(ownerId); Objects.requireNonNull(entityUuid);
            if (!LABEL.matcher(characterId).matches() || !LABEL.matcher(bodyId).matches() ||
                !List.of("minecraft:villager","touhou_little_maid:maid").contains(nativeType) ||
                ("touhou_little_maid:maid".equals(nativeType) != (nativeOwner != null))) {
                throw new IllegalArgumentException("Invalid registered native body");
            }
        }
    }
    public record Operation(String id, long generation) {
        public Operation {
            if (!LABEL.matcher(id).matches() || generation < 1) throw new IllegalArgumentException("Invalid operation");
        }
    }
    public enum Phase { PARK, RESUME }
    /** Evidence for this game-thread call. The role coordinator journals the same operation before publishing it. */
    public record PhysicalReceipt(Phase phase, Binding body, Operation operation, String snapshotSha256) {
        public UUID entityUuid() { return body.entityUuid(); }
    }
    public interface Driver {
        /** Verify the real role binding, exact old lease, and all pending actions, menus, tasks and trades. */
        boolean quiescent(Binding body, Operation operation, Entity original) throws Exception;
        /** Stop the previously verified driver. A failed or uncertain release leaves the original checkpoint held. */
        void release(Binding body, Operation operation, Entity original) throws Exception;
        /** Verify that this successor is still reserved for this role before materializing it. */
        boolean reserved(Binding body, Operation operation) throws Exception;
        /** Called once after original data is physically checkpointed, before ordinary execution can resume. */
        void activate(Binding body, Operation operation, Entity original) throws Exception;
    }
    @FunctionalInterface interface ChunkCheckpoint {
        /** Durably flush the entity section for this exact chunk; throwing keeps the original in custody. */
        void save(ServerLevel level, ChunkPos pos) throws Exception;
    }

    public static PhysicalReceipt park(ServerLevel level, Binding binding, Operation operation, Driver driver) throws Exception {
        return park(level, binding, operation, driver, NativeShellCustody::saveEntitySection);
    }

    static PhysicalReceipt park(ServerLevel level, Binding binding, Operation operation,
                                Driver driver, ChunkCheckpoint checkpoint) throws Exception {
        requireThread(level);
        Entity body = level.getEntity(binding.entityUuid());
        if (!activeOriginal(level,binding) || physicallyBusy(body) || !driver.quiescent(binding, operation, body)) {
            throw new IllegalStateException("Source body busy, unavailable or unowned");
        }
        Path file = archive(level, binding);
        if (NativeCustodyFence.isHeld(binding.entityUuid()) || Files.exists(file)) {
            throw new IllegalStateException("Original custody operation needs reconciliation");
        }
        var nbt = new CompoundTag();
        if (!body.save(nbt) || nbt.contains(META)) throw new IllegalStateException("Native snapshot unavailable");
        var info = new CompoundTag();
        info.putString("character", binding.characterId()); info.putUUID("owner", binding.ownerId());
        info.putString("body", binding.bodyId()); info.putString("dimension", level.dimension().location().toString());
        info.putString("operation", operation.id()); info.putLong("generation", operation.generation());
        nbt.put(META, info);
        Files.createDirectories(file.getParent());
        Path temporary = Files.createTempFile(file.getParent(), "capturing-", ".tmp");
        try {
            NbtIo.writeCompressed(nbt, temporary);
            NativeCustodyFence.verify(temporary, binding.entityUuid());
            try (var channel=FileChannel.open(temporary, StandardOpenOption.WRITE)) { channel.force(true); }
            Files.createLink(file, temporary); // durable preimage published with no replacement of an earlier hold
        } finally { Files.deleteIfExists(temporary); }
        NativeCustodyFence.registerCheckpoint(level.getServer(), binding.entityUuid());
        String sha = sha256(file);
        ChunkPos source = body.chunkPosition();
        try { driver.release(binding, operation, body); }
        finally { body.discard(); }
        if (exists(level,binding.entityUuid())) throw new IllegalStateException("Source removal unconfirmed");
        checkpoint.save(level, source);
        return new PhysicalReceipt(Phase.PARK, binding, operation, sha);
    }

    public static PhysicalReceipt resume(ServerLevel level, Binding binding, Operation operation,
                                         String expectedSnapshot, Driver driver) throws Exception {
        return resume(level, binding, operation, expectedSnapshot, driver, NativeShellCustody::saveEntitySection);
    }

    static PhysicalReceipt resume(ServerLevel level, Binding binding, Operation operation, String expectedSnapshot,
                                  Driver driver, ChunkCheckpoint checkpoint) throws Exception {
        requireThread(level);
        Path file = archive(level, binding);
        if (!NativeCustodyFence.isHeld(binding.entityUuid()) || exists(level,binding.entityUuid()) ||
            !driver.reserved(binding, operation)) throw new IllegalStateException("Target body not reserved");
        String sha = sha256(file);
        if (!sha.equals(expectedSnapshot)) throw new IllegalStateException("Original checkpoint digest changed");
        var nbt=originalCheckpoint(level, binding, operation.generation());
        Entity body=EntityType.create(nbt,level).orElseThrow();
        if (!matches(binding,body)) throw new IllegalStateException("Native identity failed after decoding");
        // A crash at any point before the archive is retired leaves the global fence and saved original in place.
        NativeCustodyFence.addOriginal(level,body);
        try {
            if (!exclusive(level,body)) throw new IllegalStateException("Original admission unconfirmed");
            checkpoint.save(level,body.chunkPosition());
            NativeCustodyFence.activateDriver(driver,binding,operation,body);
            NativeCustodyFence.finishRestore(level,body,file,sha);
        } catch (Exception | LinkageError failure) {
            body.discard();
            throw failure;
        }
        return new PhysicalReceipt(Phase.RESUME, binding, operation, sha);
    }

    static boolean parked(ServerLevel level, Binding binding, long successorGeneration, String digest) throws Exception {
        requireThread(level);
        if (!NativeCustodyFence.isHeld(binding.entityUuid()) || exists(level,binding.entityUuid()) ||
            !sha256(archive(level,binding)).equals(digest)) return false;
        originalCheckpoint(level,binding,successorGeneration);
        return true;
    }

    private static CompoundTag originalCheckpoint(ServerLevel level, Binding binding, long generation) throws Exception {
        var nbt=NbtIo.readCompressed(archive(level,binding),NbtAccounter.create(8L*1024*1024));
        var info=nbt.getCompound(META);
        if (!binding.characterId().equals(info.getString("character")) ||
            !info.hasUUID("owner") || !binding.ownerId().equals(info.getUUID("owner")) ||
            !binding.bodyId().equals(info.getString("body")) ||
            !level.dimension().location().toString().equals(info.getString("dimension")) ||
            generation <= info.getLong("generation") || !nbt.hasUUID("UUID") ||
            binding.nativeOwner()!=null && (!nbt.hasUUID("Owner") || !binding.nativeOwner().equals(nbt.getUUID("Owner"))) ||
            !binding.entityUuid().equals(nbt.getUUID("UUID")) || !binding.nativeType().equals(nbt.getString("id"))) {
            throw new IllegalStateException("Original body checkpoint binding changed");
        }
        nbt.remove(META);
        var xyz=nbt.getList("Pos",6);
        if (xyz.size()!=3 || !level.hasChunkAt(BlockPos.containing(xyz.getDouble(0),xyz.getDouble(1),xyz.getDouble(2)))) {
            throw new IllegalStateException("Original body chunk is unavailable");
        }
        return nbt;
    }

    /** Use the existing resident entity-section checkpoint. No global world save or playerdata writes. */
    public static void saveEntitySection(ServerLevel level, ChunkPos pos) throws Exception {
        requireThread(level);
        ClassLoader loader=level.getClass().getClassLoader();
        var accessor=Class.forName("local.qdj.maids.brain.mixin.ResidentLevelStorage",false,loader);
        var sections=Class.forName("local.qdj.maids.brain.mixin.ResidentEntityStorage",false,loader);
        Object manager=accessor.getMethod("residentEntityManager").invoke(level);
        var noop=(java.util.function.Consumer<Entity>)ignored->{};
        if (!Boolean.TRUE.equals(sections.getMethod("residentStoreChunk",long.class,java.util.function.Consumer.class)
                .invoke(manager,pos.toLong(),noop))) throw new IllegalStateException("Entity section checkpoint unavailable");
        var disk=(net.minecraft.world.level.entity.EntityPersistentStorage<?>)sections.getMethod("residentStorage").invoke(manager);
        disk.flush(true);
    }

    static boolean activeOriginal(ServerLevel level, Binding binding) {
        var entity=level.getEntity(binding.entityUuid());
        return matches(binding,entity) && exclusive(level,entity) && !NativeCustodyFence.isHeld(binding.entityUuid());
    }
    static boolean physicallyBusy(Entity entity) {
        return entity.isPassenger() || entity.isVehicle() || entity instanceof AbstractVillager trader && trader.getTradingPlayer()!=null;
    }
    private static boolean matches(Binding binding, Entity e) {
        return e instanceof LivingEntity living && living.isAlive() && binding.entityUuid().equals(e.getUUID()) &&
            binding.nativeType().equals(BuiltInRegistries.ENTITY_TYPE.getKey(e.getType()).toString()) &&
            (binding.nativeOwner()==null || e instanceof TamableAnimal tame && binding.nativeOwner().equals(tame.getOwnerUUID()));
    }
    private static boolean exclusive(ServerLevel level,Entity original) {
        for (var world:level.getServer().getAllLevels()) {
            Entity found=world.getEntity(original.getUUID());
            if (world==level ? found!=original : found!=null) return false;
        }
        return true;
    }
    private static boolean exists(ServerLevel level,UUID id) {
        for(var world:level.getServer().getAllLevels()) if(world.getEntity(id)!=null) return true;
        return false;
    }
    private static Path archive(ServerLevel level,Binding binding) {
        return NativeCustodyFence.directory(level.getServer()).resolve(binding.entityUuid()+".nbt");
    }
    private static String sha256(Path p) throws Exception {
        if (Files.size(p)>8L*1024*1024) throw new IOException("Native snapshot too large");
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(p)));
    }
    private static void requireThread(ServerLevel level) {
        if (!level.getServer().isSameThread()) throw new IllegalStateException("Server thread required");
    }
}
