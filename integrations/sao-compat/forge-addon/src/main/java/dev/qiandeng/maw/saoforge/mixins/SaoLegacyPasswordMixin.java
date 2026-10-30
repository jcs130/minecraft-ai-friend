package dev.qiandeng.maw.saoforge.mixins;

import dev.qiandeng.maw.saoforge.SaoLegacyPasswords;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Pseudo;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Keep DirectAuth's async pool, account checks, lockout and atomic rehash. */
@Pseudo
@Mixin(targets="com.marcp.directauth.auth.LoginManager", remap=false)
public abstract class SaoLegacyPasswordMixin {
    @SuppressWarnings({"rawtypes", "unchecked"})
    @Inject(method="verifyPassword(Ljava/lang/String;Ljava/lang/String;)Lcom/marcp/directauth/auth/LoginManager$PasswordCheck;", at=@At("HEAD"), cancellable=true, require=0, remap=false)
    private static void mawLegacyPassword(String password, String storedHash, CallbackInfoReturnable<Object> result) {
        Boolean valid = SaoLegacyPasswords.verifyIfLegacy(password, storedHash);
        if (valid == null) return;
        try {
            Class type = Class.forName("com.marcp.directauth.auth.LoginManager$PasswordCheck");
            result.setReturnValue(Enum.valueOf(type, valid ? "OK_NEEDS_REHASH" : "WRONG"));
        } catch (ClassNotFoundException failure) { throw new IllegalStateException("pinned_auth_runtime_unavailable", failure); }
    }
}
