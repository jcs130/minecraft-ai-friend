package dev.god.settlementsfix.mixin;

import net.minecraft.core.component.DataComponents;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * 羽落之靴（2026-08-30 造物主钦点「缓降做成装备技能放鞋子上」）：
 * 脚上靴子带 custom_data:featherfall 标记 → 摔落伤害清零 + 云雾踏落特效。
 *
 * 装备即生效——与被动装备化同哲学：穿上就护住，脱下即失效，无需任何操作。
 * 御空术到期若人在半空也兜底（靴子+御空缓降双保险）。
 */
@Mixin(LivingEntity.class)
public abstract class FeatherBootsMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-feather");

    @Inject(method = "causeFallDamage", at = @At("HEAD"), cancellable = true)
    private void settlementsfix$featherFall(float fallDistance, float multiplier, DamageSource source, CallbackInfoReturnable<Boolean> cir) {
        LivingEntity self = (LivingEntity) (Object) this;
        if (!(self instanceof ServerPlayer sp)) return;
        if (fallDistance < 2.5f) return; // 低空落地不惊动特效
        ItemStack boots = sp.getItemBySlot(EquipmentSlot.FEET);
        if (boots.isEmpty()) return;
        CustomData data = boots.get(DataComponents.CUSTOM_DATA);
        if (data == null || !data.copyTag().getBoolean("featherfall")) return;
        // 摔伤清零：落地如踏云
        cir.setReturnValue(false);
        try {
            ServerLevel lvl = sp.serverLevel();
            Vec3 p = sp.position();
            lvl.sendParticles(net.minecraft.core.particles.ParticleTypes.CLOUD,
                    p.x, p.y + 0.2, p.z, 14, 0.35, 0.15, 0.35, 0.02);
            lvl.playSound(null, p.x, p.y, p.z, SoundEvents.ARMOR_EQUIP_LEATHER, SoundSource.PLAYERS, 0.8f, 1.4f);
        } catch (Exception e) {
            GODFIX.debug("[feather] fx failed: {}", e.toString());
        }
    }
}
