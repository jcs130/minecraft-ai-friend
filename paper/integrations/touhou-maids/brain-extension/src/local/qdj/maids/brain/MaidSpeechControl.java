package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.network.message.PlayMaidSoundPackage;
import java.util.*;
import java.util.function.BiConsumer;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.level.ServerPlayer;

/** Only replaces the configured companion's ambient voice, never another maid's sounds. */
public final class MaidSpeechControl {
    private record Binding(UUID maid,UUID owner,BiConsumer<EntityMaid,String> speech){}
    private static volatile Binding binding;
    private MaidSpeechControl(){}
    public static synchronized AutoCloseable bind(UUID maid,UUID owner,BiConsumer<EntityMaid,String> speech){
        if(binding!=null)throw new IllegalStateException("A companion voice is already bound");
        Binding next=new Binding(maid,owner,speech);binding=next;
        return ()->{synchronized(MaidSpeechControl.class){if(binding==next)binding=null;}};
    }
    public static boolean consume(ServerPlayer player,CustomPacketPayload payload){
        Binding current=binding;if(current==null||!(payload instanceof PlayMaidSoundPackage sound))return false;
        var entity=player.level().getEntity(sound.entityId());
        if(!(entity instanceof EntityMaid maid)||!current.maid.equals(maid.getUUID())||!current.owner.equals(maid.getOwnerUUID()))return false;
        if(player.distanceToSqr(maid)<=256)current.speech.accept(maid,sound.soundEvent().toString());
        return true;
    }
}
