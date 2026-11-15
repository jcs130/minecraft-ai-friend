package qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.world.data.MaidWorldData;
import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Real native damage and persistence; fixed synthetic identities in a marked loopback world only. */
public final class CompanionRespawnQa extends JavaPlugin {
    static final UUID ID=UUID.fromString("00000000-0000-4000-8000-000000009115");
    static final UUID OTHER=UUID.fromString("00000000-0000-4000-8000-000000009116");
    static final UUID OWNER=UUID.nameUUIDFromBytes("OfflinePlayer:NavActorQA".getBytes(StandardCharsets.UTF_8));
    static final String TAG="qiandengji_companion_respawn";
    private JavaPlugin bridge;
    @Override public void onEnable(){
        try{if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=26461||!Files.readString(Path.of(".player-navigation-qa")).equals("SYNTHETIC_PLAYER_NAVIGATION_ONLY"))throw new IllegalStateException("Synthetic loopback only");}
        catch(Exception e){throw new IllegalStateException(e);}
        bridge=(JavaPlugin)Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
        Bukkit.getCommandMap().register("respawnqa",new Command("respawnqa"){
            public boolean execute(CommandSender sender,String label,String[] args){
                if(sender instanceof Player||args.length<1)return false;
                try{run(args);sender.sendMessage("RESPAWN_QA "+state());}
                catch(Exception e){sender.sendMessage("RESPAWN_QA_ERROR "+e);getLogger().warning(e.toString());}
                return true;
            }
        });
    }
    EntityMaid maid(UUID id){var e=Bukkit.getEntity(id);return e instanceof CraftEntity c&&c.getHandle() instanceof EntityMaid m?m:null;}
    Player owner(){var p=Bukkit.getPlayer(OWNER);if(p==null||!p.getName().equals("NavActorQA"))throw new IllegalStateException("Synthetic owner required");return p;}
    Object call(Object target,String name,Object...args)throws Exception{
        var m=Arrays.stream(target.getClass().getDeclaredMethods()).filter(x->x.getName().equals(name)&&x.getParameterCount()==args.length).findFirst().orElseThrow();m.setAccessible(true);return m.invoke(target,args);
    }
    void scene(){
        com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig.LLM_ENABLED.set(false);
        Player p=owner();World w=Bukkit.getWorld("world");w.setGameRule(GameRule.DO_MOB_SPAWNING,false);w.setTime(6000);w.setStorm(false);
        for(int x=90;x<=110;x++)for(int z=90;z<=110;z++)for(int y=89;y<=93;y++)w.getBlockAt(x,y,z).setType(y==89?Material.STONE:Material.AIR,false);
        p.setGameMode(GameMode.SURVIVAL);p.setHealth(Math.min(p.getMaxHealth(),20));p.teleport(new Location(w,100.5,90,100.5));
    }
    EntityMaid spawn(UUID id)throws Exception{
        EntityMaid previous=maid(id);
        if(previous!=null){if(!OWNER.equals(previous.getOwnerUUID())||!previous.getName().getString().startsWith("隔离重生"))throw new IllegalStateException("Unexpected original body");previous.discard();}
        else if(Bukkit.getEntity(id)!=null)throw new IllegalStateException("Unexpected UUID");
        var level=((CraftWorld)owner().getWorld()).getHandle();EntityMaid m=new EntityMaid(level);
        m.setUUID(id);m.setOwnerUUID(OWNER);m.setTame(true,false);m.setCustomName(net.minecraft.network.chat.Component.literal("隔离重生伙伴"));
        m.setTask(TaskManager.getIdleTask());m.setInSittingPose(false);m.setHomeModeEnable(false);m.setNoAi(false);m.setInvulnerable(false);m.setSilent(true);m.setPersistenceRequired();
        m.moveTo(102.5,90,100.5,0,0);m.getConfigManager().setSoundFreq(0.0F);
        m.getMaidInv().setStackInSlot(0,new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.DIAMOND,7));
        m.getMaidInv().setStackInSlot(1,new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.BOW));
        if(!level.addFreshEntity(m,org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.CUSTOM))throw new IllegalStateException("Spawn refused");
        call(bridge,"bind",m);return m;
    }
    void run(String[] args)throws Exception{
        switch(args[0]){
            case "setup"->{scene();spawn(ID);}
            case "ordinary"->{spawn(OTHER).hurt(maid(OTHER).damageSources().generic(),10000F);}
            case "lethal"->{var m=Objects.requireNonNull(maid(ID));m.setInvulnerable(false);m.invulnerableTime=0;m.hurt(m.damageSources().generic(),10000F);}
            case "repeat"->{var m=Objects.requireNonNull(maid(ID));m.hurt(m.damageSources().generic(),10000F);}
            case "load"->{Bukkit.getWorld("world").getChunkAt(6,6).load();}
            case "crossworld"->{World w=Bukkit.getWorld("world_nether");if(w==null)throw new IllegalStateException("Native Nether unavailable");for(int x=98;x<=104;x++)for(int z=98;z<=104;z++)for(int y=89;y<=94;y++)w.getBlockAt(x,y,z).setType(y==89?Material.STONE:Material.AIR,false);owner().teleport(new Location(w,100.5,90,100.5));}
            case "status"->{}
            default->throw new IllegalArgumentException("Unknown synthetic action");
        }
    }
    JsonObject state()throws Exception{
        JsonObject out=new JsonObject();EntityMaid m=maid(ID);out.addProperty("id",ID.toString());out.addProperty("owner",OWNER.toString());out.addProperty("loaded",m!=null);
        var p=Bukkit.getPlayer(OWNER);var data=MaidWorldData.get(((CraftWorld)Bukkit.getWorlds().getFirst()).getHandle());var graves=data.getTombstones(OWNER);
        out.addProperty("graves",graves==null?0:graves.size());out.addProperty("ordinaryAlive",maid(OTHER)!=null&&maid(OTHER).isAlive());
        out.addProperty("copies",Bukkit.getWorlds().stream().flatMap(w->w.getEntities().stream()).filter(e->e.getUniqueId().equals(ID)).count());
        if(m!=null){
            out.addProperty("alive",m.isAlive());out.addProperty("health",m.getHealth());out.addProperty("maxHealth",m.getMaxHealth());out.addProperty("waiting",m.getPersistentData().contains(TAG));
            out.addProperty("invulnerable",m.isInvulnerable());out.addProperty("noAI",m.isNoAi());out.addProperty("name",m.getName().getString());out.addProperty("model",m.getModelId());out.addProperty("voice",m.getSoundPackId());
            out.addProperty("dimension",m.level().dimension().location().toString());out.addProperty("eventId",m.getPersistentData().getCompound(TAG).getString("eventId"));
            StringBuilder items=new StringBuilder();for(int i=0;i<m.getMaidInv().getSlots();i++)items.append(m.getMaidInv().getStackInSlot(i).saveOptional(m.level().registryAccess()));
            for(var s:net.minecraft.world.entity.EquipmentSlot.values())items.append(m.getItemBySlot(s).saveOptional(m.level().registryAccess()));
            out.addProperty("inventorySha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(items.toString().getBytes(StandardCharsets.UTF_8))));
            out.addProperty("distance",p!=null&&p.getWorld()==m.getBukkitEntity().getWorld()?p.getLocation().distance(m.getBukkitEntity().getLocation()):-1);
            if(p!=null){var c=(JsonObject)call(bridge,"context",p,ID);for(String k:List.of("respawn","lifeState","historicalDeath"))if(c.has(k))out.add(k,c.get(k));}
        }
        return out;
    }
}
