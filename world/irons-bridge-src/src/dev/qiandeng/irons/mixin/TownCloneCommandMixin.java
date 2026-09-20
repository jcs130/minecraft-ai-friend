package dev.qiandeng.irons.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import dev.qiandeng.irons.TownCommandScope;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.commands.CloneCommands;
import net.minecraft.world.level.block.state.pattern.BlockInWorld;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.Coerce;
import java.util.function.Predicate;

@Mixin(value=CloneCommands.class, remap=false)
public abstract class TownCloneCommandMixin {
    @WrapMethod(method="clone", require=1)
    private static int qiandeng$consoleClone(CommandSourceStack source, @Coerce Object begin, @Coerce Object end,
                                             @Coerce Object target, Predicate<BlockInWorld> filter,
                                             @Coerce Object mode, Operation<Integer> original) {
        return TownCommandScope.call(source.getEntity()!=null, source.hasPermission(4),
            () -> original.call(source,begin,end,target,filter,mode));
    }
}
