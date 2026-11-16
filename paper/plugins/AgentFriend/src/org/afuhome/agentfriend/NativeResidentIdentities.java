package org.afuhome.agentfriend;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Optional native residents. Does not make arbitrary never-seen player UUIDs trustable. */
final class NativeResidentIdentities {
    static Map<UUID,String> all(){
        var result=new LinkedHashMap<UUID,String>();
        try{
            Object raw=Class.forName("local.qdj.maids.brain.MaidAgentsMod").getMethod("residentIdentities").invoke(null);
            if(raw instanceof Map<?,?> rows&&rows.size()<=24)for(var e:rows.entrySet())
                if(e.getKey() instanceof UUID id&&e.getValue() instanceof String name&&!name.isBlank()&&name.length()<=48&&!name.codePoints().anyMatch(Character::isISOControl))result.put(id,name);
        }catch(ReflectiveOperationException|LinkageError ignored){}
        return Map.copyOf(result);
    }
}
