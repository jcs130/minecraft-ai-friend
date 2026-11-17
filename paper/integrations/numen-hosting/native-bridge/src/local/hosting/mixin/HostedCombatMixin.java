package local.hosting.mixin;
import local.hosting.HostedBetterCombat;
import net.minecraft.world.entity.player.Player;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
@Mixin(value=Player.class,remap=false)
public abstract class HostedCombatMixin {
    @Inject(method="attack",at=@At("HEAD"),cancellable=true,require=1)
    private void hosted$attack(Entity target,CallbackInfo ci){
        if(HostedBetterCombat.EXECUTING.get()&&(Object)this instanceof ServerPlayer player&&Boolean.getBoolean("qiandengji.combat.diagnostics")){
            System.out.println("[HostedCombatDiagnostic] charge="+player.getAttackStrengthScale(0)+" damage="+player.getAttributeValue(net.minecraft.world.entity.ai.attributes.Attributes.ATTACK_DAMAGE)+" targetHealth="+(target instanceof net.minecraft.world.entity.LivingEntity living?living.getHealth():-1));
        }
        if((Object)this instanceof ServerPlayer player&&HostedBetterCombat.attack(player,target))ci.cancel();
    }
}
