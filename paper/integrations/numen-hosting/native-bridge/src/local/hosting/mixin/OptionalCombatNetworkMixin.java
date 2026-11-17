package local.hosting.mixin;
import net.bettercombat.network.Packets;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.Redirect;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
/** Only clients advertising BC channels receive its handshake. No vanilla packet rewriting. */
@Mixin(targets="net.bettercombat.neoforge.network.NetworkEvents",remap=false)
public abstract class OptionalCombatNetworkMixin {
    @Inject(method="register(Lnet/neoforged/neoforge/network/event/RegisterConfigurationTasksEvent;)V",at=@At("HEAD"),cancellable=true,require=1)
    private static void hosted$config(RegisterConfigurationTasksEvent event,CallbackInfo ci){
        if(!event.getListener().hasChannel(Packets.ConfigSync.ID)||!event.getListener().hasChannel(Packets.WeaponRegistrySync.ID)||!event.getListener().hasChannel(Packets.Ack.ID))ci.cancel();
    }
    @Redirect(method="register(Lnet/neoforged/neoforge/network/event/RegisterPayloadHandlersEvent;)V",at=@At(value="INVOKE",target="Lnet/neoforged/neoforge/network/event/RegisterPayloadHandlersEvent;registrar(Ljava/lang/String;)Lnet/neoforged/neoforge/network/registration/PayloadRegistrar;"),require=1)
    private static PayloadRegistrar hosted$optional(RegisterPayloadHandlersEvent event,String version){return event.registrar(version).optional();}
}
