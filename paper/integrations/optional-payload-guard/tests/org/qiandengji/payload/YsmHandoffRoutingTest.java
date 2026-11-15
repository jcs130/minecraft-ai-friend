package org.qiandengji.payload;

import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.scheduler.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.function.Supplier;

/** Actual Velocity events exercise the production routing and scheduled callback. */
public final class YsmHandoffRoutingTest {
    private static int checks;
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);checks++;}
    private static byte[] ack(){return new byte[]{52,5,'2','.','6','.','0'};}
    private static byte[] greeting(){return new byte[]{51,5,'2','.','6','.','0'};}
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
        boolean[] active={true};
        Player[] player=new Player[1],actual=new Player[1];ServerConnection[] current=new ServerConnection[1];
        RegisteredServer paper=stub(RegisteredServer.class,(p,m,a)->empty(m.getReturnType()));
        RegisteredServer auth=stub(RegisteredServer.class,(p,m,a)->empty(m.getReturnType()));
        player[0]=stub(Player.class,(p,m,a)->switch(m.getName()){
            case "isActive"->active[0];case "getUniqueId"->new UUID(7,8);case "getCurrentServer"->Optional.ofNullable(current[0]);default->empty(m.getReturnType());
        });actual[0]=player[0];
        Supplier<ServerConnection> gameConnection=()->stub(ServerConnection.class,(p,m,a)->switch(m.getName()){
            case "getPlayer"->player[0];case "getServer"->paper;
            case "sendPluginMessage"->{check(a[0].equals(MinecraftChannelIdentifier.from(YsmAcknowledgementHandoff.CHANNEL)),"only original channel forwarded");sent.add(((byte[])a[1]).clone());yield true;}
            default->empty(m.getReturnType());
        });
        ServerConnection game=gameConnection.get(),replacement=gameConnection.get(),direct=gameConnection.get();
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
            case "getPlayer"->Optional.ofNullable(actual[0]);case "getServer"->a[0].equals("paper")?Optional.of(paper):a[0].equals("auth")?Optional.of(auth):Optional.empty();case "getScheduler"->scheduler;default->empty(m.getReturnType());
        });
        var guard=new OptionalPayloadGuard(server);var channel=MinecraftChannelIdentifier.from(YsmAcknowledgementHandoff.CHANNEL);
        current[0]=authentication;
        var authGreeting=new PluginMessageEvent(authentication,player[0],channel,greeting());
        guard.ysmMessage(authGreeting);
        check(!authGreeting.getResult().isAllowed(),"auth greeting must not consume the physical client's original handshake");
        var authCatalogue=new PluginMessageEvent(authentication,player[0],channel,new byte[]{8,0});
        guard.ysmMessage(authCatalogue);
        check(!authCatalogue.getResult().isAllowed(),"auth model announcement is also scoped away from the client");
        var authReply=new PluginMessageEvent(player[0],authentication,channel,ack());guard.ysmMessage(authReply);
        check(!authReply.getResult().isAllowed()&&tasks.isEmpty(),"an auth reply cannot supply handoff evidence");
        var configuration=new PluginMessageEvent(authentication,player[0],MinecraftChannelIdentifier.from("neoforge:register"),new byte[0]);
        guard.ysmMessage(configuration);
        check(configuration.getResult().isAllowed(),"NeoForge channel negotiation is unaffected");
        current[0]=game;
        var firstGameGreeting=new PluginMessageEvent(game,player[0],channel,greeting());guard.ysmMessage(firstGameGreeting);
        check(firstGameGreeting.getResult().isAllowed()&&tasks.isEmpty(),"first game greeting is forwarded without a fabricated reply");
        guard.ysmMessage(new PluginMessageEvent(game,player[0],channel,ack()));
        guard.ysmMessage(new PluginMessageEvent(player[0],game,MinecraftChannelIdentifier.from("other:channel"),ack()));
        guard.ysmMessage(new PluginMessageEvent(player[0],game,channel,new byte[]{6,0}));
        Player wrong=stub(Player.class,(p,m,a)->empty(m.getReturnType()));
        guard.ysmMessage(new PluginMessageEvent(wrong,game,channel,ack()));
        var blocked=new PluginMessageEvent(player[0],game,channel,ack());blocked.setResult(PluginMessageEvent.ForwardResult.handled());guard.ysmMessage(blocked);
        current[0]=replacement;
        var replacementGreeting=new PluginMessageEvent(replacement,player[0],channel,greeting());
        guard.ysmMessage(replacementGreeting);
        check(tasks.isEmpty()&&!blocked.getResult().isAllowed(),"backend origin, wrong channel/data/owner and handled events cannot seed a replay");
        current[0]=game;
        var original=new PluginMessageEvent(player[0],game,channel,ack());guard.ysmMessage(original);
        check(original.getResult().isAllowed()&&tasks.isEmpty(),"the original acknowledgement goes directly to the current game");
        current[0]=replacement;guard.ysmMessage(firstGameGreeting);
        check(tasks.isEmpty(),"a greeting from a departed game cannot schedule replay");
        guard.ysmMessage(replacementGreeting);guard.ysmMessage(replacementGreeting);
        check(tasks.size()==1,"a current replacement gaming connection must emit a real greeting before one replay");
        tasks.removeFirst().run();check(sent.size()==1&&Arrays.equals(sent.get(0),ack()),"replacement receives the same physical client's real acknowledgement");
        guard.ysmMessage(replacementGreeting);check(tasks.isEmpty(),"repeat greeting does not repeat the replay");
        current[0]=direct;
        guard.ysmMessage(new PluginMessageEvent(direct,player[0],channel,greeting()));
        guard.ysmMessage(new PluginMessageEvent(player[0],direct,channel,ack()));
        tasks.removeFirst().run();check(sent.size()==1,"a direct reply to the new greeting suppresses replay");
        var last=gameConnection.get();current[0]=last;
        guard.ysmMessage(new PluginMessageEvent(last,player[0],channel,greeting()));actual[0]=wrong;
        tasks.removeFirst().run();check(sent.size()==1,"replaced physical player cannot use original proof even with the same UUID");
        guard.disconnected(new DisconnectEvent(player[0],DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));actual[0]=player[0];
        guard.ysmMessage(new PluginMessageEvent(last,player[0],channel,greeting()));
        check(tasks.isEmpty(),"disconnect invalidates all retained evidence");
        System.out.println("YsmHandoffRoutingTest: "+checks+" checks passed");
    }
}
