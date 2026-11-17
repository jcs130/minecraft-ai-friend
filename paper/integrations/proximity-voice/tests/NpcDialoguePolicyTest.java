package dev.god.godvoice;
import com.google.gson.*;
import java.util.*;
public final class NpcDialoguePolicyTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("NPC dialogue check "+checks);checks++;}
    static void rejected(Runnable work){try{work.run();throw new AssertionError("expected rejection");}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        UUID a=UUID.randomUUID(),b=UUID.randomUUID(),world=UUID.randomUUID();
        JsonObject config=JsonParser.parseString("{\"schema\":1,\"roles\":[{\"id\":\""+a+"\",\"ownerId\":\""+b+"\",\"kind\":\"maid\",\"name\":\"结衣\",\"voice\":\"neko-yui-cn\",\"range\":24}]}").getAsJsonObject();
        check(NpcDialoguePolicy.profiles(config).get(a).owner().equals(b));
        var duplicate=config.deepCopy();duplicate.getAsJsonArray("roles").add(duplicate.getAsJsonArray("roles").get(0).deepCopy());rejected(()->NpcDialoguePolicy.profiles(duplicate));
        var wrong=config.deepCopy();wrong.getAsJsonArray("roles").get(0).getAsJsonObject().addProperty("kind","player");rejected(()->NpcDialoguePolicy.profiles(wrong));
        check(NpcDialoguePolicy.speechId(a,"original").equals(NpcDialoguePolicy.speechId(a,"original")));
        check(!NpcDialoguePolicy.speechId(a,"original").equals(NpcDialoguePolicy.speechId(b,"original")));
        rejected(()->NpcDialoguePolicy.speechId(a,""));rejected(()->NpcDialoguePolicy.text("fake\nidentity"));
        check(NpcDialoguePolicy.fresh(1000,16000));check(!NpcDialoguePolicy.fresh(1000,16001));check(!NpcDialoguePolicy.fresh(16001,16000));
        check(NpcDialoguePolicy.nearby(a,b,world,world,576,24));check(!NpcDialoguePolicy.nearby(a,b,world,world,577,24));
        check(!NpcDialoguePolicy.nearby(a,a,world,world,0,24));check(!NpcDialoguePolicy.nearby(a,b,world,UUID.randomUUID(),0,24));
        check(!NpcDialoguePolicy.nearby(a,b,world,world,Double.NaN,24));
        var seen=new NpcDialoguePolicy.Seen();check(seen.add(b,a,"original",1000));check(!seen.add(b,a,"original",2000));
        check(seen.add(UUID.randomUUID(),a,"original",2000));check(seen.add(b,a,"new",2000));
        UUID session=UUID.randomUUID();
        var source=new VoiceAudience.Actor(a,session,world,0,80,0,"human",true);
        var distant=new VoiceAudience.Actor(b,session,world,30,80,0,"npc",true,24);
        var close=new VoiceAudience.Actor(b,session,world,2,80,0,"npc",true,24);
        var window=new VoiceAudience.Window();window.observe(new VoiceAudience.Snapshot(1000,Map.of(a,source,b,distant)),a,48,1000);
        window.observe(new VoiceAudience.Snapshot(1100,Map.of(a,source,b,close)),a,48,1100);
        check(!window.finish().containsKey(b)); // Arriving after speech began is not hearing the whole utterance.
        window=new VoiceAudience.Window();window.observe(new VoiceAudience.Snapshot(1000,Map.of(a,source,b,close)),a,48,1000);
        check(window.finish().containsKey(b));
        window.observe(new VoiceAudience.Snapshot(1100,Map.of(a,source,b,distant)),a,48,1100);check(!window.finish().containsKey(b));
        var maid=new VoiceAudience.Actor(b,session,world,16,80,0,"maid",true,24,UUID.randomUUID(),8);
        window=new VoiceAudience.Window();window.observe(new VoiceAudience.Snapshot(1000,Map.of(a,source,b,maid)),a,48,1000);check(!window.finish().containsKey(b));
        maid=new VoiceAudience.Actor(b,session,world,16,80,0,"maid",true,24,a,8);
        window=new VoiceAudience.Window();window.observe(new VoiceAudience.Snapshot(1000,Map.of(a,source,b,maid)),a,48,1000);check(window.finish().containsKey(b));
        System.out.println("NPC dialogue boundaries: "+checks+" checks passed");
    }
}
