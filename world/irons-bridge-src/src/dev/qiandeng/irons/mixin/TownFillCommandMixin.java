package dev.qiandeng.irons.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.qiandeng.irons.TownCommandScope;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.blocks.BlockInput;
import net.minecraft.server.commands.FillCommand;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.minecraft.world.level.block.state.pattern.BlockInWorld;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.Coerce;
import java.util.function.Predicate;

@Mixin(value=FillCommand.class, remap=false)
public abstract class TownFillCommandMixin {
    @WrapMethod(method="fillBlocks", require=1)
    private static int qiandeng$consoleFill(CommandSourceStack source, BoundingBox box, BlockInput input,
                                            @Coerce Object mode, Predicate<BlockInWorld> filter, Operation<Integer> original) {
        return TownCommandScope.call(source.getEntity()!=null, source.hasPermission(4),
            () -> original.call(source,box,input,mode,filter));
    }
}
