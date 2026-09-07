package dev.god.godvoice;

import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.bus.api.Event;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;

/** Optional versioned event contract; no class/link dependency on the staff mod. */
@EventBusSubscriber(modid = "godvoice", bus = EventBusSubscriber.Bus.GAME)
public final class StaffBoundaryListener {
    private static final String EVENT = "dev.qiandeng.chanting.StaffAudioBoundaryEvent";
    private static boolean registered;
    @SubscribeEvent
    public static void starting(ServerStartingEvent event) {
        if (!registered) registered = registerBoundary(NeoForge.EVENT_BUS);
    }

    /** Explicit concrete class registration: NeoForge 8 rejects abstract PlayerEvent listeners. */
    public static boolean registerBoundary(IEventBus bus) {
        try {
            Class<? extends Event> type = Class.forName(EVENT, false, StaffBoundaryListener.class.getClassLoader()).asSubclass(Event.class);
            bus.addListener(type, StaffBoundaryListener::boundary);
            return true;
        } catch (ClassNotFoundException unavailable) {
            return false; // Optional staff mod is absent; ordinary recording is unchanged.
        }
    }

    private static void boundary(Event event) {
        if (!event.getClass().getName().equals(EVENT) || !(event instanceof PlayerEvent playerEvent)
                || !(playerEvent.getEntity() instanceof ServerPlayer player)) return;
        try {
            Class<?> type = event.getClass();
            if (!Integer.valueOf(1).equals(type.getMethod("protocol").invoke(event))) return;
            String phase = (String) type.getMethod("phase").invoke(event);
            long floor = (Long) type.getMethod("floor").invoke(event);
            String result = MicCapture.get().staffBoundary(player.getUUID(), player.getGameProfile().getName(), phase, floor);
            type.getMethod("respond", String.class).invoke(event, result);
        } catch (ReflectiveOperationException | RuntimeException error) {
            GodVoiceLog.warn("staff audio boundary unavailable", error);
        }
    }
    @SubscribeEvent
    public static void logout(PlayerEvent.PlayerLoggedOutEvent event) { MicCapture.get().forget(event.getEntity().getUUID()); }
}
