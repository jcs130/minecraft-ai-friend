package dev.qiandeng.maw.numenmods;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.fml.ModList;
/** Dedicated operations do not gain permission to modify another owner's native territory. */
final class WorldPermissions {
    static void check(ServerPlayer p,BlockPos pos){
        if(ModList.get().isLoaded("openpartiesandclaims")&&!xaero.pac.common.server.api.OpenPACServerAPI.get(p.getServer()).getChunkProtection()
            .hasChunkAccess(p,p.level().dimension().location(),pos.getX()>>4,pos.getZ()>>4))throw new IllegalArgumentException("claimed_chunk_access_denied");
        if(ModList.get().isLoaded("minecolonies"))ColonyNative.checkAccess(p,pos);
    }
}
