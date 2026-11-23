package dev.god.godvoice;
import com.google.gson.*;
import java.util.*;
public final class NpcDialoguePolicyTest {
    static int checks;
    static void check(boolean value){if(!value)throw new AssertionError("NPC dialogue check "+checks);checks++;}
    static void rejected(Runnable work){try{work.run();throw new AssertionError("expected rejection");}catch(IllegalArgumentException expected){checks++;}}

    public static void main(String[] args)throws Exception{
        NpcDialoguePolicy.validateConversationText("🐋".repeat(400));
        rejected(() -> NpcDialoguePolicy.validateConversationText("🐋".repeat(401)));
        rejected(() -> NpcDialoguePolicy.validateConversationText(""));
        rejected(() -> NpcDialoguePolicy.validateConversationText("抬头\n看"));
        rejected(() -> NpcDialoguePolicy.validateConversationText("§0input"));
        UUID a=UUID.randomUUID(),b=UUID.randomUUID(),world=UUID.randomUUID();
        JsonObject config=JsonParser.parseString("{\"schema\":1,\"roles\":[{\"id\":\""+a+"\",\"ownerId\":\""+b+"\",\"kind\":\"maid\",\"name\":\"结衣\",\"voice\":\"neko-yui-cn\",\"range\":24}]}").getAsJsonObject();
        check(NpcDialoguePolicy.profiles(config).get(a).owner().equals(b));
        JsonObject villagers=JsonParser.parseString("{\"schema\":1,\"roles\":[{\"id\":\""+a+"\",\"kind\":\"villager\",\"residentId\":\"qinghe\",\"name\":\"青禾\",\"voice\":\"qa\",\"range\":8}]}").getAsJsonObject();
        var farmer=NpcDialoguePolicy.profiles(villagers).get(a);
        check(farmer.owner()==null&&farmer.residentId().equals("qinghe")&&farmer.serviceCounter()==null);
        var guild=villagers.deepCopy();
        var counter=guild.getAsJsonArray("roles").get(0).getAsJsonObject();
        counter.addProperty("residentId","guild_receptionist");
        counter.addProperty("serviceCounter","guild-receptionist");
        var receptionist=NpcDialoguePolicy.profiles(guild).get(a);
        check(receptionist.id().equals(a)&&receptionist.residentId().equals("guild_receptionist")
                &&receptionist.serviceCounter().equals("guild-receptionist"));
        counter.addProperty("serviceCounter","guessed-counter");
        rejected(()->NpcDialoguePolicy.profiles(guild));
        counter.addProperty("serviceCounter",true);
        rejected(()->NpcDialoguePolicy.profiles(guild));
        var foreignCounter=config.deepCopy();
        foreignCounter.getAsJsonArray("roles").get(0).getAsJsonObject().addProperty("serviceCounter","guild-receptionist");
        rejected(()->NpcDialoguePolicy.profiles(foreignCounter));
        check(NpcDialoguePolicy.addressed(List.of(farmer),"青禾，你在忙什么？",true).profile().equals(farmer));
        var mixed=villagers.deepCopy();mixed.getAsJsonArray("roles").get(0).getAsJsonObject().addProperty("ownerId",b.toString());
        rejected(()->NpcDialoguePolicy.profiles(mixed));
        var unmarked=villagers.deepCopy();unmarked.getAsJsonArray("roles").get(0).getAsJsonObject().remove("residentId");
        rejected(()->NpcDialoguePolicy.profiles(unmarked));
        var duplicates=villagers.deepCopy();
        var sameResident=duplicates.getAsJsonArray("roles").get(0).getAsJsonObject().deepCopy();
        sameResident.addProperty("id",b.toString());sameResident.addProperty("name","阿渔");
        duplicates.getAsJsonArray("roles").add(sameResident);
        rejected(()->NpcDialoguePolicy.profiles(duplicates));
        var folder=java.nio.file.Files.createTempDirectory("resident-names");
        var activated=new com.google.gson.JsonObject();activated.addProperty("bodyId",a.toString());activated.addProperty("ownerGameId",b.toString());
        activated.addProperty("characterId",UUID.randomUUID().toString());activated.addProperty("bodyKind","maid");activated.addProperty("name","星野");
        var file=folder.resolve(a+".json");
        try{
            java.nio.file.Files.writeString(file,activated.toString());
            var registered=NpcDialoguePolicy.profiles(config);
            var profile=NpcDialoguePolicy.residentNames(registered,folder).get(a);
            check(profile.name().equals(registered.get(a).name())&&profile.voice().equals(registered.get(a).voice()));
            check(profile.display().equals("星野")&&NpcDialoguePolicy.addressed(List.of(profile),"星野，走吧",true).profile().id().equals(a));
            var conflicting=config.deepCopy();
            var other=conflicting.getAsJsonArray("roles").get(0).getAsJsonObject().deepCopy();
            other.addProperty("name","OtherSlot");other.addProperty("id",UUID.randomUUID().toString());
            other.add("spokenAliases",JsonParser.parseString("[\"星野\"]"));conflicting.getAsJsonArray("roles").add(other);
            check(!NpcDialoguePolicy.residentNames(NpcDialoguePolicy.profiles(conflicting),folder).get(a).hasName("星野"));
            activated.addProperty("ownerGameId",UUID.randomUUID().toString());java.nio.file.Files.writeString(file,activated.toString());
            check(!NpcDialoguePolicy.residentNames(registered,folder).get(a).hasName("星野"));
        }finally{java.nio.file.Files.deleteIfExists(file);java.nio.file.Files.deleteIfExists(folder);}
        var request=new com.google.gson.JsonObject();var answer=new com.google.gson.JsonObject();
        check("native".equals(NpcDialoguePolicy.replyMode(request,answer)));
        answer.addProperty("replyMode","speech");check(NpcDialoguePolicy.replyMode(request,answer)==null);
        request.add("replyModes",JsonParser.parseString("[\"native\",\"text\"]"));
        check(NpcDialoguePolicy.replyMode(request,answer)==null);
        answer.addProperty("replyMode","text");check("text".equals(NpcDialoguePolicy.replyMode(request,answer)));
        request.getAsJsonArray("replyModes").add("speech");answer.addProperty("replyMode","speech");
        check("speech".equals(NpcDialoguePolicy.replyMode(request,answer)));
        answer.addProperty("replyMode","public");check(NpcDialoguePolicy.replyMode(request,answer)==null);
        var duplicate=config.deepCopy();duplicate.getAsJsonArray("roles").add(duplicate.getAsJsonArray("roles").get(0).deepCopy());rejected(()->NpcDialoguePolicy.profiles(duplicate));
        var wrong=config.deepCopy();wrong.getAsJsonArray("roles").get(0).getAsJsonObject().addProperty("kind","player");rejected(()->NpcDialoguePolicy.profiles(wrong));
        var named=config.deepCopy();
        var first=named.getAsJsonArray("roles").get(0).getAsJsonObject();
        first.add("aliases",JsonParser.parseString("[\"Yui\"]"));
        var known=NpcDialoguePolicy.profiles(named).values();
        check(NpcDialoguePolicy.addressed(known,"结衣，你好！").text().equals("你好！"));
        check(NpcDialoguePolicy.addressed(known,"@yui hello").profile().id().equals(a));
        check(NpcDialoguePolicy.addressed(known,"结衣你要一起出门吗？").text().equals("你要一起出门吗？"));
        check(NpcDialoguePolicy.addressed(known,"我刚看见结衣")==null);
        check(NpcDialoguePolicy.addressed(known,"YuiSword 很好用")==null);
        var sword=new NpcDialoguePolicy.Profile(UUID.randomUUID(),b,"numen","Kirito","qa",24,List.of("桐人"));
        var spokenSword=new NpcDialoguePolicy.Profile(sword.id(),b,"numen","Kirito","qa",24,List.of("桐人"),List.of("同仁","同人"));
        var solo=List.of(spokenSword);
        check(NpcDialoguePolicy.addressed(solo,"同仁帮我打僵尸",true).text().equals("帮我打僵尸"));
        check(NpcDialoguePolicy.addressed(solo,"同人，在吗",true).profile()==spokenSword);
        check(NpcDialoguePolicy.addressed(solo,"桐人帮我打僵尸").profile()==spokenSword);
        for(String other:List.of("我在读同人小说","同仁堂有药卖","同人作品有哪些","请问同仁帮我了吗"))
            check(NpcDialoguePolicy.addressed(solo,other,true)==null);
        check(NpcDialoguePolicy.addressed(solo,"同仁帮我打僵尸")==null && !spokenSword.hasName("同仁") && spokenSword.display().equals("桐人"));
        var fish=new NpcDialoguePolicy.Profile(UUID.randomUUID(),b,"maid","肥鱼","qa",24,List.of("Feiyu"));
        var registered=List.of(sword,fish,known.iterator().next());
        var group=NpcDialoguePolicy.group(registered,"桐人、肥鱼，补给齐了，你们一起来开塔！");
        check(group.recipients().equals(List.of(sword,fish)) && group.message().equals("补给齐了，你们一起来开塔！"));
        check(NpcDialoguePolicy.group(registered,"@Feiyu、@kirito：走吧").recipients().equals(List.of(fish,sword)));
        check(NpcDialoguePolicy.group(registered,"结衣、桐人、肥鱼，集合").recipients().equals(List.of(registered.get(2),sword,fish)));
        check(NpcDialoguePolicy.group(registered,"桐人、Kirito、肥鱼，走吧").recipients().equals(List.of(sword,fish)));
        for(String words:List.of("我刚和桐人、肥鱼说过了","等桐人、肥鱼，一起开塔","“桐人、肥鱼，集合”","肥鱼，我们去找桐人、结衣",
                "桐人、路人，集合","桐人、，集合","桐人、肥鱼，","!桐人、肥鱼，集合","/msg 桐人、肥鱼 集合"))
            check(NpcDialoguePolicy.group(registered,words)==null);
        var second=first.deepCopy();
        second.addProperty("id",UUID.randomUUID().toString());
        second.addProperty("name","另一位居民");
        named.getAsJsonArray("roles").add(second);
        rejected(()->NpcDialoguePolicy.profiles(named));
        check(NpcDialoguePolicy.speechId(a,"original").equals(NpcDialoguePolicy.speechId(a,"original")));
        check(!NpcDialoguePolicy.speechId(a,"original").equals(NpcDialoguePolicy.speechId(b,"original")));
        rejected(()->NpcDialoguePolicy.speechId(a,""));rejected(()->NpcDialoguePolicy.text("fake\nidentity"));
        check(NpcDialoguePolicy.fresh(1000,16000));check(!NpcDialoguePolicy.fresh(1000,16001));check(!NpcDialoguePolicy.fresh(16001,16000));
        check(NpcDialoguePolicy.nearby(a,b,world,world,576,24));check(!NpcDialoguePolicy.nearby(a,b,world,world,577,24));
        check(!NpcDialoguePolicy.nearby(a,a,world,world,0,24));check(!NpcDialoguePolicy.nearby(a,b,world,UUID.randomUUID(),0,24));
        check(!NpcDialoguePolicy.nearby(a,b,world,world,Double.NaN,24));
        var seen=new NpcDialoguePolicy.Seen();check(seen.add(b,a,"original",1000));check(!seen.add(b,a,"original",2000));
        check(seen.add(UUID.randomUUID(),a,"original",2000));check(seen.add(b,a,"new",2000));
        var delivery=new NpcDialoguePolicy.Seen();int[] calls={0};
        check(delivery.deliver(b,a,"recoverable",1000,()->{calls[0]++;return false;})==NpcDialoguePolicy.Delivery.NOT_READY);
        check(delivery.deliver(b,a,"recoverable",1500,()->{calls[0]++;return null;})==NpcDialoguePolicy.Delivery.NOT_READY);
        check(delivery.deliver(b,a,"recoverable",2000,()->{calls[0]++;return true;})==NpcDialoguePolicy.Delivery.ACCEPTED);
        check(delivery.deliver(b,a,"recoverable",2500,()->{calls[0]++;return true;})==NpcDialoguePolicy.Delivery.ALREADY_SEEN);
        check(calls[0]==3); // readiness recovery uses the original input once, not a new event or another model request
        check(delivery.deliver(b,a,"uncertain",3000,()->{calls[0]++;throw new IllegalStateException("acceptance unknown");})==NpcDialoguePolicy.Delivery.UNKNOWN);
        check(delivery.deliver(b,a,"uncertain",3500,()->{calls[0]++;return true;})==NpcDialoguePolicy.Delivery.ALREADY_SEEN);
        check(calls[0]==4); // a callback exception is not replay permission
        check(delivery.deliver(UUID.randomUUID(),a,"recoverable",4000,()->true)==NpcDialoguePolicy.Delivery.ACCEPTED);
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
