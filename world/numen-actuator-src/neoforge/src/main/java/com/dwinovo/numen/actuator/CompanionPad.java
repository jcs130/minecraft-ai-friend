package com.dwinovo.numen.actuator;

import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.world.level.ChunkPos;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Keeps a player-sized pad of chunks loaded and ticking around each companion.
 *
 * <p>QiandengJi change (2026-09-18). Upstream already ships a bounded pad — see
 * {@code CompanionChunkLoader}, radius 2, a 5x5 square — and deliberately strips the player
 * loading ticket from companions through its {@code ChunkMapCompanionMixin}. Measured on this
 * world, that left a live body able to load only the line it happened to walk: about 48-96
 * blocks along its travel axis and under 8 blocks across. Anything off that corridor came back
 * {@code target_chunk_unloaded}, so the body could not return to the farm it had just worked,
 * and the agent (correctly) diagnosed it and stopped instead of looping.
 *
 * <p>Widening upstream's constant did not take effect: the class ships inside {@code api/common},
 * which this project bundles into the core jar through jarjar, so a source edit there is not what
 * the running jar loads. Rather than fight that identity question, this adds the pad from our own
 * module with our own ticket name. Nothing is entangled with upstream's own loader, which may keep
 * doing whatever it does, and the radius is ours to configure and to report.
 *
 * <p>The ticket is self-cleaning, exactly as upstream's is: it carries a short timeout and is
 * re-stamped on a chunk crossing or every {@link #REFRESH_TICKS}, so a companion that stops
 * ticking — dormancy, death, despawn, a crash — leaves nothing behind.
 */
public final class CompanionPad {

    /** Java-side config domain, alongside the other qiandeng companion settings. */
    private static final Path CONFIG = FMLPaths.CONFIGDIR.get().resolve("qiandeng-companion-pad.json");
    private static final int MAX_CONFIG_BYTES = 4096;
    private static final int DEFAULT_RADIUS = 6;      // matches this server's view-distance
    private static final int MIN_RADIUS = 0;
    private static final int MAX_RADIUS = 10;         // a cap, so a typo cannot flood the tick budget
    private static final int TIMEOUT_TICKS = 40;
    private static final int REFRESH_TICKS = TIMEOUT_TICKS / 2;
    private static final int RELOAD_EVERY = 100;      // config re-read cadence, in ticks

    private static final TicketType<ChunkPos> TICKET =
            TicketType.create("qiandeng_companion_pad", Comparator.comparingLong(ChunkPos::toLong),
                    TIMEOUT_TICKS);

    private static final class Pad {
        long chunk = Long.MIN_VALUE;
        int countdown;
        int stamped;      // how many tickets we have actually placed, for the status report
    }

    private static final Map<UUID, Pad> pads = new HashMap<>();

    private static volatile boolean enabled = true;
    private static volatile int radius = DEFAULT_RADIUS;
    private static int sinceReload = RELOAD_EVERY;

    private CompanionPad() {}

    /** Read the bounded config. A missing or malformed file keeps the last good values. */
    private static void reload() {
        boolean nextEnabled = true;
        int nextRadius = DEFAULT_RADIUS;
        try {
            if (Files.isRegularFile(CONFIG) && Files.size(CONFIG) <= MAX_CONFIG_BYTES) {
                JsonObject root = JsonParser.parseString(Files.readString(CONFIG)).getAsJsonObject();
                if (root.has("enabled")) {
                    nextEnabled = root.get("enabled").getAsBoolean();
                }
                if (root.has("radiusChunks")) {
                    nextRadius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, root.get("radiusChunks").getAsInt()));
                }
            }
        } catch (Exception ignored) {
            // A bad config must not take the pad down; the defaults above stand.
        }
        enabled = nextEnabled;
        radius = nextRadius;
    }

    public static void onServerTick(ServerTickEvent.Post event) {
        if (--sinceReload <= 0) {
            sinceReload = RELOAD_EVERY;
            reload();
        }
        if (!enabled) {
            return;
        }
        MinecraftServer server = event.getServer();
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player instanceof NumenPlayer companion) {
                refresh(companion);
            }
        }
    }

    /**
     * Re-stamp one companion's pad. Cheap in the steady state: one countdown decrement per tick and
     * one ticket op per {@link #REFRESH_TICKS} ticks, or immediately when the companion crosses into
     * a new chunk — which is what makes the pad travel with the body instead of trailing it.
     */
    private static void refresh(NumenPlayer companion) {
        if (!(companion.level() instanceof ServerLevel level)) {
            return;
        }
        try {
            ChunkPos pos = companion.chunkPosition();
            long packed = pos.toLong();
            Pad pad = pads.computeIfAbsent(companion.getUUID(), key -> new Pad());
            boolean crossed = pad.chunk != packed;
            if (!crossed && pad.countdown > 0) {
                pad.countdown--;
                return;
            }
            pad.chunk = packed;
            pad.countdown = REFRESH_TICKS;
            level.getChunkSource().addRegionTicket(TICKET, pos, radius, pos);
            pad.stamped++;
        } catch (Exception ignored) {
            // Never let the pad take the server tick down with it.
        }
    }

    /** Status for {@code /numen_act pad}: what is configured and what has actually been stamped. */
    public static String status(MinecraftServer server) {
        StringBuilder out = new StringBuilder();
        out.append("enabled=").append(enabled).append(" radiusChunks=").append(radius)
           .append(" pad=").append(2 * radius + 1).append('x').append(2 * radius + 1)
           .append(" timeoutTicks=").append(TIMEOUT_TICKS).append(" config=").append(CONFIG);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player instanceof NumenPlayer companion) {
                Pad pad = pads.get(companion.getUUID());
                out.append('\n').append(companion.getName().getString())
                   .append(" padCenter=").append(pad == null || pad.chunk == Long.MIN_VALUE
                           ? "none" : new ChunkPos(pad.chunk).x + "," + new ChunkPos(pad.chunk).z)
                   .append(" stamped=").append(pad == null ? 0 : pad.stamped);
            }
        }
        return out.toString();
    }
}
