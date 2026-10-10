package dev.qiandeng.maw.numenserver.mixin;

import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.program.*;
import dev.qiandeng.maw.numenserver.HeadlessRuntime;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import java.util.UUID;
import java.util.function.Consumer;

@Mixin(value=ServerPrograms.class, remap=false)
public abstract class ProgramOwnershipMixin {
    @Inject(method="run", at=@At("HEAD"), cancellable=true)
    private static void maw$singleController(NumenPlayer body, UUID companion, UUID owner,
            ServerPrograms.Request request, ClientTransport transport, CallObserver observer,
            Consumer<RunResult> done, CallbackInfo ci) {
        if (HeadlessRuntime.managed(companion) && !HeadlessRuntime.authorizedDispatch()) {
            done.accept(RunResult.refused("server_managed_body: use the authenticated server SDK; another controller cannot dispatch"));
            ci.cancel();
        }
    }
}
