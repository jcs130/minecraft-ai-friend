package dev.god.godvoice;

import com.google.gson.*;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.nio.file.*;
import java.util.*;
import java.util.function.Function;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;

/** Scoped text/ASR input for registered NPCs. No model, controller or new player connection. */
final class NpcConversations implements Listener {
    private final PaperVoicePlugin plugin;
    private final Map<UUID,NpcDialoguePolicy.Profile> profiles;
    private record Binding(Entity entity,Function<String,Boolean> input){}
    private record Generation(Entity entity,UUID world,UUID session){}
    private final Map<UUID,Binding> hosted=new HashMap<>();
    private final Map<UUID,Generation> generations=new HashMap<>();
    private final NpcDialoguePolicy.Seen delivered=new NpcDialoguePolicy.Seen();
    private long lastWarning;
    NpcConversations(PaperVoicePlugin plugin,Path file)throws Exception {
        this.plugin=plugin;profiles=Files.exists(file)?NpcDialoguePolicy.profiles(JsonParser.parseString(Files.readString(file)).getAsJsonObject()):Map.of();
        Bukkit.getPluginManager().registerEvents(this,plugin);
    }
    boolean configured(UUID id){return profiles.containsKey(id);}
    boolean enabled(){return !profiles.isEmpty();}
    NpcDialoguePolicy.Profile profile(UUID id){return profiles.get(id);}
    Collection<NpcDialoguePolicy.Profile> profiles(){return profiles.values();}
    NpcDialoguePolicy.Profile find(String key) {
        try { return profiles.get(UUID.fromString(key)); }
        catch (IllegalArgumentException name) {
            var matches = profiles.values().stream().filter(profile -> profile.name().equalsIgnoreCase(key)).toList();
            return matches.size() == 1 ? matches.getFirst() : null;
        }
    }
    boolean hears(Player player, Entity entity, NpcDialoguePolicy.Profile profile) {
        return entity != null && player.isOnline() && !player.isDead() && !player.isInvisible()
                && player.getGameMode() != GameMode.SPECTATOR && player.getWorld().equals(entity.getWorld())
                && player.canSee(entity)
                && NpcDialoguePolicy.nearby(player.getUniqueId(), entity.getUniqueId(), player.getWorld().getUID(),
                    entity.getWorld().getUID(), player.getLocation().distanceSquared(entity.getLocation()), profile.range());
    }
    Entity live(UUID id){
        var profile=profiles.get(id);if(profile==null)return null;
        Entity entity=Bukkit.getEntity(id);if(!(entity instanceof LivingEntity living)||living.isDead()||!living.isValid())return null;
        try{
            Object handle=entity.getClass().getMethod("getHandle").invoke(entity);
            String type=handle.getClass().getName();
            if(profile.kind().equals("numen")){
                if(!type.equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer")||!entity.getName().equals(profile.name()))return null;
                if(!profile.owner().equals(handle.getClass().getMethod("getOwnerUuid").invoke(handle)))return null;
            }else{
                if(!type.equals("com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid"))return null;
                if(!profile.owner().equals(handle.getClass().getMethod("getOwnerUUID").invoke(handle)))return null;
            }
            return entity;
        }catch(ReflectiveOperationException unavailable){return null;}
    }
    JsonArray catalogue(){
        var rows=new JsonArray();for(var p:profiles.values()){
            var row=new JsonObject();row.addProperty("id",p.id().toString());row.addProperty("ownerId",p.owner().toString());
            row.addProperty("kind",p.kind());row.addProperty("name",p.name());row.addProperty("voice",p.voice());row.addProperty("range",p.range());rows.add(row);
        }return rows;
    }
    boolean bind(UUID id,UUID owner,Function<String,Boolean> input){
        var p=profiles.get(id);Entity entity=live(id);
        if(p==null||!p.kind().equals("numen")||!p.owner().equals(owner)||entity==null||input==null)return false;
        hosted.put(id,new Binding(entity,input));return true;
    }
    void sample(Map<UUID,VoiceAudience.Actor> all){
        for(var p:profiles.values()){
            Entity entity=live(p.id());if(entity==null){generations.remove(p.id());hosted.remove(p.id());continue;}
            Location at=entity.getLocation();var generation=generations.get(p.id());
            if(generation==null||generation.entity()!=entity||!generation.world().equals(at.getWorld().getUID())){
                generation=new Generation(entity,at.getWorld().getUID(),UUID.randomUUID());generations.put(p.id(),generation);
            }
            // A hosted player already has its real connection generation in the snapshot.
            var existing=all.get(p.id());
            all.put(p.id(),new VoiceAudience.Actor(p.id(),existing==null?generation.session():existing.session(),generation.world(),at.getX(),at.getY(),at.getZ(),p.name(),true,p.range(),p.kind().equals("maid")?p.owner():null,Math.min(8,p.range())));
        }
    }
    void voice(UUID actor,UUID world,UUID utterance,long occurredAt,String text,Set<UUID> audience){
        Player source=Bukkit.getPlayer(actor);
        if(source==null||source.isDead()||source.isInvisible()||source.getGameMode()==GameMode.SPECTATOR||!source.getWorld().getUID().equals(world))return;
        if(System.currentTimeMillis()-occurredAt>120_000||occurredAt>System.currentTimeMillis())return;
        for(UUID target:audience)deliver(source,target,"voice_"+utterance,text,"voice",occurredAt);
    }
    void said(UUID actor,String operation,String text,long occurredAt){
        Entity source=live(actor);if(source==null||!NpcDialoguePolicy.fresh(occurredAt,System.currentTimeMillis()))return;
        NpcDialoguePolicy.text(text);String event="npc_"+NpcDialoguePolicy.speechId(actor,operation);
        for(UUID target:profiles.keySet())deliver(source,target,event,text,"npc_chat",occurredAt);
    }
    private boolean deliver(Entity source,UUID target,String event,String text,String channel,long occurredAt){
        var profile=profiles.get(target);Entity entity=live(target);
        if(profile==null||entity==null||!source.getWorld().equals(entity.getWorld())||!NpcDialoguePolicy.nearby(source.getUniqueId(),target,source.getWorld().getUID(),entity.getWorld().getUID(),source.getLocation().distanceSquared(entity.getLocation()),profile.range()))return false;
        // Preserve existing maid partner (24) / visitor (8) speech boundaries.
        if(channel.equals("voice")&&profile.kind().equals("maid")&&!source.getUniqueId().equals(profile.owner())&&source.getLocation().distanceSquared(entity.getLocation())>64)return false;
        if(source instanceof Player player&&!player.canSee(entity))return false;
        try{NpcDialoguePolicy.text(text);}catch(IllegalArgumentException invalid){return false;}
        if(!delivered.add(target,source.getUniqueId(),event,System.currentTimeMillis()))return false;
        String id="qdvoice:"+source.getUniqueId()+":"+event;
        try{
            if(profile.kind().equals("maid")){
                var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");if(bridge==null||!bridge.isEnabled())return false;
                return Boolean.TRUE.equals(bridge.getClass().getMethod("acceptUnifiedNpcDialogue",UUID.class,UUID.class,UUID.class,String.class,String.class,String.class)
                    .invoke(bridge,target,profile.owner(),source.getUniqueId(),source.getName(),text,id));
            }else{
                var binding=hosted.get(target);if(binding==null||binding.entity()!=entity)return false;
                var payload=new JsonObject();payload.addProperty("schema",1);payload.addProperty("eventId",id);payload.addProperty("listenerId",target.toString());
                payload.addProperty("speakerId",source.getUniqueId().toString());payload.addProperty("speaker",source.getName());payload.addProperty("text",text);
                payload.addProperty("channel",channel);payload.addProperty("occurredAt",occurredAt);payload.addProperty("receivedAt",System.currentTimeMillis());
                payload.addProperty("deliveryScope","nearby");
                payload.addProperty("speakerKind",profiles.containsKey(source.getUniqueId())?"npc":"player");payload.addProperty("trusted",false);
                if(Boolean.TRUE.equals(binding.input().apply(payload.toString())))return true;
                warn();return false;
            }
        }catch(Exception failed){warn();return false;}
    }
    private void warn(){long now=System.nanoTime();if(now-lastWarning>30_000_000_000L){lastWarning=now;plugin.getLogger().warning("NPC dialogue could not be delivered; no action or automatic replay was attempted");}}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void chat(AsyncChatEvent event){
        Player actor=event.getPlayer();String original=PlainTextComponentSerializer.plainText().serialize(event.originalMessage());
        String text=PlainTextComponentSerializer.plainText().serialize(event.message());Set<UUID> recipients=new HashSet<>();
        for(var viewer:event.viewers())if(viewer instanceof Player p)recipients.add(p.getUniqueId());
        UUID input=UUID.randomUUID();long at=System.currentTimeMillis();
        Bukkit.getScheduler().runTask(plugin,()->{
            if(Bukkit.getPlayer(actor.getUniqueId())!=actor||actor.isDead()||actor.isInvisible()||actor.getGameMode()==GameMode.SPECTATOR||!local(actor,original))return;
            // Maids already receive their native local-chat path; do not duplicate it.
            for(var p:profiles.values())if(p.kind().equals("numen")&&recipients.contains(p.id()))deliver(actor,p.id(),"chat_"+input,text,"chat",at);
        });
    }
    private boolean local(Player actor,String text){
        var essentials=Bukkit.getPluginManager().getPlugin("Essentials");var chat=Bukkit.getPluginManager().getPlugin("EssentialsChat");
        if(essentials==null||chat==null||!essentials.isEnabled()||!chat.isEnabled())return false;
        try{
            Object settings=essentials.getClass().getMethod("getSettings").invoke(essentials);
            int radius=((Number)settings.getClass().getMethod("getChatRadius").invoke(settings)).intValue();
            char shout=(Character)settings.getClass().getMethod("getChatShout").invoke(settings);
            Object user=essentials.getClass().getMethod("getUser",Player.class).invoke(essentials,actor);
            return radius>0&&!text.stripLeading().startsWith(String.valueOf(shout))&&!(Boolean)user.getClass().getMethod("isToggleShout").invoke(user);
        }catch(Exception unknown){return false;}
    }
}
