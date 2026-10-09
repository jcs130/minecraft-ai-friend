package dev.qiandeng.maw.numencompat.mixin;

import com.dwinovo.numen.agent.script.ApiReply;
import com.dwinovo.numen.agent.script.ErrorKind;
import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.network.payload.ClientCallPayload;
import com.dwinovo.numen.program.ClientTransport;
import com.dwinovo.numen.program.NetworkTransport;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.function.Consumer;

@Mixin(value = NetworkTransport.class, remap = false)
public abstract class NumenClientTransportMixin {
    @Inject(method = "request", at = @At("HEAD"), cancellable = true, require = 1)
    private void maw$missingClientIsUnavailable(NumenPlayer body, ClientCallPayload request,
                                               Consumer<ClientTransport.Answer> done, CallbackInfo ci) {
        ServerPlayer owner = body == null ? null : body.resolveOwnerPlayer();
        // Offline owners already have an explicit upstream error. An online player
        // without the optional client also needs an error, rather than a timeout.
        if (owner != null && (owner.connection == null || !owner.connection.hasChannel(ClientCallPayload.TYPE))) {
            done.accept(new ClientTransport.Answer(ApiReply.error(ErrorKind.FAILED,
                    "client_capability_unavailable: " + request.function()
                            + " requires the optional Numen Java client; server-side actions remain available",
                    null, null).toString(), null));
            ci.cancel();
        }
    }
}
