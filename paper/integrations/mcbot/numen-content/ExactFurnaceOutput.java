/* SPDX-License-Identifier: LGPL-3.0-only */
package com.dwinovo.numen.tools;

import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.FurnaceResultSlot;
import net.minecraft.world.item.ItemStack;

/** A result slot cannot accept the cursor remainder left by dripInto's clicks. */
public final class ExactFurnaceOutput {
    private ExactFurnaceOutput() {}
    public static boolean move(AbstractContainerMenu menu,Player who,int from,int to,int count){
        var source=menu.slots.get(from);var destination=menu.slots.get(to);
        if(!(source instanceof FurnaceResultSlot)||destination.container!=who.getInventory())return false;
        ItemStack stack=source.getItem(),target=destination.getItem();
        if(!menu.getCarried().isEmpty()||count<=0||stack.isEmpty()||!source.mayPickup(who)||!destination.mayPlace(stack))return true;
        if(!target.isEmpty()&&!ItemStack.isSameItemSameComponents(stack,target))return true;
        int room=destination.getMaxStackSize(stack)-target.getCount(),want=Math.min(count,Math.min(room,stack.getCount()));
        if(want<=0)return true;
        // The normal Slot methods keep pickup restrictions, stack components,
        // result-slot onTake/recipe XP and inventory notifications intact.
        ItemStack taken=source.safeTake(want,stack.getCount(),who);
        ItemStack remainder=destination.safeInsert(taken);
        if(!remainder.isEmpty())who.getInventory().placeItemBackInInventory(remainder);
        menu.broadcastChanges();return true;
    }
}
