package dev.god.botgate;

import net.neoforged.fml.common.Mod;

/**
 * botgate（2026-09-06 提炼自 settlementsfix godfix 网络之门）。
 *
 * settlements 生态退役时，settlementsfix.jar 一并撤下，但其中五个通用网络门
 * mixin 是裸协议客户端（mineflayer 女神化身/守卫探针/基岩 Geyser）能与
 * NeoForge 服协商存活的命脉，与 settlements 本体无关——提炼为独立 mod。
 *
 *   PayloadRegistrarForceOptionalMixin  所有 mod payload 强制 optional（协商总闸）
 *   ConfigTaskGateForNonNeoForgeMixin   非 NeoForge 连接跳过全部 mod CONFIG 任务
 *   RecipePacketGateForNonNeoForgeMixin 非 NeoForge 连接不下发配方包（防解析错位）
 *   EquipmentPacketGateForNonNeoForgeMixin 非 NeoForge 连接净化装备包（防组件错位）
 *   BetterCombatConfigTaskGateMixin     Better Combat 按连接类型分流（require=0 静默）
 */
@Mod("botgate")
public class BotGateMod {
    public BotGateMod() {
        System.out.println("[BOTGATE] botgate loaded: 5 vanilla/bedrock protocol gates armed");
    }
}
