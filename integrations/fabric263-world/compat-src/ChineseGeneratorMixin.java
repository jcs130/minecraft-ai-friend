package dev.myagentworld.fabric263;

import java.util.ArrayList;
import java.util.List;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Mutable;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Add the supplied Chinese catalogue to the vendor's locale discovery only. */
@Mixin(targets = "com.erikedits.justquests.generator.v2.internal.catalog.Localization", remap = false)
public abstract class ChineseGeneratorMixin {
    @Shadow @Final @Mutable public static List<String> CODES;

    @Inject(method = "<clinit>", at = @At("TAIL"), require = 1)
    private static void maw$registerChinese(CallbackInfo ci) {
        if (!CODES.contains("zh_cn")) {
            List<String> codes = new ArrayList<>(CODES);
            codes.add("zh_cn");
            CODES = List.copyOf(codes);
        }
    }
}
