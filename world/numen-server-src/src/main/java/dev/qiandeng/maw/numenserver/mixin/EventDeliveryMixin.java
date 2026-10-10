package dev.qiandeng.maw.numenserver.mixin;

import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.event.NumenEvents;
import com.dwinovo.numen.agent.inbox.EventQueue;
import dev.qiandeng.maw.numenserver.HeadlessRuntime;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value=NumenEvents.class, remap=false)
public abstract class EventDeliveryMixin {
    // After ServerPrograms has claimed its own task receipts. Server-managed
    // events go to a durable acknowledged stream, even when the owner is online.
    @Inject(method="deliver", at=@At("HEAD"), cancellable=true)
    private static void maw$deliver(NumenPlayer body, EventQueue.Entry event, CallbackInfo ci) {
        if (HeadlessRuntime.deliver(body, event)) ci.cancel();
    }
}
