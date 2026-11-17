package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.network.message.PlayMaidSoundPackage;
import java.util.*;
import java.util.function.BiConsumer;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.level.ServerPlayer;

/** Only replaces explicitly registered bodies' voices, never other maids' sounds. */
public final class MaidSpeechControl {
    private record Binding(UUID maid,UUID owner,BiConsumer<EntityMaid,String> speech){}
    private static final Map<UUID,Binding> bindings=new java.util.concurrent.ConcurrentHashMap<>();
    private MaidSpeechControl(){}
    public static synchronized AutoCloseable bind(UUID maid,UUID owner,BiConsumer<EntityMaid,String> speech){
        Objects.requireNonNull(maid);Objects.requireNonNull(owner);Objects.requireNonNull(speech);
        if(bindings.size()>=32||bindings.containsKey(maid))throw new IllegalStateException("Body voice already bound or registry full");
        Binding next=new Binding(maid,owner,speech);bindings.put(maid,next);
        return ()->bindings.remove(maid,next);
    }
    public static boolean consume(ServerPlayer player,CustomPacketPayload payload){
        if(bindings.isEmpty()||!(payload instanceof PlayMaidSoundPackage sound))return false;
        var entity=player.level().getEntity(sound.entityId());
        if(!(entity instanceof EntityMaid maid))return false;
        Binding current=bindings.get(maid.getUUID());if(current==null||!current.owner.equals(maid.getOwnerUUID()))return false;
        if(player.distanceToSqr(maid)<=256)current.speech.accept(maid,sound.soundEvent().toString());
        return true;
    }
}
