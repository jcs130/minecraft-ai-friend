package dev.qiandeng.maw;

import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.Event;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import net.neoforged.neoforge.common.NeoForge;

/** Folkways decorates ordinary chests with an LDLib overlay. Keep the real
 * chest/menu for connections without LDLib instead of sending unsupported UI
 * payloads. No channel is falsely advertised and no colony permission changes.
 * Version-pinned public mixin field: LDLib 2.2.42's public setter rejects null. */
final class FolkwaysUiCompat {
    private static final org.slf4j.Logger LOGGER = org.slf4j.LoggerFactory.getLogger(FolkwaysUiCompat.class);
    private static final String SITE_UI = "io.github.izakyl.folkways.front.ui.screen.ColonyShell$SiteUI";
    private static final CustomPacketPayload.Type<CustomPacketPayload> SYNC = new CustomPacketPayload.Type<>(ResourceLocation.parse("ldlib2:modular_ui_sync"));
    static void register(IEventBus modBus) {
        modBus.addListener((FMLCommonSetupEvent event) -> event.enqueueWork(FolkwaysUiCompat::configure));
    }
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void configure() {
        if (!ModList.get().isLoaded("folkways") || !ModList.get().isLoaded("ldlib2")) return;
        try {
            Class<? extends Event> eventType = (Class<? extends Event>) Class.forName("com.lowdragmc.lowdraglib2.gui.event.ContainerMenuEvent$Create");
            var playerField = eventType.getField("player");
            var menuField = eventType.getField("menu");
            NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, false, (Class) eventType, (java.util.function.Consumer<Event>) event -> {
                try {
                    if (!(playerField.get(event) instanceof ServerPlayer player)
                            || player.connection != null && player.connection.hasChannel(SYNC)) return;
                    Object menu = menuField.get(event);
                    var overlay = menu.getClass().getField("ldlib2$modularUI");
                    Object ui = overlay.get(menu);
                    if (ui != null && ui.getClass().getName().equals(SITE_UI)) overlay.set(menu, null);
                } catch (ReflectiveOperationException error) {
                    throw new IllegalStateException("folkways_container_overlay_api_mismatch", error);
                }
            });
            LOGGER.info("Folkways ordinary containers preserve native slots for connections without LDLib UI");
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("folkways_container_overlay_api_mismatch", error);
        }
    }
}
