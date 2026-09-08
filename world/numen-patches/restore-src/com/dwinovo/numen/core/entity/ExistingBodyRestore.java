package com.dwinovo.numen.core.entity;

import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.Companions;
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

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Reconnect a known dormant body; never creates an identity or repairs a save. */
public final class ExistingBodyRestore {
    private static final Gson JSON = new Gson();
    private static final Map<UUID, Long> ATTEMPTS = new LinkedHashMap<>();
    public static final String CAPABILITY = "existing_body_restore_v1";
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
            if (entry.diedAt() > 0) throw new IllegalArgumentException("body_dead");
            if (entry.taskTool() != null && !entry.taskTool().isBlank())
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
            long now = System.currentTimeMillis();
            Long previous = ATTEMPTS.get(body);
            if (previous != null && now - previous < 60_000) throw new IllegalArgumentException("restore_cooldown");
            if (ATTEMPTS.size() >= 64 && previous == null) throw new IllegalArgumentException("restore_capacity");
            ATTEMPTS.put(body, now);
            invoked = true;
            // No position/skin/owner override; the original factory loads this exact .dat.
            NumenPlayer restored = Companions.respawn(server, body);
            if (restored == null || !body.equals(restored.getUUID()) || !owner.equals(restored.getOwnerUuid())
                    || !name.equals(restored.getGameProfile().getName())
                    || server.getPlayerList().getPlayer(body) != restored)
                throw new IllegalStateException("restore_unconfirmed");
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
