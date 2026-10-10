package dev.qiandeng.maw.numenserver;

import static dev.qiandeng.maw.numenserver.PrivateStore.*;
import com.dwinovo.numen.entity.NumenPlayer;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import java.util.*;

/** Owner-scoped, ephemeral UI events over the existing authenticated local bridge.
 * All methods run on the server thread; no polling thread, new port or model call.
 */
final class BedrockMenus {
    private static final long SESSION_MS = 20_000, EVENT_MS = 5_000;
    private final HeadlessRuntime runtime;
    private final Map<UUID, Binding> bindings = new HashMap<>();
    private static final class Binding {
        final UUID session;
        final ServerPlayer player;
        long seen, clicked, eventAt;
        JsonObject pending;
        Binding(UUID session, ServerPlayer player, long now) {
            this.session = session; this.player = player; seen = now;
        }
    }
    BedrockMenus(HeadlessRuntime runtime) { this.runtime = runtime; }

    JsonObject invoke(ServerPlayer player, String action, JsonObject args) {
        UUID session = UUID.fromString(text(args, "sessionId", 36));
        long now = System.currentTimeMillis();
        prune(now);
        if (action.equals("bedrock.bind")) {
            if (bindings.size() >= 64 && !bindings.containsKey(player.getUUID()))
                throw new IllegalArgumentException("bedrock_menu_capacity");
            Binding old = bindings.get(player.getUUID());
            if (old == null || old.player != player || !old.session.equals(session))
                bindings.put(player.getUUID(), new Binding(session, player, now));
            else old.seen = now;
            return object("ok", true, "schemaVersion", 1, "visualMenus", true);
        }
        Binding binding = bindings.get(player.getUUID());
        if (binding == null || binding.player != player || !binding.session.equals(session))
            throw new IllegalArgumentException("bedrock_menu_session_expired");
        if (action.equals("bedrock.unbind")) {
            bindings.remove(player.getUUID());
            return object("ok", true);
        }
        if (!action.equals("bedrock.poll")) throw new IllegalArgumentException("unknown_bedrock_ui_action");
        binding.seen = now;
        String ack = args.has("ackEventId") ? text(args, "ackEventId", 36) : "";
        if (binding.pending != null && (now-binding.eventAt > EVENT_MS ||
                ack.equals(binding.pending.get("eventId").getAsString()))) binding.pending = null;
        return object("ok", true, "schemaVersion", 1, "event", binding.pending == null ? null : binding.pending.deepCopy());
    }

    void prune(long now) {
        bindings.entrySet().removeIf(e -> now-e.getValue().seen > SESSION_MS ||
            runtime.server.getPlayerList().getPlayer(e.getKey()) != e.getValue().player);
    }

    static void interact(PlayerInteractEvent.EntityInteract event) {
        if(queue(event,event.getTarget())){
            event.setCanceled(true);event.setCancellationResult(InteractionResult.SUCCESS);
        }
    }
    static void interactSpecific(PlayerInteractEvent.EntityInteractSpecific event) {
        if(queue(event,event.getTarget())){
            event.setCanceled(true);event.setCancellationResult(InteractionResult.SUCCESS);
        }
    }
    private static boolean queue(PlayerInteractEvent event,net.minecraft.world.entity.Entity target) {
        HeadlessRuntime r = HeadlessRuntime.INSTANCE;
        if (r == null || event.getHand() != InteractionHand.MAIN_HAND ||
                !(event.getEntity() instanceof ServerPlayer player) || player instanceof NumenPlayer ||
                !player.isAlive() || player.isSpectator() || !player.getMainHandItem().isEmpty()) return false;
        Binding binding = r.bedrockMenus.bindings.get(player.getUUID());
        long now = System.currentTimeMillis();
        if (binding == null || binding.player != player || now-binding.seen > SESSION_MS) return false;
        if (!target.isAlive() || target.isRemoved() || target.level() != player.level() || player.distanceToSqr(target) > 25) return false;
        String kind = null;
        if (target instanceof NumenPlayer && r.bodies.containsKey(target.getUUID()) &&
                player.getUUID().toString().equals(text(r.bodies.get(target.getUUID()), "ownerUuid", 36))) kind = "companion";
        else if (r.maids != null && r.maids.canOpenFromInteraction(player, target)) kind = "maid";
        if (kind == null) return false;
        // Coalesce general/precise duplicate interactions without a Java-only container.
        if (now-binding.clicked < 750) return true;
        binding.clicked = now; binding.eventAt = now;
        binding.pending = object("schemaVersion", 1, "eventId", UUID.randomUUID(),
            "ownerUuid", player.getUUID(), "kind", kind, "targetUuid", target.getUUID());
        return true;
    }
}
