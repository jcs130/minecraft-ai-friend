package dev.god.godvoice;

import net.neoforged.bus.api.BusBuilder;
import net.neoforged.bus.api.Event;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/** Runs with the project's actual NeoForge 21.1.248 + bus 8.0.5 binaries. */
public final class StaffBoundaryRegistrationTest {
    public static void main(String[] args) throws Exception {
        var bus = BusBuilder.builder().build();
        // Exercise the exact automatic-subscriber registration that previously crashed startup.
        bus.register(StaffBoundaryListener.class);
        boolean expected = args.length > 0 && args[0].equals("present");
        boolean registered = StaffBoundaryListener.registerBoundary(bus);
        if (registered != expected) throw new AssertionError("Optional concrete boundary registration");
        int assertions = 2;
        try {
            bus.addListener(PlayerEvent.class, event -> { });
            throw new AssertionError("Actual bus must reject the former abstract subscription");
        } catch (IllegalArgumentException confirmed) { assertions++; }
        if (expected) {
            Class<? extends Event> type = Class.forName("dev.qiandeng.chanting.StaffAudioBoundaryEvent").asSubclass(Event.class);
            int[] received = {0};
            bus.addListener(type, event -> received[0]++);
            Event event = (Event) type.getConstructors()[0].newInstance(null, "hold", -1L);
            bus.post(event);
            if (received[0] != 1) throw new AssertionError("Concrete event dispatch");
            assertions++;
        }
        System.out.println("{\"ok\":true,\"assertions\":" + assertions + ",\"staffPresent\":" + expected + "}");
    }
}
