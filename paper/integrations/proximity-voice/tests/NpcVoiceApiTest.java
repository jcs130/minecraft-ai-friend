package dev.god.godvoice;
import java.lang.reflect.Proxy;
import java.nio.file.*;
import java.util.*;
import java.util.function.Function;
import org.bukkit.*;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
/** Runtime ABI regression against either the deployed or candidate JAR. */
public final class NpcVoiceApiTest {
    private static void check(boolean allowed) {
        if (!allowed) throw new AssertionError("private dialogue policy");
    }

    public interface MessagingUser {
        boolean isIgnoreMsg();
    }

    public record TestUser(boolean isMuted, boolean isIgnoreMsg, MessagingUser ignored) implements MessagingUser {
        public boolean isIgnoredPlayer(MessagingUser sender) { return sender == ignored; }
    }

    public record TestEssentials(Player speaker, TestUser sender, Player recipient, TestUser receiver) {
        public MessagingUser getUser(Player player) {
            if (player == speaker) return sender;
            return player == recipient ? receiver : null;
        }
    }

    private static Player player(boolean online, boolean canSee) {
        return (Player) Proxy.newProxyInstance(NpcDialoguePolicyTest.class.getClassLoader(), new Class<?>[]{Player.class},
            (source, method, args) -> switch (method.getName()) {
                case "isOnline" -> online;
                case "canSee" -> {
                    check(method.getParameterTypes()[0] == Player.class);
                    yield canSee;
                }
                default -> throw new AssertionError(method.getName());
            });
    }

