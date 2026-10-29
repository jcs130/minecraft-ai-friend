package dev.qiandeng.maw.numenserver.mixin;

import com.dwinovo.numen.sdk.ApiFunction;
import com.dwinovo.numen.sdk.Codec;
import dev.qiandeng.maw.numenserver.NativeReturnContracts;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value=ApiFunction.class,remap=false)
public abstract class ItemUseReturnMixin {
    @Shadow @Final private String namespace;
    @Shadow @Final private String group;
    @Shadow @Final private String name;
    @Shadow @Final @Mutable private Codec<Object> returns;

    @Inject(method="<init>",at=@At("RETURN"))
    private void maw$correctItemUseContract(CallbackInfo ci) {
        returns=NativeReturnContracts.correct(namespace,group,name,returns);
    }
}
