package com.l299l.npcspeak.npc;

import java.util.UUID;
import com.l299l.npcspeak.NPCSpeak;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Keep the existing NPCSpeak provider/API and identities, awaiting entity I/O. */
public class BuiltinNpcProvider implements NpcProvider, Listener {
    private final JavaPlugin plugin;
    private final NpcEntityReadiness readiness;
    public BuiltinNpcProvider(JavaPlugin plugin) {
        this.plugin=plugin;this.readiness=new NpcEntityReadiness(plugin);
        plugin.getServer().getPluginManager().registerEvents(this,plugin);
    }
    @Override public void restoreOrSpawn(NpcData npc) {
        if(npc.getSpawnLocation()==null||npc.getSpawnLocation().getWorld()==null){plugin.getLogger().warning("NPC world unavailable; original identity retained: "+npc.getId());return;}
        if(!readiness.ready(npc.getId(),npc.getSpawnLocation(),()->{
            if(plugin instanceof NPCSpeak speak && speak.getNpcManager().getById(npc.getId())!=npc)return;
            restoreOrSpawn(npc);
            if(plugin instanceof NPCSpeak speak)try{speak.getNpcManager().saveNpc(npc);}catch(java.io.IOException failure){plugin.getLogger().warning("NPC identity save failed: "+npc.getId());}
        }))return;
        Entity old=npc.getEntityUUID()==null?null:Bukkit.getEntity(npc.getEntityUUID());
        if(old instanceof Villager v&&!v.isDead()){configureVillager(v,npc.getDisplayName());return;}
        Villager v=npc.getSpawnLocation().getWorld().spawn(npc.getSpawnLocation(),Villager.class,e->configureVillager(e,npc.getDisplayName()));
        npc.setEntityUUID(v.getUniqueId());
    }
    @Override public void despawn(NpcData npc) {
        readiness.cancel(npc.getId());
        Entity e=npc.getEntityUUID()==null?null:Bukkit.getEntity(npc.getEntityUUID());
        if(e!=null)e.remove();npc.setEntityUUID(null);
    }
    @Override public void rename(NpcData npc,String name) {
        Entity e=npc.getEntityUUID()==null?null:Bukkit.getEntity(npc.getEntityUUID());
        if(e!=null)e.customName(Component.text(name,NamedTextColor.GOLD));
    }
    @Override public String getName(){return "builtin";}
    private void configureVillager(Villager v,String name){
        v.setAI(false);v.setInvulnerable(true);v.setPersistent(true);v.setRemoveWhenFarAway(false);
        v.customName(Component.text(name,NamedTextColor.GOLD));v.setCustomNameVisible(true);v.setSilent(true);
    }
    // NPCSpeak originally indexed only the UUID seen before restoreOrSpawn
    // returns. Deferred creation must resolve the current authoritative object.
    public static NpcData lookup(NpcManager manager,UUID id){
        if(id==null)return null;
        for(NpcData npc:manager.getAll())if(id.equals(npc.getEntityUUID()))return npc;
        return null;
    }
    @EventHandler public void disable(PluginDisableEvent event){if(event.getPlugin()==plugin)readiness.close();}
}
