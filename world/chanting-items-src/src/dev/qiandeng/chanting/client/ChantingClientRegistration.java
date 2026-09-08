package dev.qiandeng.chanting.client;

import dev.qiandeng.chanting.QiandengChantingItems;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;

@EventBusSubscriber(modid = QiandengChantingItems.MOD_ID, value = Dist.CLIENT,
        bus = EventBusSubscriber.Bus.MOD)
public final class ChantingClientRegistration {
    private ChantingClientRegistration() { }

    @SubscribeEvent
    public static void registerKeys(RegisterKeyMappingsEvent event) {
        for (var key : ChantingClient.KEYS) event.register(key);
        // Controlify locks its binding registry at onGameLoadFinished; key
        // mapping registration happens earlier, before controller discovery.
        ChantingClient.registerOptionalController();
    }
}
