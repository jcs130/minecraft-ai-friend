package org.qiandengji.payload;

import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.scheduler.*;
import java.lang.reflect.*;
import java.util.*;

/** Actual Velocity events exercise the production routing and scheduled callback. */
public final class YsmHandoffRoutingTest {
    private static int checks;
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);checks++;}
    private static byte[] ack(){return new byte[]{52,5,'2','.','6','.','0'};}
    private static Object empty(Class<?> type){
        if(type==boolean.class)return false;if(type==int.class)return 0;if(type==long.class)return 0L;
        if(type==Optional.class)return Optional.empty();return null;
    }
    @SuppressWarnings("unchecked") private static <T>T stub(Class<T> type,InvocationHandler body){
        return (T)Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(proxy,method,args)->{
            if(method.getName().equals("equals"))return proxy==args[0];
            if(method.getName().equals("hashCode"))return System.identityHashCode(proxy);
            if(method.getName().equals("toString"))return "OwnRoutingFixture";
            return body.invoke(proxy,method,args);
        });
    }
    public static void main(String[] args){
        List<Runnable> tasks=new ArrayList<>();List<byte[]> sent=new ArrayList<>();
        boolean[] active={true},accept={true};
        Player[] player=new Player[1],actual=new Player[1];ServerConnection[] current=new ServerConnection[1];
        RegisteredServer paper=stub(RegisteredServer.class,(p,m,a)->empty(m.getReturnType()));
        RegisteredServer auth=stub(RegisteredServer.class,(p,m,a)->empty(m.getReturnType()));
        player[0]=stub(Player.class,(p,m,a)->switch(m.getName()){
            case "isActive"->active[0];case "getUniqueId"->new UUID(7,8);case "getCurrentServer"->Optional.ofNullable(current[0]);default->empty(m.getReturnType());
        });actual[0]=player[0];
        ServerConnection game=stub(ServerConnection.class,(p,m,a)->switch(m.getName()){
            case "getPlayer"->player[0];case "getServer"->paper;
            case "sendPluginMessage"->{check(a[0].equals(MinecraftChannelIdentifier.from(YsmAcknowledgementHandoff.CHANNEL)),"only original channel forwarded");sent.add(((byte[])a[1]).clone());yield accept[0];}
            default->empty(m.getReturnType());
        });
        ServerConnection authentication=stub(ServerConnection.class,(p,m,a)->switch(m.getName()){
            case "getPlayer"->player[0];case "getServer"->auth;default->empty(m.getReturnType());
        });
        Scheduler scheduler=stub(Scheduler.class,(p,m,a)->{
            if(!m.getName().equals("buildTask"))return empty(m.getReturnType());
            Runnable runnable=(Runnable)a[1];Object[] builder=new Object[1];
            builder[0]=stub(Scheduler.TaskBuilder.class,(b,n,v)->{
                if(n.getName().equals("schedule")){tasks.add(runnable);return stub(ScheduledTask.class,(x,y,z)->empty(y.getReturnType()));}
                return builder[0];
            });return builder[0];
        });
        ProxyServer server=stub(ProxyServer.class,(p,m,a)->switch(m.getName()){
            case "getPlayer"->Optional.ofNullable(actual[0]);case "getServer"->a[0].equals("paper")?Optional.of(paper):Optional.empty();case "getScheduler"->scheduler;default->empty(m.getReturnType());
        });
        var guard=new OptionalPayloadGuard(server);var channel=MinecraftChannelIdentifier.from(YsmAcknowledgementHandoff.CHANNEL);
        current[0]=authentication;
        var original=new PluginMessageEvent(player[0],authentication,channel,ack());guard.acknowledgement(original);
        check(original.getResult().isAllowed()&&tasks.isEmpty(),"auth receipt remains forwarded normally and does not route to auth again");
        current[0]=game;guard.connected(new ServerPostConnectEvent(player[0],auth));
        check(tasks.size()==1,"actual game post-connect queues retained client receipt");
        tasks.remove(0).run();check(sent.size()==1&&Arrays.equals(sent.get(0),ack()),"same player's current game connection receives actual bytes");
        guard.acknowledgement(original);guard.connected(new ServerPostConnectEvent(player[0],auth));
        check(tasks.isEmpty(),"successful receipt is not replayed by duplicate events");
        guard.disconnected(new DisconnectEvent(player[0],DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));sent.clear();
        guard.acknowledgement(new PluginMessageEvent(game,player[0],channel,ack()));
        guard.acknowledgement(new PluginMessageEvent(player[0],game,MinecraftChannelIdentifier.from("other:channel"),ack()));
        guard.acknowledgement(new PluginMessageEvent(player[0],game,channel,new byte[]{6,0}));
        Player wrong=stub(Player.class,(p,m,a)->empty(m.getReturnType()));
        guard.acknowledgement(new PluginMessageEvent(wrong,game,channel,ack()));
        var blocked=new PluginMessageEvent(player[0],game,channel,ack());blocked.setResult(PluginMessageEvent.ForwardResult.handled());guard.acknowledgement(blocked);
        check(tasks.isEmpty()&&!blocked.getResult().isAllowed(),"backend origin, wrong channel/data/owner and handled events cannot seed a receipt");
        guard.acknowledgement(new PluginMessageEvent(player[0],game,channel,ack()));actual[0]=wrong;tasks.remove(0).run();
        check(sent.isEmpty(),"a replaced physical session is rejected even when UUID lookup exists");
        guard.disconnected(new DisconnectEvent(player[0],DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));actual[0]=player[0];
        guard.acknowledgement(new PluginMessageEvent(player[0],game,channel,ack()));current[0]=authentication;tasks.remove(0).run();
        check(sent.isEmpty(),"a stale task cannot send after leaving that backend");
        guard.disconnected(new DisconnectEvent(player[0],DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));current[0]=game;active[0]=false;
        guard.acknowledgement(new PluginMessageEvent(player[0],game,channel,ack()));check(tasks.isEmpty(),"inactive client cannot queue forwarding");
        guard.disconnected(new DisconnectEvent(player[0],DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));active[0]=true;accept[0]=false;
        guard.acknowledgement(new PluginMessageEvent(player[0],game,channel,ack()));
        tasks.remove(0).run();check(tasks.size()==1,"transport failure queues only one retry");tasks.remove(0).run();
        check(tasks.isEmpty()&&sent.size()==2,"retry budget is enforced by production adapter");
        guard.disconnected(new DisconnectEvent(player[0],DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));guard.connected(new ServerPostConnectEvent(player[0],auth));
        check(tasks.isEmpty(),"disconnect invalidates receipt before future connect events");
        System.out.println("YsmHandoffRoutingTest: "+checks+" checks passed");
    }
}
