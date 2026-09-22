package dev.qiandeng.irons.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.qiandeng.irons.TownCommandScope;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.commands.PlaceCommand;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import org.spongepowered.asm.mixin.Mixin;

@Mixin(value=PlaceCommand.class, remap=false)
public abstract class TownPlaceCommandMixin {
    @WrapMethod(method="placeTemplate", require=1)
    private static int qiandeng$consoleTemplate(CommandSourceStack source, ResourceLocation template, BlockPos pos,
                                                Rotation rotation, Mirror mirror, float integrity, int seed,
                                                Operation<Integer> original) {
        return TownCommandScope.call(source.getEntity()!=null, source.hasPermission(4),
            () -> original.call(source,template,pos,rotation,mirror,integrity,seed));
    }
}
