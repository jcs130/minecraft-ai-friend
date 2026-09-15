package dev.god.botgate.chest;

import net.minecraft.server.level.ServerPlayer;

/** Optional bridge dependency: loading the compass does not require Iron classes. */
final class SkillChestNative {
    static void refresh(SkillChestLayout.Config cfg, ServerPlayer player) {
        try {
            var bridge = Class.forName("dev.qiandeng.irons.QiandengIronsBridge");
            Object response = bridge.getMethod("describe", ServerPlayer.class, String.class).invoke(null, player, "list");
            SkillChestNativeSnapshot.apply(cfg, response, player.getStringUUID(), player.getGameProfile().getName());
        } catch (ReflectiveOperationException | LinkageError error) {
            cfg.nativeAvailable = false; cfg.nativeSpells.clear();
            cfg.nativeSummary = "铁魔法桥暂不可用，特色技能与原有记录仍保留";
        }
    }
    private SkillChestNative() {}
}
