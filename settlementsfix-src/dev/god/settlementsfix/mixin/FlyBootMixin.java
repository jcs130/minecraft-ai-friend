package dev.god.settlementsfix.mixin;

import com.mojang.brigadier.CommandDispatcher;
import dev.god.settlementsfix.magic.FlyCommand;
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
 * 御空术命令注册（2026-08-30）：与 SkillChestBootMixin 同款——Commands 构造器
 * TAIL 直接 dispatcher.register，不依赖事件时序。/fly（OP only，RCON 施法链）。
 */
@Mixin(Commands.class)
public class FlyBootMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-fly");

    @Shadow @Final
    private CommandDispatcher<CommandSourceStack> dispatcher;

    @Inject(method = "<init>", at = @At("TAIL"))
    private void settlementsfix$registerFly(CallbackInfo ci) {
        try {
            dispatcher.register(FlyCommand.root());
            GODFIX.info("[fly] command registered on Commands init (/fly)");
        } catch (Exception e) {
            GODFIX.warn("[fly] command register failed: {}", e.toString());
        }
    }
}
