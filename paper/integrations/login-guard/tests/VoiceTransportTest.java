package org.afuhome.auth;

import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.ChannelMessageSink;
import com.velocitypowered.api.proxy.messages.ChannelMessageSource;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Full production handler and real Velocity events; players and LibreLogin are test doubles. */
public final class VoiceTransportTest {
    static final MinecraftChannelIdentifier VOICE=MinecraftChannelIdentifier.from("mcagent:voice");
    static final String REQUEST="00000000-0000-4000-8000-000000000001";
    static int checks;
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    static byte[] json(String body){return ("\u0001"+body).getBytes(StandardCharsets.UTF_8);}

    static final class Fixture {
        boolean granted=true,totp=false,active=true,providerThrows=false;
        String backendName="paper";
        Player player,owner;
        ServerConnection connection,current;
        final LoginGuard guard=new LoginGuard(null,null);
        @SuppressWarnings("unchecked") Fixture()throws Exception {
            player=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()){
                case "getUniqueId"->new UUID(7,4);case "getUsername"->"ag_VoiceTest";
                case "isActive"->active;case "getCurrentServer"->Optional.ofNullable(current);
                default->AuthObservationTest.empty(m.getReturnType());
            });
            owner=player;connection=backend();current=connection;
            var libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)->{
                if(m.getName().equals("getAuthorizationProvider")){
                    if(providerThrows)throw new IllegalStateException("synthetic provider unavailable");
                    return AuthObservationTest.stub(m.getReturnType(),(n,b)->switch(n.getName()){
                        case "isAuthorized"->granted;case "isAwaiting2FA"->totp;
                        default->AuthObservationTest.empty(n.getReturnType());
                    });
                }
                return AuthObservationTest.empty(m.getReturnType());
            });
            AuthObservationTest.set(guard,"libre",libre);AuthObservationTest.set(guard,"ready",true);
            authenticated().add(player);
        }
        @SuppressWarnings("unchecked") Set<Player> authenticated()throws Exception {
            return (Set<Player>)AuthObservationTest.get(guard,"authenticated");
        }
        ServerConnection backend(){return (ServerConnection)AuthObservationTest.stub(ServerConnection.class,(m,a)->switch(m.getName()){
            case "getPlayer"->owner;
            case "getServerInfo"->new ServerInfo(backendName,new InetSocketAddress("127.0.0.1",25710));
            default->AuthObservationTest.empty(m.getReturnType());
        });}
        PluginMessageEvent event(boolean reply,byte[] data){return reply
            ?new PluginMessageEvent(connection,player,VOICE,data)
            :new PluginMessageEvent(player,connection,VOICE,data);}
        void assertRoute(boolean reply,byte[] data,boolean allowed,String label){
            var e=event(reply,data);guard.voiceTransport(e);
            check(e.getResult().isAllowed()==allowed,label);
            check(Arrays.equals(data,e.getData()),label+" preserves exact payload");
        }
    }
    interface Change {void apply(Fixture f)throws Exception;}
    static void denied(String label,Change change)throws Exception {
        for(boolean reply:new boolean[]{false,true}){
            var f=new Fixture();change.apply(f);
            f.assertRoute(reply,json("{\"type\":\"voice_result\",\"state\":\"sent\"}"),false,label+(reply?" S2C":" C2S"));
        }
    }
    public static void main(String[] args)throws Exception {
        for(String op:List.of("say","status","subscribe","begin","finish")){
            var f=new Fixture();f.assertRoute(false,json("{\"op\":\""+op+"\",\"requestId\":\""+REQUEST+"\"}"),true,"authenticated request "+op);
        }
        new Fixture().assertRoute(false,new byte[]{2,0,1,2,3,(byte)255},true,"binary upload is opaque to proxy");
        for(String state:List.of("queued","playing","sent","failed","cancelled","unknown","uploading","subscribed","not_found")){
            new Fixture().assertRoute(true,json("{\"type\":\"voice_result\",\"requestId\":\""+REQUEST+"\",\"state\":\""+state+"\"}"),true,"current backend receipt "+state);
        }
        new Fixture().assertRoute(true,json("{\"type\":\"nearby_voice\",\"utteranceId\":\""+REQUEST+"\",\"speaker\":\"another player\",\"text\":\"一起去公会\"}"),true,"nearby speech uses listener connection, not speaker identity");
        denied("provider not ready",f->AuthObservationTest.set(f.guard,"ready",false));
        denied("not in authenticated sessions",f->f.authenticated().clear());
        denied("live authorization revoked",f->f.granted=false);
        denied("2FA pending",f->f.totp=true);
        denied("provider throws",f->f.providerThrows=true);
        denied("disconnected player",f->f.active=false);
        denied("auth backend",f->f.backendName="auth");
        denied("other game backend",f->f.backendName="fom");
        denied("no current backend",f->f.current=null);
        denied("stale same-name backend after switch",f->f.current=f.backend());
        denied("connection belongs to other physical player",f->f.owner=new Fixture().player);
        for(boolean reply:new boolean[]{false,true}){
            var f=new Fixture();var other=new Fixture();f.authenticated().add(other.player);
            // Both Player objects have the same UUID/name. Physical identity must still match.
            var e=reply?new PluginMessageEvent(f.connection,other.player,VOICE,new byte[]{1})
                :new PluginMessageEvent(other.player,f.connection,VOICE,new byte[]{1});
            f.guard.voiceTransport(e);check(!e.getResult().isAllowed(),"same UUID cannot redirect "+reply);
            var blocked=f.event(reply,new byte[]{1});blocked.setResult(PluginMessageEvent.ForwardResult.handled());
            f.guard.voiceTransport(blocked);check(!blocked.getResult().isAllowed(),"other plugin rejection preserved "+reply);
        }
        var f=new Fixture();
        var source=(ChannelMessageSource)AuthObservationTest.stub(ChannelMessageSource.class,(m,a)->AuthObservationTest.empty(m.getReturnType()));
        var sink=(ChannelMessageSink)AuthObservationTest.stub(ChannelMessageSink.class,(m,a)->AuthObservationTest.empty(m.getReturnType()));
        for(var e:List.of(new PluginMessageEvent(f.player,f.player,VOICE,new byte[]{1}),
                new PluginMessageEvent(f.connection,f.connection,VOICE,new byte[]{1}),
                new PluginMessageEvent(source,f.player,VOICE,new byte[]{1}),
                new PluginMessageEvent(f.player,sink,VOICE,new byte[]{1}))){
            f.guard.voiceTransport(e);check(!e.getResult().isAllowed(),"unsupported direction rejected");
        }
        for(String channel:List.of("mcbot:c2s","qiandengji:agent","other:channel")){
            for(boolean allowed:new boolean[]{true,false}){
                var e=new PluginMessageEvent(f.connection,f.player,MinecraftChannelIdentifier.from(channel),new byte[]{1});
                if(!allowed)e.setResult(PluginMessageEvent.ForwardResult.handled());
                f.guard.voiceTransport(e);check(e.getResult().isAllowed()==allowed,"independent channel unchanged "+channel);
            }
        }
        var mcbot=new PluginMessageEvent(f.connection,f.player,MinecraftChannelIdentifier.from("mcbot:c2s"),new byte[]{1});
        f.guard.mcbotTransport(mcbot);check(!mcbot.getResult().isAllowed(),"mcbot remains client-to-server only");
        check(f.authenticated().equals(Set.of(f.player)),"transport never grants/revokes authentication");
        System.out.println("PASS "+checks+" voice transport assertions (real event/handler; mocked connections/provider)");
    }
}
