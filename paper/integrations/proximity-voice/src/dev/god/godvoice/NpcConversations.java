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
import org.bukkit.event.player.PlayerInteractAtEntityEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.persistence.PersistentDataType;

/** Scoped text/ASR input for registered NPCs. No model, controller or new player connection. */
final class NpcConversations implements Listener {
    private final PaperVoicePlugin plugin;
    private volatile Map<UUID,NpcDialoguePolicy.Profile> profiles;
    // The native speech adapter renews every five game ticks, including during silence.
    static final long BINDING_NANOS = java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
    record Binding(Entity entity,Function<String,Boolean> input,long renewedAt,UUID generation){
        Binding(Entity entity,Function<String,Boolean> input,long renewedAt){
            this(entity,input,renewedAt,UUID.randomUUID());
        }
        boolean current(Entity original,long now){return original==entity && now-renewedAt < BINDING_NANOS;}
    }
    private record Generation(Entity entity,UUID world,UUID session){}
    record VillagerTurn(Entity body, Player speaker, UUID world, UUID generation, long expiresAt, boolean direct){
        boolean current(Entity entity,Player player,UUID dimension,UUID binding,long now){
            return body==entity&&speaker==player&&world.equals(dimension)&&generation.equals(binding)&&now<=expiresAt;
        }
    }
    private static final NamespacedKey VILLAGER_ID=Objects.requireNonNull(NamespacedKey.fromString("qiandeng-villager-quests:resident-id"));
    private final Map<String,VillagerTurn> villagerTurns=new LinkedHashMap<>();
    private final Map<UUID,Binding> hosted=new HashMap<>();
    private final Map<UUID,Generation> generations=new HashMap<>();
    private final NpcDialoguePolicy.Seen delivered=new NpcDialoguePolicy.Seen();
    private static final Set<String> CLOSINGS=Set.of("好","好的","嗯","嗯嗯","收到","明白了","知道了","谢谢","谢谢你","辛苦了","再见","拜拜","回头聊");
    private long lastWarning;
    NpcConversations(PaperVoicePlugin plugin,Path file)throws Exception {
        this.plugin=plugin;
        Map<UUID,NpcDialoguePolicy.Profile> configured=Files.exists(file)?NpcDialoguePolicy.profiles(JsonParser.parseString(Files.readString(file)).getAsJsonObject()):Map.of();
        profiles=configured;
        if(!configured.isEmpty()){
            Path names=file.resolveSibling("resident-names");
            Bukkit.getScheduler().runTaskTimerAsynchronously(plugin,()->profiles=NpcDialoguePolicy.residentNames(configured,names),1,100);
        }
        Bukkit.getPluginManager().registerEvents(this,plugin);
    }
    boolean configured(UUID id){return profiles.containsKey(id);}
    boolean enabled(){return !profiles.isEmpty();}
    NpcDialoguePolicy.Profile profile(UUID id){return profiles.get(id);}
    Collection<NpcDialoguePolicy.Profile> profiles(){return profiles.values();}
    NpcDialoguePolicy.Profile find(String key) {
        try { return profiles.get(UUID.fromString(key)); }
        catch (IllegalArgumentException name) {
            var matches = profiles.values().stream().filter(profile -> profile.hasName(key)).toList();
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
        if(profile.kind().equals("villager"))return entity instanceof Villager villager
                && villager.hasAI() && !villager.isInvisible()
                && profile.residentId().equals(villager.getPersistentDataContainer().get(VILLAGER_ID,PersistentDataType.STRING))?villager:null;
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
            var row=new JsonObject();row.addProperty("id",p.id().toString());
            if(p.owner()!=null)row.addProperty("ownerId",p.owner().toString());
            if(p.residentId()!=null)row.addProperty("residentId",p.residentId());
            row.addProperty("kind",p.kind());row.addProperty("name",p.name());row.addProperty("displayName",p.display());row.addProperty("voice",p.voice());row.addProperty("range",p.range());rows.add(row);
        }return rows;
    }
    boolean bind(UUID id,UUID owner,Function<String,Boolean> input){
        var p=profiles.get(id);Entity entity=live(id);
        if(p==null||!p.kind().equals("numen")||!p.owner().equals(owner)||entity==null||input==null)return false;
        // The adapter also ticks while its controller is starting. Require an actual inbox.
        try {
            var handle=entity.getClass().getMethod("getHandle").invoke(entity);
            var loops=handle.getClass().getClassLoader().loadClass("com.dwinovo.numen.hosted.api.brain.CompanionLoops");
            if(!((Optional<?>)loops.getMethod("get",UUID.class).invoke(null,id)).isPresent()){
                hosted.remove(id);return false;
            }
        } catch(ReflectiveOperationException unavailable){hosted.remove(id);return false;}
        hosted.put(id,new Binding(entity,input,System.nanoTime()));return true;
    }
    boolean hostedReady(Entity entity){
        if(entity==null)return false;
        var binding=hosted.get(entity.getUniqueId());
        return binding!=null && binding.current(entity,System.nanoTime()) && entity.isValid() && !entity.isDead();
    }
    boolean bindVillager(UUID id,Function<String,Boolean> input){
        var profile=profiles.get(id);
        Entity body=live(id);
        if(profile==null||!profile.kind().equals("villager")||body==null||input==null)return false;
        long now=System.nanoTime();
        var prior=hosted.get(id);
        if(prior!=null&&prior.current(body,now))hosted.put(id,new Binding(body,input,now,prior.generation()));
        else hosted.put(id,new Binding(body,input,now));
        return true;
    }
    Player villagerListener(UUID id,UUID listener,String event){
        var profile=profiles.get(id);
        var turn=villagerTurns.get(event);
        var body=live(id);
        var player=Bukkit.getPlayer(listener);
        var binding=hosted.get(id);
        if(profile==null||!profile.kind().equals("villager")||turn==null||body==null||player==null
                ||binding==null||!binding.current(body,System.nanoTime())
                ||!turn.current(body,player,body.getWorld().getUID(),binding.generation(),System.currentTimeMillis())
                ||(turn.direct() ? !player.isOnline() || player.isDead() || !player.canSee(body)
                                 : !hears(player,body,profile)||!player.hasLineOfSight(body)))return null;
        return player;
    }
    boolean privateVillagerTurn(UUID actor,UUID listener,String event){
        var turn=villagerTurns.get(event);
        return turn!=null&&turn.direct()&&villagerListener(actor,listener,event)!=null;
    }
    void disconnected(Player player){
        var binding=hosted.get(player.getUniqueId());
        if(binding!=null && binding.entity()==player)hosted.remove(player.getUniqueId());
    }
    void sample(Map<UUID,VoiceAudience.Actor> all){
        for(var p:profiles.values()){
            Entity entity=live(p.id());if(entity==null){generations.remove(p.id());hosted.remove(p.id());continue;}
            if(p.residentId()!=null&&!hostedReady(entity)){generations.remove(p.id());continue;}
            Location at=entity.getLocation();var generation=generations.get(p.id());
            if(generation==null||generation.entity()!=entity||!generation.world().equals(at.getWorld().getUID())){
                generation=new Generation(entity,at.getWorld().getUID(),UUID.randomUUID());generations.put(p.id(),generation);
            }
            // A hosted player already has its real connection generation in the snapshot.
            var existing=all.get(p.id());
            all.put(p.id(),new VoiceAudience.Actor(p.id(),existing==null?generation.session():existing.session(),generation.world(),at.getX(),at.getY(),at.getZ(),p.name(),true,p.range(),p.kind().equals("maid")?p.owner():null,Math.min(8,p.range())));
        }
    }
    boolean voice(UUID actor,UUID world,UUID utterance,long occurredAt,String text,Set<UUID> audience){
        Player source=Bukkit.getPlayer(actor);
        if(source==null||source.isDead()||source.isInvisible()||source.getGameMode()==GameMode.SPECTATOR||!source.getWorld().getUID().equals(world))return true;
        if(System.currentTimeMillis()-occurredAt>120_000||occurredAt>System.currentTimeMillis())return true;
        if (groupChat(source, text, audience, utterance, "voice", occurredAt)) return true;
        var named=NpcDialoguePolicy.addressed(profiles.values(),text,true);
        var address=named!=null?named:address(source,text,NpcDialoguePolicy.fresh(occurredAt,System.currentTimeMillis()));
        if(named!=null && named.profile().kind().equals("numen") && NpcDialoguePolicy.asksForAction(named.text())
                && audience.contains(named.profile().id()) && hears(source,live(named.profile().id()),named.profile())
                && deliver(source,named.profile().id(),"voice_direct_"+utterance+"_"+named.profile().id(),text,"voice",occurredAt)) return true;
        if(address!=null&&audience.contains(address.profile().id())&&
            natural(source,address,"nearby",audience,"voice_"+utterance))return true;
        for(UUID target:audience)deliver(source,target,"voice_"+utterance,text,"voice",occurredAt);
        return address!=null;
    }

