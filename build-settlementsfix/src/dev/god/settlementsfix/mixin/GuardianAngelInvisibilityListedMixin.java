package dev.god.settlementsfix.mixin;

import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * 守护天使 tab 列表隐形 —— 补 player_info 层（2026-08-23，需求文档 #5 收尾）。
 *
 * 背景：{@link GuardianAngelInvisibilityMixin} 只挡了「实体追踪」通道
 * （{@code ChunkMap$TrackedEntity.updatePlayer}），非 owner 看不到世界里的 3D 实体/漂浮名；
 * 但 MC 还有一条独立的「玩家列表」通道（{@code player_info} 包），它决定按 T 打开的
 * tab 名单。实测发现非 owner 的 tab 里仍显示 {@code sys_<owner>} 的名字——等于泄露了
 * 「有个隐藏实体 + sys_ 命名规律」。本 mixin 补上这条通道。
 *
 * 拦截点：{@code ClientboundPlayerInfoUpdatePacket$Entry(ServerPlayer)} 构造。这是所有
 * 玩家信息（加入/延迟/游戏模式/显示名/listed 状态）被打成 {@code player_info} 包进 tab
 * 列表的唯一入口。构造里 {@code listed} 参数被原版硬编码为 {@code true}（字节码 iconst_1，
 * 见 javap 反编译 {@code ClientboundPlayerInfoUpdatePacket$Entry.<init>} 第 9 行）。
 *
 * 语义：{@code listed=false} 时，客户端仍会渲染该玩家的实体（实体层由另一个 mixin 独立
 * 控制，owner 世界可见、非 owner 不可见），但**不把该玩家列入 tab 列表**，也不影响皮肤
 * 加载与私聊交互。所以把 sys_ 前缀玩家强制 {@code listed=false}，即全局 tab 隐藏。
 *
 * 与 owner 可见性（需求 #1）的关系：本 mixin 是「全局 tab 隐藏」（含 owner 的 tab），
 * 独立于 {@link GuardianAngelInvisibilityMixin#OWNER_SEES_GUARDIAN}（只控制世界内实体）。
 * owner 世界里仍能看到天使实体，只是 tab 名单里不出现——符合「守护者隐藏于名单之外」。
 */
@Mixin(targets = "net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket$Entry")
public abstract class GuardianAngelInvisibilityListedMixin {

    /**
     * 拦截 {@code Entry(ServerPlayer)} 构造里对 7 参 canonical 构造的委托调用，
     * 把第 3 个参数（index=2，boolean listed）改为：sys_ 前缀玩家 -> false，其余 -> 原值。
     *
     * @param listed 原 listed 值（原版写死 true）
     * @param player 被注入构造的参数——正在被打成 player_info 条目的玩家
     */
    @ModifyArg(
        method = "<init>(Lnet/minecraft/server/level/ServerPlayer;)V",
        at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/game/ClientboundPlayerInfoUpdatePacket$Entry;<init>(Ljava/util/UUID;Lcom/mojang/authlib/GameProfile;ZILnet/minecraft/world/level/GameType;Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/RemoteChatSession$Data;)V"
        ),
        index = 2
    )
    private boolean settlementsfix$unlistGuardian(boolean listed, ServerPlayer player) {
        String name = player.getScoreboardName();
        if (name != null && name.startsWith("sys_")) {
            return false; // 守护天使不进 tab 列表
        }
        return listed;
    }
}
