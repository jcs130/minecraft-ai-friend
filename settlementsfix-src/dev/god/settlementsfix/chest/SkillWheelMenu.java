package dev.god.settlementsfix.chest;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.MenuType;

import java.util.List;
import java.util.function.Consumer;

/**
 * 技能轮盘（2026-08-30 造物主谕「技能太多占格子，用圆盘施法」）。
 *
 * GENERIC_9x1 一行 9 格：8 技能 + 末格翻轮——服务端容器 UI 里最接近
 * 「按住键弹出轮盘」的形态：秒开、点一下秒施、不遮屏。潜行+右键命格书即开。
 * 点击语义完全继承 SkillChestMenu（施法/翻轮/造物橱窗），零新逻辑。
 */
public class SkillWheelMenu extends SkillChestMenu {

    public SkillWheelMenu(int containerId, net.minecraft.world.entity.player.Inventory playerInventory,
                          ServerPlayer player, List<SkillChestLayout.Entry> entries, int page,
                          long debounceMs, Consumer<Integer> pageTurner,
                          Consumer<Integer> itemPanelOpener) {
        super((MenuType<? extends net.minecraft.world.inventory.ChestMenu>) MenuType.GENERIC_9x1, 1,
                containerId, playerInventory, player, entries, page, debounceMs, pageTurner, itemPanelOpener);
    }
}
