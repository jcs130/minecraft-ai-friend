package dev.myagentworld.fabric263;

import com.erikedits.justquests.generator.v2.internal.catalog.Localization;
import com.erikedits.justquests.generator.v2.internal.gen.Candidate;
import com.erikedits.justquests.generator.v2.internal.gen.TextBuilder;
import java.util.Locale;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Same registry path can mean a live rabbit or raw rabbit meat: use its kind. */
@Mixin(value = TextBuilder.class, remap = false)
public abstract class ChineseQuestNamesMixin {
    @Shadow static String nameKey(Candidate candidate) { throw new AssertionError(); }

    @Inject(method = "name", at = @At("HEAD"), cancellable = true, require = 1)
    private static void maw$typedChineseName(Localization language, Candidate candidate, CallbackInfoReturnable<String> result) {
        if ("zh_cn".equals(language.code) && !candidate.isTag()) {
            String kind = candidate.type().kind().name().toLowerCase(Locale.ROOT);
            String name = language.names.get(kind + ":" + nameKey(candidate));
            if (name != null && !name.isBlank()) result.setReturnValue(name);
        }
    }
}
