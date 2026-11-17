package local.hosting.mixin;
import net.minecraft.server.players.PlayerList;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;
@Mixin(value=PlayerList.class,remap=false)
public interface PlayerSaveAccess {
    @Invoker("save") void hosted$save(ServerPlayer player);
}
