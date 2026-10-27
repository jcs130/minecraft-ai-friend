package org.afuhome.auth;

import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.proxy.server.*;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real plugin event + live authorization-provider decisions, never a heartbeat. */
public final class McbotTransportTest {
    @SuppressWarnings("unchecked") public static void main(String[] args)throws Exception {
        AtomicBoolean granted=new AtomicBoolean(false),paper=new AtomicBoolean(false),totp=new AtomicBoolean(false);
        ServerConnection connection=(ServerConnection)AuthObservationTest.stub(ServerConnection.class,(m,a)->m.getName().equals("getServerInfo")?new ServerInfo(paper.get()?"paper":"auth",new InetSocketAddress("127.0.0.1",25710)):AuthObservationTest.empty(m.getReturnType()));
        Player player=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()){
            case "getUniqueId"->new UUID(7,4);case "getCurrentServer"->Optional.of(connection);
            default->AuthObservationTest.empty(m.getReturnType());
        });
        LibreLoginPlugin<Player,RegisteredServer> libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)->{
            if(m.getName().equals("getAuthorizationProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->switch(n.getName()){
                case "isAuthorized"->granted.get();case "isAwaiting2FA"->totp.get();default->AuthObservationTest.empty(n.getReturnType());});
            return AuthObservationTest.empty(m.getReturnType());
        });
        LoginGuard guard=new LoginGuard(null,null);AuthObservationTest.set(guard,"libre",libre);
        ((Set<Player>)AuthObservationTest.get(guard,"authenticated")).add(player);
        var channel=MinecraftChannelIdentifier.create("mcbot","c2s");
        for(int state=0;state<6;state++){
            AuthObservationTest.set(guard,"ready",state!=0);granted.set(state>=2);paper.set(state>=3);totp.set(state==4);
            var event=new PluginMessageEvent(player,connection,channel,new byte[]{1});guard.mcbotTransport(event);
            AuthObservationTest.check(event.getResult().isAllowed()==(state==3||state==5),"exact actual authorization/PLAY gate "+state);
        }
        var spoof=new PluginMessageEvent(connection,player,channel,new byte[]{1});guard.mcbotTransport(spoof);
        AuthObservationTest.check(!spoof.getResult().isAllowed(),"server cannot impersonate client driver");
        var other=new PluginMessageEvent(player,connection,MinecraftChannelIdentifier.create("other","channel"),new byte[]{1});guard.mcbotTransport(other);
        AuthObservationTest.check(other.getResult().isAllowed(),"unrelated payload unchanged");
        AuthObservationTest.check(((Set<?>)AuthObservationTest.get(guard,"authenticated")).size()==1,"gate never grants or revokes login");
        System.out.println("PASS "+AuthObservationTest.checks+" mcbot live authentication cases");
    }
}
