package dev.god.settlementsfix.mixin;

import com.mojang.datafixers.util.Pair;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientboundSetEquipmentPacket;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.common.extensions.ICommonPacketListener;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * godfix 网络之门 · 装备包净化（2026-08-30，Sophisticated 背包物品触发）。
 *
 * 症状：玩家装备栏携带 mod 物品（sophisticatedbackpacks 背包+升级组件）时，
 * entity_equipment（ClientboundSetEquipmentPacket）里的 custom_data NBT 结构
 * 让 mineflayer 的 protodef 解析流错位（"Missing characters in string, found
 * size is 150 expected 182"）→ PartialReadError → bot error → Goddess 化身
 * PLAY 期断连循环 → 咏唱/CLI 施法/书页点击全部哑火（女神化身离线）。
 * modded 真人客户端解析正常，伤的只是原版协议客户端（mineflayer bot/viewer）。
 *
 * 处置：对非 NeoForge 连接，把装备包里「mod 物品」剥掉 custom_data 组件
 * （保留 itemId/count/附魔等标准组件）后重发净化副本；原版物品原样放行。
 * 净化副本再过本门时已无 mod custom_data，天然防递归。
 * require=0：send 签名变动时静默失效（日志 [EQUIP-GATE] 消失即信号），不炸服。
 */
@Mixin(targets = "net.minecraft.server.network.ServerCommonPacketListenerImpl")
public class EquipmentPacketGateForNonNeoForgeMixin {

    @Inject(
        method = "send(Lnet/minecraft/network/protocol/Packet;)V",
        at = @At("HEAD"),
        cancellable = true,
        require = 0
    )
    private void settlementsfix$sanitizeEquipmentForNonNeoForge(Packet<?> packet, CallbackInfo ci) {
        if (!(packet instanceof ClientboundSetEquipmentPacket eq)) return;
        boolean isNeoForge = ((ICommonPacketListener) (Object) this)
                .getConnectionType().isNeoForge();
        if (isNeoForge) return;

        List<Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack>> slots = eq.getSlots();
        boolean need = false;
        for (Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack> p : slots) {
            ItemStack s = p.getSecond();
            if (needsStrip(s)) { need = true; break; }
        }
        if (!need) return;

        List<Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack>> clean = new ArrayList<>();
        for (Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack> p : slots) {
            ItemStack s = p.getSecond();
            if (needsStrip(s)) {
                ItemStack copy = new ItemStack(s.getItem(), s.getCount());
                // 剥 custom_data（mod 动态 NBT 的炸点）；附魔/名称等标准组件保留
                copy.set(DataComponents.CUSTOM_DATA, null);
                clean.add(Pair.of(p.getFirst(), copy));
            } else {
                clean.add(Pair.of(p.getFirst(), s));
            }
        }
        System.out.println("[EQUIP-GATE] ClientboundSetEquipmentPacket sanitized for non-NeoForge conn, entityId="
                + eq.getEntity());
        ci.cancel();
        ((ServerCommonPacketListenerImpl) (Object) this)
                .send(new ClientboundSetEquipmentPacket(eq.getEntity(), clean));
    }

    private static boolean needsStrip(ItemStack s) {
        if (s == null || s.isEmpty()) return false;
        String ns = s.getItem().builtInRegistryHolder().key().location().getNamespace();
        if ("minecraft".equals(ns)) return false;
        return s.has(DataComponents.CUSTOM_DATA);
    }
}
