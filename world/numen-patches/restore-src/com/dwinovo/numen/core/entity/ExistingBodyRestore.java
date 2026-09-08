package com.dwinovo.numen.core.entity;

import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.Companions;
import com.dwinovo.numen.entity.CompanionFactory;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.Gson;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.item.ItemStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.StandardCopyOption;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Restore an existing body; the autonomous death branch consumes only native post-death data. */
public final class ExistingBodyRestore {
    private static final Gson JSON = new Gson();
    private static final Map<UUID, Long> ATTEMPTS = new LinkedHashMap<>();
    public static final String CAPABILITY = "existing_body_restore_v1";
    private static final UUID AUTONOMOUS_BODY = UUID.fromString("d4ac9523-4962-43ed-98c5-19b49e104048");
    private static final UUID AUTONOMOUS_OWNER = UUID.fromString("e5005711-be9f-44b7-aaad-6993c0ba5df4");
    static {
        com.dwinovo.numen.platform.ServerLifecycle.onStopped(ATTEMPTS::clear);
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("numen_restore_existing")
            .requires(s -> s.hasPermission(4) && s.getEntity() == null)
            .then(Commands.argument("uuid", StringArgumentType.word())
                .then(Commands.argument("owner", StringArgumentType.word())
                    .then(Commands.argument("name", StringArgumentType.word())
                        .executes(c -> execute(c.getSource(), StringArgumentType.getString(c, "uuid"),
                            StringArgumentType.getString(c, "owner"), StringArgumentType.getString(c, "name")))))));
    }

    public static UUID canonicalUuid(String value) {
        UUID parsed = UUID.fromString(value);
        if (!parsed.toString().equals(value)) throw new IllegalArgumentException("invalid_identity");
        return parsed;
    }

    /** Testable gate over the saved identity, before any body is constructed. */
    public static String savedDataError(CompoundTag data, UUID body, UUID owner, String dimension) {
        if (!data.hasUUID("UUID") || !body.equals(data.getUUID("UUID"))
                || !data.hasUUID("NumenOwner") || !owner.equals(data.getUUID("NumenOwner")))
            return "playerdata_identity_mismatch";
        if (!data.contains("Inventory", Tag.TAG_LIST) || !data.contains("Pos", Tag.TAG_LIST)
                || data.getList("Pos", Tag.TAG_DOUBLE).size() != 3
                || !data.contains("Health", Tag.TAG_ANY_NUMERIC)) return "playerdata_invalid";
        net.minecraft.nbt.ListTag inventory = (net.minecraft.nbt.ListTag) data.get("Inventory");
        if (inventory == null || (!inventory.isEmpty() && inventory.getElementType() != Tag.TAG_COMPOUND))
            return "playerdata_invalid";
        for (int i = 0; i < 3; i++) {
            double p = data.getList("Pos", Tag.TAG_DOUBLE).getDouble(i);
            if (!Double.isFinite(p) || Math.abs(p) > 30_000_000) return "playerdata_invalid";
        }
        if (!Float.isFinite(data.getFloat("Health")) || data.getFloat("Health") <= 0)
            return "body_dead";
        if (!dimension.equals(data.getString("Dimension"))) return "playerdata_dimension_mismatch";
        if (!data.contains("playerGameType", Tag.TAG_ANY_NUMERIC) || data.getInt("playerGameType") != 0)
            return "not_in_survival";
        return null;
    }

    public static boolean vanillaInventorySlot(int slot) {
        return slot >= 0 && slot < 36 || slot >= 100 && slot < 104 || slot == 150;
    }

    /** Other companions retain Numen's owner-driven death lifecycle without alteration. */
    public static String deathEligibilityError(UUID body, UUID owner, String name, long diedAt,
                                               long gameTime, boolean ownerOnline, String dimension) {
        if (!AUTONOMOUS_BODY.equals(body) || !AUTONOMOUS_OWNER.equals(owner) || !"Kirito".equals(name)
                || ownerOnline) return "body_dead";
        if (diedAt <= 0 || gameTime < diedAt || gameTime - diedAt < 100) return "death_respawn_delay";
        // The native factory's saved Dimension wins during player join. Never pretend a
        // spawn-coordinate override performs a dimension transfer.
        if (!"minecraft:overworld".equals(dimension)) return "death_respawn_dimension_requires_review";
        return null;
    }

    /** Same bounded deterministic shape as upstream SafeSpawn; no fallback onto an unsafe anchor. */
    public static BlockPos chooseLanding(BlockPos origin, java.util.function.Predicate<BlockPos> safe) {
        for (int dy = -1; dy <= 8; dy++) for (int r = 0; r <= 3; r++)
            for (int dx = -r; dx <= r; dx++) for (int dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) != r) continue;
                BlockPos pos = origin.offset(dx, dy, dz);
                if (safe.test(pos)) return pos;
            }
        return null;
    }

    /** Upstream SafeSpawn footing/hazard/collision checks, guarded BEFORE every world read.
     * SafeSpawn is package-private in the nested API module, so no split-package overlay is used.
     */
    public static boolean loadedSafeLanding(ServerLevel level, BlockPos pos) {
        if (pos.getY() - 1 < level.getMinBuildHeight() || pos.getY() + 2 >= level.getMaxBuildHeight()
                || !level.getWorldBorder().isWithinBounds(pos)) return false;
        // Collision iteration may inspect neighbouring block shapes. All those chunks must
        // already exist in the live chunk source; this test never calls getChunk/load.
        for (int x = pos.getX() - 1; x <= pos.getX() + 1; x++)
            for (int z = pos.getZ() - 1; z <= pos.getZ() + 1; z++)
                if (!level.getChunkSource().hasChunk(x >> 4, z >> 4)) return false;
        var below = pos.below(); var footing = level.getBlockState(below);
        if (!footing.isFaceSturdy(level, below, Direction.UP)
                || footing.is(Blocks.MAGMA_BLOCK) || footing.is(Blocks.CACTUS)) return false;
        var feet = level.getBlockState(pos); var head = level.getBlockState(pos.above());
        if (feet.is(BlockTags.FIRE) || head.is(BlockTags.FIRE)
                || feet.getFluidState().is(FluidTags.LAVA) || !head.getFluidState().isEmpty()) return false;
        return level.noCollision(new AABB(pos.getX() + .2, pos.getY(), pos.getZ() + .2,
                pos.getX() + .8, pos.getY() + 1.8, pos.getZ() + .8));
    }

    private static Path deathJournal(MinecraftServer server, UUID body, long diedAt) throws Exception {
        Path world = server.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
        Path directory = world.resolve("data/qd-numen-restores");
        if (Files.isSymbolicLink(world.resolve("data")) || Files.isSymbolicLink(directory))
            throw new IllegalArgumentException("restore_audit_unavailable");
        Files.createDirectories(directory);
        return directory.resolve(body + "-" + diedAt + ".json");
    }

    private static void claimDeath(Path journal, Map<String, Object> audit) throws Exception {
        // CREATE_NEW and force make an uncertain constructor non-replayable after a restart.
        try (FileChannel channel = FileChannel.open(journal, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            ByteBuffer bytes = StandardCharsets.UTF_8.encode(JSON.toJson(audit));
            while (bytes.hasRemaining()) channel.write(bytes);
            channel.force(true);
        }
    }

    private static void finishDeath(Path journal, Map<String, Object> audit) throws Exception {
        Path temporary = journal.resolveSibling(journal.getFileName() + ".tmp");
        Files.writeString(temporary, JSON.toJson(audit), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        Files.move(temporary, journal, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    /** Prevent vanilla's permissive load from silently dropping malformed/mod-missing stacks. */
    private static void validateInventory(MinecraftServer server, CompoundTag saved) {
        java.util.Set<Integer> slots = new java.util.HashSet<>();
        for (Tag value : saved.getList("Inventory", Tag.TAG_COMPOUND)) {
            CompoundTag item = (CompoundTag) value;
            int slot = Byte.toUnsignedInt(item.getByte("Slot"));
            if (!item.contains("Slot", Tag.TAG_BYTE) || !vanillaInventorySlot(slot) || !slots.add(slot)
                    || ItemStack.parse(server.registryAccess(), item).filter(stack -> !stack.isEmpty()).isEmpty())
                throw new IllegalArgumentException("playerdata_inventory_unreadable");
        }
    }

    private static int execute(CommandSourceStack source, String rawBody, String rawOwner, String name) {
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("schema", 1); reply.put("capability", CAPABILITY);
        reply.put("ok", false); reply.put("phase", "rejected");
        boolean invoked = false;
        try {
            UUID body = canonicalUuid(rawBody), owner = canonicalUuid(rawOwner);
            if (!name.matches("[A-Za-z0-9_]{1,16}")) throw new IllegalArgumentException("invalid_identity");
            reply.put("bodyUuid", rawBody); reply.put("ownerUuid", rawOwner); reply.put("bodyName", name);
            MinecraftServer server = source.getServer();
            CompanionRegistry.Entry entry = CompanionRegistry.get(server).find(body);
            if (entry == null) throw new IllegalArgumentException("registered_body_missing");
            if (!owner.equals(entry.owner()) || !name.equals(entry.name()))
                throw new IllegalArgumentException("registry_identity_mismatch");
            NumenPlayer live = NumenPlayer.findByUuid(server, body);
            if (live != null) {
                if (!owner.equals(live.getOwnerUuid()) || !name.equals(live.getGameProfile().getName()))
                    throw new IllegalArgumentException("live_identity_mismatch");
                reply.put("ok", true); reply.put("phase", "observed"); reply.put("code", "already_online");
                return respond(source, reply);
            }
            if (server.getPlayerList().getPlayer(body) != null
                    || server.getPlayerList().getPlayers().stream().anyMatch(p -> name.equals(p.getGameProfile().getName())))
                throw new IllegalArgumentException("live_identity_conflict");
            boolean dead = entry.diedAt() > 0;
            if (dead) {
                String deathError = deathEligibilityError(body, owner, name, entry.diedAt(),
                    server.overworld().getGameTime(), server.getPlayerList().getPlayer(owner) != null,
                    entry.dimension().location().toString());
                if (deathError != null) throw new IllegalArgumentException(deathError);
            }
            if (!dead && entry.taskTool() != null && !entry.taskTool().isBlank())
                throw new IllegalArgumentException("saved_task_requires_review");
            if (server.getLevel(entry.dimension()) == null) throw new IllegalArgumentException("dimension_unavailable");
            Path directory = server.getWorldPath(LevelResource.PLAYER_DATA_DIR).toAbsolutePath().normalize();
            Path file = directory.resolve(body + ".dat");
            if (Files.isSymbolicLink(directory) || Files.isSymbolicLink(file)
                    || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS))
                throw new IllegalArgumentException("playerdata_missing");
            if (Files.size(file) < 1 || Files.size(file) > 8_388_608)
                throw new IllegalArgumentException("playerdata_invalid");
            CompoundTag saved = NbtIo.readCompressed(file, NbtAccounter.create(8_388_608));
            String error = savedDataError(saved, body, owner, entry.dimension().location().toString());
            if (error != null) throw new IllegalArgumentException(error);
            validateInventory(server, saved);
            Vec3 deathLanding = null;
            Path journal = null;
            Map<String, Object> audit = null;
            if (dead) {
                ServerLevel level = server.overworld();
                BlockPos landing = chooseLanding(level.getSharedSpawnPos(), p -> loadedSafeLanding(level, p));
                if (landing == null) throw new IllegalArgumentException("death_safe_spawn_unavailable");
                deathLanding = Vec3.atBottomCenterOf(landing);
                journal = deathJournal(server, body, entry.diedAt());
                if (Files.exists(journal, LinkOption.NOFOLLOW_LINKS)) {
                    invoked = true; // Previous outcome must be inspected, never re-dispatched.
                    throw new IllegalStateException("previous_death_restore_unresolved");
                }
                reply.put("recovery", "native_post_death"); reply.put("deathAt", entry.diedAt());
                reply.put("deathCause", entry.deathCause());
                reply.put("sourcePlayerdataSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file))));
                reply.put("spawn", java.util.List.of(deathLanding.x, deathLanding.y, deathLanding.z));
                audit = new LinkedHashMap<>(reply); audit.put("status", "reserved");
                audit.put("attemptedAt", System.currentTimeMillis());
                audit.put("interruptedTaskTool", entry.taskTool());
                audit.put("interruptedTaskArgsSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(entry.taskArgs().getBytes(StandardCharsets.UTF_8))));
            }
            long now = System.currentTimeMillis();
            Long previous = ATTEMPTS.get(body);
            if (previous != null && now - previous < 60_000) throw new IllegalArgumentException("restore_cooldown");
            if (ATTEMPTS.size() >= 64 && previous == null) throw new IllegalArgumentException("restore_capacity");
            ATTEMPTS.put(body, now);
            if (dead) claimDeath(journal, audit);
            invoked = true;
            if (dead) {
                // Native onDeath forgets the body task before marking dead. Old registries
                // can retain interrupted metadata if no brain was present; do the exact
                // forget-state transition before first-tick TaskPersistence.restore can run.
                // The original metadata remains auditable in the already durable claim.
                CompanionRegistry.get(server).put(body, entry.doing("", ""));
            }
            // Both branches load the exact current .dat. Native death has already applied
            // drops/graves/keepInventory and saved the post-death body; never load a backup.
            NumenPlayer restored = dead
                ? CompanionFactory.spawn(server, body, name, owner, server.overworld(), deathLanding)
                : Companions.respawn(server, body);
            if (restored == null || !body.equals(restored.getUUID()) || !owner.equals(restored.getOwnerUuid())
                    || !name.equals(restored.getGameProfile().getName())
                    || server.getPlayerList().getPlayer(body) != restored)
                throw new IllegalStateException("restore_unconfirmed");
            if (dead) {
                if (restored.serverLevel() != server.overworld()
                        || !loadedSafeLanding(restored.serverLevel(), BlockPos.containing(restored.position())))
                    throw new IllegalStateException("death_spawn_unconfirmed");
                CompoundTag loaded = new CompoundTag(); restored.saveWithoutId(loaded);
                reply.put("postDeathInventoryMatched", java.util.Objects.equals(saved.get("Inventory"), loaded.get("Inventory")));
                reply.put("postDeathFoodMatched", saved.getInt("foodLevel") == restored.getFoodData().getFoodLevel());
                reply.put("postDeathXpMatched", saved.getInt("XpTotal") == restored.totalExperience);
                // Exact native respawnDead completion; food, XP, inventory and owner untouched.
                restored.setHealth(restored.getMaxHealth()); restored.clearFire();
                CompanionRegistry.get(server).markAlive(body);
                audit.put("status", "completed"); audit.put("completedAt", System.currentTimeMillis());
                audit.put("postDeathInventoryMatched", reply.get("postDeathInventoryMatched"));
                audit.put("postDeathFoodMatched", reply.get("postDeathFoodMatched"));
                audit.put("postDeathXpMatched", reply.get("postDeathXpMatched"));
                finishDeath(journal, audit);
            }
            reply.put("ok", true); reply.put("phase", "restored"); reply.put("code", "restored_existing");
            reply.put("dimension", restored.serverLevel().dimension().location().toString());
        } catch (Exception error) {
            reply.put("code", invoked ? "restore_outcome_unknown" :
                error instanceof IllegalArgumentException ? error.getMessage() : "playerdata_unavailable");
            reply.put("phase", invoked ? "unknown" : "rejected");
        }
        return respond(source, reply);
    }

    private static int respond(CommandSourceStack source, Map<String, Object> reply) {
        reply.put("observedAt", System.currentTimeMillis());
        source.sendSuccess(() -> Component.literal("QD_NUMEN_RESTORE_JSON " + JSON.toJson(reply)), false);
        return Boolean.TRUE.equals(reply.get("ok")) ? 1 : 0;
    }
}
