package dev.qiandeng.accounts.mixin;
import dev.qiandeng.accounts.SharedAccounts;
import com.marcp.directauth.auth.LoginManager;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import net.minecraft.network.chat.Component;
/** A password change in the primary realm must not revive a stale local grace login. */
@Mixin(value=LoginManager.class,remap=false)
public abstract class NoSharedGrace {
    @Inject(method="tryRestoreSession",at=@At("HEAD"),cancellable=true,remap=false)
    private void sharedAccounts(ServerPlayer player,CallbackInfoReturnable<Boolean> ci){if(SharedAccounts.isShared(player))ci.setReturnValue(false);}
    @Inject(method="setAuthenticated",at=@At("HEAD"),cancellable=true,remap=false)
    private void primaryProof(ServerPlayer player,boolean authenticated,CallbackInfo ci){if(authenticated&&!SharedAccounts.allowNativeAuthentication(player)){ci.cancel();player.connection.disconnect(Component.literal("统一身份尚未完成验证，请重新连接；未使用旧凭据放行。"));}}
}
