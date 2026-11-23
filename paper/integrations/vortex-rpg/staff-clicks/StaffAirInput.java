package io.vortexcore.item;

import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;

/** An empty block interaction does not veto an explicitly configured staff item action. */
final class StaffAirInput {
    private StaffAirInput() {}

    static boolean accepted(PlayerInteractEvent event, CustomItemDefinition definition) {
        Action action = event.getAction();
        if (definition != null && definition.id().equals("mage_apprentice_staff")
                && (action == Action.LEFT_CLICK_AIR || action == Action.RIGHT_CLICK_AIR)) {
            return event.useItemInHand() != Event.Result.DENY;
        }
        return !event.isCancelled();
    }
}
