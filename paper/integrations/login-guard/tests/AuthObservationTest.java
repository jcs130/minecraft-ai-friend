package org.afuhome.auth;

import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.event.command.CommandExecuteEvent;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;
import java.lang.reflect.*;
import java.net.InetSocketAddress;
import java.util.*;

/** Read-side observations cannot authorize a player or disclose credential records. */
public final class AuthObservationTest {
    static int checks;
    interface Call {Object apply(Method method,Object[] args)throws Throwable;}
    static Object stub(Class<?> type,Call call){return Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(p,m,a)->{
        if(m.getName().equals("hashCode"))return System.identityHashCode(p);
        if(m.getName().equals("equals"))return p==a[0];return call.apply(m,a);
    });}
    static Object empty(Class<?> type){return type==boolean.class?false:type==int.class?0:type==long.class?0L:null;}
    static void set(LoginGuard guard,String key,Object value)throws Exception {Field f=LoginGuard.class.getDeclaredField(key);f.setAccessible(true);f.set(guard,value);}
    static Object get(LoginGuard guard,String key)throws Exception {Field f=LoginGuard.class.getDeclaredField(key);f.setAccessible(true);return f.get(guard);}
    static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
    @SuppressWarnings("unchecked") public static void main(String[] args)throws Exception {
        UUID uuid=UUID.randomUUID();List<String> messages=new ArrayList<>();
        Player p=(Player)stub(Player.class,(m,a)->switch(m.getName()) {
            case "getUniqueId"->uuid;case "getUsername"->"ag_AuthTest";case "isActive"->true;
            case "getRemoteAddress"->new InetSocketAddress("127.0.0.1",31234);
            case "getCurrentServer"->Optional.empty();case "sendMessage"->{messages.add(Arrays.toString(a));yield null;}
            default->empty(m.getReturnType());
        });
        var libre=(LibreLoginPlugin<Player,RegisteredServer>)stub(LibreLoginPlugin.class,(m,a)->{
            if(m.getName().equals("getDatabaseProvider"))return stub(m.getReturnType(),(n,b)->n.getName().equals("getByName")?null:empty(n.getReturnType()));
            if(m.getName().equals("getAuthorizationProvider"))return stub(m.getReturnType(),(n,b)->n.getName().equals("isAuthorized")?true:empty(n.getReturnType()));
            return empty(m.getReturnType());
        });
        LoginGuard guard=new LoginGuard(null,null);set(guard,"libre",libre);set(guard,"ready",true);
        var first=guard.authenticationState(p);check(first.get("status").getAsString().equals("pending")&&!first.get("authorized").getAsBoolean(),"query does not authorize");
        check(guard.authenticationState(p).get("authSessionId").equals(first.get("authSessionId")),"stable connection observation ID");
        CommandExecuteEvent query=new CommandExecuteEvent(p,"authstatus");guard.command(query);
        check(!query.getResult().isAllowed()&&messages.stream().anyMatch(s->s.contains("MC_AUTH_STATE")),"proxy handles authstatus before backend without gameplay action");
        check(((Set<Player>)get(guard,"authenticated")).isEmpty(),"authstatus cannot bypass login");
        CommandExecuteEvent action=new CommandExecuteEvent(p,"mycli cast fireworks");guard.command(action);
        check(!action.getResult().isAllowed(),"unauthenticated custom command still denied");
        ((Set<Player>)get(guard,"authenticated")).add(p);var loggedIn=guard.authenticationState(p);
        check(loggedIn.get("authorized").getAsBoolean()&&loggedIn.get("status").getAsString().equals("authenticated"),"existing authorization observed");
        check(!loggedIn.toString().contains("hashedPassword")&&!loggedIn.toString().contains("secret"),"credential fields absent");
        set(guard,"ready",false);var unavailable=guard.authenticationState(p);
        check(unavailable.get("status").getAsString().equals("unavailable")&&unavailable.get("authorized").isJsonNull(),"service unavailable unknown rather than logged out");
        String serialized=((com.google.gson.Gson)get(guard,"gson")).toJson(Map.of("sessionStates",List.of(unavailable)));
        check(serialized.contains("\"authorized\":null"),"atomic heartbeat preserves explicit unknown values");
        guard.disconnected(new DisconnectEvent(p,DisconnectEvent.LoginStatus.SUCCESSFUL_LOGIN));
        check(!guard.authenticationState(p).get("authSessionId").equals(first.get("authSessionId")),"disconnect clears observation session");
        check(((Set<Player>)get(guard,"authenticated")).isEmpty(),"disconnect preserves authorization cleanup");
        System.out.println("PASS "+checks+" auth observation/read-only boundary cases");
    }
}
