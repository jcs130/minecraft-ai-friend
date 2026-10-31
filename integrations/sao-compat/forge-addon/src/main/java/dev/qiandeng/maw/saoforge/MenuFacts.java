package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;

/** Observe native slot predicates; never choose an item or perform an action. */
final class MenuFacts {
    static void slot(ServerPlayer player,AbstractContainerMenu menu,Slot slot,JsonObject row) {
        try {
            row.addProperty("active",slot.isActive());row.addProperty("maxStackSize",slot.getMaxStackSize());
            if(menu.getCarried().isEmpty())row.add("mayPlaceCarried",JsonNull.INSTANCE);
            else row.addProperty("mayPlaceCarried",slot.mayPlace(menu.getCarried()));
        }catch(RuntimeException unknown){row.add("active",JsonNull.INSTANCE);row.add("maxStackSize",JsonNull.INSTANCE);row.add("mayPlaceCarried",JsonNull.INSTANCE);row.addProperty("rulesUnavailableReason","native_slot_context_unavailable");}
    }
    static void menu(ServerPlayer player,AbstractContainerMenu menu,JsonObject out) {
        try {out.addProperty("stillValid",menu.stillValid(player));}catch(RuntimeException unknown){out.add("stillValid",JsonNull.INSTANCE);}
        out.addProperty("bodyCanInteract",!player.isDeadOrDying()&&!player.isSpectator());
        out.addProperty("interactionScope","actual_open_menu_own_connection");
        out.addProperty("slotRulesObservedNotAuthorization",true);
    }
}
