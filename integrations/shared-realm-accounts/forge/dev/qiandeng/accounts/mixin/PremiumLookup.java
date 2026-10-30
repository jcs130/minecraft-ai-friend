package dev.qiandeng.accounts.mixin;
import dev.qiandeng.accounts.SharedAccounts;
import com.marcp.directauth.data.DatabaseManager;
import com.marcp.directauth.data.UserData;
import java.util.concurrent.CompletableFuture;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
/** Decorate the native pre-login lookup, preserving its actual Mojang handshake. */
@Mixin(value=DatabaseManager.class,remap=false)
public abstract class PremiumLookup {
    @Inject(method="getUserAsync",at=@At("RETURN"),cancellable=true,remap=false)
    private void primaryPremium(String name,CallbackInfoReturnable<CompletableFuture<UserData>> ci){ci.setReturnValue(SharedAccounts.premiumLookup(name,ci.getReturnValue()));}
}
