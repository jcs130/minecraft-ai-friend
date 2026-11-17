package local.hosting.mixin;
import local.hosting.HostedBetterCombat;
import net.bettercombat.network.Packets;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;
@Mixin(targets="net.bettercombat.network.ServerNetwork",remap=false)
public abstract class HostedCombatExecutionMixin {
    @Redirect(method="handleAttackRequest",at=@At(value="INVOKE",target="Lnet/minecraft/server/MinecraftServer;executeIfPossible(Ljava/lang/Runnable;)V"),require=1)
    private static void hosted$execute(MinecraftServer executor,Runnable action,Packets.C2S_AttackRequest request,MinecraftServer server,ServerPlayer player,ServerGamePacketListenerImpl handler){
        Runnable guarded=()->{
            boolean before=HostedBetterCombat.EXECUTING.get();
            if(HostedBetterCombat.hosted(player))HostedBetterCombat.EXECUTING.set(true);
            try{action.run();}finally{HostedBetterCombat.EXECUTING.set(before);}
        };
        // The hosted upswing already runs on the server thread. Enqueuing it
        // again lets Numen's next swing reset the charge before damage lands.
        if(HostedBetterCombat.hosted(player)&&executor.isSameThread())guarded.run();
        else executor.executeIfPossible(guarded);
    }
}
