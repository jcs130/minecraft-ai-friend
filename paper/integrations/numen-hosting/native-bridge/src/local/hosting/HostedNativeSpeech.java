package local.hosting;

import com.google.gson.*;
import java.util.*;
import java.util.function.Function;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Uses Numen's actual speech outbox and inbox; never starts a second controller. */
final class HostedNativeSpeech {
    private static final String API="com.dwinovo.numen.hosted.api.brain.";
    private static final LinkedHashSet<String> seen=new LinkedHashSet<>();
    private static final Set<ClassLoader> registered=Collections.newSetFromMap(new WeakHashMap<>());
    private static long lastWarning;
    private HostedNativeSpeech(){}
    static void tick(MinecraftServer server){
        if(server.getTickCount()%5!=0)return;
        try{
            Class<?> bukkit=Class.forName("org.bukkit.Bukkit");Object manager=bukkit.getMethod("getPluginManager").invoke(null);
            Object voice=manager.getClass().getMethod("getPlugin",String.class).invoke(manager,"QiandengVoice");
            if(voice==null||!Boolean.TRUE.equals(voice.getClass().getMethod("isEnabled").invoke(voice)))return;
            var roles=JsonParser.parseString((String)voice.getClass().getMethod("npcVoiceProfiles").invoke(voice)).getAsJsonArray();
            for(var value:roles){
                var role=value.getAsJsonObject();if(!"numen".equals(role.get("kind").getAsString()))continue;
                UUID id=UUID.fromString(role.get("id").getAsString()),owner=UUID.fromString(role.get("ownerId").getAsString());
                ServerPlayer body=server.getPlayerList().getPlayer(id);
                if(body==null||!body.isAlive()||!body.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer")||!owner.equals(body.getClass().getMethod("getOwnerUuid").invoke(body)))continue;
                ClassLoader loader=body.getClass().getClassLoader();
                if(!registered.contains(loader)){
                    Class<?> types=loader.loadClass("com.dwinovo.numen.hosted.api.agent.inbox.EventTypes");
                    Object type=types.getMethod("event",String.class,boolean.class).invoke(null,"qd_npc_dialogue",false);
                    types.getMethod("register",type.getClass()).invoke(null,type);registered.add(loader);
                }
                Function<String,Boolean> input=payload->{
                    if(!server.isSameThread()||server.getPlayerList().getPlayer(id)!=body||!body.isAlive())return false;
                    try{
                        var loop=(Optional<?>)loader.loadClass(API+"CompanionLoops").getMethod("get",UUID.class).invoke(null,id);
                        if(loop.isEmpty())return false;
                        // Use the registered native inbox type with the raw structured
                        // payload. submitEvent wraps text in XML and loses this envelope.
                        Object inbox=loop.get().getClass().getMethod("inbox").invoke(loop.get());
                        inbox.getClass().getMethod("push",String.class,String.class,long.class,boolean.class)
                            .invoke(inbox,"qd_npc_dialogue",payload,System.currentTimeMillis(),false);
                        return true;
                    }catch(ReflectiveOperationException unavailable){return false;}
                };
                if(!Boolean.TRUE.equals(voice.getClass().getMethod("bindHostedNpcVoice",UUID.class,UUID.class,Function.class).invoke(voice,id,owner,input)))continue;
                var outbox=(JsonArray)loader.loadClass(API+"HostedSpeech").getMethod("read",UUID.class).invoke(null,id);
                for(var entry:outbox){
                    var speech=entry.getAsJsonObject();String event=speech.get("id").getAsString(),key=id+"/"+event;
                    if(!seen.add(key))continue;
                    while(seen.size()>4096)seen.remove(seen.iterator().next());
                    long at=speech.get("createdAt").getAsLong(),now=System.currentTimeMillis();
                    if(at>now||now-at>15_000)continue;
                    // Mark the original event before invoking the transport. Unknown outcomes are queried, never replayed.
                    voice.getClass().getMethod("speakHostedNpc",UUID.class,UUID.class,String.class,String.class,long.class)
                        .invoke(voice,id,owner,event,speech.get("body").getAsString(),at);
                }
            }
        }catch(ClassNotFoundException|NoSuchMethodException absent){/* Optional voice service on a hybrid server. */}
        catch(Exception failure){long now=System.nanoTime();if(now-lastWarning>30_000_000_000L){lastWarning=now;org.slf4j.LoggerFactory.getLogger("QiandengjiHostedVoice").warn("Native speech bridge unavailable; original speech is not replayed ({})",failure.getClass().getSimpleName());}}
    }
}
