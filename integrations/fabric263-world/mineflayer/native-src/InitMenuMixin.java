package dev.myagentworld.native263.mixin;

import dev.myagentworld.native263.NativeMenus;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.inventory.AbstractContainerMenu;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerPlayer.class)
public abstract class InitMenuMixin {
    @Inject(method = "initMenu", at = @At("HEAD"), require = 1)
    private void maw$announceCreatedMenu(AbstractContainerMenu menu, CallbackInfo ci) {
        NativeMenus.sendLayout((ServerPlayer) (Object) this, menu);
    }
}
