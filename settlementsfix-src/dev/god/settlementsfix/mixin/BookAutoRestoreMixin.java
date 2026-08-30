package dev.god.settlementsfix.mixin;

import net.minecraft.core.component.DataComponents;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.nbt.CompoundTag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * godfix 神物护持 · 命格书自动回身（2026-08-30 造物主谕：书丢了要找得回来）。
 *
 * 每 100 tick（5s）检查一次在线玩家背包（36 格+副手）：无命格书（custom_data
 * statusbook=true）→ 自动补发一本（新书右键动态重写书页，数据在 magic-state，
 * 书只是壳——丢了=换个壳）。
 * 覆盖场景：主动丢（被 DropGuard 拦，正常丢不出）、死亡掉落、塞进箱子忘了、
 * 被岩浆烧了、给错了人——5 秒内自动回身，永不丢失。
 * 潜行中的玩家不补（防打断正在进行的容器操作……实际 give 不打断，仅保守节流）。
 * require=0：无 tick 不炸。
 */
@Mixin(ServerPlayer.class)
public abstract class BookAutoRestoreMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-bookrestore");

    private static final long CHECK_INTERVAL_TICKS = 100;
    private static final Map<UUID, Long> NEXT_CHECK = new ConcurrentHashMap<>();

    @Inject(method = "tick", at = @At("HEAD"), require = 0)
    private void settlementsfix$autoRestoreBook(CallbackInfo ci) {
        try {
            ServerPlayer self = (ServerPlayer) (Object) this;
            long gameTime = self.serverLevel().getGameTime();
            UUID id = self.getUUID();
            Long next = NEXT_CHECK.get(id);
            if (next == null) {
                NEXT_CHECK.put(id, gameTime + 40L); // 登录后 2s 首查
                return;
            }
            if (gameTime < next) {
                return;
            }
            NEXT_CHECK.put(id, gameTime + CHECK_INTERVAL_TICKS);
            if (self.isSpectator()) {
                return;
            }
            if (!hasStatusBook(self)) {
                giveStatusBook(self);
            }
            // 技能罗盘（2026-08-30 造物主谕：书页手柄点不了 → 罗盘右键=轮盘）：
            // 同一套护持——无 skillbox 物品 5s 内自动补发罗盘（壳可换，丢了就回来）。
            if (!hasWheelItem(self)) {
                giveWheelItem(self);
            }
        } catch (Exception e) {
            GODFIX.warn("[bookrestore] tick hook failed: {}", e.toString());
        }
    }

    /** 技能罗盘：custom_data.skillbox=true 的任意物品（罗盘为正壳）。 */
    private static boolean hasWheelItem(ServerPlayer sp) {
        for (int i = 0; i < sp.getInventory().getContainerSize(); i++) {
            ItemStack stack = sp.getInventory().getItem(i);
            if (stack == null || stack.isEmpty()) {
                continue;
            }
            CustomData cd = stack.get(DataComponents.CUSTOM_DATA);
            if (cd != null && !cd.isEmpty() && cd.copyTag().getBoolean("skillbox")) {
                return true;
            }
        }
        return false;
    }

    private static void giveWheelItem(ServerPlayer sp) {
        ItemStack wheel = new ItemStack(Items.COMPASS);
        CompoundTag tag = new CompoundTag();
        tag.putBoolean("skillbox", true);
        wheel.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
        wheel.set(DataComponents.ITEM_NAME,
                net.minecraft.network.chat.Component.literal("§b✦ 技能罗盘 ✦"));
        if (!sp.getInventory().add(wheel)) {
            GODFIX.info("[bookrestore] {} inventory full, wheel retry next round",
                    sp.getGameProfile().getName());
            return;
        }
        sp.displayClientMessage(
                net.minecraft.network.chat.Component.literal(
                        "§b✦ 技能罗盘回到你的行囊。（右键即开技能轮盘，永不遗失）"), false);
        GODFIX.info("[bookrestore] skill wheel auto-restored to {}",
                sp.getGameProfile().getName());
    }

    private static boolean hasStatusBook(ServerPlayer sp) {
        for (int i = 0; i < sp.getInventory().getContainerSize(); i++) {
            if (isStatusBook(sp.getInventory().getItem(i))) {
                return true;
            }
        }
        return false;
    }

    private static boolean isStatusBook(ItemStack stack) {
        if (stack == null || !stack.is(Items.WRITTEN_BOOK)) {
            return false;
        }
        CustomData cd = stack.get(DataComponents.CUSTOM_DATA);
        if (cd == null || cd.isEmpty()) {
            return false;
        }
        return cd.copyTag().getBoolean("statusbook");
    }

    private static void giveStatusBook(ServerPlayer sp) {
        ItemStack book = new ItemStack(Items.WRITTEN_BOOK);
        CompoundTag tag = new CompoundTag();
        tag.putBoolean("statusbook", true);
        book.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
        book.set(DataComponents.ITEM_NAME,
                net.minecraft.network.chat.Component.literal("§6❖ 命格书 ❖"));
        if (!sp.getInventory().add(book)) {
            // 背包满：本轮放弃（不 drop——DropGuard 会拦，物品凭空消失），
            // 5s 后下一轮重试；玩家腾出格子书自动回来。
            GODFIX.info("[bookrestore] {} inventory full, retry next round",
                    sp.getGameProfile().getName());
            return;
        }
        sp.displayClientMessage(
                net.minecraft.network.chat.Component.literal(
                        "§6✦ 命格书回到你的行囊。（此书与你命格相连，永不遗失）"), false);
        GODFIX.info("[bookrestore] status book auto-restored to {}",
                sp.getGameProfile().getName());
    }
}
