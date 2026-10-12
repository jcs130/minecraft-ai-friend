import org.afuhome.auth.*;
import java.lang.reflect.*;
import java.net.*;
import java.util.*;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.util.GameProfile;
import org.slf4j.Logger;

/** Exercise actual proof capture before LibreLogin's UUID rewrite, not a
 * username lookup or a mock premium flag used as authentication. */
public final class PremiumEyePolicyTest {
    static int checks;
    static void check(boolean b){if(!b)throw new AssertionError("Check "+(checks+1));checks++;}
    static Object stub(Class<?> t,java.util.function.Function<Method,Object> f){return java.lang.reflect.Proxy.newProxyInstance(t.getClassLoader(),new Class<?>[]{t},(p,m,a)->{
        if(m.getName().equals("hashCode"))return System.identityHashCode(p);if(m.getName().equals("equals"))return p==a[0];return f.apply(m);
    });}
    public static void main(String[] args)throws Exception {
        Set<String> admins=Set.of("goddess","corti","player","corticam");
        var policy=new EyePolicy("{\"schemaVersion\":1,\"autoNameEyes\":true,\"pairs\":[{\"agent\":\"CortiLan\",\"eye\":\"CortiEye\"},{\"agent\":\"ag_CorMy\",\"eye\":\"ag_cormy_eye\"}],\"freeObservers\":[\"live\"]}");
        check(policy.body("ag_NEKO_eye",admins).equals("ag_NEKO"));
        check(policy.body("AG_NEKOEYE",admins).equals("AG_NEKO"));
        check(policy.body("CortiEye",admins).equals("CortiLan"));
        check(policy.body("ag_CorMy_Eye",admins).equals("ag_CorMy"));
        for(String name:List.of("ag_NEKO","Goddess","Goddess_eye","corti_eye","live","ag_neko_eye_eye","eye","ag_CorMy"))check(policy.body(name,admins)==null);
        var disabled=new EyePolicy("{\"schemaVersion\":1,\"autoNameEyes\":false,\"pairs\":[{\"agent\":\"A\",\"eye\":\"AEye\"}]}");
        check(disabled.body("Other_eye",admins)==null);check(disabled.body("AEye",admins).equals("A"));
        try{new EyePolicy("{\"schemaVersion\":1,\"pairs\":[{\"agent\":\"A\",\"eye\":\"B\"},{\"agent\":\"B\",\"eye\":\"C\"}]}");throw new AssertionError("Chain allowed");}catch(IllegalArgumentException expected){checks++;}
        UUID premium=UUID.randomUUID(), storage=UUID.randomUUID();var address=new InetSocketAddress("127.0.0.1",30000);
        LoginGuard guard=new LoginGuard(null,null);
        InboundConnection connection=(InboundConnection)stub(InboundConnection.class,m->m.getName().equals("getRemoteAddress")?address:null);
        Player online=(Player)stub(Player.class,m->switch(m.getName()){case "getRemoteAddress"->address;case "isOnlineMode"->true;case "getUniqueId"->storage;default->null;});
        Player offline=(Player)stub(Player.class,m->switch(m.getName()){case "getRemoteAddress"->address;case "isOnlineMode"->false;default->null;});
        Method verified=LoginGuard.class.getDeclaredMethod("premiumVerified",Player.class,UUID.class);verified.setAccessible(true);
        check(!(boolean)verified.invoke(guard,online,premium));
        guard.premiumProfile(new GameProfileRequestEvent(connection,new GameProfile(premium,"LittleFish0510",List.of()),false));
        check(!(boolean)verified.invoke(guard,online,premium));
        guard.premiumProfile(new GameProfileRequestEvent(connection,new GameProfile(premium,"LittleFish0510",List.of()),true));
        check((boolean)verified.invoke(guard,online,premium));
        check(!(boolean)verified.invoke(guard,online,storage));
        check(!(boolean)verified.invoke(guard,online,null));
        check(!(boolean)verified.invoke(guard,offline,premium));
        System.out.println("PASS "+checks+" premium proof and Eye registry checks; offline storage UUID preserved");
    }
}
