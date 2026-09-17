package com.dwinovo.numen.actuator;

import java.util.List;
import java.util.Random;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.entity.BaseContainerBlockEntity;
import net.minecraft.world.level.chunk.LevelChunk;
import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;

/**
 * 遗迹开箱摸技能书（2026-08-29 造物主谕「遗迹/宝箱里放技能书，现在太单调」）。
 *
 * <p>玩家打开结构区块内（村庄/试炼密室/沉船/要塞/地牢…区块结构引用非空即算）的
 * 箱子/木桶时，按稀有度概率塞入一本 ✦ 技能书（右键即施法，与萌萌速发书同款）。
 * 探索即得法术——给真人探索者的惊喜通道；AI 已全量知晓咒语，摸书无感。
 *
 * <ul>
 *   <li>常见 Lv≤2（鉴定/照明/风爆/归乡/圣愈…）70%；稀有 Lv3-12（雷暴/螺旋丸/
 *       影分身/隐身…）25%；传说 Lv15+（陨石/破晓/通灵契约/空间传送…）5%；</li>
 *   <li>每箱终生一次：BlockEntity 持久 NBT 标记 sb_loot（书被拿走也不再注，
 *       防刷书）；</li>
 *   <li>非结构区块（玩家家箱子）零打扰；自己的背包菜单（inventoryMenu）排除；</li>
 *   <li>double chest 的 Composite 容器不是 BlockEntity，v1 跳过（遗迹少见双箱）。</li>
 * </ul>
 */
public final class LootInjector {

    private static final List<String> COMMON = List.of(
            "鉴定", "照明术", "风爆术", "化水术", "跃升术", "羽落术", "夜视术", "澄光",
            "归乡", "圣愈术", "饱食赐福", "炼食术", "造物术", "覆土术", "迅捷术",
            "水息术", "避火术", "灌顶", "意行",
            "烟花术", "星尘术", "火焰掌", "羽盾术", "心眼术", "凌波微步", "磁石术");
    private static final List<String> RARE = List.of(
            "燃血术", "大地塑形", "再生术", "急迫术", "隐身术", "唤雨术", "雷暴术",
            "唤马术", "铁卫术", "铁肤术", "神力术", "螺旋丸", "影分身之术", "驱云术",
            "炎爆术", "冰霜新星", "剧毒瘴气", "结界术", "闪电链");
    private static final List<String> LEGENDARY = List.of(
            "退魔术", "通灵契约", "驮兽契约", "陨石术", "破晓术", "空间传送",
            "星爆气流斩", "铁卫傀儡");
    private static final float CHANCE = 0.70f; // 结构箱 70% 出书（剩下 30% 保持原味）
    private static final Random RNG = new Random();

    private LootInjector() {}

    public static void onContainerOpen(PlayerContainerEvent.Open event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) return;
        AbstractContainerMenu menu = event.getContainer();
        if (menu == null || menu == player.inventoryMenu) return;
        if (!(menu instanceof ChestMenu chestMenu)) return; // v1：箱子系菜单（含木桶/潜影盒映射不到，见下）
        Container container = chestMenu.getContainer();
        if (!(container instanceof BaseContainerBlockEntity be)) return;
        if (!(be.getLevel() instanceof ServerLevel level)) return;

        // 结构区块判定：区块结构引用非空 = 村庄/遗迹/地牢等（玩家自建家通常不在结构区块）。
        LevelChunk chunk = level.getChunkAt(be.getBlockPos());
        if (chunk.getAllReferences().isEmpty()) return;

        // 每箱终生一次：持久 NBT 标记（书被拿走也不重注，防刷）。
        if (be.getPersistentData().getBoolean("sb_loot")) return;
        be.getPersistentData().putBoolean("sb_loot", true);

        if (RNG.nextFloat() >= CHANCE) return;
        float roll = RNG.nextFloat();
        List<String> tier = roll < 0.05f ? LEGENDARY : roll < 0.30f ? RARE : COMMON;
        String spell = tier.get(RNG.nextInt(tier.size()));

        ItemStack book = new ItemStack(Items.ENCHANTED_BOOK);
        book.set(DataComponents.CUSTOM_NAME,
                Component.literal("\u2726 " + spell).withStyle(ChatFormatting.GOLD));
        // 找第一个空位塞入（箱满则放弃——箱子满了本来也不缺这一卷）。
        for (int i = 0; i < container.getContainerSize(); i++) {
            if (container.getItem(i).isEmpty()) {
                container.setItem(i, book);
                break;
            }
        }
        be.setChanged();
        container.setChanged();
        player.sendSystemMessage(Component.literal(
                "\u2726 遗迹深处摸出一卷" + (tier == LEGENDARY ? "发光的古卷" : "古卷") + "…"));
        player.server.sendSystemMessage(
                Component.literal("[loot-inject] " + player.getGameProfile().getName()
                        + " opened " + be.getBlockPos().toShortString() + " -> book: " + spell));
    }
}
