package dev.god.botgate.mixin;

import com.mojang.datafixers.util.Pair;
import dev.god.botgate.VanillaItemComponents;
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
 * botgate 网络之门 · 装备包净化（2026-08-30 原生 · 2026-09-06 提炼）。
 *
 * 症状: 玩家装备栏携带 mod 物品 (sophisticatedbackpacks 背包+升级组件) 时,
 * entity_equipment (ClientboundSetEquipmentPacket) 里的 custom_data NBT 结构
 * 让 mineflayer 的 protodef 解析流错位 ("Missing characters in string, found
 * size is 150 expected 182") → PartialReadError → bot error → Goddess 化身
 * PLAY 期断连循环 → 咏唱/CLI 施法/书页点击全部哑火 (女神化身离线)。
 * modded 真人客户端解析正常, 伤的只是原版协议客户端 (mineflayer bot/viewer)。
 *
 * 2026-09-07 实包定位：非原版 DataComponentType 没有可跳过的长度，
 * 未识别组件使后续 NBT 错位。统一只过滤这些组件，保留原版 custom_data、
 * 名称与附魔等字段；不改服务端装备。NeoForge 连接原样放行。
 */
@Mixin(targets = "net.minecraft.server.network.ServerCommonPacketListenerImpl")
public class EquipmentPacketGateForNonNeoForgeMixin {

    @Inject(
        method = "send(Lnet/minecraft/network/protocol/Packet;)V",
        at = @At("HEAD"),
        cancellable = true,
        require = 1
    )
    private void botgate$sanitizeEquipmentForNonNeoForge(Packet<?> packet, CallbackInfo ci) {
        if (!(packet instanceof ClientboundSetEquipmentPacket eq)) return;
        boolean isNeoForge = ((ICommonPacketListener) (Object) this)
                .getConnectionType().isNeoForge();
        if (isNeoForge) return;

        List<Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack>> slots = eq.getSlots();
        List<Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack>> clean = new ArrayList<>();
        boolean need = false;
        for (Pair<net.minecraft.world.entity.EquipmentSlot, ItemStack> p : slots) {
            ItemStack s = p.getSecond();
            ItemStack copy = VanillaItemComponents.sanitize(s);
            need |= copy != s;
            clean.add(Pair.of(p.getFirst(), copy));
        }
        if (!need) return;
        System.out.println("[EQUIP-GATE] ClientboundSetEquipmentPacket sanitized for non-NeoForge conn, entityId="
                + eq.getEntity());
        ci.cancel();
        ((ServerCommonPacketListenerImpl) (Object) this)
                .send(new ClientboundSetEquipmentPacket(eq.getEntity(), clean));
    }

}
