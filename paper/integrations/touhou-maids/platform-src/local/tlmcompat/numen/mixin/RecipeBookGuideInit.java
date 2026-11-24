package local.tlmcompat.numen.mixin;

import local.tlmcompat.numen.RecipeBookGuide;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.stats.ServerRecipeBook;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerRecipeBook.class)
public abstract class RecipeBookGuideInit {
    @Inject(
            method = "sendInitialRecipeBook(Lnet/minecraft/server/level/ServerPlayer;)V",
            at = @At("HEAD"),
            require = 1
    )
    private void tlmcompat$populateGuide(ServerPlayer player, CallbackInfo ci) {
        RecipeBookGuide.populate((ServerRecipeBook) (Object) this, player);
    }
}
