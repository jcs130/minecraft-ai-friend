package qa;

import com.google.gson.*;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.item.ItemSmartSlab;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Native bodies, damage, soul use and native advancement in a synthetic loopback world only. */
public final class CompanionRescueQa extends JavaPlugin {
    static final UUID ID=UUID.fromString("00000000-0000-4000-8000-000000009115");
    private JavaPlugin af,bridge;
    static Object call(Object o,String name,Object...args)throws Exception{
        var method=Arrays.stream(o.getClass().getDeclaredMethods()).filter(m->m.getName().equals(name)&&m.getParameterCount()==args.length).findFirst().orElseThrow();method.setAccessible(true);return method.invoke(o,args);
    }
    static Object field(Object o,String name)throws Exception{var f=o.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(o);}
    @Override public void onEnable(){
        try{if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=26461||!Files.readString(Path.of(".player-navigation-qa")).equals("SYNTHETIC_PLAYER_NAVIGATION_ONLY"))throw new IllegalStateException("Marked loopback only");}catch(Exception e){throw new IllegalStateException(e);}
        af=(JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");bridge=(JavaPlugin)Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");
        Bukkit.getCommandMap().register("rescueqa",new Command("rescueqa"){
            public boolean execute(CommandSender sender,String label,String[] args){if(sender instanceof Player||args.length!=1)return false;
                try{run(args[0]);sender.sendMessage("RESCUE_QA "+state());}catch(Exception e){sender.sendMessage("RESCUE_QA_ERROR "+e);getLogger().warning(e.toString());}return true;}
        });
    }
    Player actor(){return Objects.requireNonNull(Bukkit.getPlayerExact("NavActorQA"));}
    Player target(){return Objects.requireNonNull(Bukkit.getPlayerExact("NavTargetQA"));}
    EntityMaid maid(){var e=Bukkit.getEntity(ID);return e instanceof CraftEntity c&&c.getHandle() instanceof EntityMaid m?m:null;}
    void console(String command){if(!Bukkit.dispatchCommand(Bukkit.getConsoleSender(),command))throw new IllegalStateException("Fixture command rejected");}
    @SuppressWarnings("unchecked") void run(String action)throws Exception{
        World world=Bukkit.getWorld("world");var a=actor();
        switch(action){
            case "rescue-setup"->{
                for(int x=-601;x<=-579;x++)for(int z=-316;z<=-294;z++)for(int y=67;y<=73;y++)world.getBlockAt(x,y,z).setType(y==67?Material.STONE:Material.AIR,false);
                a.teleport(new Location(world,-589.5,68,-304.5));target().teleport(new Location(world,-580.5,68,-304.5));
                Object dungeon=call(af,"dungeon");var members=(Set<UUID>)field(dungeon,"participants");members.clear();members.add(a.getUniqueId());call(dungeon,"persistRun");
                var m=Objects.requireNonNull(maid());m.moveTo(-598.5,68,-304.5,0,0);m.setNoAi(false);m.setInSittingPose(false);m.setHealth(m.getMaxHealth());
                a.setInvulnerable(false);a.setNoDamageTicks(0);a.setHealth(Math.min(20,a.getMaxHealth()));
            }
            case "down"->{a.setNoDamageTicks(0);a.damage(10000);}
            case "sit-with-human"->{
                Object dungeon=call(af,"dungeon");((Set<UUID>)field(dungeon,"participants")).add(target().getUniqueId());call(dungeon,"persistRun");
                target().teleport(new Location(world,-580.5,68,-304.5));var m=Objects.requireNonNull(maid());m.moveTo(-591.5,68,-304.5,0,0);m.setInSittingPose(true);
                a.setNoDamageTicks(0);a.setHealth(Math.min(20,a.getMaxHealth()));
            }
            case "human-near"->target().teleport(a.getLocation().clone().add(2,0,0));
            case "soul-setup"->{
                Object dungeon=call(af,"dungeon");var f=dungeon.getClass().getDeclaredField("active");f.setAccessible(true);f.set(dungeon,false);((Set<?>)field(dungeon,"participants")).clear();call(dungeon,"persistRun");
                for(int x=198;x<=204;x++)for(int z=198;z<=204;z++)for(int y=89;y<=94;y++)world.getBlockAt(x,y,z).setType(y==89?Material.STONE:Material.AIR,false);
                target().setGameMode(GameMode.SURVIVAL);target().setOp(false);target().teleport(new Location(world,200.5,90,202.5,180,70));target().getInventory().clear();
                console("minecraft:advancement revoke NavTargetQA only touhou_little_maid:give_smart_slab");
            }
            case "grant"->{console("minecraft:advancement grant NavTargetQA only touhou_little_maid:give_smart_slab");}
            case "own-hand"->{
                var inv=target().getInventory();for(int i=0;i<36;i++){var item=inv.getItem(i);if(item!=null&&item.getType().getKey().toString().equals("touhou_little_maid:smart_slab_init")){var old=inv.getItem(0);inv.setItem(0,item);if(i!=0)inv.setItem(i,old);inv.setHeldItemSlot(0);break;}}
            }
            case "foreign-hand"->{
                var item=new net.minecraft.world.item.ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("touhou_little_maid:smart_slab_init")));
                ItemSmartSlab.setInitMaidOwner(item,a.getUniqueId());target().getInventory().setItemInMainHand(CraftItemStack.asBukkitCopy(item));
            }
            case "status"->{}
            default->throw new IllegalArgumentException("Unknown fixture action");
        }
    }
    JsonObject state()throws Exception{
        var out=new JsonObject();var a=actor();var m=maid();out.addProperty("actorHealth",a.getHealth());out.addProperty("actorAlive",!a.isDead());
        out.add("rescue",(JsonObject)call(call(af,"trialRescue"),"state",a));
        if(m!=null){out.addProperty("maidDistance",m.getBukkitEntity().getLocation().distance(a.getLocation()));out.addProperty("maidX",m.getX());out.addProperty("maidSitting",m.isMaidInSittingPose());out.addProperty("maidId",m.getUUID().toString());out.addProperty("eligible",(Boolean)call(bridge,"eligibleRescueCompanion",a,m.getBukkitEntity()));var c=(JsonObject)call(bridge,"context",a,ID);if(c.has("companion"))out.add("companion",c.get("companion"));}
        int items=0;JsonArray owners=new JsonArray();for(var item:target().getInventory().getContents())if(item!=null&&item.getType().getKey().toString().equals("touhou_little_maid:smart_slab_init")){items+=item.getAmount();owners.add(ItemSmartSlab.getInitMaidOwner(CraftItemStack.asNMSCopy(item)).toString());}
        out.addProperty("initialSouls",items);out.add("soulOwners",owners);out.addProperty("targetId",target().getUniqueId().toString());
        out.addProperty("targetMaids",Bukkit.getWorlds().stream().flatMap(w->w.getEntities().stream()).filter(e->e instanceof CraftEntity c&&c.getHandle() instanceof EntityMaid n&&target().getUniqueId().equals(n.getOwnerUUID())).count());
        return out;
    }
}
