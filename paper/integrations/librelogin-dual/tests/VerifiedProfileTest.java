import java.lang.reflect.*;
import java.net.*;
import java.sql.Timestamp;
import java.util.*;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.util.GameProfile;
import xyz.kyngs.librelogin.api.PlatformHandle;
import xyz.kyngs.librelogin.api.database.User;
import xyz.kyngs.librelogin.api.database.ReadWriteDatabaseProvider;
import xyz.kyngs.librelogin.common.database.AuthenticUser;
import xyz.kyngs.librelogin.velocity.*;

/** Invoke the patched production profile handler: official UUID linkage must
 * never replace the storage identity, and offline profiles cannot create proof. */
public final class VerifiedProfileTest {
    static ReadWriteDatabaseProvider db;
    static final class Plugin extends VelocityLibreLogin {
        Plugin(){super(null);}
        protected PlatformHandle<Player,RegisteredServer> providePlatformHandle(){return null;}
        public ReadWriteDatabaseProvider getDatabaseProvider(){return db;}
        public boolean fromFloodgate(UUID id){return false;}
    }
    static Object stub(Class<?> c,InvocationHandler h){return java.lang.reflect.Proxy.newProxyInstance(c.getClassLoader(),new Class<?>[]{c},h);}
    static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
    public static void main(String[] args) {
        UUID storage=UUID.randomUUID(),official=UUID.randomUUID();int[] writes={0};User[] conflict={null};
        Timestamp now=new Timestamp(System.currentTimeMillis());
        User user=new AuthenticUser(storage,null,null,"TianYi",now,now,null,"127.0.0.1",null,null,null);
        db=(ReadWriteDatabaseProvider)stub(ReadWriteDatabaseProvider.class,(p,m,a)->switch(m.getName()){
            case "getByName"->user;case "getByPremiumUUID"->conflict[0];case "updateUser"->{writes[0]++;yield null;}default->null;});
        InboundConnection connection=(InboundConnection)stub(InboundConnection.class,(p,m,a)->m.getName().equals("getRemoteAddress")?new InetSocketAddress("127.0.0.1",30000):null);
        var listeners=new VelocityListeners(new Plugin());
        var offline=new GameProfileRequestEvent(connection,new GameProfile(official,"TianYi",List.of()),false);
        listeners.onProfileRequest(offline);
        check(user.getPremiumUUID()==null&&writes[0]==0,"offline UUID claim must not create premium linkage");
        check(offline.getGameProfile().getId().equals(storage),"offline mode keeps original storage UUID");
        var verified=new GameProfileRequestEvent(connection,new GameProfile(official,"TianYi",List.of()),true);
        listeners.onProfileRequest(verified);
        check(user.getPremiumUUID().equals(official)&&writes[0]==1,"verified official profile is linked");
        check(verified.getGameProfile().getId().equals(storage),"premium mode uses same original storage UUID");
        check(user.getHashedPassword()==null,"premium linkage must not create or overwrite a password");
        listeners.onProfileRequest(verified);check(writes[0]==1,"repeated profile handler does not rewrite linkage");
        conflict[0]=new AuthenticUser(UUID.randomUUID(),official,null,"DifferentName",now,now,null,"127.0.0.1",null,null,null);
        try {listeners.onProfileRequest(verified);throw new AssertionError("conflicting premium linkage accepted");}
        catch(IllegalStateException expected) {check(user.getUuid().equals(storage)&&writes[0]==1,"conflict cannot migrate storage or write an account");}
        System.out.println("PASS 7 actual dual-login profile handler checks; original storage UUID retained");
    }
}
