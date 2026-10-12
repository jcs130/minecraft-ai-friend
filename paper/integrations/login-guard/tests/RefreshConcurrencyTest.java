import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
import java.net.InetSocketAddress;
import org.slf4j.Logger;
import org.afuhome.auth.LoginGuard;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import xyz.kyngs.librelogin.api.database.User;
import xyz.kyngs.librelogin.api.event.EventProvider;

/** Exercise the real refresh method under initialization/scheduler overlap.
 * No server, credentials, network or production files are used. */
public final class RefreshConcurrencyTest {
    interface Call { Object invoke(Object p, Method m, Object[] a) throws Throwable; }
    static Object stub(Class<?> type, Call call) {
        return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(p,m,a)->{
            if(m.getName().equals("toString"))return "test-stub";
            if(m.getName().equals("hashCode"))return System.identityHashCode(p);
            if(m.getName().equals("equals"))return p==a[0];
            return call.invoke(p,m,a);
        });
    }
    static Object empty(Class<?> type) {
        if(type==boolean.class)return false;if(type==int.class)return 0;
        if(type==long.class)return 0L;return null;
    }
    static void set(Object target,String name,Object value)throws Exception {
        Field f=LoginGuard.class.getDeclaredField(name);f.setAccessible(true);f.set(target,value);
    }
    public static void main(String[] args)throws Exception {
        Path dir=Path.of(args[0]);Files.createDirectories(dir);Path ops=dir.resolve("ops.json");Files.writeString(ops,"[]");
        String authHost=args.length>1?args[1]:"127.0.0.1";boolean expectedReady=authHost.equals("127.0.0.1");
        AtomicInteger subscriptions=new AtomicInteger();
        Object user=stub(User.class,(p,m,a)->m.getName().equals("isRegistered")?true:empty(m.getReturnType()));
        Object events=stub(EventProvider.class,(p,m,a)->{
            if(m.isDefault())return InvocationHandler.invokeDefault(p,m,a);
            if(m.getName().equals("subscribe")){subscriptions.incrementAndGet();Thread.sleep(20);return a[1];}
            return empty(m.getReturnType());
        });
        Object libre=stub(LibreLoginPlugin.class,(p,m,a)->{
            if(m.getName().equals("getEventProvider"))return events;
            if(m.getName().equals("getDatabaseProvider"))return stub(m.getReturnType(),(x,n,b)->{
                if(n.getName().equals("getByName")){Thread.sleep(2);return user;}return empty(n.getReturnType());
            });
            if(m.getName().equals("getAuthorizationProvider")||m.getName().equals("getDefaultCryptoProvider"))
                return stub(m.getReturnType(),(x,n,b)->empty(n.getReturnType()));
            return empty(m.getReturnType());
        });
        ProxyServer server=(ProxyServer)stub(ProxyServer.class,(p,m,a)->{
            if(m.getName().equals("getServer"))return Optional.of(stub(RegisteredServer.class,(x,n,b)->n.getName().equals("getServerInfo")?new ServerInfo("auth",new InetSocketAddress(authHost,25587)):empty(n.getReturnType())));
            if(m.getName().equals("getCommandManager"))return stub(m.getReturnType(),(x,n,b)->n.getName().equals("hasCommand")?true:empty(n.getReturnType()));
            if(m.getName().equals("getAllPlayers"))return List.of();
            return empty(m.getReturnType());
        });
        Logger logger=(Logger)stub(Logger.class,(p,m,a)->empty(m.getReturnType()));
        LoginGuard guard=new LoginGuard(server,logger);set(guard,"libre",libre);set(guard,"opsFile",ops);set(guard,"heartbeat",dir.resolve("auth-heartbeat.json"));
        Method refresh=LoginGuard.class.getDeclaredMethod("refresh");refresh.setAccessible(true);
        ExecutorService pool=Executors.newFixedThreadPool(16);CountDownLatch start=new CountDownLatch(1);List<Future<?>> jobs=new ArrayList<>();
        for(int i=0;i<64;i++)jobs.add(pool.submit(()->{try{start.await();refresh.invoke(guard);}catch(Exception e){throw new RuntimeException(e);}}));
        start.countDown();for(Future<?> job:jobs)job.get();pool.shutdown();
        int expected=expectedReady?3:0;
        if(subscriptions.get()!=expected)throw new AssertionError("Expected "+expected+" subscriptions; got "+subscriptions.get());
        String health=Files.readString(dir.resolve("auth-heartbeat.json"));
        if(!health.contains("\"ready\":"+expectedReady))throw new AssertionError("Unexpected readiness for auth host "+authHost);
        System.out.println(expectedReady?"PASS concurrent initialization installs authentication handlers once and keeps health ready":"PASS wildcard authentication endpoint fails closed");
    }
}
