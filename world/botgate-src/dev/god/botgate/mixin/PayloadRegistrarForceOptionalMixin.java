package dev.god.botgate.mixin;

import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * 破基岩/原版之门(2026-08-28 原生 · 2026-09-06 提炼入 botgate)。
 *
 * 现役 NeoForge 21.1.248 中, PayloadRegistrar.register(...) 私有方法将 optional 实参
 * (index 6) 原样传给 NetworkRegistry.register。所有走 PayloadRegistrar 的 mod
 * (architectury / modernfix / puffish_skills / touhou_little_maid_spell /
 * irons_spellbooks / geckolib ...) 都未调 .optional(), 其 payload 全部为
 * required —— NeoForge 协商阶段直接踢掉一切非 NeoForge 客户端, 提示
 * "Incompatible client! Please use NeoForge 21.1.248", 基岩玩家 (Geyser
 * 翻译为原版协议) 与 mineflayer 女神化身因此进不了服。
 *
 * 本 mixin 把该实参强制改为 true: 所有 payload 变 optional, 协商对缺通道的
 * 客户端放行。发送侧天然安全 —— 原版协议对未知 custom payload 通道静默忽略。
 * NeoForge 自身通道不经 PayloadRegistrar 注册, 不受影响。
 */
@Mixin(PayloadRegistrar.class)
public class PayloadRegistrarForceOptionalMixin {

    @ModifyArg(
        method = "register(Lnet/minecraft/network/protocol/common/custom/CustomPacketPayload$Type;Lnet/minecraft/network/codec/StreamCodec;Lnet/neoforged/neoforge/network/handling/IPayloadHandler;Ljava/util/List;Ljava/util/Optional;Ljava/lang/String;Z)V",
        at = @At(
            value = "INVOKE",
            target = "Lnet/neoforged/neoforge/network/registration/NetworkRegistry;register(Lnet/minecraft/network/protocol/common/custom/CustomPacketPayload$Type;Lnet/minecraft/network/codec/StreamCodec;Lnet/neoforged/neoforge/network/handling/IPayloadHandler;Ljava/util/List;Ljava/util/Optional;Ljava/lang/String;Z)V"
        ),
        index = 6
    )
    private boolean botgate$forceOptional(boolean optional) {
        return true;
    }
}