    private boolean groupChat(Player speaker, String text, Set<UUID> audience, UUID input, String channel, long at) {
        var group = NpcDialoguePolicy.group(profiles.values(), text);
        if (group == null) return false;
        if (closing(group.message())) return true;
        for (var profile : group.recipients()) {
            var body = live(profile.id());
            if (!hears(speaker, body, profile)) continue;
            // ASR listeners must have been present throughout the original utterance.
            if (channel.equals("voice") && !audience.contains(profile.id())) continue;
            if (channel.equals("chat") && body instanceof Player && !audience.contains(profile.id())) continue;
            if (profile.kind().equals("maid") && !profile.owner().equals(speaker.getUniqueId())
                    && speaker.getLocation().distanceSquared(body.getLocation()) > 64) continue;
            String event = channel + "_group_" + input + "_" + profile.id();
            deliver(speaker, profile.id(), event, text, channel, at);
        }
        return true;
    }

    private static boolean closing(String text) {
        return CLOSINGS.contains(text.replaceAll("[\\p{P}\\s]+", ""));
    }

    private NpcDialoguePolicy.Address address(Player player,String text,boolean allowLook){
        var named=NpcDialoguePolicy.addressed(profiles.values(),text);
        if(named!=null||!allowLook)return named;
        String line=text.strip();
        if(line.isEmpty()||line.startsWith("@")||line.startsWith("/")||line.startsWith("!"))return null;
        var facing=player.getTargetEntity(5);
        var profile=facing==null?null:profiles.get(facing.getUniqueId());
        return profile==null?null:new NpcDialoguePolicy.Address(profile,line);
    }

