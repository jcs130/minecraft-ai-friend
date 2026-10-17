package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

/** One private, stable native task bar per explorer. No chat polling or scoreboard replacement. */
final class QuestTracker implements Listener {
    private record Tracked(String run, BossBar bar) { }
    private final AgentFriendPlugin plugin;
    private final Map<UUID,Tracked> bars=new HashMap<>();
    private final Map<UUID,Long> refreshed=new HashMap<>();
    private final BukkitTask cleanup;
    QuestTracker(AgentFriendPlugin plugin) {
        this.plugin=plugin;Bukkit.getPluginManager().registerEvents(this,plugin);
        cleanup=Bukkit.getScheduler().runTaskTimer(plugin,this::prune,20L,20L);
    }
    boolean due(Player p) {return System.currentTimeMillis()-refreshed.getOrDefault(p.getUniqueId(),0L)>=1000;}
    private boolean visible(Player p) {
        return p!=null&&p.isOnline()&&!p.isDead()&&!plugin.isObserver(p)&&p.getGameMode()==GameMode.SURVIVAL
                &&!plugin.isDowned(p)&&!plugin.dungeonParticipant(p)&&!plugin.pvpParticipant(p)
                &&plugin.getConfig().getBoolean("task-tracking.enabled",true);
    }
    void update(Player p,String run,String title,JsonObject guide) {
        if(!visible(p)){remove(p.getUniqueId());return;}
        refreshed.put(p.getUniqueId(),System.currentTimeMillis());
        Tracked current=bars.get(p.getUniqueId());
        if(current!=null&&!current.run.equals(run)){remove(p.getUniqueId());current=null;}
        if(current==null){current=new Tracked(run,Bukkit.createBossBar("任务追踪",BarColor.BLUE,BarStyle.SOLID));bars.put(p.getUniqueId(),current);}
        String label="§b任务 · "+title+" §f｜"+QuestGuidance.text(guide,"summary");
        if(guide.has("completedObjectives"))label+=" §7"+guide.get("completedObjectives").getAsInt()+"/"+guide.get("totalObjectives").getAsInt();
        if(guide.has("missingConditions")&&!guide.getAsJsonArray("missingConditions").isEmpty())label+=" · "+guide.getAsJsonArray("missingConditions").get(0).getAsString();
        if(label.length()>112)label=label.substring(0,112);
        if(!current.bar.getTitle().equals(label))current.bar.setTitle(label);
        double progress=guide.has("progress")?guide.get("progress").getAsDouble():0;
        progress=Math.max(0,Math.min(1,progress));if(current.bar.getProgress()!=progress)current.bar.setProgress(progress);
        BarColor color=QuestGuidance.flag(guide,"ready")?BarColor.GREEN:BarColor.BLUE;
        if(current.bar.getColor()!=color)current.bar.setColor(color);
        audience(p,current.bar);
    }
    private void audience(Player owner,BossBar bar) {
        Set<Player> wanted=new HashSet<>();wanted.add(owner);wanted.addAll(plugin.attachedEyes(owner));
        Set<Player> before=new HashSet<>(bar.getPlayers());
        for(Player old:before)if(!wanted.contains(old))bar.removePlayer(old);
        for(Player p:wanted)if(!before.contains(p))bar.addPlayer(p);
    }
    private void prune() {
        for(var entry:Set.copyOf(bars.entrySet())) {
            Player p=Bukkit.getPlayer(entry.getKey());
            String run=plugin.getConfig().getString("guild-players."+entry.getKey()+".active.market.run","");
            if(!visible(p)||!entry.getValue().run.equals(run))remove(entry.getKey());else audience(p,entry.getValue().bar);
        }
    }
    void remove(UUID id) {Tracked old=bars.remove(id);if(old!=null)old.bar.removeAll();refreshed.remove(id);}
    @EventHandler public void quit(PlayerQuitEvent e) {remove(e.getPlayer().getUniqueId());prune();}
    void close() {cleanup.cancel();bars.values().forEach(t->t.bar.removeAll());bars.clear();refreshed.clear();}
}
