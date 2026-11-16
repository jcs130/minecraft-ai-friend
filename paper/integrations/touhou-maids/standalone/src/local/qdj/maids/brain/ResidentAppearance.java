package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.util.Map;
import net.minecraft.network.chat.Component;
import net.neoforged.fml.ModList;
import net.neoforged.fml.loading.FMLPaths;

/** Explicit appearance selection from a reviewed source. No model download or entity replacement. */
final class ResidentAppearance {
    static Map<String,Object> apply(EntityMaid maid,ResidentConfig.Resident role)throws Exception{
        return apply(maid,role.appearance(),role.name());
    }
    static void check(ResidentConfig.Appearance model)throws Exception{
        if(model==null)throw new IllegalArgumentException("appearance_not_configured");
        if(!ModList.get().isLoaded("yes_steve_model"))throw new IllegalArgumentException("ysm_not_installed");
        var root=FMLPaths.CONFIGDIR.get().resolve("yes_steve_model/custom").toAbsolutePath().normalize();
        var file=root.resolve(model.modelId()).normalize();
        if(!file.startsWith(root)||!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)||Files.size(file)>32*1024*1024)
            throw new IllegalArgumentException("reviewed_model_file_missing");
        String hash=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
        if(!hash.equals(model.sha256()))throw new IllegalArgumentException("reviewed_model_hash_mismatch");
    }
    static Map<String,Object> apply(EntityMaid maid,ResidentConfig.Appearance model,String name)throws Exception{
        check(model);
        maid.setIsYsmModel(true);maid.setYsmModel(model.modelId(),model.texture(),Component.literal(name));
        boolean selected=maid.isYsmModel()&&maid.getYsmModelId().equals(model.modelId())&&maid.getYsmModelTexture().equals(model.texture());
        return Map.of("status",selected?"completed":"unknown","completed",selected,"reason","native_model_selection_read_back",
            "modelId",maid.getYsmModelId(),"texture",maid.getYsmModelTexture(),"sha256",model.sha256(),"clientRenderVerified",false);
    }
}
