package dev.god.godvoice;

import de.maxhenkel.voicechat.api.VoicechatConnection;
import java.lang.reflect.Proxy;
import java.util.*;

/** State snapshots deliberately stay stale, like the documented SVC API. */
public final class VoicePresenceTest {
    static int passed;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);passed++;}
    static final class Peer {
        boolean installed,connected,disabled;int writes;
        VoicechatConnection snapshot(){
            final boolean i=installed,c=connected,d=disabled;
            return (VoicechatConnection)Proxy.newProxyInstance(VoicechatConnection.class.getClassLoader(),new Class<?>[]{VoicechatConnection.class},(p,m,a)->switch(m.getName()){
                case "isInstalled"->i;case "isConnected"->c;case "isDisabled"->d;
                case "setConnected"->{connected=(boolean)a[0];writes++;yield null;}
                case "setDisabled"->{disabled=(boolean)a[0];writes++;yield null;}
                default->throw new UnsupportedOperationException(m.getName());
            });
        }
    }
    public static void main(String[] args){
        UUID agent=UUID.randomUUID(),human=UUID.randomUUID(),other=UUID.randomUUID();Map<UUID,Peer> peers=new HashMap<>();
        VoicePresence state=new VoicePresence(id->peers.containsKey(id)?peers.get(id).snapshot():null);
        state.attach(agent);check(!state.isConnected(agent),"missing SVC state is not ready");
        Peer a=new Peer();a.disabled=true;peers.put(agent,a);state.attach(agent);
        check(a.connected&&!a.disabled&&state.isConnected(agent),"registered adapter gets connected using fresh state");
        check(!a.installed,"native mod installation is never fabricated");
        int writes=a.writes;state.attach(agent);check(a.writes==writes,"duplicate registration is quiet");
        state.detach(agent);check(!a.connected&&a.disabled&&!state.isConnected(agent),"detach restores only the owned display state");
        writes=a.writes;state.detach(agent);check(a.writes==writes,"duplicate close is idempotent");
        Peer h=new Peer();h.installed=true;h.disabled=true;peers.put(human,h);state.attach(human);state.detach(human);
        check(!h.connected&&h.disabled&&h.writes==0,"native pre-UDP and disabled states stay authoritative");
        Peer o=new Peer();o.connected=true;o.disabled=true;peers.put(other,o);state.attach(other);state.detach(other);
        check(o.connected&&o.disabled&&o.writes==0,"another provider is not overwritten");
        state.attach(agent);a.installed=true;a.disabled=true;writes=a.writes;state.detach(agent);
        check(a.connected&&a.disabled&&a.writes==writes,"later native handshake wins over bridge cleanup");
        a.installed=false;a.connected=false;state.attach(agent);a.connected=false;writes=a.writes;state.detach(agent);
        check(a.writes==writes,"external disconnection is not replaced by stale state");
        state.attach(agent);state.close();check(!a.connected&&!state.isConnected(agent),"plugin teardown clears owned presence");
        state.attach(agent);state.forget(agent);peers.remove(agent);state.close();
        check(!state.isConnected(agent),"quit does not preserve a stale connection");
        Peer replacement=new Peer();peers.put(agent,replacement);check(!state.isConnected(agent),"new session must register again");
        state.attach(agent);check(replacement.connected&&state.isConnected(agent),"same UUID can register after reconnect");
        System.out.println("VoicePresenceTest: "+passed+" passed");
    }
}
