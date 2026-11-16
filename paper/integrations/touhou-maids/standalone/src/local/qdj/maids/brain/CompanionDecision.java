package local.qdj.maids.brain;

import com.google.gson.JsonParser;
import java.util.Set;
import java.util.UUID;

/** Native dialogue is structured content, never a permission to invoke arbitrary tools. */
record CompanionDecision(String reply, String action, String targetNpc, String spokenReply) {
    static CompanionDecision parse(String text, boolean social) {
        try {
            if (text == null || text.length() > 8192) throw new IllegalArgumentException();
            var object = JsonParser.parseString(text).getAsJsonObject();
            if (!Set.of("reply", "action", "targetNpc", "spokenReply").containsAll(object.keySet()) ||
                    !object.has("reply") || !object.has("action")) throw new IllegalArgumentException();
            for (String key : Set.of("reply", "action")) if (!object.get(key).isJsonPrimitive() ||
                    !object.getAsJsonPrimitive(key).isString()) throw new IllegalArgumentException();
            String reply = object.get("reply").getAsString(), action = object.get("action").getAsString();
            if (reply.isBlank() || reply.codePointCount(0, reply.length()) > 140 || reply.contains("---") ||
                    reply.codePoints().anyMatch(Character::isISOControl) ||
                    !Set.of("talk", "decline", "join", "follow", "stay", "work", "dismiss", "invite", "talk_to").contains(action))
                throw new IllegalArgumentException();
            boolean directed = Set.of("invite", "talk_to").contains(action);
            String target = null;
            if (object.has("targetNpc") && !object.get("targetNpc").isJsonNull()) {
                if (!object.get("targetNpc").isJsonPrimitive() || !object.getAsJsonPrimitive("targetNpc").isString())
                    throw new IllegalArgumentException();
                target = object.get("targetNpc").getAsString();
                if (!UUID.fromString(target).toString().equals(target)) throw new IllegalArgumentException();
            }
            if (directed != (target != null) || directed && !social) throw new IllegalArgumentException();
            String spoken=null;
            if(object.has("spokenReply")&&!object.get("spokenReply").isJsonNull()){
                var value=object.get("spokenReply");
                if(!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString())throw new IllegalArgumentException();
                spoken=value.getAsString();
                if(spoken.isBlank()||spoken.codePointCount(0,spoken.length())>200||spoken.contains("---")||spoken.codePoints().anyMatch(Character::isISOControl))throw new IllegalArgumentException();
            }
            return new CompanionDecision(reply, action, target, spoken);
        } catch (RuntimeException bad) { throw new IllegalArgumentException("invalid_npc_decision"); }
    }
}
