package dev.god.settlementsfix.mixin;

import net.minecraft.core.component.DataComponents;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 治愈光环（2026-08-30 造物主钦点「装备附被动光环，如治愈光环」）：
 * 任一盔甲 custom_data.aura=healing → 每 3 秒回 1 点血（0.5 心），装备即生效。
 * （嗜血光环=bloodlust 由 WeaponSkillMixin 在攻击时结算，tick 不参与。）
 */
@Mixin(ServerPlayer.class)
public abstract class AuraTickMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-enchant");

    @Unique
    private long settlementsfix$auraTick = 0;

    @Inject(method = "tick", at = @At("TAIL"))
    private void settlementsfix$healingAura(CallbackInfo ci) {
        ServerPlayer sp = (ServerPlayer) (Object) this;
        if (sp.isSpectator()) return;
        if (++settlementsfix$auraTick % 60 != 0) return; // 3s 一跳
        for (EquipmentSlot slot : new EquipmentSlot[]{EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
            ItemStack armor = sp.getItemBySlot(slot);
            if (armor.isEmpty()) continue;
            CustomData d = armor.get(DataComponents.CUSTOM_DATA);
            if (d != null && "healing".equals(d.copyTag().getString("aura"))) {
                if (sp.getHealth() < sp.getMaxHealth() && !sp.isDeadOrDying()) {
                    sp.heal(1.0f);
                    sp.serverLevel().sendParticles(
                            net.minecraft.core.particles.ParticleTypes.HEART,
                            sp.getX(), sp.getY() + 2.0, sp.getZ(), 3, 0.3, 0.2, 0.3, 0.01);
                }
                return; // 一件生效即可，不叠
            }
        }
    }
}
