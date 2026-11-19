package local.hosting.mixin;

import com.mojang.logging.LogUtils;
import local.hosting.CompatibleCombatAnimation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(value = Player.class, remap = false)
public abstract class CompatibleCombatAnimationMixin {
    @Unique private CompatibleCombatAnimation.Combo qiandengji$visualCombo;
    @Redirect(method = "attack(Lnet/minecraft/world/entity/Entity;)V", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/world/entity/Entity;hurt(Lnet/minecraft/world/damagesource/DamageSource;F)Z"),
            require = 1, allow = 1)
    private boolean qiandengji$animateAcceptedHit(Entity target, DamageSource source, float amount) {
        if (!((Object) this instanceof ServerPlayer player)) {
            return target.hurt(source, amount);
        }

        // Capture the actual weapon before damage listeners can change equipment.
        var level = player.serverLevel();
        CompatibleCombatAnimation.Swing animation = null;
        try {
            animation = CompatibleCombatAnimation.capture(player, source, qiandengji$visualCombo);
        } catch (RuntimeException failure) {
            LogUtils.getLogger().debug("Could not resolve the Better Combat animation for an ordinary attack", failure);
        }
        boolean accepted = target.hurt(source, amount);
        if (accepted && animation != null) {
            try {
                qiandengji$visualCombo = animation.afterHit();
                CompatibleCombatAnimation.send(player, level, animation.packet());
            } catch (RuntimeException failure) {
                LogUtils.getLogger().debug("Could not relay the Better Combat animation for an ordinary attack", failure);
            }
        }
        return accepted;
    }
}
