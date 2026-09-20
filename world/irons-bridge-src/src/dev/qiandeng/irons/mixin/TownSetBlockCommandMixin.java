package dev.qiandeng.irons.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.qiandeng.irons.TownCommandScope;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.arguments.blocks.BlockInput;
import net.minecraft.core.BlockPos;
import net.minecraft.server.commands.SetBlockCommand;
import net.minecraft.world.level.block.state.pattern.BlockInWorld;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.Coerce;
import java.util.function.Predicate;

@Mixin(value=SetBlockCommand.class, remap=false)
public abstract class TownSetBlockCommandMixin {
    @WrapMethod(method="setBlock", require=1)
    private static int qiandeng$consoleReplace(CommandSourceStack source, BlockPos pos, BlockInput input,
                                               @Coerce Object mode, Predicate<BlockInWorld> filter, Operation<Integer> original) {
        return TownCommandScope.call(source.getEntity()!=null, source.hasPermission(4),
            () -> original.call(source,pos,input,mode,filter));
    }
}
