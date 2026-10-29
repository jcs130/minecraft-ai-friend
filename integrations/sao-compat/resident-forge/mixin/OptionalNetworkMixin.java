package dev.qiandeng.maw.numenserver.mixin;

import com.dwinovo.numen.entity.NumenPlayer;
import com.dwinovo.numen.network.NumenPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.simple.SimpleChannel;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import java.util.function.*;

/** The server owns the bodies; only clients using Numen's UI need its channel. */
@Mixin(targets="com.dwinovo.numen.platform.ForgeNetworkChannel",remap=false)
public abstract class OptionalNetworkMixin {
    @Shadow @Final private static SimpleChannel CHANNEL;
    @Redirect(method="<clinit>",at=@At(value="INVOKE",target="Lnet/minecraftforge/network/NetworkRegistry;newSimpleChannel(Lnet/minecraft/resources/ResourceLocation;Ljava/util/function/Supplier;Ljava/util/function/Predicate;Ljava/util/function/Predicate;)Lnet/minecraftforge/network/simple/SimpleChannel;"))
    private static SimpleChannel maw$optional(ResourceLocation name,Supplier<String> version,Predicate<String> client,Predicate<String> server){
        if(!name.toString().equals("numen_api:main"))throw new IllegalStateException("review_changed_numen_network_channel");
        return NetworkRegistry.newSimpleChannel(name,version,NetworkRegistry.acceptMissingOr(client),NetworkRegistry.acceptMissingOr(server));
    }
    @Inject(method="sendToPlayer",at=@At("HEAD"),cancellable=true)
    private void maw$skipAbsentUI(ServerPlayer player,NumenPayload payload,CallbackInfo ci){
        if(!(player instanceof NumenPlayer)&&!CHANNEL.isRemotePresent(player.connection.connection))ci.cancel();
    }
}
