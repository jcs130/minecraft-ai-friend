package org.qiandengji.ruinsqa;

import com.google.gson.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.structure.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.BoundingBox;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import dev.aurelium.auraskills.api.AuraSkillsApi;

/** Console-only test fixture. This JAR is never a production dependency. */
public final class RuinsFixture extends JavaPlugin implements CommandExecutor,Listener {
    final Gson json=new Gson(); JsonObject manifest;
    final Map<UUID,List<String>> hits=new HashMap<>();
    final Map<UUID,List<String>> actions=new HashMap<>();
    local.tlmcompat.hybrid.HybridPluginPayloads payloads;
    public void onEnable(){
        try{
            if(Bukkit.getPort()!=40081||!"127.0.0.1".equals(Bukkit.getIp())
                ||!Files.readString(Path.of(".qa-only")).equals("QD_RUINS_EXPANSION_20261108"))
                throw new IllegalStateException("isolated_fixture_only");
            manifest=JsonParser.parseString(Files.readString(Path.of("ruins-content/manifest.json"))).getAsJsonObject();
            // Same deployed adapter and unchanged message bytes as production.
            // The isolated world needs no maid/LLM services to exercise this codec.
            payloads=new local.tlmcompat.hybrid.HybridPluginPayloads(this);
            getCommand("qruins").setExecutor(this);Bukkit.getPluginManager().registerEvents(this,this);
        }catch(Exception e){throw new IllegalStateException(e);}
    }
    public void onDisable(){if(payloads!=null)payloads.close();}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void damage(EntityDamageByEntityEvent e){
        Entity actor=e.getDamager();if(actor instanceof Projectile p&&p.getShooter()instanceof Entity shooter)actor=shooter;
        if(e.getFinalDamage()>0&&e.getEntity()instanceof Player p&&actor.getScoreboardTags().contains("afu_site_dungeon"))
            {hits.computeIfAbsent(p.getUniqueId(),k->new ArrayList<>()).add(actor.getType().name()+":"+e.getFinalDamage());actions.computeIfAbsent(actor.getUniqueId(),k->new ArrayList<>()).add("damage:"+e.getFinalDamage());}
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void projectile(ProjectileLaunchEvent e){if(e.getEntity().getShooter()instanceof Mob m&&m.getScoreboardTags().contains("afu_site_dungeon"))actions.computeIfAbsent(m.getUniqueId(),k->new ArrayList<>()).add("projectile:"+e.getEntity().getType().name());}
    JsonObject site(String id){for(var row:manifest.getAsJsonArray("sites")){var o=row.getAsJsonObject();if(o.get("id").getAsString().equals(id))return o;}throw new IllegalArgumentException("unknown_site");}
    Object manaService()throws Exception{var p=Bukkit.getPluginManager().getPlugin("VortexRPG");return p.getClass().getMethod("qiandengjiMana").invoke(p);}
    public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try{
            if(args.length==0)throw new IllegalArgumentException("operation_required");
            World world=Bukkit.getWorld("world");var out=new LinkedHashMap<String,Object>();out.put("operation",args[0]);out.put("observedAt",System.currentTimeMillis());
            switch(args[0]){
                case "place"->{var s=site(args[1]);var origin=s.getAsJsonArray("origin");
                    var structure=Bukkit.getStructureManager().loadStructure(new File("ruins-content/datapack/data/qd_ruins/structure/"+args[1]+".nbt"));
                    var at=new Location(world,origin.get(0).getAsInt(),origin.get(1).getAsInt(),origin.get(2).getAsInt());
                    var box=s.getAsJsonArray("bounds");
                    for(int x=box.get(0).getAsInt();x<=box.get(3).getAsInt();x++)for(int z=box.get(2).getAsInt();z<=box.get(5).getAsInt();z++)for(int y=box.get(1).getAsInt();y<=box.get(4).getAsInt();y++)
                        if(!world.getBlockAt(x,y,z).getType().isAir())world.getBlockAt(x,y,z).setType(Material.AIR,false);
                    structure.place(at,false,StructureRotation.NONE,Mirror.NONE,0,1f,new Random(0));
                    out.put("size",structure.getSize().toString());out.put("placed",true);
                }
                case "inspect"->{var s=site(args[1]);var rows=new ArrayList<>();
                    for(var point:s.getAsJsonArray("centres")){var p=point.getAsJsonArray();int x=p.get(0).getAsInt(),y=p.get(1).getAsInt(),z=p.get(2).getAsInt();
                        rows.add(Map.of("position",List.of(x,y,z),"feet",world.getBlockAt(x,y,z).getType().name(),"head",world.getBlockAt(x,y+1,z).getType().name(),"floor",world.getBlockAt(x,y-1,z).getType().name()));}
                    out.put("centres",rows);
                }
                case "setup","heal","mana","state"->{Player p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("player_offline");
                    if(args[0].equals("setup")){
                        p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.getInventory().clear();
                        ItemStack sword=new ItemStack(Material.NETHERITE_SWORD);sword.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.SHARPNESS,20);p.getInventory().setItem(0,sword);
                        p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.NETHERITE_BOOTS),new ItemStack(Material.NETHERITE_LEGGINGS),new ItemStack(Material.NETHERITE_CHESTPLATE),new ItemStack(Material.NETHERITE_HELMET)});
                        p.getInventory().setItem(1,new ItemStack(Material.COOKED_BEEF,32));
                    }
                    if(!args[0].equals("state")){
                        p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());p.setFoodLevel(20);p.setSaturation(20);
                        var user=AuraSkillsApi.get().getUser(p.getUniqueId());user.setMana(user.getMaxMana());
                        var mana=manaService();mana.getClass().getMethod("setMana",UUID.class,double.class).invoke(mana,p.getUniqueId(),200d);
                    }
                    var user=AuraSkillsApi.get().getUser(p.getUniqueId());
                    var mana=manaService();out.put("player",p.getName());out.put("op",p.isOp());out.put("health",p.getHealth());out.put("mana",mana.getClass().getMethod("getMana",UUID.class).invoke(mana,p.getUniqueId()));out.put("world",p.getWorld().getName());
                    out.put("position",List.of(p.getX(),p.getY(),p.getZ()));out.put("hits",hits.getOrDefault(p.getUniqueId(),List.of()));
                }
                case "mobs"->{var rows=new ArrayList<>();for(Entity e:world.getEntities())if(e instanceof Mob m&&e.getScoreboardTags().contains("afu_site_dungeon")){
                    var row=new LinkedHashMap<String,Object>();row.put("id",m.getEntityId());row.put("uuid",m.getUniqueId().toString());row.put("type",m.getType().name());row.put("health",m.getHealth());row.put("ai",m.hasAI());row.put("hand",m.getEquipment().getItemInMainHand().getType().name());row.put("target",m.getTarget()==null?null:m.getTarget().getUniqueId().toString());row.put("position",List.of(m.getX(),m.getY(),m.getZ()));row.put("actions",actions.getOrDefault(m.getUniqueId(),List.of()));rows.add(row);
                }out.put("mobs",rows);}
                default->throw new IllegalArgumentException("unknown_operation");
            }
            out.put("success",true);sender.sendMessage(json.toJson(out));
        }catch(Exception|LinkageError e){sender.sendMessage(json.toJson(Map.of("success",false,"reason",e.toString())));}
        return true;
    }
}
