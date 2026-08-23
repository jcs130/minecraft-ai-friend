package dev.god.settlementsfix.mixin;

import com.mojang.authlib.GameProfile;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArgs;
import org.spongepowered.asm.mixin.injection.invoke.arg.Args;

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
 * 列表的唯一入口。构造里 {@code listed} 参数被原版硬编码为 {@code true}（字节码 iconst_1）。
 *
 * 语义：{@code listed=false} 时，客户端仍会渲染该玩家的实体（实体层由另一个 mixin 独立
 * 控制，owner 世界可见、非 owner 不可见），但**不把该玩家列入 tab 列表**。把 sys_ 前缀
 * 玩家强制 {@code listed=false}，即全局 tab 隐藏（含 owner 的 tab），与
 * {@link GuardianAngelInvisibilityMixin#OWNER_SEES_GUARDIAN}（只控制世界内实体）不冲突。
 *
 * 实现注记（2026-08-23 三次踩坑）：
 *  1. 注入点在 {@code this()} 构造委托之前，{@code this} 未初始化，handler 必须 static；
 *  2. {@code @ModifyArg} 的 handler 默认只接收「被修改参数」，额外参数不能凭空声明（会报
 *     invalid signature），需 {@code @Local}/LocalCapture 才能捕获上下文；
 *  3. 改用 {@code @ModifyArgs}：handler 只收一个 {@link Args} 对象，可同时读参数（
 *     {@code args.get(1)} 取 GameProfile 判断 sys_ 前缀）和改参数（{@code args.set(2,
 *     false)} 把 listed 置 false），无需 MixExtras、无需纠结参数捕获顺序。
 */
@Mixin(targets = "net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket$Entry")
public abstract class GuardianAngelInvisibilityListedMixin {

    /**
     * 拦截 {@code Entry(ServerPlayer)} 构造里对 7 参 canonical 构造的委托调用
     * {@code this(uuid, profile, true, latency, gameType, displayName, chatSession)}，
     * 把第 3 个参数（index=2，boolean listed，原版写死 true）改为：sys_ 前缀玩家 -> false。
     *
     * @param args 被调用的 7 参构造的参数集合；index 1 = GameProfile，index 2 = listed
     */
    @ModifyArgs(
        method = "<init>(Lnet/minecraft/server/level/ServerPlayer;)V",
        at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/game/ClientboundPlayerInfoUpdatePacket$Entry;<init>(Ljava/util/UUID;Lcom/mojang/authlib/GameProfile;ZILnet/minecraft/world/level/GameType;Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/RemoteChatSession$Data;)V"
        )
    )
    private static void settlementsfix$unlistGuardian(Args args) {
        GameProfile profile = args.get(1);
        if (profile != null) {
            String name = profile.getName();
            if (name != null && name.startsWith("sys_")) {
                args.set(2, false); // 守护天使不进 tab 列表
            }
        }
    }
}
