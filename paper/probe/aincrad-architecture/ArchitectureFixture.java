package org.qdqa;

import com.google.gson.Gson;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Disposable, loopback-only inspection fixture. Never shipped in a release. */
public final class ArchitectureFixture extends JavaPlugin implements Listener {
    private static final Set<String> ACTORS=Set.of("ag_ArchAlice","ag_ArchBob");
    private final Gson json=new Gson();
    private JavaPlugin owner;
    private Object manager;
    private final Map<UUID,Integer> bowShots=new HashMap<>();
    @Override public void onEnable(){
        try{
            int port=getServer().getPort();
            if(!getServer().getIp().equals("127.0.0.1")||!Set.of(29395,29397).contains(port)
                    ||!Files.readString(Path.of(".communication-qa")).strip().equals("127.0.0.1:"+port+" 20261030"))throw new IllegalStateException("marked_loopback_qa_required");
            owner=(JavaPlugin)getServer().getPluginManager().getPlugin("AgentFriend");
            if(owner==null)throw new IllegalStateException("agentfriend_required");
            manager=field(owner,"siteDungeons");
            getCommand("qd_arch_fixture").setExecutor(this);
            Bukkit.getPluginManager().registerEvents(this,this);
        }catch(Exception failure){throw new IllegalStateException(failure);}
    }
    @EventHandler(ignoreCancelled=true)
    public void bowShot(EntityShootBowEvent event){bowShots.merge(event.getEntity().getUniqueId(),1,Integer::sum);}
    private static Object field(Object object,String name)throws Exception{var f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
    private static Object call(Object object,String name,Class<?>[] types,Object...values)throws Exception{var m=object.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(object,values);}
    private static Object value(Object record,String name)throws Exception{return call(record,name,new Class<?>[0]);}
    private Object site()throws Exception{Object result=((Map<?,?>)field(manager,"sites")).get("aincrad_01");if(result==null)throw new IllegalStateException("site_missing");return result;}
    private static void check(boolean value,String message){if(!value)throw new IllegalStateException(message);}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(sender instanceof Player||args.length<1)return true;
        try{
            String action=args[0];
            if(action.equals("unit")){
                Class.forName("org.afuhome.agentfriend.DungeonMapArchitectureTest",true,owner.getClass().getClassLoader()).getMethod("main",String[].class).invoke(null,(Object)new String[0]);
                sender.sendMessage("ARCH_QA_UNIT checks=9 passed=true");return true;
            }
            if(action.equals("map")){
                Object s=site();World world=Bukkit.getWorld((String)value(s,"world"));check(world!=null,"map_not_loaded");
                var rows=new ArrayList<Map<String,Object>>();
                var method=manager.getClass().getDeclaredMethod("flatSpawnSupport",org.bukkit.block.Block.class);method.setAccessible(true);
                Class<?> mode=Class.forName(manager.getClass().getName()+"$Mode"),runType=Class.forName(manager.getClass().getName()+"$Run");
                var constructor=runType.getDeclaredConstructor(s.getClass(),mode);constructor.setAccessible(true);Object run=constructor.newInstance(s,mode.getEnumConstants()[0]);
                var safeSpots=manager.getClass().getDeclaredMethod("safeSpots",runType);safeSpots.setAccessible(true);
                int stage=0;
                for(Object room:(List<?>)value(s,"rooms")){
                    int x=(Integer)value(room,"x"),y=(Integer)value(room,"y"),z=(Integer)value(room,"z");
                    for(Object raw:(List<?>)value(room,"spawnPoints")){
                        List<?> point=(List<?>)raw;int px=(Integer)point.get(0),pz=(Integer)point.get(2);
                        check(world.isChunkGenerated(px>>4,pz>>4),"unsaved_chunk");world.getChunkAt(px>>4,pz>>4);
                    }
                    var field=runType.getDeclaredField("stage");field.setAccessible(true);field.setInt(run,stage++);
                    List<?> safe=(List<?>)safeSpots.invoke(manager,run);int required=((List<?>)value(room,"enemies")).size();check(safe.size()>=required,"insufficient_real_spawn_points_"+stage+"_"+safe.size());
                    Set<String> floors=new TreeSet<>();
                    for(Object raw:(List<?>)value(room,"spawnPoints")){
                        List<?> p=(List<?>)raw;var floor=world.getBlockAt((Integer)p.get(0),(Integer)p.get(1)-1,(Integer)p.get(2));
                        floors.add(floor.getBlockData().getAsString());
                    }
                    Integer roof=null;for(int ry=y+2;ry<=y+16;ry++)if(world.getBlockAt(x,ry,z).getType().isSolid()){roof=ry;break;}
                    Map<String,Object> row=new LinkedHashMap<>();row.put("name",value(room,"name"));row.put("center",List.of(x,y,z));row.put("safeSpots",safe.size());row.put("required",required);row.put("roofY",roof);row.put("floors",floors);rows.add(row);
                }
                check(rows.size()==6,"six_rooms_required");sender.sendMessage("ARCH_QA_MAP "+json.toJson(rows));return true;
            }
            check(args.length>=2&&ACTORS.contains(args[1]),"own_disposable_actor_required");
            Player player=Bukkit.getPlayerExact(args[1]);check(player!=null,"actor_offline");
            if(action.equals("prepare")){
                check(Bukkit.getOnlinePlayers().stream().allMatch(p->ACTORS.contains(p.getName())),"foreign_actor_in_fixture");
                World world=Bukkit.getWorld("aincrad");check(world!=null,"map_not_loaded");
                world.setGameRule(GameRule.DO_MOB_SPAWNING,false);world.setGameRule(GameRule.KEEP_INVENTORY,true);world.setTime(6000);world.setStorm(false);
                player.setOp(false);player.setGameMode(GameMode.SURVIVAL);player.getInventory().clear();player.setFoodLevel(20);player.setSaturation(15);
                player.getInventory().setHelmet(new ItemStack(Material.IRON_HELMET));player.getInventory().setChestplate(new ItemStack(Material.IRON_CHESTPLATE));player.getInventory().setLeggings(new ItemStack(Material.IRON_LEGGINGS));player.getInventory().setBoots(new ItemStack(Material.IRON_BOOTS));
                player.getInventory().setItem(0,new ItemStack(Material.IRON_SWORD));player.getInventory().setItem(1,new ItemStack(Material.BOW));player.getInventory().setItem(2,new ItemStack(Material.ARROW,64));player.getInventory().setItem(3,new ItemStack(Material.BREAD,32));player.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD));player.getInventory().setHeldItemSlot(0);
                check(player.teleport(new Location(world,856.5,69,-1143.5)),"initial_qa_position_failed");
            }else if(action.equals("snapshot")){
                var result=new LinkedHashMap<String,Object>();Object run=((Map<?,?>)field(manager,"runs")).get("aincrad_01");
                result.put("position",List.of(player.getLocation().getX(),player.getLocation().getY(),player.getLocation().getZ()));result.put("health",player.getHealth());result.put("food",player.getFoodLevel());
                if(run!=null){
                    result.put("stage",field(run,"stage"));result.put("phase",field(run,"phase"));result.put("failures",field(run,"failures"));
                    var mobs=new ArrayList<Map<String,Object>>();
                    for(Object id:((Map<?,?>)field(run,"mobs")).keySet()){
                        Entity entity=Bukkit.getEntity((UUID)id);if(!(entity instanceof Mob mob))continue;
                        Map<String,Object> info=new LinkedHashMap<>();info.put("id",mob.getUniqueId().toString());info.put("type",mob.getType().name());info.put("health",mob.getHealth());info.put("position",List.of(mob.getLocation().getX(),mob.getLocation().getY(),mob.getLocation().getZ()));info.put("ai",mob.hasAI());info.put("fireTicks",mob.getFireTicks());info.put("weapon",mob.getEquipment()==null||mob.getEquipment().getItemInMainHand()==null?"AIR":mob.getEquipment().getItemInMainHand().getType().name());info.put("helmet",mob.getEquipment()==null||mob.getEquipment().getHelmet()==null?"AIR":mob.getEquipment().getHelmet().getType().name());info.put("bowShots",bowShots.getOrDefault(mob.getUniqueId(),0));mobs.add(info);
                    }
                    result.put("mobs",mobs);
                }
                sender.sendMessage("ARCH_QA_STATE "+json.toJson(result));return true;
            }else if(action.equals("position")){
                int index=Integer.parseInt(args[2]);List<?> rooms=(List<?>)value(site(),"rooms");check(index>=0&&index<rooms.size(),"room_index");Object room=rooms.get(index);
                check(player.teleport(new Location(Bukkit.getWorld("aincrad"),(Integer)value(room,"x")+.5,(Integer)value(room,"y"),(Integer)value(room,"z")+.5)),"qa_position_failed");
            }else if(action.equals("recover")){
                check(!player.isDead(),"qa_actor_dead");player.setHealth(player.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());player.setFoodLevel(20);
            }else if(action.equals("strike")){
                Object run=((Map<?,?>)field(manager,"runs")).get("aincrad_01");check(run!=null&&(Integer)field(run,"stage")==5,"boss_stage_required");
                // Native onDamaged conditions may inspect the pre-hit health. Keep one
                // small, nonlethal hit below the threshold instead of stopping there.
                for(Object id:((Map<?,?>)field(run,"mobs")).keySet())if(Bukkit.getEntity((UUID)id) instanceof Vindicator mob&&mob.getHealth()>4){mob.damage(mob.getHealth()>96?35:1,player);break;}
            }else if(action.equals("clear")){
                Object run=((Map<?,?>)field(manager,"runs")).get("aincrad_01");check(run!=null,"run_required");
                check(((Set<?>)field(run,"party")).contains(player.getUniqueId()),"own_run_required");
                for(Object id:new ArrayList<>(((Map<?,?>)field(run,"mobs")).keySet()))if(Bukkit.getEntity((UUID)id) instanceof Mob mob){mob.setNoDamageTicks(0);mob.damage(4096,player);}
            }else throw new IllegalArgumentException("unknown_qa_action");
            sender.sendMessage("ARCH_QA_OK "+action);
        }catch(Throwable failure){getLogger().log(java.util.logging.Level.WARNING,"Architecture QA failure",failure);sender.sendMessage("ARCH_QA_ERROR "+failure);}
        return true;
    }
}
