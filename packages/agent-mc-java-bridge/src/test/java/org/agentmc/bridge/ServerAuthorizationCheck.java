package org.agentmc.bridge;
import java.util.*;
public final class ServerAuthorizationCheck {
    private static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
    public static void main(String[] args){
        Map<String,Object> p=new HashMap<>(Map.of("protocol","agent-mc-server-authorization/v1","required",true,"connectionMatched",true,"username","Agent","server","EXAMPLE.test:25565","phase","confirmed","authorized",true,"password","must-not-escape"));
        var proof=ServerAuthorization.evaluate(List.of(p),false,"Agent","example.test",42);
        check(ServerAuthorization.ready(proof),"confirmed current transport ready");
        check(proof.get("generation").equals(42)&&!proof.containsKey("password"),"allowlisted public evidence only");
        check(!ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(p),false,"Other","example.test",42)),"account mismatch");
        check(!ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(p),false,"Agent","other.test",42)),"server mismatch");
        check(!ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(p,p),false,"Agent","example.test",42)),"ambiguous provider");
        p.put("phase","submitted");check(!ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(p),false,"Agent","example.test",42)),"pending is not confirmed even with stale true");
        p.put("phase","confirmed");p.put("connectionMatched",false);check(!ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(p),false,"Agent","example.test",42)),"old transport");
        check(!ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(),true,"Agent","example.test",42)),"required missing provider unknown");
        check(ServerAuthorization.ready(ServerAuthorization.evaluate(List.of(),false,"Agent","example.test",42)),"generic server compatible");
        System.out.println("ServerAuthorizationCheck: scoped proof, ambiguity, pending/revoked state, generic compatibility and metadata allowlist passed");
    }
}
