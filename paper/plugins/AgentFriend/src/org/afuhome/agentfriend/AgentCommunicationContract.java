package org.afuhome.agentfriend;

import java.util.*;

/** Data-only observations. Does not select recipients, dispatch chat or grant permissions. */
final class AgentCommunicationContract {
    static Map<String,Object> chatPolicy(String provider, String version, int radius, char shout,
                                         boolean shoutDefault, boolean persistShout) {
        var out=new LinkedHashMap<String,Object>();
        out.put("schema","agent-mc/chat-policy/v1");out.put("provider",provider);out.put("providerVersion",version);
        out.put("defaultChannel",persistShout?"unknown":shoutDefault||radius<=0?"server":"nearby");
        out.put("nearby",Map.of("scope","same-world-range","radius",radius));
        out.put("shout",Map.of("prefix",String.valueOf(shout),"scope","server"));
        out.put("private",Map.of("command","/msg <player> <text>","scope","single-recipient"));
        out.put("mentionsExpandScope",false);out.put("deliveryAcknowledged",false);
        return out;
    }
    static boolean castable(String id,String command) {
        String prefix="/mycli cast "+id;
        return command.equals(prefix)||command.startsWith(prefix+" ");
    }
    static Map<String,Object> invocation(String id,String command) {
        return Map.of("kind",castable(id,command)?"cast":"command","command",command);
    }
    static String invocationRevision(Map<String,String> commands) {
        String text=commands.entrySet().stream().sorted(Map.Entry.comparingByKey())
            .map(row->row.getKey()+"\t"+row.getValue()).collect(java.util.stream.Collectors.joining("\n"));
        try{return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
            .digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8))).substring(0,16);}
        catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
}
