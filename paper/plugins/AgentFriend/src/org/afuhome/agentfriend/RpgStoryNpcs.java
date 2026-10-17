package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.nio.file.*;
import java.util.*;
import java.util.function.BiConsumer;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.configuration.file.YamlConfiguration;

/** Six small native NPC bodies. Only explicit content reload/startup/chunk load
 * may create a body; a journal/status query never loads chunks or spawns one. */
final class RpgStoryNpcs implements Listener {
    private final AgentFriendPlugin plugin;
    private final NamespacedKey roleKey;
    private final File registryFile;
    private final YamlConfiguration registry;
    private final BiConsumer<Player,String> interaction;
    private RpgStoryContent content;
    RpgStoryNpcs(AgentFriendPlugin plugin,RpgStoryContent content,BiConsumer<Player,String> interaction)throws Exception{
        this.plugin=plugin;this.content=content;this.interaction=interaction;
        roleKey=new NamespacedKey(plugin,"rpg_story_npc");registryFile=new File(plugin.getDataFolder(),"rpg-story-npcs.yml");
        registry=new YamlConfiguration();if(registryFile.exists())registry.load(registryFile);
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskLater(plugin,this::ensureLoaded,20L);
    }
    void reload(RpgStoryContent next){content=next;ensureLoaded();}
    LivingEntity entity(String id){String uid=registry.getString("npcs."+id+".uuid","");try{var e=Bukkit.getEntity(UUID.fromString(uid));return e instanceof LivingEntity living&&id.equals(living.getPersistentDataContainer().get(roleKey,PersistentDataType.STRING))?living:null;}catch(IllegalArgumentException unavailable){return null;}}
    Location target(String id){var e=entity(id);if(e!=null)return e.getLocation();var n=content.npc(id);World w=n==null?null:Bukkit.getWorld(n.world());return w==null?null:new Location(w,n.x(),n.y(),n.z());}
    boolean nearby(Player p,String id){var e=entity(id);return e!=null&&e.isValid()&&!e.isDead()&&e.getWorld().equals(p.getWorld())&&e.getLocation().distanceSquared(p.getLocation())<=64;}
    String id(Entity e){return e.getPersistentDataContainer().getOrDefault(roleKey,PersistentDataType.STRING,"");}
    private void ensureLoaded(){if(!content.enabled)return;for(var n:content.npcs)ensure(n);}
    private void ensure(RpgStoryContent.Npc n){
        World w=Bukkit.getWorld(n.world());if(w==null||!w.isChunkLoaded(((int)Math.floor(n.x()))>>4,((int)Math.floor(n.z()))>>4))return;
        LivingEntity current=entity(n.id());
        if(current==null){
            var at=new Location(w,n.x(),n.y(),n.z());var chunk=w.getChunkAt(at);var found=new ArrayList<LivingEntity>();
            for(Entity e:chunk.getEntities())if(e instanceof LivingEntity living&&n.id().equals(id(e)))found.add(living);
            if(found.size()>1){plugin.getLogger().warning("Duplicate story NPC role retained for inspection: "+n.id());return;}
            if(found.size()==1)current=found.getFirst();
            else{
                // An administrator may have moved this fixed NPC elsewhere. A
                // known loaded body is authoritative; do not move or duplicate it.
                String known=registry.getString("npcs."+n.id()+".uuid","");
                // Absence during entity loading or after an administrator moved
                // this body is not proof of deletion. Never duplicate a known UUID.
                if(!known.isEmpty())return;
                var floor=at.clone().subtract(0,1,0).getBlock();
                if(!floor.getType().isSolid()||!at.getBlock().isPassable()||!at.clone().add(0,1,0).getBlock().isPassable()
                        ||Set.of(Material.LAVA,Material.WATER,Material.FIRE,Material.CAMPFIRE,Material.SOUL_CAMPFIRE,Material.CACTUS,Material.MAGMA_BLOCK).contains(floor.getType())){
                    plugin.getLogger().warning("Story NPC spawn blocked; preserve terrain: "+n.id());return;
                }
                current=w.spawn(at,Villager.class,v->{v.getPersistentDataContainer().set(roleKey,PersistentDataType.STRING,n.id());v.addScoreboardTag("qd_service_npc");v.setAI(false);v.setInvulnerable(true);v.setSilent(true);v.setCollidable(false);v.setCanPickupItems(false);v.setPersistent(true);v.setRemoveWhenFarAway(false);v.setAdult();v.setBreed(false);});
                if(!current.isValid())return;
            }
            String base="npcs."+n.id()+".";registry.set(base+"uuid",current.getUniqueId().toString());registry.set(base+"world",w.getName());registry.set(base+"chunk-x",current.getLocation().getBlockX()>>4);registry.set(base+"chunk-z",current.getLocation().getBlockZ()>>4);
            if(!save())plugin.getLogger().warning("Story NPC registry save unavailable: "+n.id());
        }
        current.addScoreboardTag("qd_story_npc");current.setCustomName("§e◆ "+n.name());current.setCustomNameVisible(true);
        if(current instanceof Villager v){try{v.setProfession(Villager.Profession.valueOf(n.profession()));}catch(IllegalArgumentException invalid){plugin.getLogger().warning("Unknown story NPC profession retained: "+n.id());}}
    }
    private boolean save(){try{File tmp=new File(registryFile.getParentFile(),registryFile.getName()+".tmp");registry.save(tmp);try{Files.move(tmp.toPath(),registryFile.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException unsupported){Files.move(tmp.toPath(),registryFile.toPath(),StandardCopyOption.REPLACE_EXISTING);}return true;}catch(Exception error){return false;}}
    @EventHandler(ignoreCancelled=true)public void load(ChunkLoadEvent event){
        if(content.npcs.stream().anyMatch(n->n.world().equals(event.getWorld().getName())&&((int)Math.floor(n.x())>>4)==event.getChunk().getX()&&((int)Math.floor(n.z())>>4)==event.getChunk().getZ()))Bukkit.getScheduler().runTaskLater(plugin,this::ensureLoaded,5L);
    }
    @EventHandler(priority=EventPriority.HIGHEST)public void interact(PlayerInteractEntityEvent event){
        String id=id(event.getRightClicked());if(id.isEmpty()||content.npc(id)==null)return;event.setCancelled(true);
        if(event.getHand()==EquipmentSlot.HAND)try{interaction.accept(event.getPlayer(),id);}catch(IllegalArgumentException|IllegalStateException denied){plugin.communication().error(event.getPlayer(),"STORY_ACTION_DENIED",denied.getMessage(),false,"/mycli world story status");}
    }
    JsonObject view(String id){var n=content.npc(id);if(n==null)return null;var out=new JsonObject();out.addProperty("id",n.id());out.addProperty("name",n.name());out.addProperty("role",n.role());
        var e=entity(id);var at=target(id);out.addProperty("loaded",e!=null);out.addProperty("positionSource",e==null?"registered_spawn":"live_entity");
        if(at!=null){out.addProperty("world",at.getWorld().getKey().toString());out.addProperty("x",at.getX());out.addProperty("y",at.getY());out.addProperty("z",at.getZ());}out.addProperty("talkRange",8);out.addProperty("nextAction",e==null?"这是登记位置；走近后重查，实体仍缺失请联系服主，不要挖掘寻找。":"走到人物8格内选择话题交谈。");out.addProperty("nextCommand",e==null?"/mycli world story info "+id:"/mycli world story talk "+id);return out;
    }
    JsonArray places(){var out=new JsonArray();for(var n:content.npcs){var row=view(n.id());row.addProperty("kind","rpg_npc");out.add(row);}return out;}
}
