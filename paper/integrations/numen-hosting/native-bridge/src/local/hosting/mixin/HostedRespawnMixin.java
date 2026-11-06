package local.hosting.mixin;
import com.mojang.authlib.GameProfile;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.PlayerList;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Youer constructs a replacement player on death; preserve only the hosted
 * edition's class, using the same constructor the upstream Numen mixin uses. */
@Mixin(value=PlayerList.class,remap=false)
public abstract class HostedRespawnMixin {
    @Redirect(method="respawn",at=@At(value="NEW",remap=false,
        target="(Lnet/minecraft/server/MinecraftServer;Lnet/minecraft/server/level/ServerLevel;Lcom/mojang/authlib/GameProfile;Lnet/minecraft/server/level/ClientInformation;)Lnet/minecraft/server/level/ServerPlayer;"),require=1)
    private ServerPlayer hosted$replacement(MinecraftServer server,ServerLevel level,GameProfile profile,
        ClientInformation information,ServerPlayer previous,boolean keepInventory,Entity.RemovalReason reason) {
        if(previous.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer")) {
            try{return(ServerPlayer)previous.getClass().getConstructor(MinecraftServer.class,ServerLevel.class,GameProfile.class,ClientInformation.class).newInstance(server,level,profile,information);}
            catch(ReflectiveOperationException failure){throw new IllegalStateException("hosted replacement player could not be constructed",failure);}
        }
        return new ServerPlayer(server,level,profile,information);
    }
}
