package dev.god.botgate.chest;

import net.minecraft.server.level.ServerPlayer;

import java.util.List;
import java.util.function.Consumer;

/**
 * Compatibility name for the unified 27-slot compass. Existing callers retain their entry point.
 */
public class SkillWheelMenu extends SkillChestMenu {

    public SkillWheelMenu(int containerId, net.minecraft.world.entity.player.Inventory playerInventory,
                          ServerPlayer player, List<SkillChestLayout.Entry> entries, int page,
                          long debounceMs, Consumer<Integer> pageTurner,
                          Consumer<Integer> itemPanelOpener) {
        super(containerId, playerInventory, player, entries, page, debounceMs, pageTurner, itemPanelOpener);
    }
}
