package dev.qiandeng.maw.saoforge.mixins;

import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** A server-resident body has an Owner identity instead of a password socket.
 * Only the current instance attested by our active owner-scoped runtime qualifies;
 * names, UUIDs, a generic Numen class or an offline saved record are insufficient.
 * Every ordinary player's original DirectAuth decision remains unchanged. */
@Pseudo
@Mixin(targets="com.marcp.directauth.auth.LoginManager",remap=false)
public abstract class OwnedNumenAuthenticationMixin {
    @Inject(method="isAuthenticated(Lnet/minecraft/server/level/ServerPlayer;)Z",at=@At("HEAD"),cancellable=true,remap=false,require=1)
    private void ownerIdentity(ServerPlayer player,CallbackInfoReturnable<Boolean> ci) {
        try {
            Class<?> runtime=Class.forName("dev.qiandeng.maw.numenserver.HeadlessRuntime");
            if(Boolean.TRUE.equals(runtime.getMethod("authenticatedBody",ServerPlayer.class).invoke(null,player)))ci.setReturnValue(true);
        }catch(ReflectiveOperationException|LinkageError unavailable){/* Keep the original authentication decision. */}
    }
}
