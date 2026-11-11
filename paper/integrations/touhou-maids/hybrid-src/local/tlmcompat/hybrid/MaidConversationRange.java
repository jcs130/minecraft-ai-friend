package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;

/** Public proximity only. Ownership, native private chat and management are unchanged. */
final class MaidConversationRange {
    static final int PARTNER=24,VISITOR=8;
    static int speaker(EntityMaid maid,Player actor){
        return actor.getUniqueId().equals(maid.getOwnerUUID())?PARTNER:VISITOR;
    }
    static int listener(EntityMaid maid,Player actor){
        if(speaker(maid,actor)==PARTNER)return PARTNER;
        if(actor.getGameMode()==GameMode.SPECTATOR&&actor.getSpectatorTarget() instanceof Player target
            &&target.getUniqueId().equals(maid.getOwnerUUID()))return PARTNER;
        return VISITOR;
    }
    static boolean within(EntityMaid maid,Player actor,int radius){
        return actor.getWorld().equals(maid.getBukkitEntity().getWorld())
            &&actor.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())<=radius*radius;
    }
    static boolean hears(EntityMaid maid,Player actor){return within(maid,actor,listener(maid,actor));}
}
