package local.hosting.mixin;

import net.bettercombat.config.ServerConfig;
import net.bettercombat.logic.TargetHelper;
import net.bettercombat.logic.TargetHelper.Relation;
import net.minecraft.core.Holder;
import net.minecraft.world.entity.AgeableMob;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import org.spongepowered.asm.mixin.injection.callback.LocalCapture;

/** A direct entity-type holder has neither a registry key nor registry tags.
 * Better Combat 2.4.0 has already evaluated owners and teams at this point. */
@Mixin(value = TargetHelper.class, remap = false)
public abstract class UnkeyedCombatTargetMixin {
    @Inject(method = "getRelation", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/core/Holder;unwrapKey()Ljava/util/Optional;"),
            locals = LocalCapture.CAPTURE_FAILHARD, cancellable = true, require = 1)
    private static void qdj$unkeyedRelation(Player attacker, Entity target, CallbackInfoReturnable<Relation> result,
                                            ServerConfig config, Holder<EntityType<?>> type) {
        if (type.unwrapKey().isPresent()) return;
        // Use the same configured category defaults as the end of getRelation.
        Relation configured = config.player_relation_to_other;
        if (target instanceof AgeableMob) configured = config.player_relation_to_passives;
        else if (target instanceof Monster) configured = config.player_relation_to_hostiles;
        result.setReturnValue(Relation.coalesce(configured, Relation.HOSTILE));
    }
}
