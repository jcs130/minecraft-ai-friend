package dev.qiandeng.maw.numenserver.mixin;

import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.task.CompanionTickDispatcher;
import dev.qiandeng.maw.numenserver.HeadlessRuntime;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value=CompanionTickDispatcher.class,remap=false)
public abstract class TaskRestoreMixin {
    // The native brain has bound this body already. Do not replay a saved Lua
    // command: the external action ledger owns reconciliation for managed bodies.
    @Inject(method="onCompanionSpawned",at=@At(value="INVOKE",target=
        "Lcom/dwinovo/numen/task/TaskPersistence;leftOver(Lcom/dwinovo/numen/entity/NumenPlayer;)Lcom/dwinovo/numen/task/TaskPersistence$LeftOver;"),cancellable=true)
    private static void maw$noReplay(NumenPlayer body,CallbackInfo ci) {
        if(HeadlessRuntime.managed(body.getUUID())) ci.cancel();
    }
}
