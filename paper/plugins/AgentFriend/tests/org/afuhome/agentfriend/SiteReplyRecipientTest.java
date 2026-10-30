package org.afuhome.agentfriend;

import com.google.gson.*;
import java.lang.reflect.*;
import java.util.*;
import org.bukkit.entity.Player;
import sun.misc.Unsafe;

/** Calls the real wire serializer without a live world or gameplay actions. */
public final class SiteReplyRecipientTest {
    private static int checks;
    private static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;}
    public static void main(String[] args)throws Exception{
        var unsafeField=Unsafe.class.getDeclaredField("theUnsafe");unsafeField.setAccessible(true);
        var unsafe=(Unsafe)unsafeField.get(null);var owner=SiteDungeonManager.class;
        Object manager=unsafe.allocateInstance(owner);
        var sites=owner.getDeclaredField("sites");sites.setAccessible(true);sites.set(manager,Map.of());
        var output=owner.getDeclaredField("jsonOutput");output.setAccessible(true);output.set(manager,ThreadLocal.withInitial(()->true));
        var send=owner.getDeclaredMethod("send",Player.class,String.class,Map.class);send.setAccessible(true);
        for(String name:List.of("ag_ReplyAlice","ag_ReplyBob")){
            var messages=new ArrayList<String>();
            Player player=(Player)Proxy.newProxyInstance(owner.getClassLoader(),new Class<?>[]{Player.class},(p,m,a)->{
                if(m.getName().equals("getName"))return name;
                if(m.getName().equals("sendMessage")&&a[0] instanceof String value){messages.add(value);return null;}
                throw new UnsupportedOperationException(m.getName());
            });
            for(String prefix:List.of("MC_SITE_DUNGEON_STATE","MC_SITE_DUNGEON_INFO","MC_SITE_DUNGEON_RESULT")){
                var fields=new LinkedHashMap<String,Object>();fields.put("id","unknown_qa_site");fields.put("custom",Map.of("count",3));
                send.invoke(manager,player,prefix,fields);
                String line=messages.getLast();check(line.startsWith(prefix+" "),"wire type retained");
                var data=JsonParser.parseString(line.substring(prefix.length()+1)).getAsJsonObject();
                check(data.has("recipient")&&data.get("recipient").getAsString().equals(name),"reply bound to actual recipient");
                check(data.get("id").getAsString().equals("unknown_qa_site")&&data.getAsJsonObject("custom").get("count").getAsInt()==3,"original fields retained");
                check(data.get("commandRoot").getAsString().equals("/mycli dungeon")&&data.get("activityType").getAsString().equals("site_dungeon"),"routing contract retained");
                check(!fields.containsKey("recipient"),"serializer does not add fields to caller map");
                fields.put("recipient","forged_other_player");send.invoke(manager,player,prefix,fields);
                data=JsonParser.parseString(messages.getLast().substring(prefix.length()+1)).getAsJsonObject();
                check(data.get("recipient").getAsString().equals(name),"supplied recipient cannot override actual receiver");
                check(fields.get("recipient").equals("forged_other_player"),"caller map remains unmodified");
            }
        }
        System.out.println("SiteReplyRecipientTest: "+checks+" passed");
    }
}
