package dev.qiandeng.maid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Set;

/** Gives one authorized body vanilla entity and nearby world ticks; TLM decides movement.
 * Nine native radius-2 tickets cover only the centre and eight adjacent chunks.
 * No entity creation, chunk search/load, direct tick, AI replacement or teleport.
 */
public final class CompanionTick {
    public static final Path CONFIG = Path.of("config/qiandeng-companion-ticking.json");
    public static final int RADIUS = 2, TIMEOUT_TICKS = 40, REFRESH_TICKS = 20;
    private static final TicketType<ChunkPos> TICKET = TicketType.create(
        "qiandeng_companion", Comparator.comparingLong(ChunkPos::toLong), TIMEOUT_TICKS);
    private static CompanionTickPolicy policy = CompanionTickPolicy.disabled();
    private static String configState = "not_loaded";
    private static boolean installed;
    private static ServerLevel previousLevel;
    private static long previousChunk = Long.MIN_VALUE;
    private static int countdown, lastRefreshServerTick = -1;
    private CompanionTick() {}

    public static synchronized void install() {
        if (installed) return;
        installed = true;
        try {
            if (!Files.exists(CONFIG)) configState = "missing";
            else if (Files.isSymbolicLink(CONFIG) || !Files.isRegularFile(CONFIG) || Files.size(CONFIG) > 4096)
                configState = "invalid";
            else {
                policy = CompanionTickPolicy.parse(Files.readString(CONFIG, StandardCharsets.UTF_8));
                configState = policy.enabled() ? "enabled" : "disabled";
            }
        } catch (Exception ignored) { policy = CompanionTickPolicy.disabled(); configState = "invalid"; }
        // Cached once at startup. This callback must run even when the maid is loaded but not ticking.
        NeoForge.EVENT_BUS.addListener(CompanionTick::onTick);
    }

    static boolean eligible(EntityMaid maid) {
        var server = maid.getServer();
        var owner = server == null || policy.ownerUuid() == null ? null
            : server.getPlayerList().getPlayer(policy.ownerUuid());
        return policy.eligible(maid.getUUID(), maid.getOwnerUUID(), owner == null ? null : owner.getUUID(),
            owner != null && owner.getClass().getName().equals("com.dwinovo.numen.entity.NumenPlayer"),
            owner != null && owner.level() == maid.level(), maid.isAlive(), maid.isRemoved(),
            !maid.isHomeModeEnable(), maid.isMaidInSittingPose(), maid.isNoAi());
    }

    private static EntityMaid loaded(MinecraftServer server) {
        if (!policy.enabled() || policy.bodyUuid() == null) return null;
        for (ServerLevel level : server.getAllLevels()) {
            var entity = level.getEntity(policy.bodyUuid());
            if (entity instanceof EntityMaid maid) return maid;
        }
        return null;
    }

    private static void onTick(ServerTickEvent.Post event) {
        EntityMaid maid = loaded(event.getServer());
        if (maid == null || !eligible(maid)) {
            releasePrevious();
            previousLevel = null; previousChunk = Long.MIN_VALUE; countdown = 0;
            // Existing region tickets expire naturally after forty ticks; never remove another ticket.
            return;
        }
        ServerLevel level = (ServerLevel) maid.level();
        ChunkPos pos = maid.chunkPosition();
        if (level == previousLevel && pos.toLong() == previousChunk && --countdown > 0) return;
        Set<Long> targets = CompanionTickPolicy.worldChunks(pos.x, pos.z);
        if (level != previousLevel || pos.toLong() != previousChunk)
            releasePreviousExcept(level == previousLevel ? targets : Set.of());
        previousLevel = level; previousChunk = pos.toLong(); countdown = REFRESH_TICKS;
        // Entity tickets without NeoForge's forceTicks flag skip vanilla random
        // block ticks when Numen is the only player: its viewer ticket is disabled.
        for (long key : targets) {
            ChunkPos target = new ChunkPos(key);
            level.getChunkSource().addRegionTicket(TICKET, target, RADIUS, target, true);
        }
        lastRefreshServerTick = event.getServer().getTickCount();
    }

    private static void releasePrevious() { releasePreviousExcept(Set.of()); }

    private static void releasePreviousExcept(Set<Long> retained) {
        if (previousLevel == null || previousChunk == Long.MIN_VALUE) return;
        ChunkPos pos = new ChunkPos(previousChunk);
        for (long key : CompanionTickPolicy.worldChunks(pos.x, pos.z)) if (!retained.contains(key)) {
            ChunkPos target = new ChunkPos(key);
            previousLevel.getChunkSource().removeRegionTicket(TICKET, target, RADIUS, target, true);
        }
    }

    public static JsonObject status(EntityMaid maid) {
        JsonObject out = new JsonObject();
        out.addProperty("configState", configState);
        out.addProperty("eligible", eligible(maid));
        out.addProperty("entityTicking", ((ServerLevel) maid.level()).isPositionEntityTicking(maid.blockPosition()));
        out.addProperty("bodyTickCount", maid.tickCount);
        out.addProperty("serverTick", maid.getServer().getTickCount());
        out.addProperty("radius", RADIUS); out.addProperty("timeoutTicks", TIMEOUT_TICKS);
        out.addProperty("refreshTicks", REFRESH_TICKS);
        out.addProperty("forceTicks", true);
        out.addProperty("nativeForceTicks", ((ServerLevel) maid.level()).getChunkSource().chunkMap
            .getDistanceManager().shouldForceTicks(maid.chunkPosition().toLong()));
        out.addProperty("worldTickCapability", "autonomous_world_tick_v3");
        out.addProperty("worldTickChunkRadius", 1); out.addProperty("worldTickChunkCount", 9);
        int forceCount = 0, entityCount = 0;
        ServerLevel level = (ServerLevel) maid.level();
        for (long key : CompanionTickPolicy.worldChunks(maid.chunkPosition().x, maid.chunkPosition().z)) {
            if (level.getChunkSource().chunkMap.getDistanceManager().shouldForceTicks(key)) forceCount++;
            if (level.isPositionEntityTicking(new ChunkPos(key).getMiddleBlockPosition(0))) entityCount++;
        }
        out.addProperty("worldTickNativeForcedCount", forceCount);
        out.addProperty("worldTickEntityTickingCount", entityCount);
        if (policy.bodyUuid() != null && policy.bodyUuid().equals(maid.getUUID()))
            out.addProperty("lastRefreshServerTick", lastRefreshServerTick);
        else out.add("lastRefreshServerTick", com.google.gson.JsonNull.INSTANCE);
        out.addProperty("loadedAloneIsTickEvidence", false);
        return out;
    }
}
