package org.afuhome.auth;

import com.velocitypowered.api.event.command.CommandExecuteEvent;
import com.velocitypowered.api.proxy.*;
import com.velocitypowered.api.proxy.server.*;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import xyz.kyngs.librelogin.api.LibreLoginPlugin;

/** Real guard branches with an actual failing atomic destination, no copied policy. */
public final class AuthHeartbeatRecoveryTest {
    @SuppressWarnings("unchecked") public static void main(String[] args)throws Exception {
        AtomicBoolean granted=new AtomicBoolean(true);
        List<String> messages=new ArrayList<>();UUID id=UUID.randomUUID();
        var connection=(ServerConnection)AuthObservationTest.stub(ServerConnection.class,(m,a)->
            m.getName().equals("getServerInfo")?new ServerInfo("paper",new InetSocketAddress("127.0.0.1",25710)):AuthObservationTest.empty(m.getReturnType()));
        Player player=(Player)AuthObservationTest.stub(Player.class,(m,a)->switch(m.getName()) {
            case "getUniqueId"->id;case "getUsername"->"ag_RecoveryQA";case "isActive"->true;
            case "getCurrentServer"->Optional.of(connection);
            case "sendMessage"->{messages.add(PlainTextComponentSerializer.plainText().serialize((net.kyori.adventure.text.Component)a[0]));yield null;}
            default->AuthObservationTest.empty(m.getReturnType());
        });
        var libre=(LibreLoginPlugin<Player,RegisteredServer>)AuthObservationTest.stub(LibreLoginPlugin.class,(m,a)-> {
            if(m.getName().equals("getAuthorizationProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->n.getName().equals("isAuthorized")?granted.get():AuthObservationTest.empty(n.getReturnType()));
            if(m.getName().equals("getDatabaseProvider"))return AuthObservationTest.stub(m.getReturnType(),(n,b)->null);
            return AuthObservationTest.empty(m.getReturnType());
        });
        var server=(ProxyServer)AuthObservationTest.stub(ProxyServer.class,(m,a)->m.getName().equals("getAllPlayers")?List.of(player):AuthObservationTest.empty(m.getReturnType()));
        LoginGuard guard=new LoginGuard(server,null);AuthObservationTest.set(guard,"libre",libre);AuthObservationTest.set(guard,"ready",true);
        ((Set<Player>)AuthObservationTest.get(guard,"authenticated")).add(player);
        var directory=Files.createTempDirectory("auth-heartbeat-failure-");
        try {
            var destination=directory.resolve("heartbeat.json");Files.createDirectory(destination);Files.writeString(destination.resolve("occupied"),"fixture");
            AuthObservationTest.set(guard,"heartbeat",destination);guard.publishHeartbeat();
            AuthObservationTest.check((Boolean)AuthObservationTest.get(guard,"ready"),"observation write failure cannot revoke engine readiness");
            AuthObservationTest.check(guard.authenticationState(player).get("authorized").getAsBoolean(),"real engine remains authorized");
            var query=new CommandExecuteEvent(player,"mycli dungeon status undead_crypt");guard.command(query);
            AuthObservationTest.check(query.getResult().isAllowed(),"already authenticated read command passes despite disk observation failure");
            for(String alias:List.of("login","l","log")) {
                messages.clear();var recovery=new CommandExecuteEvent(player,alias+" never-log-this-secret");guard.command(recovery);
                AuthObservationTest.check(!recovery.getResult().isAllowed(),"already authorized recovery is intercepted");
                AuthObservationTest.check(messages.size()==1&&messages.getFirst().contains("MC_AUTH_STATE")&&messages.getFirst().contains("authenticated"),"recovery returns fresh authoritative state");
                AuthObservationTest.check(messages.stream().noneMatch(s->s.contains("never-log-this-secret")||s.contains("MC_AUTH_SUCCESS")),"no credential or duplicate initial success");
            }
            granted.set(false);messages.clear();query=new CommandExecuteEvent(player,"mycli dungeon status undead_crypt");guard.command(query);
            AuthObservationTest.check(!query.getResult().isAllowed()&&messages.getFirst().startsWith("[MC_AUTH_DENIED]"),"real authorization loss remains denied");
            var login=new CommandExecuteEvent(player,"login password");guard.command(login);
            AuthObservationTest.check(login.getResult().isAllowed(),"pending player still reaches original password verifier");
            AuthObservationTest.set(guard,"ready",false);messages.clear();query=new CommandExecuteEvent(player,"mycli status");guard.command(query);
            AuthObservationTest.check(!query.getResult().isAllowed()&&messages.getFirst().startsWith("[MC_AUTH_UNAVAILABLE]"),"provider outage remains closed and distinct from invalid session");
            AuthObservationTest.check(!guard.authenticationState(player).get("authorized").isJsonPrimitive(),"unavailable authorization is null, not a false claim");
        } finally {
            try(var paths=Files.walk(directory)){for(var path:paths.sorted(Comparator.reverseOrder()).toList())Files.delete(path);}
        }
        System.out.println("PASS "+AuthObservationTest.checks+" heartbeat failure and recovery cases");
    }
}