    private boolean natural(Player player,NpcDialoguePolicy.Address address,String scope,Set<UUID> audience,String input){
        var profile=address.profile();
        var body=live(profile.id());
        if(configured(player.getUniqueId())||!hears(player,body,profile)||!player.hasLineOfSight(body))return false;
        if(profile.kind().equals("maid")&&profile.owner().equals(player.getUniqueId()))return false;
        if(profile.kind().equals("maid")&&player.getLocation().distanceSquared(body.getLocation())>64)return false;
        if(closing(address.text()))return true;
        if(profile.kind().equals("villager"))
            return deliver(player,profile.id(),"addressed_"+input+"_"+profile.id(),address.text(),input.startsWith("voice_")?"voice":"chat",System.currentTimeMillis());
        if(!delivered.add(profile.id(),player.getUniqueId(),"natural_"+input,System.currentTimeMillis()))return true;
        return plugin.naturalNpcDialogue(profile,player,address.text(),scope,audience,input.startsWith("voice_")?"voice":"text");
    }

    boolean naturalMaidChat(Player actor,String text,Set<UUID> recipients){
        if(!Bukkit.isPrimaryThread()||Bukkit.getPlayer(actor.getUniqueId())!=actor)return false;
        // The chat listener owns a named group's one event, including its maid recipients.
        if (NpcDialoguePolicy.group(profiles.values(), text) != null) return true;
        var address=address(actor,text,true);
        return address!=null&&address.profile().kind().equals("maid")&&
            natural(actor,address,"public",recipients,"chat_"+UUID.randomUUID());
    }

    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void greetAt(PlayerInteractAtEntityEvent event){greet(event);}

    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void greet(PlayerInteractEntityEvent event){
        Player player=event.getPlayer();
        if(event.getHand()!=EquipmentSlot.HAND||player.isSneaking()||!player.getInventory().getItemInMainHand().getType().isAir())return;
        var profile=profiles.get(event.getRightClicked().getUniqueId());
        if(profile==null||!profile.kind().equals("numen")||player.getLocation().distanceSquared(event.getRightClicked().getLocation())>25)return;
        natural(player,new NpcDialoguePolicy.Address(profile,"你好。"),"private",Set.of(),"greeting");
    }
    void said(UUID actor,String operation,String text,long occurredAt){
        Entity source=live(actor);if(source==null||!NpcDialoguePolicy.fresh(occurredAt,System.currentTimeMillis()))return;
        NpcDialoguePolicy.text(text);String event="npc_"+NpcDialoguePolicy.speechId(actor,operation);
        for(UUID target:profiles.keySet())deliver(source,target,event,text,"npc_chat",occurredAt);
    }
    void nearbySpokenText(Player source,NpcDialoguePolicy.Profile profile,UUID request,String text){
        for(Player listener:source.getWorld().getPlayers()){
            if(configured(listener.getUniqueId()) || !hears(listener,source,profile) || !plugin.wantsCaptions(listener))continue;
            if(delivered.add(listener.getUniqueId(),source.getUniqueId(),"speech_"+request,System.currentTimeMillis()))
                listener.sendMessage("[附近] "+profile.display()+"："+text);
        }
    }
    private boolean deliver(Entity source,UUID target,String event,String text,String channel,long occurredAt){
        var profile=profiles.get(target);Entity entity=live(target);
        if(profile==null||entity==null||!source.getWorld().equals(entity.getWorld())||!NpcDialoguePolicy.nearby(source.getUniqueId(),target,source.getWorld().getUID(),entity.getWorld().getUID(),source.getLocation().distanceSquared(entity.getLocation()),profile.range()))return false;
        if(profile.kind().equals("villager")&&(!(source instanceof Player speaker)||!hears(speaker,entity,profile)
                ||!speaker.hasLineOfSight(entity)||!(event.startsWith("addressed_")||event.startsWith("voice_group_")||event.startsWith("chat_group_"))))return false;
        // Preserve existing maid partner (24) / visitor (8) speech boundaries.
        if(channel.equals("voice")&&profile.kind().equals("maid")&&!source.getUniqueId().equals(profile.owner())&&source.getLocation().distanceSquared(entity.getLocation())>64)return false;
        if(source instanceof Player player&&!player.canSee(entity))return false;
        try{NpcDialoguePolicy.text(text);}catch(IllegalArgumentException invalid){return false;}
        if(!delivered.add(target,source.getUniqueId(),event,System.currentTimeMillis()))return false;
        String id="qdvoice:"+source.getUniqueId()+":"+event;
        return deliverBound(profile,entity,source,id,text,channel,occurredAt,false);
    }
    boolean tellVillager(NpcDialoguePolicy.Profile profile,Player speaker,UUID request,String text,long now){
        Entity entity=live(profile.id());
        if(profile.residentId()==null||entity==null||Bukkit.getPlayer(speaker.getUniqueId())!=speaker
                ||speaker.isDead()||!speaker.canSee(entity))return false;
        return deliverBound(profile,entity,speaker,request.toString(),text,"chat",now,true);
    }
    private boolean deliverBound(NpcDialoguePolicy.Profile profile,Entity entity,Entity source,String id,
                                 String text,String channel,long occurredAt,boolean direct){
        UUID target=profile.id();
        try{
            if(profile.kind().equals("maid")){
                var bridge=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");if(bridge==null||!bridge.isEnabled())return false;
                return Boolean.TRUE.equals(bridge.getClass().getMethod("acceptUnifiedNpcDialogue",UUID.class,UUID.class,UUID.class,String.class,String.class,String.class)
                    .invoke(bridge,target,profile.owner(),source.getUniqueId(),source.getName(),text,id));
            }else{
                var binding=hosted.get(target);if(!hostedReady(entity))return false;
                var payload=new JsonObject();payload.addProperty("schema",1);payload.addProperty("eventId",id);payload.addProperty("listenerId",target.toString());
                payload.addProperty("speakerId",source.getUniqueId().toString());payload.addProperty("speaker",source.getName());payload.addProperty("text",text);
                payload.addProperty("channel",channel);payload.addProperty("occurredAt",occurredAt);payload.addProperty("receivedAt",System.currentTimeMillis());
                payload.addProperty("deliveryScope",direct?"private":"nearby");
                payload.addProperty("speakerKind",profiles.containsKey(source.getUniqueId())?"npc":"player");payload.addProperty("trusted",false);
                if(profile.residentId()!=null){
                    payload.addProperty("residentId",profile.residentId());
                    payload.addProperty("world",entity.getWorld().getKey().toString());
                }
                if(Boolean.TRUE.equals(binding.input().apply(payload.toString()))){
                    if(profile.residentId()!=null){
                        long now=System.currentTimeMillis();
                        villagerTurns.values().removeIf(turn->turn.expiresAt()<now);
                        villagerTurns.put(id,new VillagerTurn(entity,(Player)source,entity.getWorld().getUID(),binding.generation(),now+30_000,direct));
                        while(villagerTurns.size()>128)villagerTurns.remove(villagerTurns.keySet().iterator().next());
                    }
                    return true;
                }
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
            if (groupChat(actor, text, recipients, input, "chat", at)) return;
            var address=address(actor,text,true);
            if(address!=null&&(address.profile().kind().equals("maid")||natural(actor,address,"public",recipients,"chat_"+input)))return;
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
