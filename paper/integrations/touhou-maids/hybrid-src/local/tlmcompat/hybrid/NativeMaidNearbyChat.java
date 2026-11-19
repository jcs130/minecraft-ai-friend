package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.*;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.plugin.Plugin;

/** Observe delivered player chat; never turn system messages or whispers into commands. */
final class NativeMaidNearbyChat implements Listener {
    private final HybridMaidPlugin plugin;
    private record Pose(long time,UUID world,double x,double y,double z,boolean ownerFacing){}
    record Address(String text, boolean namedPartner) {}
    private final Map<UUID,ArrayDeque<Pose>> positions=new HashMap<>();
    private final MaidConversationWindow conversation=new MaidConversationWindow();
    MaidConversationWindow.Admission admit(Player actor,EntityMaid maid,Address address){
        return conversation.admit(actor.getUniqueId(),maid.getUUID(),actor.getWorld().getUID(),actor,
            address.text(),address.namedPartner(),System.nanoTime());
    }
    boolean started(Player actor,EntityMaid maid){
        return conversation.started(actor.getUniqueId(),maid.getUUID(),actor.getWorld().getUID(),actor,System.nanoTime());
    }
    void replied(Player actor,EntityMaid maid,String reply,boolean proactive){
        conversation.replied(actor.getUniqueId(),maid.getUUID(),actor.getWorld().getUID(),actor,reply,proactive,System.nanoTime());
    }
    void closed(Player actor,EntityMaid maid){
        conversation.close(actor.getUniqueId(),maid.getUUID(),actor.getWorld().getUID(),actor,System.nanoTime());
    }
    boolean mayInitiate(Player actor,EntityMaid maid){
        return conversation.mayInitiate(actor.getUniqueId(),maid.getUUID(),actor.getWorld().getUID(),actor,System.nanoTime());
    }
    @EventHandler public void changedWorld(org.bukkit.event.player.PlayerChangedWorldEvent event){
        Player actor=event.getPlayer();
        plugin.resetNearbyConversation(actor,"world_changed");
        conversation.reset(actor.getUniqueId());
    }
    @EventHandler public void quit(org.bukkit.event.player.PlayerQuitEvent event){
        Player actor=event.getPlayer();
        plugin.resetNearbyConversation(actor,"listener_left");
        conversation.reset(actor.getUniqueId());
    }
    private Address addressed(Player actor,EntityMaid maid,String text,boolean facing){
        boolean partner=actor.getUniqueId().equals(maid.getOwnerUUID());
        String direct=partner
            ?MaidAddressing.partnerAddressed(maid.getName().getString(),text)
            :MaidAddressing.addressed(maid.getName().getString(),text);
        if(direct!=null)return new Address(direct,partner);
        if(plugin.ownerDialogue(actor,maid)){
            if (addressesSomeoneElse(actor, maid, text)) return null;
            String vocative=MaidAddressing.partnerAddressed("女仆",text);
            if(vocative!=null){
                if(facing||onlyNearbyPersonalMaid(actor,maid))return new Address(vocative,true);
                return null;
            }
            if(facing && text!=null && !text.isBlank()
                && text.length()<=140 && !text.stripLeading().matches("[/!@].*")
                && text.codePoints().noneMatch(c->Character.isISOControl(c)||c==0xA7))return new Address(text.strip(),true);
        }
        String followup=conversation.followup(actor.getUniqueId(),maid.getUUID(),actor.getWorld().getUID(),actor,text,System.nanoTime());
        return followup==null?null:new Address(followup,false);
    }
    private boolean onlyNearbyPersonalMaid(Player owner,EntityMaid maid){
        int range=MaidConversationRange.PARTNER;
        for(var other:owner.getNearbyEntities(range,range,range)){
            if(other.getUniqueId().equals(maid.getUUID())||!owner.canSee(other))continue;
            var body=HybridMaidPlugin.nativeMaid(other);
            if(plugin.ownerDialogue(owner,body)&&MaidConversationRange.within(body,owner,range))return false;
        }
        return true;
    }
    private boolean addressesSomeoneElse(Player actor, EntityMaid maid, String text) {
        int radius = MaidConversationRange.speaker(maid, actor);
        for (var entity : actor.getNearbyEntities(radius, radius, radius)) {
            if (entity.getUniqueId().equals(maid.getUUID()) || !actor.canSee(entity)) continue;
            var otherMaid = HybridMaidPlugin.nativeMaid(entity);
            String name = otherMaid != null ? otherMaid.getName().getString()
                : entity instanceof Player player ? player.getName() : null;
            if (name != null && MaidAddressing.partnerAddressed(name, text) != null) return true;
        }
        return false;
    }

