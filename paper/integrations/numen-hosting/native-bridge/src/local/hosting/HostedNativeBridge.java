package local.hosting;
import net.neoforged.fml.common.Mod;
@Mod("qiandengji_hosted_bridge")
public final class HostedNativeBridge {
    public HostedNativeBridge(){
        var events=net.neoforged.neoforge.common.NeoForge.EVENT_BUS;
        events.addListener(NativeCustodyFence::beforeWorlds);
        events.addListener(NativeCustodyFence::stopped);
        events.addListener(NativeResidentHandoffPort::start);
        events.addListener(NativeResidentHandoffPort::stop);
        events.addListener(net.neoforged.bus.api.EventPriority.HIGHEST, NativeCustodyFence::onJoin);
        events.addListener(net.neoforged.bus.api.EventPriority.HIGHEST,NativePlayerCustody::protectPendingPlayer);
        events.addListener(net.neoforged.bus.api.EventPriority.HIGHEST,NativePlayerCustody::preventPendingPickup);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::tick);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(HostedMigration::damage);
    }
    private void tick(net.neoforged.neoforge.event.tick.ServerTickEvent.Post event){
        HostedMigration.tick(event.getServer());
        HostedNativeSpeech.tick(event.getServer());
        if(net.neoforged.fml.ModList.get().isLoaded("bettercombat"))HostedBetterCombat.tick(event.getServer());
    }
}
