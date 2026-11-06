package dev.god.godvoice;

import de.maxhenkel.voicechat.api.VoicechatConnection;
import java.util.*;
import java.util.function.Function;

/** Main-thread adapter presence, not a claim about native UDP or actual hearing. */
final class VoicePresence {
    private record Original(boolean owned,boolean disabled){}
    private final Map<UUID,Original> attached=new HashMap<>();
    private final Function<UUID,VoicechatConnection> lookup;
    VoicePresence(Function<UUID,VoicechatConnection> lookup){this.lookup=lookup;}
    void attach(UUID actor){
        VoicechatConnection connection=lookup.apply(actor);
        if(connection==null)return;
        // A real mod always owns its connection/mute state, even before UDP is ready.
        if(connection.isInstalled()){attached.remove(actor);return;}
        Original original=attached.get(actor);
        if(original==null){original=new Original(!connection.isConnected(),connection.isDisabled());attached.put(actor,original);}
        // Do not take over a connection represented by another addon.
        if(!original.owned())return;
        if(!connection.isConnected())connection.setConnected(true);
        connection=lookup.apply(actor);
        if(connection!=null&&!connection.isInstalled()&&connection.isDisabled())connection.setDisabled(false);
    }
    boolean isConnected(UUID actor){
        VoicechatConnection connection=lookup.apply(actor);
        return attached.containsKey(actor)&&connection!=null&&!connection.isInstalled()&&connection.isConnected()&&!connection.isDisabled();
    }
    void detach(UUID actor){
        Original original=attached.remove(actor);if(original==null||!original.owned())return;
        VoicechatConnection connection=lookup.apply(actor);
        // Only undo our connected/enabled presentation; preserve later native
        // handshakes or a state change performed by another provider.
        if(connection==null||connection.isInstalled()||!connection.isConnected()||connection.isDisabled())return;
        connection.setConnected(false);
        connection=lookup.apply(actor);
        if(connection!=null&&!connection.isInstalled()&&connection.isDisabled()!=original.disabled())connection.setDisabled(original.disabled());
    }
    void forget(UUID actor){attached.remove(actor);}
    void close(){for(UUID actor:new ArrayList<>(attached.keySet()))detach(actor);}
}
