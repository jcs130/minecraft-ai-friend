package local.hosting.mixin;
import java.util.List;
import java.util.Set;
import org.objectweb.asm.tree.ClassNode;
import org.spongepowered.asm.mixin.extensibility.IMixinConfigPlugin;
import org.spongepowered.asm.mixin.extensibility.IMixinInfo;
public final class HostedMixinSelector implements IMixinConfigPlugin {
    public void onLoad(String pkg){}
    public String getRefMapperConfig(){return null;}
    public boolean shouldApplyMixin(String target,String mixin){
        if(mixin.endsWith("HostedRespawnMixin")||mixin.endsWith("HostedAdmissionMixin")||mixin.endsWith("PlayerSaveAccess")
                ||mixin.endsWith("HostedPlayerLoginMixin")||mixin.endsWith("HostedPlayerPacketFenceMixin")
                ||mixin.endsWith("HostedPrivateMessageMixin"))return true;
        var mods=net.neoforged.fml.loading.FMLLoader.getLoadingModList();
        return mods!=null&&mods.getMods().stream().anyMatch(m->m.getModId().equals("bettercombat"));
    }
    public void acceptTargets(Set<String> own,Set<String> other){}
    public List<String> getMixins(){return null;}
    public void preApply(String target,ClassNode node,String mixin,IMixinInfo info){}
    public void postApply(String target,ClassNode node,String mixin,IMixinInfo info){}
}
