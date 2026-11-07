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
    private record Pose(long time,UUID world,double x,double y,double z){}
    private final Map<UUID,ArrayDeque<Pose>> positions=new HashMap<>();
    NativeMaidNearbyChat(HybridMaidPlugin plugin){
        this.plugin=plugin;Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::sample,1,5);
    }
    private void sample(){
        long now=System.currentTimeMillis();
        for(String key:plugin.registeredMaids().keySet()){
            UUID id=UUID.fromString(key);EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
            if(maid==null||!plugin.sharedDialogueEnabled(maid))continue;
            var history=positions.computeIfAbsent(id,k->new ArrayDeque<>());
            history.addLast(new Pose(now,maid.getBukkitEntity().getWorld().getUID(),maid.getX(),maid.getY(),maid.getZ()));
            while(history.size()>800||!history.isEmpty()&&history.peekFirst().time<now-180_000)history.removeFirst();
        }
    }
    void voice(UUID actorId,UUID world,UUID utterance,long start,long end,double[] bounds,double range,String text,Set<UUID> audience){
        long now=System.currentTimeMillis();
        if(bounds==null||bounds.length!=6||Arrays.stream(bounds).anyMatch(v->!Double.isFinite(v))||!Double.isFinite(range)||range<=0||start>end||end-start>25_000||now-end>120_000||end>now)return;
        for(int i=0;i<3;i++)if(bounds[i]>bounds[i+3])return;
        Player actor=Bukkit.getPlayer(actorId);if(actor==null||!actor.getWorld().getUID().equals(world)||actor.isDead()||actor.isInvisible()||actor.getGameMode()==GameMode.SPECTATOR)return;
        for(var row:positions.entrySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(row.getKey()));
            if(maid==null||!plugin.sharedDialogueEnabled(maid)||!world.equals(maid.getBukkitEntity().getWorld().getUID())||!actor.canSee(maid.getBukkitEntity())||actor.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())>64)continue;
            String addressed=MaidAddressing.addressed(maid.getName().getString(),text);if(addressed==null)continue;
            List<Pose> samples=row.getValue().stream().filter(p->p.time>=start-300&&p.time<=end+300).toList();
            if(samples.isEmpty()||samples.getFirst().time>start||samples.getLast().time<end-300)continue;
            boolean heard=true;long previous=start;
            for(Pose p:samples){
                double dx=Math.max(Math.abs(p.x-bounds[0]),Math.abs(p.x-bounds[3])),dy=Math.max(Math.abs(p.y-bounds[1]),Math.abs(p.y-bounds[4])),dz=Math.max(Math.abs(p.z-bounds[2]),Math.abs(p.z-bounds[5]));
                if(!p.world.equals(world)||p.time-previous>550||dx*dx+dy*dy+dz*dz>Math.pow(Math.min(8,range),2)){heard=false;break;}previous=p.time;
            }
            if(heard)plugin.nearbyConversation(actor,maid,addressed,audience,"voice_"+utterance);
            return;
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
        // Only explicitly configured shared companions, no scanning or chunk loading.
        for(String id:plugin.registeredMaids().keySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(id)));
            if(maid==null||!plugin.sharedDialogueEnabled(maid)||!maid.isAlive()||maid.isRemoved()
                ||!actor.getWorld().equals(maid.getBukkitEntity().getWorld())||!actor.canSee(maid.getBukkitEntity())
                ||actor.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())>64)continue;
            String addressed=MaidAddressing.addressed(maid.getName().getString(),text);if(addressed==null)continue;
            plugin.nearbyConversation(actor,maid,addressed,recipients);return;
        }
    }
}
