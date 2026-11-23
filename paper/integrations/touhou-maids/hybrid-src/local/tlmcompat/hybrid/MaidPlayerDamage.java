package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.OwnableEntity;
import net.minecraft.world.entity.TraceableEntity;
import net.minecraft.world.entity.player.Player;

/**
 * A player may not hurt an owned maid, in person or through a projectile, explosive, pet or summon.
 * Mobs, the environment, attacker-less sources and the console keep their original effect.
 */
final class MaidPlayerDamage {
    private static final int OWNER_DEPTH = 4;
    private MaidPlayerDamage() {}

    static boolean blocked(EntityMaid maid, DamageSource source) {
        return maid.getOwnerUUID() != null && responsiblePlayer(source) != null;
    }

    static Player responsiblePlayer(DamageSource source) {
        Player player = player(source.getEntity(), 0);
        return player != null ? player : player(source.getDirectEntity(), 0);
    }

    /** Follows shooter and tamer links; a missing or looping owner is nobody's responsibility. */
    private static Player player(Entity entity, int depth) {
        if (entity == null || depth > OWNER_DEPTH) return null;
        if (entity instanceof Player found) return found;
        Entity owner = entity instanceof TraceableEntity traced ? traced.getOwner()
            : entity instanceof OwnableEntity owned ? owned.getOwner() : null;
        return owner == entity ? null : player(owner, depth + 1);
    }
}
