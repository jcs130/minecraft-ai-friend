package org.afuhome.auth;

import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Real plugin message events; synthetic secrets, connections and authorization only. */
public final class SvcAddressTest {
    static final MinecraftChannelIdentifier SECRET=MinecraftChannelIdentifier.from("voicechat:secret");
    static int checks;
    static void check(boolean b,String label){checks++;if(!b)throw new AssertionError(label);}
    static Properties settings(){
        var p=new Properties();p.setProperty("svc-route.enabled","true");
        p.setProperty("svc-route.public-host","voice.example.org:24454");
        p.setProperty("svc-route.lan-cidr","192.168.3.0/24");
        p.setProperty("svc-route.lan-host","192.168.3.163:24454");
        p.setProperty("svc-route.loopback-host","127.0.0.1:24454");return p;
    }
    static byte[] packet(String host){
        byte[] utf=host.getBytes(StandardCharsets.UTF_8);var b=ByteBuffer.allocate(60+utf.length);
        b.putLong(1).putLong(2).putInt(24454).putLong(3).putLong(4).put((byte)0);
        b.putInt(1275).putDouble(48).putInt(1000).put((byte)1);
        int n=utf.length;do{b.put((byte)((n&127)|(n>127?128:0)));n>>>=7;}while(n!=0);
        b.put(utf).put((byte)0);return Arrays.copyOf(b.array(),b.position());
    }
    static String host(byte[] packet){int n=0,shift=0,at=54,v;do{v=packet[at++]&255;n|=(v&127)<<shift;shift+=7;}while((v&128)!=0);return new String(packet,at,n,StandardCharsets.UTF_8);}
    static final class Fixture {
        final VoiceTransportTest.Fixture auth;
        final List<byte[]> sent=new ArrayList<>();
        InetSocketAddress remote=new InetSocketAddress("192.168.3.25",40000);
        boolean accepts=true;
        Fixture(Properties settings)throws Exception {
            auth=new VoiceTransportTest.Fixture();
            Player wrapped=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()){
                case "getUniqueId"->new UUID(7,4);case "getUsername"->"qa_voice";
                case "isActive"->auth.active;case "getCurrentServer"->Optional.ofNullable(auth.current);
                case "getRemoteAddress"->remote;
                case "sendPluginMessage"->{check(SECRET.equals(a[0]),"only SVC secret is emitted");if(accepts)sent.add(((byte[])a[1]).clone());yield accepts;}
                default->AuthObservationTest.empty(m.getReturnType());
            });
            auth.authenticated().clear();auth.player=wrapped;auth.owner=wrapped;
            auth.connection=auth.backend();auth.current=auth.connection;auth.authenticated().add(wrapped);
            // Also compiles against the pre-fix source for a behavioral red run.
            try{LoginGuard.class.getDeclaredMethod("configureSvcRoutes",Properties.class).invoke(auth.guard,settings);}
            catch(NoSuchMethodException baseline){}
        }
        PluginMessageEvent event(byte[] data){return new PluginMessageEvent(auth.connection,auth.player,SECRET,data);}
        void fire(PluginMessageEvent event)throws Exception {
            try{LoginGuard.class.getMethod("svcSecret",PluginMessageEvent.class).invoke(auth.guard,event);}
            catch(NoSuchMethodException baseline){}
        }
    }
    interface Change {void apply(Fixture f)throws Exception;}
    public static void main(String[] args)throws Exception {
        for(String[] row:new String[][]{
            {"192.168.3.25","192.168.3.163:24454"},{"192.168.3.1","192.168.3.163:24454"},
            {"203.0.113.25","voice.example.org:24454"},{"10.1.2.3","voice.example.org:24454"},
            {"192.168.30.1","voice.example.org:24454"},{"127.0.0.1","127.0.0.1:24454"},
            {"::1","127.0.0.1:24454"},{"2001:db8::25","voice.example.org:24454"}}){
            var f=new Fixture(settings());f.remote=new InetSocketAddress(row[0],40000);
            byte[] original=packet("");var e=f.event(original);f.fire(e);
            check(f.sent.size()==1,"route a single SVC reply for "+row[0]);
            check(!e.getResult().isAllowed(),"original reply is not duplicated");
            check(host(f.sent.getFirst()).equals(row[1]),"correct endpoint for "+row[0]);
            check(Arrays.equals(Arrays.copyOf(original,54),Arrays.copyOf(f.sent.getFirst(),54)),"secret/UUID/port/audio settings unchanged");
            check(Arrays.equals(original,e.getData()),"received payload not mutated");
        }
        for(Change change:List.<Change>of(f->f.auth.active=false,f->f.auth.granted=false,
                f->f.auth.totp=true,f->f.auth.authenticated().clear(),f->f.auth.current=null,
                f->f.auth.current=f.auth.backend(),f->f.auth.backendName="auth",
                f->f.auth.owner=new VoiceTransportTest.Fixture().player)){
            var f=new Fixture(settings());change.apply(f);var e=f.event(packet(""));f.fire(e);
            check(f.sent.isEmpty()&&!e.getResult().isAllowed(),"unauthorized or stale SVC reply cannot be routed");
        }
        var f=new Fixture(settings());var blocked=f.event(packet(""));blocked.setResult(PluginMessageEvent.ForwardResult.handled());f.fire(blocked);
        check(f.sent.isEmpty()&&!blocked.getResult().isAllowed(),"preserve another plugin's veto");
        var spoof=new PluginMessageEvent(f.auth.player,f.auth.connection,SECRET,packet(""));f.fire(spoof);
        check(f.sent.isEmpty()&&!spoof.getResult().isAllowed(),"client cannot inject server secrets");
        for(byte[] malformed:List.of(new byte[0],new byte[54],Arrays.copyOf(packet(""),58),Arrays.copyOf(packet(""),55))){
            var broken=new Fixture(settings());var e=broken.event(malformed);broken.fire(e);
            check(broken.sent.isEmpty()&&e.getResult().isAllowed(),"unsupported payload retains backend behavior");
        }
        var disabled=new Fixture(new Properties());var e=disabled.event(packet(""));disabled.fire(e);
        check(disabled.sent.isEmpty()&&e.getResult().isAllowed(),"opt-in only");
        var invalid=settings();invalid.setProperty("svc-route.lan-cidr","0.0.0.0/0");
        var invalidFixture=new Fixture(invalid);e=invalidFixture.event(packet(""));invalidFixture.fire(e);
        check(invalidFixture.sent.isEmpty()&&e.getResult().isAllowed(),"invalid config disables routing only");
        var already=new Fixture(settings());e=already.event(packet("192.168.3.163:24454"));already.fire(e);
        check(already.sent.isEmpty()&&e.getResult().isAllowed(),"unchanged destination forwards once normally");
        var rejected=new Fixture(settings());rejected.accepts=false;e=rejected.event(packet(""));rejected.fire(e);
        check(rejected.sent.isEmpty()&&!e.getResult().isAllowed(),"closed sink never leaks a second reply");
        System.out.println("PASS "+checks+" SVC address/authentication boundary checks");
    }
}