    NativeMaidNearbyChat(HybridMaidPlugin plugin){
        this.plugin=plugin;Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::sample,1,5);
    }
    private void sample(){
        long now=System.currentTimeMillis();
        positions.values().removeIf(history->history.isEmpty()||history.peekLast().time<now-180_000);
        for(String key:plugin.registeredMaids().keySet()){
            UUID id=UUID.fromString(key);EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
            if(maid==null||!plugin.sharedDialogueEnabled(maid)&&!plugin.personalDialogue(maid))continue;
            Player owner=plugin.personalDialogue(maid)?Bukkit.getPlayer(maid.getOwnerUUID()):null;
            if(plugin.personalDialogue(maid)&&(owner==null||!MaidConversationRange.within(maid,owner,MaidConversationRange.PARTNER)))continue;
            var history=positions.computeIfAbsent(id,k->new ArrayDeque<>());
            boolean facing=owner!=null&&MaidConversationRange.within(maid,owner,5)&&owner.getTargetEntity(5)==maid.getBukkitEntity();
            history.addLast(new Pose(now,maid.getBukkitEntity().getWorld().getUID(),maid.getX(),maid.getY(),maid.getZ(),facing));
            while(history.size()>800||!history.isEmpty()&&history.peekFirst().time<now-180_000)history.removeFirst();
        }
    }
    void voice(UUID actorId,UUID world,UUID utterance,long start,long end,double[] bounds,double range,String text,Set<UUID> audience,boolean onlyPersonal){
        long now=System.currentTimeMillis();
        if(bounds==null||bounds.length!=6||Arrays.stream(bounds).anyMatch(v->!Double.isFinite(v))||!Double.isFinite(range)||range<=0||start>end||end-start>25_000||now-end>120_000||end>now)return;
        for(int i=0;i<3;i++)if(bounds[i]>bounds[i+3])return;
        Player actor=Bukkit.getPlayer(actorId);if(actor==null||!actor.getWorld().getUID().equals(world)||actor.isDead()||actor.isInvisible()||actor.getGameMode()==GameMode.SPECTATOR)return;
        for(var row:positions.entrySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(row.getKey()));
            if(maid==null|| (onlyPersonal ? !plugin.ownerDialogue(actor,maid) : !plugin.nearbyDialogue(actor,maid)) ||!world.equals(maid.getBukkitEntity().getWorld().getUID())||!actor.canSee(maid.getBukkitEntity())||!MaidConversationRange.within(maid,actor,MaidConversationRange.speaker(maid,actor)))continue;
            List<Pose> samples=row.getValue().stream().filter(p->p.time>=start-300&&p.time<=end+300).toList();
            if(samples.isEmpty()||samples.getFirst().time>start||samples.getLast().time<end-300)continue;
            boolean heard=true;long previous=start;
            for(Pose p:samples){
                double dx=Math.max(Math.abs(p.x-bounds[0]),Math.abs(p.x-bounds[3])),dy=Math.max(Math.abs(p.y-bounds[1]),Math.abs(p.y-bounds[4])),dz=Math.max(Math.abs(p.z-bounds[2]),Math.abs(p.z-bounds[5]));
                if(!p.world.equals(world)||p.time-previous>550||dx*dx+dy*dy+dz*dz>Math.pow(Math.min(MaidConversationRange.speaker(maid,actor),range),2)){heard=false;break;}previous=p.time;
            }
            if(!heard)continue;
            // Choose whom the speaker faced during the utterance, before ASR latency.
            boolean facing=samples.stream().filter(p->p.time>=start&&p.time<=end).anyMatch(Pose::ownerFacing);
            Address address=addressed(actor,maid,text,facing);
            if(address!=null){plugin.nearbyConversation(actor,maid,address,audience,"voice_"+utterance);return;}
        }
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void heard(AsyncChatEvent event){
        Player original=event.getPlayer();
        // originalMessage retains a shout prefix even when Essentials strips it.
        String originalText=PlainTextComponentSerializer.plainText().serialize(event.originalMessage());
        String text=PlainTextComponentSerializer.plainText().serialize(event.message());
        Set<UUID> recipients=new HashSet<>();
        for(var viewer:event.viewers())if(viewer instanceof Player p)recipients.add(p.getUniqueId());
        Bukkit.getScheduler().runTask(plugin,()->{
            if(Bukkit.getPlayer(original.getUniqueId())!=original||!localChannel(original,originalText))return;
            var voice=Bukkit.getPluginManager().getPlugin("QiandengVoice");
            if(voice!=null&&voice.isEnabled())try{
                if(Boolean.TRUE.equals(voice.getClass().getMethod("acceptNaturalMaidChat",Player.class,String.class,Set.class)
                    .invoke(voice,original,text,recipients)))return;
            }catch(ReflectiveOperationException unavailable){/* Older voice plugin keeps the native chat path. */}
            receive(original,text,recipients);
        });
    }
    private boolean localChannel(Player actor,String text){
        Plugin essentials=Bukkit.getPluginManager().getPlugin("Essentials"),chat=Bukkit.getPluginManager().getPlugin("EssentialsChat");
        // An absent/unknown channel must not silently become a public AI listener.
        if(essentials==null||chat==null||!essentials.isEnabled()||!chat.isEnabled())return false;
        try{
            Object settings=essentials.getClass().getMethod("getSettings").invoke(essentials);
            int radius=((Number)settings.getClass().getMethod("getChatRadius").invoke(settings)).intValue();
            char shout=(Character)settings.getClass().getMethod("getChatShout").invoke(settings);
            Object user=essentials.getClass().getMethod("getUser",Player.class).invoke(essentials,actor);
            return radius>0&&!text.stripLeading().startsWith(String.valueOf(shout))
                &&!(Boolean)user.getClass().getMethod("isToggleShout").invoke(user);
        }catch(ReflectiveOperationException|RuntimeException unknown){return false;}
    }
    private void receive(Player actor,String text,Set<UUID> recipients){
        if(!actor.isOnline()||actor.isDead()||actor.isInvisible()||actor.getGameMode()==GameMode.SPECTATOR)return;
        // Only registered, opted-in bodies take part in nearby chat.
        for(String id:plugin.registeredMaids().keySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(id)));
            if(maid==null||!plugin.nearbyDialogue(actor,maid)||!maid.isAlive()||maid.isRemoved()
                ||!actor.getWorld().equals(maid.getBukkitEntity().getWorld())||!actor.canSee(maid.getBukkitEntity())
                ||!MaidConversationRange.within(maid,actor,MaidConversationRange.speaker(maid,actor)))continue;
            Address addressed=addressed(actor,maid,text,plugin.ownerDialogue(actor,maid)&&actor.getTargetEntity(5)==maid.getBukkitEntity());if(addressed==null)continue;
            plugin.nearbyConversation(actor,maid,addressed,recipients);return;
        }
    }
}
