package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.CropBlock;
import net.minecraft.world.level.block.state.BlockState;

/** Observe completed native farming. Selecting a work mode is never task completion. */
public final class ResidentActivity {
    private static long lastWarning;
    public static void harvested(EntityMaid maid,BlockPos at,BlockState before) {
        if(!(before.getBlock() instanceof CropBlock crop)||!crop.isMaxAge(before))return;
        BlockState after=maid.level().getBlockState(at);
        if(after.isAir()||after.is(before.getBlock())&&!crop.isMaxAge(after)){
            emit(maid,at,before,"harvest");
            // Original TLM's no-hoe harvest can reset the same crop to age zero.
            if(after.is(before.getBlock())&&crop.getAge(after)==0)emit(maid,at,after,"replant");
        }
    }
    public static void planted(EntityMaid maid,BlockPos at,BlockState before,int consumed) {
        BlockState after=maid.level().getBlockState(at);
        if(before.isAir()&&consumed==1&&after.getBlock() instanceof CropBlock crop&&crop.getAge(after)==0)emit(maid,at,after,"replant");
    }
    private static void emit(EntityMaid maid,BlockPos at,BlockState crop,String action) {
        var residents=MaidAgentsMod.residents();
        if(maid.level().isClientSide||residents==null||residents.role(maid.getUUID())==null||!MaidAgentsMod.managed(maid))return;
        if(action.equals("harvest"))ResidentRpg.xp(maid,1);
        try {
            Class<?> bukkit;try{bukkit=Class.forName("org.bukkit.Bukkit");}catch(ClassNotFoundException stock){return;}
            var manager=bukkit.getMethod("getPluginManager").invoke(null);
            var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(manager,"AgentFriend");
            if(plugin==null)throw new IllegalStateException("native_activity_adapter_missing");
            var service=plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.ResidentWorldActions");
            service.getMethod("crop",java.util.UUID.class,String.class,int.class,int.class,int.class,String.class)
                .invoke(null,maid.getUUID(),action,at.getX(),at.getY(),at.getZ(),BuiltInRegistries.BLOCK.getKey(crop.getBlock()).toString());
        }catch(ReflectiveOperationException|RuntimeException error){
            long now=System.currentTimeMillis();if(now-lastWarning>60_000){lastWarning=now;com.mojang.logging.LogUtils.getLogger().warn("Resident native farming proof unavailable: {}",error.getClass().getSimpleName());}
        }
    }
}
