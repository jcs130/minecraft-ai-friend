package org.qiandengji.anticheat;

import me.vekster.lightanticheat.api.event.LACViolationEvent;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.command.*;
import org.bukkit.plugin.java.JavaPlugin;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/** Remote vanilla/Mineflayer clients retain physics checks. A genuine Numen
 * ServerPlayer body has no untrusted network movement stream to authenticate.
 * Class identity comes from the installed API's loader, never a name, UUID
 * prefix, operator permission, brand string or client-provided metadata.
 */
public final class AgentAntiCheat extends JavaPlugin implements Listener {
    private Class<?> nativeBody;
    private record Source(ClassLoader loader,String prefix){}
    private final List<Source> sources=new ArrayList<>();
    private final Map<EntityDamageByEntityEvent,Boolean> skillEvents=Collections.synchronizedMap(new WeakHashMap<>());
    private final AtomicLong marked=new AtomicLong(),skipped=new AtomicLong();
    private final StackWalker walker=StackWalker.getInstance(StackWalker.Option.RETAIN_CLASS_REFERENCE);
    @Override public void onEnable(){
        var api=Bukkit.getPluginManager().getPlugin("numen_api");
        if(api!=null&&api.isEnabled()){
            try{nativeBody=Class.forName("com.dwinovo.numen.api.entity.NumenPlayer",false,api.getClass().getClassLoader());}
            catch(ClassNotFoundException|LinkageError e){getLogger().severe("Numen身体类型不可用；不按名称放行，禁止将本状态视为兼容验收完成。");}
        }
        for(var entry:Map.of("AgentFriend","org.afuhome.agentfriend.","VortexRPG","io.vortexcore.","MagicSpells","com.nisovin.magicspells.","MythicMobs","io.lumine.mythic.").entrySet()){
            var plugin=Bukkit.getPluginManager().getPlugin(entry.getKey());if(plugin!=null&&plugin.isEnabled())sources.add(new Source(plugin.getClass().getClassLoader(),entry.getValue()));
        }
        Bukkit.getPluginManager().registerEvents(this,this);
    }
    public boolean isServerBody(Player player){
        if(nativeBody==null)return false;
        try{return nativeBody.isInstance(player.getClass().getMethod("getHandle").invoke(player));}
        catch(ReflectiveOperationException|LinkageError e){return false;}
    }
    private void markSkill(EntityDamageByEntityEvent event){
        if(!(event.getDamager() instanceof Player)||event.isCancelled())return;
        // Authorise only this exact damage event while a reviewed server spell
        // implementation is on the stack. No timed player-wide reach bypass,
        // no damage cancellation, no changed damage type or protection bypass.
        boolean trusted=walker.walk(frames->frames.limit(80).anyMatch(frame->sources.stream().anyMatch(source->frame.getDeclaringClass().getClassLoader()==source.loader()&&frame.getClassName().startsWith(source.prefix()))));
        if(trusted&&skillEvents.put(event,true)==null)marked.incrementAndGet();
    }
    @EventHandler(priority=EventPriority.LOWEST,ignoreCancelled=true)
    public void damage(EntityDamageByEntityEvent event){markSkill(event);}
    @EventHandler(priority=EventPriority.LOWEST)
    public void damageCaller(me.vekster.lightanticheat.event.playerattack.LACPlayerAttackEvent event){markSkill(event.getEvent());}
    // LAC consumes this event at HIGHEST. Cancelling at the same priority is
    // too late when its listener was registered first: flags/setbacks already
    // happened. Its documented API must be enabled in the generated policy.
    @EventHandler(priority=EventPriority.LOWEST,ignoreCancelled=false)
    public void serverBody(LACViolationEvent event){
        if(isServerBody(event.getPlayer())){event.setCancelled(true);return;}
        if(event.getCancellable() instanceof EntityDamageByEntityEvent damage&&skillEvents.containsKey(damage)){event.setCancelled(true);skipped.incrementAndGet();}
    }
    @Override public boolean onCommand(CommandSender sender,Command cmd,String label,String[] args){if(sender instanceof ConsoleCommandSender||sender instanceof RemoteConsoleCommandSender)sender.sendMessage("AC_GUARD skillEvents="+marked.get()+" skippedSkillFlags="+skipped.get());else sender.sendMessage("仅维护台可读此诊断。");return true;}
}
