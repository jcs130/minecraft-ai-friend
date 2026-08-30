package dev.god.settlementsfix.mixin;

import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.LightningBolt;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.List;
import java.util.Random;

/**
 * 武器技能附魔 v2（2026-08-30）：钩 LivingEntity.hurt 而非 Player.attack——
 * numen 假玩家/bot 的攻击不走 vanilla attack 交互，hurt 是一切伤害的必经之路，
 * 覆盖真人、假玩家、bot 全部攻击路径。
 *
 * 条件：伤害直接来源是 ServerPlayer（近战型）→ 查其主手 skill_enchant：
 *   chain_lightning 闪电链（20%）：目标落雷+3 格内至多 2 只怪连锁；
 *   fireburst 炎爆（20%）：目标着火 8s；rasengan 螺旋丸（20%）：+4 伤+击退。
 * 嗜血光环（armor aura=bloodlust）：命中伤害 40% 回作攻击者之血。
 * 递归保护：rasengan 追加伤害经 reentrancy flag，不再触发自身。
 */
@Mixin(LivingEntity.class)
public abstract class WeaponSkillMixin {

    private static final Logger GODFIX = LoggerFactory.getLogger("godfix-enchant");
    private static final Random RNG = new Random();
    private static final float TRIGGER_CHANCE = 0.20f;

    @Unique
    private static final ThreadLocal<Boolean> settlementsfix$inProc = ThreadLocal.withInitial(() -> Boolean.FALSE);

    @Inject(method = "hurt", at = @At("HEAD"))
    private void settlementsfix$weaponSkill(DamageSource source, float amount, CallbackInfoReturnable<Boolean> cir) {
        if (settlementsfix$inProc.get()) return;
        LivingEntity target = (LivingEntity) (Object) this;
        if (!(source.getEntity() instanceof ServerPlayer sp)) return;
        if (amount <= 0 || target.isDeadOrDying()) return;
        ServerLevel lvl = sp.serverLevel();

        // 嗜血光环：命中伤害 40% 回血（每次有效近战都结算，与武器技能无关）
        if (hasAura(sp, "bloodlust") && sp.getHealth() < sp.getMaxHealth()) {
            sp.heal(Math.max(0.5f, amount * 0.4f));
            lvl.sendParticles(ParticleTypes.DAMAGE_INDICATOR, sp.getX(), sp.getY() + 1, sp.getZ(), 6, 0.3, 0.3, 0.3, 0.05);
        }

        ItemStack weapon = sp.getMainHandItem();
        CustomData data = weapon.get(DataComponents.CUSTOM_DATA);
        if (data == null) return;
        String skill = data.copyTag().getString("skill_enchant");
        if (skill.isEmpty()) return;
        if (RNG.nextFloat() > TRIGGER_CHANCE) return;

        settlementsfix$inProc.set(Boolean.TRUE);
        try {
            switch (skill) {
                case "chain_lightning" -> {
                    strike(lvl, target);
                    List<Monster> near = lvl.getEntitiesOfClass(Monster.class, target.getBoundingBox().inflate(3.0),
                            m -> m != target && m.isAlive());
                    int chained = 0;
                    for (Monster m : near) {
                        if (chained++ >= 2) break;
                        strike(lvl, m);
                    }
                    GODFIX.info("[enchant] chain_lightning proc by {}", sp.getName().getString());
                }
                case "fireburst" -> {
                    target.setRemainingFireTicks(8 * 20);
                    lvl.sendParticles(ParticleTypes.FLAME, target.getX(), target.getY() + 1, target.getZ(), 24, 0.3, 0.4, 0.3, 0.05);
                    lvl.playSound(null, target.getX(), target.getY(), target.getZ(), SoundEvents.FIRECHARGE_USE, SoundSource.PLAYERS, 0.8f, 1.1f);
                    GODFIX.info("[enchant] fireburst proc by {}", sp.getName().getString());
                }
                case "rasengan" -> {
                    target.hurt(sp.damageSources().generic(), 4.0f);
                    var look = sp.getLookAngle();
                    target.push(look.x * 1.6, 0.45, look.z * 1.6);
                    target.hurtMarked = true;
                    lvl.sendParticles(ParticleTypes.CLOUD, target.getX(), target.getY() + 1, target.getZ(), 20, 0.3, 0.3, 0.3, 0.08);
                    lvl.playSound(null, target.getX(), target.getY(), target.getZ(), SoundEvents.BREEZE_SHOOT, SoundSource.PLAYERS, 1.0f, 0.9f);
                    GODFIX.info("[enchant] rasengan proc by {}", sp.getName().getString());
                }
                default -> { }
            }
        } finally {
            settlementsfix$inProc.set(Boolean.FALSE);
        }
    }

    @Unique
    private static boolean hasAura(ServerPlayer sp, String aura) {
        for (EquipmentSlot slot : new EquipmentSlot[]{EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET}) {
            ItemStack armor = sp.getItemBySlot(slot);
            CustomData d = armor.get(DataComponents.CUSTOM_DATA);
            if (d != null && aura.equals(d.copyTag().getString("aura"))) return true;
        }
        return false;
    }

    @Unique
    private static void strike(ServerLevel lvl, Entity at) {
        LightningBolt bolt = EntityType.LIGHTNING_BOLT.create(lvl);
        if (bolt == null) return;
        bolt.moveTo(at.getX(), at.getY(), at.getZ());
        lvl.addFreshEntity(bolt);
    }
}
