package com.dwinovo.numen.actuator;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * 服务端 actuator 入口：注册 {@code /numen_act} 命令树，把 Numen 假玩家与工具
 * 暴露给 RCON，供 QwenPaw 亲卫 agent（mc-guard-*）直驱服务端假玩家 ——
 * b 路「亲卫上脑」的服务端侧薄 actuator。
 *
 * <p>依赖 numen-api 引擎（Companions / ToolRegistry / NumenTool 均在
 * {@code api:common}，LGPL-3.0）。本模块是独立 mod（不内改 Numen jar），
 * 自用不发布，LGPL 的「链接」不触发开源义务。
 */
@Mod("numen_act")
public final class NumenActuatorMod {

    public NumenActuatorMod(IEventBus eventBus, ModContainer container) {
        NeoForge.EVENT_BUS.addListener(NumenActuatorMod::onRegisterCommands);
        // 神使通道：进程内控制面（文件队列 + 世界信标），见 GodChannel。
        NeoForge.EVENT_BUS.addListener(GodChannel::onServerTick);
        // 同伴区块票据（2026-09-18）：给假身体一张与玩家等量的加载垫，
        // 否则它只能加载自己走过的那条线，离开即 target_chunk_unloaded。见 CompanionPad。
        NeoForge.EVENT_BUS.addListener(CompanionPad::onServerTick);
        // 技能书右键施法（2026-08-29）：✦ 徽记书右键 → 私语 /cli cast，见 SkillBookHandler。
        NeoForge.EVENT_BUS.addListener(SkillBookHandler::onRightClickItem);
        NeoForge.EVENT_BUS.addListener(SkillBookHandler::onPlayerLoggedOut);
        // 遗迹开箱摸技能书（2026-08-29）：结构区块内容器开箱注入，见 LootInjector。
        NeoForge.EVENT_BUS.addListener(LootInjector::onContainerOpen);
    }

    private static void onRegisterCommands(RegisterCommandsEvent event) {
        NumenActCommand.register(event.getDispatcher());
        GoddessBridgeCommands.register(event.getDispatcher());
    }
}
