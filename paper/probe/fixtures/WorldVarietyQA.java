import com.olencounters.OlEncountersPlugin;
import com.olencounters.event.MeteorType;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import com.sk89q.worldedit.math.BlockVector3;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipFile;
import net.citizensnpcs.api.CitizensAPI;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.*;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.util.Vector;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import com.olencounters.api.event.MeteorPreStartEvent;
import org.mcmonkey.sentinel.SentinelTrait;

/** Isolated fixture only. Never part of a production release. */
public final class WorldVarietyQA extends JavaPlugin implements Listener {
    private Location snapshotCenter;
    private String snapshotHash;
    @Override public void onEnable() {
        if (Bukkit.getPort()!=25914 || !getDataFolder().getAbsolutePath().replace('\\','/').contains("/staging/world-expansion-20261016/"))
            throw new IllegalStateException("Private test server required");
        Bukkit.getPluginManager().registerEvents(this,this);
    }
    @EventHandler(priority=EventPriority.MONITOR)
    public void interact(PlayerInteractEntityEvent e) {
        if(!e.getPlayer().getName().equals("ag_VarietyQA"))return;
        getLogger().info("WVQA interaction: cancelled="+e.isCancelled()+" hand="+e.getHand()+" sneak="+e.getPlayer().isSneaking()+" held="+e.getPlayer().getInventory().getItemInMainHand().getType()+" entity="+e.getRightClicked().getType()+" ai="+(e.getRightClicked() instanceof LivingEntity l&&l.hasAI()));
    }
    private String terrainHash(Location c) throws Exception {
        var digest=java.security.MessageDigest.getInstance("SHA-256");
        for(int x=-20;x<=20;x++)for(int z=-20;z<=20;z++)for(int y=-4;y<=15;y++){
            var b=c.getWorld().getBlockAt(c.getBlockX()+x,c.getBlockY()+y,c.getBlockZ()+z);
            digest.update((b.getBlockData().getAsString()+"\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            if(b.getState() instanceof org.bukkit.block.Container container)for(var item:container.getInventory().getContents())
                digest.update(String.valueOf(item).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        return java.util.HexFormat.of().formatHex(digest.digest());
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void preStart(MeteorPreStartEvent e) {
        try{snapshotCenter=e.getLocation().clone();snapshotHash=terrainHash(snapshotCenter);getLogger().info("WVQA terrainBefore="+snapshotHash+" at="+snapshotCenter);}catch(Exception error){throw new RuntimeException(error);}
    }
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return true;
        try {
            var ol=OlEncountersPlugin.getInstance();
            switch(args[0]) {
                case "blueprint" -> {
                    World world=Bukkit.getWorld("world");
                    var file=new File(world.getWorldFolder(),"datapacks/world-expansion--grim-kingdoms-lost-structures-ruins.zip");
                    try(var reader=BuiltInClipboardFormat.MINECRAFT_STRUCTURE.getReader(new FileInputStream(new File("ops/qd_forest_camp.blocks.nbt")))) {
                        var clipboard=reader.read();
                        // The temporary encounter owns its wave entities. Do
                        // not leave untracked template villagers after rollback.
                        for(var entity:List.copyOf(clipboard.getEntities()))entity.remove();
                        var min=clipboard.getMinimumPoint();var max=clipboard.getMaximumPoint();
                        var origin=BlockVector3.at((min.x()+max.x())/2,min.y(),(min.z()+max.z())/2);clipboard.setOrigin(origin);
                        // Omitted native structure positions become structure_void
                        // in WorldEdit. Temporary encounters capture their entire
                        // volume and must have explicit walkable air above ground.
                        for(int x=min.x();x<=max.x();x++)for(int z=min.z();z<=max.z();z++)for(int y=min.y();y<=max.y();y++) {
                            var p=BlockVector3.at(x,y,z);
                            if(clipboard.getBlock(p).getBlockType().id().equals("minecraft:structure_void"))
                                clipboard.setBlock(p,com.sk89q.worldedit.world.block.BlockTypes.AIR.getDefaultState());
                        }
                        List<Vector> chests=new ArrayList<>(),floor=new ArrayList<>();
                        int lowest=Integer.MAX_VALUE;
                        for(int x=min.x();x<=max.x();x++)for(int z=min.z();z<=max.z();z++)for(int y=min.y();y<=max.y();y++) {
                            var p=BlockVector3.at(x,y,z);String id=clipboard.getBlock(p).getBlockType().id();
                            if(id.contains("chest")||id.equals("minecraft:barrel"))chests.add(new Vector(x-origin.x(),y-origin.y(),z-origin.z()));
                            if(y+2<=max.y()&&clipboard.getBlock(p).getBlockType().getMaterial().isSolid()
                                    &&clipboard.getBlock(p.add(0,1,0)).getBlockType().getMaterial().isAir()
                                    &&clipboard.getBlock(p.add(0,2,0)).getBlockType().getMaterial().isAir()) {
                                if(y<lowest){floor.clear();lowest=y;}
                                if(y==lowest)floor.add(new Vector(x-origin.x(),y+1-origin.y(),z-origin.z()));
                            }
                        }
                        if(floor.size()<3||chests.isEmpty())throw new IllegalStateException("Blueprint needs real walkable ground and loot containers: floor="+floor.size()+" chests="+chests.size());
                        floor.sort(Comparator.comparingDouble(Vector::lengthSquared));
                        List<Vector> mobs=new ArrayList<>();
                        for(Vector v:floor)if(mobs.stream().allMatch(other->other.distanceSquared(v)>=4)){mobs.add(v);if(mobs.size()==3)break;}
                        File target=new File(ol.getDataFolder(),"schematics/qd_forest_camp.schem");target.getParentFile().mkdirs();
                        if(target.exists())throw new IllegalStateException("Fresh schematic required");
                        try(var writer=BuiltInClipboardFormat.SPONGE_SCHEMATIC.getWriter(new FileOutputStream(target))){writer.write(clipboard);}
                        if(!ol.getConfigManager().saveSchematicSetup("qd_forest_camp.schem",mobs,List.of(new Vector(0,3,0)),chests,new Vector()))throw new IllegalStateException("Metadata save failed");
                        if(!ol.getConfigManager().setSchematicForType(MeteorType.SMALL,"qd_forest_camp.schem"))throw new IllegalStateException("Type binding failed");
                        var rewards=Bukkit.createInventory(null,9);
                        rewards.addItem(new ItemStack(Material.BREAD,4),new ItemStack(Material.IRON_INGOT,2),new ItemStack(Material.EMERALD,1));
                        if(ol.getLootGUIEditor().importFromInventory(MeteorType.SMALL,rewards)!=3)throw new IllegalStateException("Native loot import failed");
                        sender.sendMessage("WVQA blueprint dimensions="+clipboard.getDimensions()+" mobs="+mobs+" chests="+chests);
                    }
                }
                case "villagers" -> {
                    World w=Bukkit.getWorld("world");
                    for(String key:getConfig().getConfigurationSection("villagers")==null?Set.<String>of():getConfig().getConfigurationSection("villagers").getKeys(false)){
                        Entity old=Bukkit.getEntity(UUID.fromString(getConfig().getString("villagers."+key)));if(old!=null)old.remove();
                    }
                    for(int i=0;i<3;i++){
                        Location at=new Location(w,-1220.5+i*2,73,-700.5);
                        w.getBlockAt(at.clone().subtract(0,1,0)).setType(Material.STONE);
                        for(int y=0;y<3;y++)w.getBlockAt(at.clone().add(0,y,0)).setType(Material.AIR);
                        Villager v=w.spawn(at,Villager.class);v.setCustomName("测试居民"+i);v.setAI(i!=2);v.setGravity(false);v.setProfession(Villager.Profession.LIBRARIAN);
                        MerchantRecipe recipe=new MerchantRecipe(new ItemStack(Material.BREAD,3),100);recipe.addIngredient(new ItemStack(Material.EMERALD));v.setRecipes(List.of(recipe));
                        getConfig().set("villagers."+i,v.getUniqueId().toString());
                    }saveConfig();sender.sendMessage("WVQA villagers="+getConfig().getConfigurationSection("villagers").getValues(false));
                }
                case "guards" -> {
                    for(var npc:CitizensAPI.getNPCRegistry())if(npc.hasTrait(SentinelTrait.class)){
                        var s=npc.getTrait(SentinelTrait.class);sender.sendMessage("WVQA guard id="+npc.getId()+" uuid="+npc.getUniqueId()+" spawned="+npc.isSpawned()+" damage="+s.stats_damageGiven+" targets="+s.allTargets.targets+" ignores="+s.allIgnores.targets);
                        if(args.length>1&&args[1].equals("attack")&&npc.isSpawned()){
                            var z=npc.getEntity().getWorld().spawn(npc.getEntity().getLocation().clone().add(3,0,0),Zombie.class);z.setAI(false);z.setCustomName("WVQA_guard_target");z.setPersistent(true);
                            sender.sendMessage("WVQA target="+z.getUniqueId()+" selected="+s.allTargets.isTarget(z));
                        }
                    }
                }
                case "guards-install" -> {
                    var p=Bukkit.getPluginManager().getPlugin("WorldVariety");p.reloadConfig();
                    var method=p.getClass().getDeclaredMethod("ensureGuards");method.setAccessible(true);method.invoke(p);
                    sender.sendMessage("WVQA guarded installation invoked");
                }
                case "load-probe-world" -> {
                    World world=Bukkit.createWorld(new WorldCreator("variety_probe"));sender.sendMessage("WVQA probeWorld="+world.getUID());
                }
                case "npc-filter" -> {
                    var plugin=(de.tecca.villagerlife.VillagerLifePlugin)Bukkit.getPluginManager().getPlugin("VillagerLife");
                    var finder=plugin.getRoutineManager().getClass().getDeclaredMethod("findVillager",World.class,UUID.class);finder.setAccessible(true);
                    int fixed=0,wrong=0;
                    for(World w:Bukkit.getWorlds())for(Villager v:w.getEntitiesByClass(Villager.class))if(!v.hasAI()||v.isInsideVehicle()||v.hasMetadata("NPC")){fixed++;if(finder.invoke(plugin.getRoutineManager(),w,v.getUniqueId())!=null)wrong++;}
                    sender.sendMessage("WVQA excludedFixed="+fixed+" incorrect="+wrong+" routines="+plugin.getRoutineManager().getActiveCount());
                }
                case "surface" -> {
                    World w=Bukkit.getWorld("world");int x=Integer.parseInt(args[1]),z=Integer.parseInt(args[2]);
                    for(int y=55;y<=80;y++)if(!w.getBlockAt(x,y,z).getType().isAir())sender.sendMessage("WVQA block "+x+","+y+","+z+"="+w.getBlockAt(x,y,z).getBlockData().getAsString());
                }
                case "player" -> {
                    Player actor=Bukkit.getPlayerExact(args[1]);sender.sendMessage("WVQA player="+(actor==null?"offline":actor.getLocation()+" mode="+actor.getGameMode()));
                }
                case "event" -> {
                    String profile=args[1];World w=Bukkit.getWorld("world");Location at=new Location(w,Integer.parseInt(args[2]),Integer.parseInt(args[3]),Integer.parseInt(args[4]));
                    ol.getEncounterService().startAt(profile,at,sender).whenComplete((result,error)->getLogger().info("WVQA eventResult="+result+" error="+(error==null?"none":error.toString())));
                }
                case "event-auto" -> {
                    ol.getEncounterService().start(args[1],"world",sender).whenComplete((result,error)->getLogger().info("WVQA automaticSearch="+result+" error="+(error==null?"none":error.toString())));
                }
                case "events" -> {
                    for(var event:ol.getMeteorEventManager().getActiveEvents().values())sender.sendMessage("WVQA event="+event.eventId()+" phase="+event.phase()+" center="+event.center()+" mobs="+event.mobSpawnPoints());
                }
                case "profiles" -> {
                    for(var definition:ol.getEncounterRegistry().all())sender.sendMessage("WVQA profile="+definition);
                    for(World w:Bukkit.getWorlds())sender.sendMessage("WVQA world="+w.getName()+" key="+w.getKey());
                }
                case "event-stop" -> {ol.getMeteorEventManager().stopEvent(args[1],sender);}
                case "terrain-check" -> {
                    if(snapshotCenter==null)throw new IllegalStateException("No pre-start snapshot");
                    String after=terrainHash(snapshotCenter);sender.sendMessage("WVQA terrainRestored="+after.equals(snapshotHash)+" before="+snapshotHash+" after="+after);
                }
                case "kill-wave" -> {
                    Player actor=Bukkit.getPlayerExact(args[1]);if(actor==null)throw new IllegalStateException("Online test actor required");
                    int killed=0;for(var e:actor.getNearbyEntities(50,30,50))if(e instanceof Monster m&&!m.hasMetadata("NPC")){m.damage(10000,actor);killed++;}
                    sender.sendMessage("WVQA playerDamageKills="+killed);
                }
                default -> throw new IllegalArgumentException("Unknown private fixture");
            }
        }catch(Exception error){sender.sendMessage("WVQA FAILED "+error);error.printStackTrace();}
        return true;
    }
}
