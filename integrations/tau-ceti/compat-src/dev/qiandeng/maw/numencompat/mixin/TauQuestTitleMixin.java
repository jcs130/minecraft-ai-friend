package dev.qiandeng.maw.numencompat.mixin;

import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Coerce;
import org.spongepowered.asm.mixin.injection.Redirect;

/** FTB now strips GUI title methods on dedicated servers. Keep Numen's
 * original watcher and quest actions, reading actual stored data on the server.
 * No events, permission checks, rewards or official JAR bytes are suppressed. */
@Mixin(targets = {"com.dwinovo.numen.plugins.ftbquests.QuestBook",
        "com.dwinovo.numen.plugins.ftbquests.QuestWatch",
        "com.dwinovo.numen.plugins.ftbquests.QuestSubmit"}, remap = false)
public abstract class TauQuestTitleMixin {
    @Redirect(method = "*", at = @At(value = "INVOKE",
            target = "Ldev/ftb/mods/ftbquests/quest/QuestObject;getTitle()Lnet/minecraft/network/chat/Component;"), require = 0)
    private static Component qiandeng$tauQuestObjectTitle(@Coerce Object quest) { return qiandeng$tauStoredTitle(quest); }
    @Redirect(method = "*", at = @At(value = "INVOKE",
            target = "Ldev/ftb/mods/ftbquests/quest/Quest;getTitle()Lnet/minecraft/network/chat/Component;"), require = 0)
    private static Component qiandeng$tauQuestTitle(@Coerce Object quest) { return qiandeng$tauStoredTitle(quest); }
    @Redirect(method = "*", at = @At(value = "INVOKE",
            target = "Ldev/ftb/mods/ftbquests/quest/Chapter;getTitle()Lnet/minecraft/network/chat/Component;"), require = 0)
    private static Component qiandeng$tauChapterTitle(@Coerce Object quest) { return qiandeng$tauStoredTitle(quest); }
    @Redirect(method = "*", at = @At(value = "INVOKE",
            target = "Ldev/ftb/mods/ftbquests/quest/task/Task;getTitle()Lnet/minecraft/network/chat/Component;"), require = 0)
    private static Component qiandeng$tauTaskTitle(@Coerce Object quest) { return qiandeng$tauStoredTitle(quest); }
    @Redirect(method = "*", at = @At(value = "INVOKE",
            target = "Ldev/ftb/mods/ftbquests/quest/reward/Reward;getTitle()Lnet/minecraft/network/chat/Component;"), require = 0)
    private static Component qiandeng$tauRewardTitle(@Coerce Object quest) { return qiandeng$tauStoredTitle(quest); }
    @Unique
    private static Component qiandeng$tauStoredTitle(Object quest) {
        try {
            String raw = (String)quest.getClass().getMethod("getRawTitle").invoke(quest);
            if (raw != null && !raw.isBlank()) {
                var server = net.neoforged.neoforge.server.ServerLifecycleHooks.getCurrentServer();
                if (server != null && (raw.stripLeading().startsWith("{") || raw.stripLeading().startsWith("["))) {
                    try { Component parsed = Component.Serializer.fromJson(raw, server.registryAccess()); if (parsed != null) return parsed; }
                    catch (RuntimeException invalid) { /* Preserve raw text rather than inventing a translated title. */ }
                }
                return Component.literal(raw);
            }
            long id = quest.getClass().getField("id").getLong(quest);
            return Component.literal(quest.getClass().getSimpleName() + " #" + Long.toUnsignedString(id,16));
        } catch (ReflectiveOperationException failure) {
            // A missing display label must not break an otherwise valid login
            // or mutate quest progress; expose unknown identity explicitly.
            return Component.literal("[任务标题不可读: " + quest.getClass().getSimpleName() + "]");
        }
    }
}
