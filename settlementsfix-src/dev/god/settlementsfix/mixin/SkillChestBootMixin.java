package dev.god.settlementsfix.mixin;

import com.mojang.brigadier.CommandDispatcher;
import dev.god.settlementsfix.chest.SkillChestCommands;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 宝箱技能面板 · 命令注册（2026-08-30 docs/skill-chest-design.md）。
 *
 * 直接注进 Commands 构造器尾部：不管命令树何时重建（启动、/reload），都能注册。
 * v1 曾走 RegisterCommandsEvent 监听（initServer HEAD 挂钩）——启动期事件先于
 * 挂钩 fire，错过注册，`/skillchest` Unknown（/reload 才生效）；v2 构造器注入
 * 根治。 brigadier root.addChild 同名覆盖，重复注册安全。
 *
 * /skillchest open <player> [page]  OP：开面板
 * /skillchest click <player> <slot> 测试钩子（-Dsettlementsfix.testHooks=true）
 */
@Mixin(Commands.class)
public class SkillChestBootMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-skillchest");

    @Shadow @Final
    private CommandDispatcher<CommandSourceStack> dispatcher;

    @Inject(method = "<init>", at = @At("TAIL"))
    private void settlementsfix$registerSkillChest(CallbackInfo ci) {
        try {
            dispatcher.register(SkillChestCommands.root());
            GODFIX.info("[skillchest] command registered on Commands init (/skillchest)");
        } catch (Exception e) {
            GODFIX.warn("[skillchest] command register failed: {}", e.toString());
        }
    }
}
