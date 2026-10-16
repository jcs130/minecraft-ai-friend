package org.agentmc.bridge;
import java.util.*;

/** Optional plugin evidence. Never handles credentials or infers authorization from position. */
public final class ServerAuthorization {
    public static Map<String,Object> evaluate(List<Map<String,Object>> providers, boolean requiredByClient,
            String username, String server, int generation) {
        Map<String,Object> selected=null;int required=0;
        for(Map<String,Object> p:providers)if(Boolean.TRUE.equals(p.get("required"))){selected=p;required++;}
        boolean needs=requiredByClient||required>0;
        Map<String,Object> out=new LinkedHashMap<>();out.put("protocol","agent-mc-server-authorization/v1");
        out.put("required",needs);out.put("generation",generation);out.put("observedAt",java.time.Instant.now().toString());
        out.put("phase",needs?"unknown":"disabled");out.put("authorized",null);out.put("connectionMatched",false);
        if(required>1){out.put("phase","ambiguous");return out;}
        if(!needs||selected==null)return out;
        if(!"agent-mc-server-authorization/v1".equals(selected.get("protocol"))
          ||!Objects.equals(username,selected.get("username"))||!address(server).equals(address(String.valueOf(selected.get("server")))) )return out;
        boolean matched=Boolean.TRUE.equals(selected.get("connectionMatched"));
        String phase=String.valueOf(selected.get("phase"));
        if(!Set.of("armed","submitted","confirmed","required","blocked","unknown").contains(phase))phase="unknown";
        out.put("username",username);out.put("server",server);out.put("phase",matched?phase:"unknown");out.put("connectionMatched",matched);
        out.put("authorized",matched&&selected.get("authorized") instanceof Boolean
            ?Boolean.TRUE.equals(selected.get("authorized"))&&phase.equals("confirmed"):null);
        if(selected.get("confirmedAt") instanceof String at&&at.length()<80)out.put("confirmedAt",at);
        return out;
    }
    public static boolean ready(Map<String,Object> evidence){return !Boolean.TRUE.equals(evidence.get("required"))
        ||Boolean.TRUE.equals(evidence.get("authorized"))&&Boolean.TRUE.equals(evidence.get("connectionMatched"))&&"confirmed".equals(evidence.get("phase"));}
    private static String address(String value){return value.toLowerCase(Locale.ROOT).replaceAll(":25565$","");}
}