    private static void privateDialogueChecks() throws ReflectiveOperationException {
        var speaker = player(true, true);
        var recipient = player(true, true);
        var inaccessible = player(true, false);
        var offline = player(false, true);
        var maid = (Entity) Proxy.newProxyInstance(NpcDialoguePolicyTest.class.getClassLoader(), new Class<?>[]{Entity.class},
            (source, method, args) -> { throw new AssertionError(method.getName()); });
        check(NpcConversations.privateMessageAllowed(speaker, recipient, null));
        check(!NpcConversations.privateMessageAllowed(inaccessible, recipient, null));
        check(!NpcConversations.privateMessageAllowed(offline, recipient, null));
        check(NpcConversations.privateMessageAllowed(inaccessible, maid, null));

        var talking = new TestUser(false, false, null);
        var muted = new TestUser(true, false, null);
        var ignoringDms = new TestUser(false, true, null);
        var ignoringSpeaker = new TestUser(false, false, talking);
        check(NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, talking),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, muted, recipient, talking),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, ignoringDms),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, ignoringSpeaker),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, null),
            MessagingUser.class, speaker, recipient));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, null, recipient, talking),
            MessagingUser.class, speaker, recipient));
        check(NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, talking, recipient, null),
            MessagingUser.class, speaker, null));
        check(!NpcConversations.essentialsPrivateMessageAllowed(new TestEssentials(speaker, muted, recipient, null),
            MessagingUser.class, speaker, null));
    }

    private static int nearbyChecks;
    private static void nearbyCheck(boolean allowed){nearbyCheck(allowed,"");}
    private static void nearbyCheck(boolean allowed,String detail){
        if(!allowed)throw new AssertionError("nearby villager check "+nearbyChecks+": "+detail);nearbyChecks++;
    }
    private static void nearbyRejected(ThrowingRunnable action){
        try{action.run();throw new AssertionError("expected nearby rejection");}catch(IllegalArgumentException expected){nearbyChecks++;}
        catch(Exception failure){throw new AssertionError(failure);}
    }
    @FunctionalInterface private interface ThrowingRunnable { void run()throws Exception; }
    private static void nearbySpeechChecks()throws Exception{
        UUID actor=UUID.randomUUID(),listener=UUID.randomUUID(),worldId=UUID.randomUUID();
        var profile=new NpcDialoguePolicy.Profile(actor,null,"villager","青禾","qa",8,List.of());
        nearbyCheck(profile.kind().equals("villager")&&profile.residentId()==null);
        nearbyRejected(()->NpcDialoguePolicy.profiles(com.google.gson.JsonParser.parseString(
                "{\"schema\":1,\"roles\":[{\"id\":\""+actor+"\",\"kind\":\"villager\",\"name\":\"青禾\",\"voice\":\"qa\"}]}").getAsJsonObject()));
        var operation="nearby-operation";var request=NpcDialoguePolicy.speechId(actor,operation);var text="你好，附近的朋友。";
        String fingerprint=NpcConversations.nearbyFingerprint(profile.voice(),text);
        Path root=Files.createTempDirectory("villager-nearby-");
        try{
            var ledger=new VoiceLedger(root);
            nearbyCheck(ledger.get(actor,request)==null);
            nearbyCheck(ledger.reserve(actor,request,fingerprint));
            ledger.transition(actor,request,fingerprint,"queued","");
            nearbyCheck(!ledger.reserve(actor,request,fingerprint));
            nearbyRejected(()->ledger.reserve(actor,request,NpcConversations.nearbyFingerprint(profile.voice(),"冲突文本")));
            var recovered=new VoiceLedger(root);
            nearbyCheck(recovered.get(actor,request).state().equals("unknown"));
            nearbyCheck(!recovered.reserve(actor,request,fingerprint));
            ledger.transition(actor,request,fingerprint,"sent","");
            nearbyCheck(new VoiceLedger(root).get(actor,request).state().equals("sent"));
        }finally{
            try(var files=Files.list(root)){for(Path file:files.toList())Files.delete(file);}Files.delete(root);
        }
        nearbyCheck(NpcDialoguePolicy.fresh(1000,16000));
        nearbyCheck(!NpcDialoguePolicy.fresh(1000,16001)&&!NpcDialoguePolicy.fresh(16001,16000));
        var body=(Entity)java.lang.reflect.Proxy.newProxyInstance(NpcVoiceApiTest.class.getClassLoader(),new Class<?>[]{Entity.class},(o,m,a)->null);
        var binding=new NpcConversations.Binding(body,ignored->true,100L);
        nearbyCheck(binding.current(body,100L+NpcConversations.BINDING_NANOS-1));
        nearbyCheck(!binding.current(body,100L+NpcConversations.BINDING_NANOS));
        var foreign=(Entity)java.lang.reflect.Proxy.newProxyInstance(NpcVoiceApiTest.class.getClassLoader(),new Class<?>[]{Entity.class},(o,m,a)->null);
        nearbyCheck(!binding.current(foreign,101L));
        UUID source=actor,target=listener;
        nearbyCheck(NpcDialoguePolicy.nearby(source,target,worldId,worldId,64,8));
        nearbyCheck(!NpcDialoguePolicy.nearby(source,target,worldId,worldId,65,8));
        nearbyCheck(!NpcDialoguePolicy.nearby(source,target,worldId,UUID.randomUUID(),64,8));
        nearbyCheck(!NpcDialoguePolicy.nearby(source,source,worldId,worldId,0,8));
        var empty=java.util.Collections.<UUID,Player>emptyMap();
        nearbyCheck(empty.isEmpty());
        boolean[] state={true,false,false,false,true,true,true};
        World world=(World)Proxy.newProxyInstance(NpcVoiceApiTest.class.getClassLoader(),new Class<?>[]{World.class},(o,m,a)->{
            if(m.getName().equals("equals"))return o==a[0];
            if(m.getName().equals("hashCode"))return System.identityHashCode(o);
            if(m.getName().equals("toString"))return "test-world";
            return switch(m.getName()){case "getUID"->worldId;default->throw new AssertionError(m.getName());};
        });
        Location location=new Location(world,0,64,0);
        Entity villagerBody=(Entity)Proxy.newProxyInstance(NpcVoiceApiTest.class.getClassLoader(),new Class<?>[]{Entity.class},(o,m,a)->switch(m.getName()){
            case "getUniqueId"->source;case "getWorld"->world;case "getLocation"->location;
            default->throw new AssertionError(m.getName());});
        Player nearby=(Player)Proxy.newProxyInstance(NpcVoiceApiTest.class.getClassLoader(),new Class<?>[]{Player.class},(o,m,a)->switch(m.getName()){
            case "getUniqueId"->target;case "isOnline"->state[0];case "isDead"->state[1];case "isInvisible"->state[2];
            case "getGameMode"->state[3]?GameMode.SPECTATOR:GameMode.SURVIVAL;case "getWorld"->state[4]?world:null;
            case "canSee"->state[5];case "hasLineOfSight"->state[6];case "getLocation"->new Location(world,1,64,0);
            default->throw new AssertionError(m.getName());});
        nearbyCheck(!NpcConversations.hearsNearbyListener(nearby,villagerBody,
                new NpcDialoguePolicy.Profile(actor,null,"villager","青禾","qa",0.5,List.of())));
        nearbyCheck(NpcConversations.hearsNearbyListener(nearby,villagerBody,profile));
        nearbyCheck(!NpcConversations.hearsNearbyListener(nearby,null,profile));
        for(int index=0;index<state.length;index++){
            boolean prior=state[index];state[index]=!prior;
            nearbyCheck(!NpcConversations.hearsNearbyListener(nearby,villagerBody,profile));
            state[index]=prior;
        }
        nearbyCheck(!empty.containsValue(nearby));
        Entity maid=(Entity)Proxy.newProxyInstance(NpcVoiceApiTest.class.getClassLoader(),new Class<?>[]{Entity.class},(o,m,a)->switch(m.getName()){
            case "getUniqueId"->source;case "getWorld"->world;case "getLocation"->new Location(world,16,64,0);
            case "isValid"->true;case "isDead","isInvisible"->false;
            default->throw new AssertionError(m.getName());});
        var ownerProfile=new NpcDialoguePolicy.Profile(source,target,"maid","QA Maid","qa",24,List.of());
        var visitorProfile=new NpcDialoguePolicy.Profile(source,UUID.randomUUID(),"maid","QA Maid","qa",24,List.of());
        nearbyCheck(NpcConversations.hearsAsrListener(nearby,maid,ownerProfile,24));
        nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,visitorProfile,24));
        nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,ownerProfile,8));
        nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,null,24));
        nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,ownerProfile,Double.NaN));
        nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,ownerProfile,0));
        nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,profile,24));
        for(int index=0;index<state.length;index++){
            boolean prior=state[index];state[index]=!prior;
            nearbyCheck(!NpcConversations.hearsAsrListener(nearby,maid,ownerProfile,24));
            state[index]=prior;
        }
    }

    public static void main(String[] args)throws Exception{
        privateDialogueChecks();
        nearbySpeechChecks();
        Class<?> plugin=Class.forName("dev.god.godvoice.PaperVoicePlugin");
        plugin.getMethod("npcVoiceProfiles");
        plugin.getMethod("bindHostedNpcVoice",UUID.class,UUID.class,Function.class);
        if (plugin.getMethod("queueHostedPrivateConversation",UUID.class,UUID.class,String.class).getReturnType() != String.class)
            throw new AssertionError("hosted private conversation receipt ABI");
        if (plugin.getMethod("queueNpcPrivateConversation",UUID.class,UUID.class,String.class).getReturnType() != String.class)
            throw new AssertionError("maid private conversation receipt ABI");
        plugin.getMethod("publishNpcSpeech",UUID.class,String.class,String.class,long.class);
        plugin.getMethod("speakHostedNpc",UUID.class,UUID.class,String.class,String.class,long.class);
        plugin.getMethod("npcSpeechStatus",UUID.class,String.class);
        plugin.getMethod("bindVillagerNpcVoice",org.bukkit.plugin.Plugin.class,UUID.class,Function.class);
        plugin.getMethod("nearbyVillagerAudience",org.bukkit.plugin.Plugin.class,UUID.class);
        plugin.getMethod("speakVillagerReply",org.bukkit.plugin.Plugin.class,UUID.class,UUID.class,String.class,String.class);
        plugin.getMethod("speakVillagerReply",org.bukkit.plugin.Plugin.class,UUID.class,UUID.class,String.class,String.class,boolean.class);
        plugin.getMethod("speakVillagerNearby",org.bukkit.plugin.Plugin.class,UUID.class,String.class,String.class,long.class);
        plugin.getMethod("finishVillagerPrivateReply",org.bukkit.plugin.Plugin.class,UUID.class,UUID.class,String.class,String.class);
        plugin.getMethod("recordManagedVillagerReply",org.bukkit.plugin.Plugin.class,UUID.class,UUID.class,String.class,String.class,int.class,String.class);
        var original=(org.bukkit.entity.Entity)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Entity.class},(o,m,a)->null);
        var binding=new NpcConversations.Binding(original,text->true,100L);
        if(!binding.current(original,100L+NpcConversations.BINDING_NANOS-1))throw new AssertionError("quiet live binding");
        if(binding.current(null,101L))throw new AssertionError("stale body generation");
        if(binding.current(original,100L+NpcConversations.BINDING_NANOS))throw new AssertionError("lost heartbeat");
        var speaker=(org.bukkit.entity.Player)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Player.class},(o,m,a)->null);
        var world=UUID.randomUUID();
        var turn=new NpcConversations.VillagerTurn(original,speaker,world,binding.generation(),1000,false);
        if(!turn.current(original,speaker,world,binding.generation(),1000))throw new AssertionError("valid original turn");
        if(turn.current(original,speaker,world,UUID.randomUUID(),999))throw new AssertionError("rebind cannot inherit old dialogue");
        if(turn.current(original,null,world,binding.generation(),999))throw new AssertionError("listener disconnected");
        if(turn.current(original,speaker,UUID.randomUUID(),binding.generation(),999))throw new AssertionError("dimension changed");
        if(turn.current(original,speaker,world,binding.generation(),1001))throw new AssertionError("reply expired");
        var privateTurn=new NpcConversations.VillagerTurn(original,speaker,world,binding.generation(),1000,true);
        var rejoined=(org.bukkit.entity.Player)java.lang.reflect.Proxy.newProxyInstance(plugin.getClassLoader(),
            new Class<?>[]{org.bukkit.entity.Player.class},(o,m,a)->null);
        if(!privateTurn.direct() || !privateTurn.current(original,speaker,world,binding.generation(),995))
            throw new AssertionError("private turn with original listener");
        if(privateTurn.current(original,rejoined,world,binding.generation(),995))throw new AssertionError("reconnected listener");
        System.out.println("NPC voice runtime ABI, liveness and private dialogue: 34 checks passed; nearby villager: "+nearbyChecks+" checks passed");
    }
}
