package local.hosting.mixin;

import net.minecraft.network.Connection;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.players.PlayerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import net.minecraft.nbt.CompoundTag;
import java.util.Optional;

/** Initialize the same in-memory protocol handlers used by an integrated client.
 * Real client connections and their codecs are never changed. */
@Mixin(value=PlayerList.class,remap=false)
public abstract class HostedAdmissionMixin {
    @Inject(method="load",at=@At("RETURN"),require=1)
    private void hosted$savedHealth(ServerPlayer player,CallbackInfoReturnable<Optional<CompoundTag>> ci){
        ci.getReturnValue().ifPresent(tag->local.hosting.HostedMigration.loaded(player,tag));
    }
    @Inject(method="placeNewPlayer",at=@At("HEAD"),require=1)
    private void hosted$pipeline(Connection connection,ServerPlayer player,CommonListenerCookie cookie,CallbackInfo ci){
        if(player.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer")
                &&connection.channel.pipeline().get("encoder")==null){
            Connection.configureInMemoryPipeline(connection.channel.pipeline(),PacketFlow.SERVERBOUND);
        }
    }
}
