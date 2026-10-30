package dev.qiandeng.maw.numenserver.mixin;

import dev.qiandeng.maw.saoforge.OptionalStatusPolicy;
import net.minecraft.resources.ResourceLocation;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.loading.FMLEnvironment;
import net.minecraftforge.network.NetworkConstants;
import net.minecraftforge.network.ServerStatusPing;
import java.util.HashMap;
import java.util.Map;
import org.spongepowered.asm.mixin.*;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Align list-ping metadata with the existing optional-client login policy.
 * Does not alter channel predicates, versions, mod loading or game authorization.
 */
@Mixin(value=ServerStatusPing.class,remap=false)
public abstract class OptionalServerStatusMixin {
    @Shadow @Final private Map<String,String> mods;
    @Shadow @Final private Map<ResourceLocation,ServerStatusPing.ChannelData> channels;

    @Inject(method="<init>()V",at=@At("TAIL"),remap=false)
    private void optionalClientStatus(CallbackInfo ci){
        Map<String,String> versions=new HashMap<>();channels.forEach((id,data)->versions.put(id.toString(),data.version()));
        if(!OptionalStatusPolicy.supported(FMLEnvironment.dist==Dist.DEDICATED_SERVER,mods,versions))return;
        for(String id:OptionalStatusPolicy.MODS)mods.put(id,NetworkConstants.IGNORESERVERONLY);
        channels.replaceAll((id,data)->OptionalStatusPolicy.CHANNELS.containsKey(id.toString())?new ServerStatusPing.ChannelData(data.res(),data.version(),false):data);
    }
}
