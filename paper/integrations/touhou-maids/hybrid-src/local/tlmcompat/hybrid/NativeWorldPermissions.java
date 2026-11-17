package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.function.BiPredicate;
import net.minecraft.core.BlockPos;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.plugin.Plugin;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;

/** Native TLM's existing world gate. Independent residents use their own principal. */
public final class NativeWorldPermissions implements AutoCloseable {
    private final Class<?> gate;
    public NativeWorldPermissions(Plugin plugin)throws Exception {
        gate=Class.forName("local.tlmcompat.nativebridge.NativePlatform",true,EntityMaid.class.getClassLoader());
        BiPredicate<EntityMaid,BlockPos> breaking=(maid,pos)->allow(maid,pos,false);
        BiPredicate<EntityMaid,BlockPos> placing=(maid,pos)->allow(maid,pos,true);
        gate.getMethod("install",BiPredicate.class,BiPredicate.class).invoke(null,breaking,placing);
        plugin.getLogger().info("Native maid permissions: registered resident UUID, ordinary companion owner; native block events retained");
    }
    private boolean allow(EntityMaid maid,BlockPos pos,boolean place) {
        if(!Bukkit.isPrimaryThread()||!maid.isAlive())return false;
        try {
            Class<?> resident=null;
            try{resident=Class.forName("local.qdj.maids.brain.ResidentProtection",false,EntityMaid.class.getClassLoader());}
            catch(ClassNotFoundException absent){/* Original companion-only installation. */}
            if(resident!=null&&Boolean.TRUE.equals(resident.getMethod("registered",EntityMaid.class).invoke(null,maid)))
                return Boolean.TRUE.equals(resident.getMethod("nativeAllowed",EntityMaid.class,String.class,BlockPos.class).invoke(null,maid,place?"place":"break",pos));
            // Do not give a persisted resident its creator's rights while its registry is unavailable.
            if(maid.getPersistentData().getBoolean("tlm_resident_home_installed"))return false;
            var owner=maid.getOwnerUUID();if(owner==null)return false;
            if(!Bukkit.getPluginManager().isPluginEnabled("WorldGuard"))return true;
            var principal=WorldGuardPlugin.inst().wrapOfflinePlayer(Bukkit.getOfflinePlayer(owner));
            var at=BukkitAdapter.adapt(new Location(maid.getBukkitEntity().getWorld(),pos.getX(),pos.getY(),pos.getZ()));
            return WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery()
                .testBuild(at,principal,place?Flags.BLOCK_PLACE:Flags.BLOCK_BREAK);
        }catch(ReflectiveOperationException|RuntimeException|LinkageError unavailable){return false;}
    }
    @Override public void close(){
        try{gate.getMethod("disable").invoke(null);}catch(ReflectiveOperationException error){throw new IllegalStateException(error);}
    }
}
