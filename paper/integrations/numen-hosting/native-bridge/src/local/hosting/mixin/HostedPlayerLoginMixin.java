package local.hosting.mixin;

import com.mojang.authlib.GameProfile;
import java.net.SocketAddress;
import local.hosting.HostedPlayerLoginFence;
import local.hosting.NativePlayerCustody;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.players.PlayerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value=PlayerList.class,remap=false)
public abstract class HostedPlayerLoginMixin implements HostedPlayerLoginFence {
    @Override public boolean qdj$admitsNumen(GameProfile profile,java.util.UUID nativeOwner) {
        return NativePlayerCustody.admitsNumen(profile,nativeOwner);
    }
    @Override public boolean qdj$acceptsNumenGameplay(ServerPlayer original) {
        PlayerList list=(PlayerList)(Object)this;
        return list.getPlayer(original.getUUID())==original && NativePlayerCustody.acceptsPlayerInput(original);
    }
    @Unique private boolean qdj$protected(ServerPlayer occupant) {
        if (occupant == null || !occupant.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer")) return false;
        // The optional Paper hosted plugin has its own classloader. Its trusted
        // registry, including the explicit owner binding, is the sole authority.
        try {
            var type=Class.forName("com.dwinovo.numen.hosted.api.brain.HostedBootstrap",false,occupant.getClass().getClassLoader());
            return Boolean.TRUE.equals(type.getMethod("protectsPlayerLogin",ServerPlayer.class).invoke(null,occupant));
        } catch (ClassNotFoundException | NoSuchMethodException olderEdition) {
            return false;
        } catch (ReflectiveOperationException unavailable) {
            return true;
        }
    }
    @Unique private boolean qdj$occupied(GameProfile profile) {
        PlayerList list=(PlayerList)(Object)this;
        if (NativePlayerCustody.enrolled(profile)) {
            return !NativePlayerCustody.admitsMineflayer(profile) || list.getPlayer(profile.getId())!=null
                    || list.getPlayerByName(profile.getName())!=null;
        }
        if (qdj$protected(list.getPlayer(profile.getId()))) return true;
        ServerPlayer named=list.getPlayerByName(profile.getName());
        if (!qdj$protected(named)) return false;
        try {
            var config=Class.forName("io.papermc.paper.configuration.GlobalConfiguration");
            var proxies=config.getField("proxies").get(config.getMethod("get").invoke(null));
            return Boolean.TRUE.equals(proxies.getClass().getMethod("isProxyOnlineMode").invoke(proxies));
        } catch (ClassNotFoundException absent) { return false; }
        catch (ReflectiveOperationException unavailable) { return true; }
    }
    // Youer's canPlayerLogin disconnects duplicates before firing Bukkit PlayerLoginEvent.
    @Inject(method="canPlayerLogin(Ljava/net/SocketAddress;Lcom/mojang/authlib/GameProfile;)Lnet/minecraft/network/chat/Component;",at=@At("HEAD"),cancellable=true)
    private void qdj$beforeDuplicate(SocketAddress address, GameProfile entering, CallbackInfoReturnable<Component> result) {
        if (qdj$occupied(entering)) result.setReturnValue(Component.literal("这个角色当前不可接管。请在官网核对原换身请求和当前控制端，再重新连接。"));
    }
    // A delayed configuration/cookie response can revisit duplicate handling after the first check.
    @Inject(method="disconnectAllPlayersWithProfile(Lcom/mojang/authlib/GameProfile;Lnet/minecraft/server/level/ServerPlayer;)Z",at=@At("HEAD"),cancellable=true,require=0)
    private void qdj$keepOriginal(GameProfile entering, ServerPlayer candidate, CallbackInfoReturnable<Boolean> result) {
        if (qdj$occupied(entering)) result.setReturnValue(true);
    }
}
