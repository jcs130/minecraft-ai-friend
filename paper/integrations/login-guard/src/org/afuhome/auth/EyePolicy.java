package org.afuhome.auth;

import com.google.gson.JsonParser;
import java.util.*;

/** Uses the gateway's existing registry. A suffix alone never grants a session:
 * LoginGuard also requires the paired body to be authenticated in Paper. */
public final class EyePolicy {
    private final Map<String,String> pairs;
    private final Set<String> agents,free;
    private final boolean automatic;
    private static String key(String s){return s.toLowerCase(Locale.ROOT);}
    private static String name(String s){if(!s.matches("[A-Za-z0-9_]{1,16}"))throw new IllegalArgumentException("Invalid Eye name");return s;}
    public EyePolicy(String json) {
        var root=JsonParser.parseString(json).getAsJsonObject();
        if(root.get("schemaVersion").getAsInt()!=1 || !root.has("pairs") || root.getAsJsonArray("pairs").size()>16)throw new IllegalArgumentException("Invalid Eye registry");
        pairs=new HashMap<>();agents=new HashSet<>();free=new HashSet<>();
        automatic=(!root.has("autoNameEyes")||root.get("autoNameEyes").getAsBoolean())
            &&(!root.has("autoOnlineAgentEyes")||root.get("autoOnlineAgentEyes").getAsBoolean())
            &&(!root.has("autoSameSourceEyes")||root.get("autoSameSourceEyes").getAsBoolean());
        for(var row:root.getAsJsonArray("pairs")) {
            var r=row.getAsJsonObject();String agent=name(r.get("agent").getAsString()),eye=name(r.has("eye")?r.get("eye").getAsString():agent+"_eye");
            if(key(agent).equals(key(eye))||key(agent).equals("goddess")||key(eye).equals("goddess")||!agents.add(key(agent))||pairs.put(key(eye),agent)!=null)throw new IllegalArgumentException("Conflicting Eye pair");
        }
        for(String agent:agents)if(pairs.containsKey(agent))throw new IllegalArgumentException("Chained Eye pair");
        if(root.has("freeObservers"))for(var n:root.getAsJsonArray("freeObservers"))free.add(key(name(n.getAsString())));
        else free.add("live");
    }
    public String body(String eye,Set<String> reserved) {
        String n=key(eye);
        if(reserved.contains(n)||free.contains(n)||agents.contains(n))return null;
        if(pairs.containsKey(n))return pairs.get(n);
        if(!automatic || !eye.matches("[A-Za-z0-9_]{1,16}"))return null;
        String base=eye.replaceFirst("(?i)_?eye$","");
        if(base.equals(eye)||base.isEmpty()||key(base).endsWith("eye")||reserved.contains(key(base))||pairs.containsKey(key(base))||key(base).equals("goddess"))return null;
        return base;
    }
}
