package dev.qiandeng.maw.numencompat.mixin;

import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Redirect;

/** FTB moved titles below QuestObject in its inheritance tree. Keep Numen's
 * original watcher and quest actions, resolving the actual object's public API.
 * No events, permission checks, rewards or official JAR bytes are suppressed. */
@Mixin(targets = {"com.dwinovo.numen.plugins.ftbquests.QuestBook",
        "com.dwinovo.numen.plugins.ftbquests.QuestWatch"}, remap = false)
public abstract class TauQuestTitleMixin {
    @Redirect(method = "*", at = @At(value = "INVOKE",
            target = "Ldev/ftb/mods/ftbquests/quest/QuestObject;getTitle()Lnet/minecraft/network/chat/Component;"), require = 1)
    private static Component qiandeng$tauQuestTitle(@Coerce Object quest) {
        try {
            Object value = quest.getClass().getMethod("getTitle").invoke(quest);
            if (value instanceof Component title) return title;
            throw new IllegalStateException("FTB quest title was not a Component");
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("FTB quest title API unavailable for " + quest.getClass().getName(), failure);
        }
    }
}
