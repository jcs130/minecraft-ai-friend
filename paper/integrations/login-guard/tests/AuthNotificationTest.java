package org.afuhome.auth;

import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.server.*;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import xyz.kyngs.librelogin.api.database.User;
import java.lang.reflect.*;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Exercise the real delayed delivery method, including concurrent refresh/join. */
public final class AuthNotificationTest {
    @SuppressWarnings("unchecked") public static void main(String[] args)throws Exception {
        AtomicBoolean granted=new AtomicBoolean(false),paper=new AtomicBoolean(false);
        List<String> messages=new CopyOnWriteArrayList<>();UUID uuid=UUID.randomUUID();
        ServerConnection connection=(ServerConnection)AuthObservationTest.stub(ServerConnection.class,(m,a)->
            m.getName().equals("getServerInfo")?new ServerInfo(paper.get()?"paper":"auth",new InetSocketAddress("127.0.0.1",25710)):AuthObservationTest.empty(m.getReturnType()));
        Player p=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()){
            case "getUniqueId"->uuid;case "getUsername"->"ag_NotifyTest";case "isActive"->true;
            case "getRemoteAddress"->new InetSocketAddress("127.0.0.1",31234);
            case "getCurrentServer"->Optional.of(connection);
            case "sendMessage"->{messages.add(Arrays.toString(a));yield null;}
            default->AuthObservationTest.empty(m.getReturnType());
        });
        LibreLoginPlugin<Player,RegisteredServer> libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)->{
            if(m.getName().equals("getDatabaseProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->null);
            if(m.getName().equals("getAuthorizationProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->n.getName().equals("isAuthorized")?granted.get():AuthObservationTest.empty(n.getReturnType()));
            return AuthObservationTest.empty(m.getReturnType());
        });
        LoginGuard guard=new LoginGuard(null,null);AuthObservationTest.set(guard,"libre",libre);
        Set<Player> authorized=(Set<Player>)AuthObservationTest.get(guard,"authenticated");authorized.add(p);
        Method notify=LoginGuard.class.getDeclaredMethod("notifyAuthenticated",Player.class);notify.setAccessible(true);
        notify.invoke(guard,p);AuthObservationTest.check(messages.isEmpty(),"unavailable cannot emit success");
        AuthObservationTest.set(guard,"ready",true);paper.set(true);notify.invoke(guard,p);
        AuthObservationTest.check(messages.isEmpty(),"pending authentication cannot emit success");
        granted.set(true);paper.set(false);notify.invoke(guard,p);
        AuthObservationTest.check(messages.isEmpty(),"authenticated limbo is not a ready game session");
        paper.set(true);ExecutorService pool=Executors.newFixedThreadPool(8);List<Future<?>> jobs=new ArrayList<>();
        for(int i=0;i<64;i++)jobs.add(pool.submit(()->{try{notify.invoke(guard,p);}catch(Exception e){throw new RuntimeException(e);}}));
        for(Future<?> job:jobs)job.get();pool.shutdown();
        AuthObservationTest.check(messages.stream().filter(s->s.contains("[MC_AUTH_SUCCESS]")).count()==1,"deferred actual success delivered once");
        AuthObservationTest.check(messages.stream().filter(s->s.contains("MC_AUTH_STATE")&&s.contains("authenticated")&&s.contains("authorized")).count()==1,"matching accurate state delivered once");
        AuthObservationTest.check(authorized.size()==1&&authorized.contains(p),"delivery does not grant or alter authorization");
        guard.disconnected(new DisconnectEvent(p,DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));
        AuthObservationTest.check(((Set<?>)AuthObservationTest.get(guard,"authenticationNotified")).isEmpty(),"disconnect removes notification session");
        AuthObservationTest.check(!authorized.contains(p),"normal authorization cleanup retained");
        verifyPasswordReminders();
        System.out.println("PASS "+AuthObservationTest.checks+" delayed success/concurrent/session cases");
    }

    @SuppressWarnings("unchecked")
    private static void verifyPasswordReminders() throws Exception {
        List<String> messages = new ArrayList<>();
        AtomicBoolean online = new AtomicBoolean(true), granted = new AtomicBoolean(true), paper = new AtomicBoolean(true);
        var address = new InetSocketAddress("127.0.0.1", 31235);
        UUID storage = UUID.randomUUID(), premium = UUID.randomUUID();
        var connection = (ServerConnection) AuthObservationTest.stub(ServerConnection.class, (m, a) ->
            m.getName().equals("getServerInfo") ? new ServerInfo(paper.get() ? "paper" : "auth", address) : null);
        Player player = (Player) AuthObservationTest.stub(Player.class, (m, a) -> switch (m.getName()) {
            case "getUsername" -> "VerifiedPlayer";
            case "getUniqueId" -> storage;
            case "getRemoteAddress" -> address;
            case "getCurrentServer" -> Optional.of(connection);
            case "isOnlineMode" -> online.get();
            case "sendMessage" -> { messages.add(Arrays.toString(a)); yield null; }
            default -> AuthObservationTest.empty(m.getReturnType());
        });
        ProxyServer proxy = (ProxyServer) AuthObservationTest.stub(ProxyServer.class,
            (m, a) -> m.getName().equals("getAllPlayers") ? List.of(player) : null);
        Object user = AuthObservationTest.stub(User.class, (m, a) ->
            m.getName().equals("getPremiumUUID") ? premium : AuthObservationTest.empty(m.getReturnType()));
        Object libre = AuthObservationTest.stub(LibreLoginPlugin.class, (m, a) -> switch (m.getName()) {
            case "getDatabaseProvider" -> AuthObservationTest.stub(m.getReturnType(),
                (n, b) -> n.getName().equals("getByName") ? user : AuthObservationTest.empty(n.getReturnType()));
            case "getAuthorizationProvider" -> AuthObservationTest.stub(m.getReturnType(), (n, b) -> switch (n.getName()) {
                case "isAuthorized" -> granted.get();
                case "authorize" -> { granted.set(true); yield AuthObservationTest.empty(n.getReturnType()); }
                default -> AuthObservationTest.empty(n.getReturnType());
            });
            default -> AuthObservationTest.empty(m.getReturnType());
        });
        LoginGuard guard = new LoginGuard(proxy, null);
        AuthObservationTest.set(guard, "libre", libre);
        AuthObservationTest.set(guard, "ready", true);
        ((Set<Player>) AuthObservationTest.get(guard, "authenticated")).add(player);
        ((Map<InetSocketAddress, UUID>) AuthObservationTest.get(guard, "premiumProofs")).put(address, premium);
        var refresh = LoginGuard.class.getDeclaredMethod("refreshFirstPasswords");
        refresh.setAccessible(true);
        refresh.invoke(guard);
        AuthObservationTest.check(messages.isEmpty(), "a verified Microsoft login never receives the offline password reminder");
        var firstVisits = (Set<Player>) AuthObservationTest.get(guard, "firstPasswordSessions");
        granted.set(false);
        paper.set(false);
        refresh.invoke(guard);
        AuthObservationTest.check(!granted.get() && firstVisits.isEmpty(), "pending official authentication stays outside first-visit admission");
        online.set(false);
        refresh.invoke(guard);
        AuthObservationTest.check(granted.get() && firstVisits.contains(player) && messages.isEmpty(), "an ordinary offline first visit can enter the game");
        paper.set(true);
        refresh.invoke(guard);
        refresh.invoke(guard);
        AuthObservationTest.check(messages.size() == 1 && messages.getFirst().contains("MC_AUTH_PASSWORD_SETUP"), "only the offline first visit receives a rate-limited reminder");
    }
}
