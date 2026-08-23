package dev.god.settlementsfix.mixin;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 守护天使（Guardian Angel）隐形过滤 —— 2026-08-23 需求文档 #5（服务端落地）。
 *
 * 背景：守护天使 = 玩家客户端侧 AI 陪玩（LLM），以 mineflayer 客户端实体登录
 * （登录名 {@code sys_<owner>}）。需求：该实体对「除 owner 外的所有玩家」不可见，
 * 且服务端世界进程/女神仍正常感知（走 RCON/numen，不依赖这些 Clientbound 包）。
 *
 * 拦截点：{@code ChunkMap$TrackedEntity.updatePlayer(ServerPlayer)} —— 这是唯一把
 * 观看者加进 {@code seenBy} 集合的入口（加入后发 AddEntity 包，后续移动/数据包
 * {@code broadcast} 只遍历 {@code seenBy}）。在 HEAD 处对「非 owner」直接 cancel：
 * 该观看者不进 seenBy → AddEntity / Move / SetEntityData / RotateHead 全都不发，
 * 对该观看者完全隐形。比拦 {@code addPairing} 更彻底（addPairing 在 seenBy.add 之后，
 * 只拦它仍会漏掉 broadcast 的移动包）。
 *
 * owner 可见性（需求 #1，待用户拍板）：由 {@link #OWNER_SEES_GUARDIAN} 控制。
 * true = owner 能在游戏里看到自己的守护天使（默认，符合「其他玩家看不到、自己能看到」）；
 * false = owner 也看不到（纯逻辑存在，最干净）。
 */
@Mixin(targets = "net.minecraft.server.level.ChunkMap$TrackedEntity")
public abstract class GuardianAngelInvisibilityMixin {

    /**
     * owner 是否能看到自己的守护天使（需求 #1 待拍板）。
     * 改这一个常量即可翻转，无需动其他逻辑。
     */
    private static final boolean OWNER_SEES_GUARDIAN = true;

    /** TrackedEntity.entity —— 被追踪的实体。 */
    @Shadow
    @Final
    private Entity entity;

    @Inject(method = "updatePlayer", at = @At("HEAD"), cancellable = true)
    private void settlementsfix$hideGuardianAngel(ServerPlayer player, CallbackInfo ci) {
        // 只有「守护天使」实体需要过滤：mineflayer 客户端登录名 sys_<owner>
        if (!(entity instanceof ServerPlayer sp)) {
            return;
        }
        String loginName = sp.getScoreboardName();
        if (loginName == null || !loginName.startsWith("sys_")) {
            return;
        }
        String owner = loginName.substring("sys_".length());
        boolean isOwner = owner.equalsIgnoreCase(player.getScoreboardName());
        // owner 可见性：false 时 owner 也隐藏；true 时只有 owner 可见、其余全隐藏
        if (!OWNER_SEES_GUARDIAN || !isOwner) {
            ci.cancel(); // 不进 seenBy → 对该观看者不广播任何实体包
        }
    }
}
