package org.qdqa;

import java.util.*;
import java.lang.reflect.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import dev.aurelium.auraskills.api.AuraSkillsApi;

/** Test-only console fixture. Refuses to enable outside the loopback test port. */
public final class ConquestFixture extends JavaPlugin implements CommandExecutor,org.bukkit.event.Listener {
    final Map<String,UUID> mobs=new HashMap<>();
    final Set<UUID> vetoTargets=new HashSet<>();
    final Set<UUID> vetoDamageTargets=new HashSet<>();
    final Map<UUID,String> damageEvents=new HashMap<>();
    final Map<UUID,String> delegateEvents=new HashMap<>();
    @Override public void onEnable(){
        if(Bukkit.getPort()!=25924||!Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("isolated_fixture_only");
        getCommand("qdqa").setExecutor(this);
        Bukkit.getPluginManager().registerEvents(this,this);
    }
    @Override public void onDisable(){for(UUID id:mobs.values()){var mob=Bukkit.getEntity(id);if(mob!=null)mob.remove();}}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.LOWEST)
    public void veto(org.bukkit.event.entity.EntityTargetLivingEntityEvent e){if(e.getReason()==org.bukkit.event.entity.EntityTargetEvent.TargetReason.CUSTOM&&e.getTarget()!=null&&vetoTargets.contains(e.getTarget().getUniqueId()))e.setCancelled(true);}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.LOWEST)
    public void vetoDamage(org.bukkit.event.entity.EntityDamageEvent e){if(vetoDamageTargets.contains(e.getEntity().getUniqueId()))e.setCancelled(true);}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void damageObserved(org.bukkit.event.entity.EntityDamageEvent e){if(e.getEntity() instanceof LivingEntity p)damageEvents.put(p.getUniqueId(),"cancelled="+e.isCancelled()+" final="+e.getFinalDamage()+" cause="+e.getCause());}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void guardObserved(com.sk89q.worldguard.bukkit.event.entity.DamageEntityEvent e){
        if(delegateEvents.size()<128)delegateEvents.put(e.getEntity().getUniqueId(),"result="+e.getResult()+" flags="+e.getRelevantFlags()+" firstPlayer="+e.getCause().getFirstPlayer()+" root="+e.getCause().getRootCause());
    }
    Object call(Object target,String name,Class<?>[] types,Object...args)throws Exception{var m=target.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(target,args);}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try{
            String op=args[0];Player p=args.length>1?Bukkit.getPlayerExact(args[1]):null;
            var plugin=Bukkit.getPluginManager().getPlugin("AgentFriend");
            switch(op){
                case "setup"->{p.setGameMode(GameMode.SURVIVAL);p.setOp(false);var w=Bukkit.getWorld("world");
                    for(int x=2;x<=20;x++)for(int z=2;z<=20;z++){w.getBlockAt(x,64,z).setType(Material.STONE);for(int y=65;y<=68;y++)w.getBlockAt(x,y,z).setType(Material.AIR);}
                    p.teleport(new Location(w,10.5,65,10.5,180,0));p.getInventory().clear();p.getInventory().setItem(0,new ItemStack(Material.IRON_SWORD));
                    p.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD));p.setFoodLevel(20);p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());
                    var u=AuraSkillsApi.get().getUser(p.getUniqueId());u.setMana(u.getMaxMana());}
                case "mana"->{var u=AuraSkillsApi.get().getUser(p.getUniqueId());u.setMana(u.getMaxMana());}
                case "shield"->p.getInventory().setItemInOffHand(new ItemStack(args[2].equals("yes")?Material.SHIELD:Material.AIR));
                case "spawn"->{for(var old:p.getNearbyEntities(8,4,8))if(old instanceof Zombie z&&!z.hasAI()&&z.isSilent())old.remove();
                    Mob mob=(Mob)p.getWorld().spawnEntity(p.getLocation().clone().add(0,0,-3),EntityType.ZOMBIE);mob.setAI(false);mob.setSilent(true);
                    mob.getEquipment().setHelmet(new ItemStack(Material.IRON_HELMET));
                    mob.getPersistentDataContainer().set(new NamespacedKey(plugin,"combat_origin"),PersistentDataType.STRING,"NATURAL");mobs.put(p.getName(),mob.getUniqueId());}
                case "target"->{var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));mob.setTarget(Bukkit.getPlayerExact(args[2]));sender.sendMessage("target="+(mob.getTarget()==null?"none":mob.getTarget().getName()));}
                case "targetevent"->{var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));var e=new org.bukkit.event.entity.EntityTargetLivingEntityEvent(mob,Bukkit.getPlayerExact(args[2]),org.bukkit.event.entity.EntityTargetEvent.TargetReason.CLOSEST_PLAYER);Bukkit.getPluginManager().callEvent(e);if(!e.isCancelled())mob.setTarget(e.getTarget());sender.sendMessage("target="+(mob.getTarget()==null?"none":mob.getTarget().getName()));}
                case "veto"->{if(args[2].equals("yes"))vetoTargets.add(p.getUniqueId());else vetoTargets.remove(p.getUniqueId());}
                case "damageveto"->{var id=mobs.get(p.getName());if(args[2].equals("yes"))vetoDamageTargets.add(id);else vetoDamageTargets.remove(id);}
                case "difficulty"->{var world=Bukkit.getWorld("aincrad");world.setDifficulty(args.length>1&&args[1].equals("easy")?Difficulty.EASY:Difficulty.NORMAL);sender.sendMessage("difficulty="+world.getDifficulty());}
                case "hurtcast"->{
                    // One genuine strong hit followed immediately by the normal
                    // player's spell dispatcher exercises native hurt immunity.
                    var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));
                    mob.damage(8,p);double before=mob.getHealth();
                    sender.sendMessage("beforeSpell="+before+" ticks="+mob.getNoDamageTicks()+" last="+mob.getLastDamage());
                    Bukkit.dispatchCommand(p,"mycli cast sword_thrust");
                    sender.sendMessage("afterSpell="+mob.getHealth());
                }
                case "metrics"->{sender.sendMessage("mana="+AuraSkillsApi.get().getUser(p.getUniqueId()).getMana()+" health="+p.getHealth());}
                case "encounter"->{
                    var rows=new ArrayList<Map<String,Object>>();
                    for(var entity:p.getNearbyEntities(24,8,24))if(entity instanceof Mob mob&&mob.getScoreboardTags().contains("afu_site_dungeon"))
                        rows.add(Map.of("id",mob.getEntityId(),"health",mob.getHealth(),"x",mob.getLocation().getX(),"y",mob.getLocation().getY(),"z",mob.getLocation().getZ(),"event",damageEvents.getOrDefault(mob.getUniqueId(),"none"),"guard",delegateEvents.getOrDefault(mob.getUniqueId(),"none")));
                    sender.sendMessage(new com.google.gson.Gson().toJson(Map.of("mobs",rows,"player",p.getLocation().toString(),"hand",p.getInventory().getItemInMainHand().getType().name())));
                }
                case "mob"->{var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));sender.sendMessage(mob==null?"missing":"target="+(mob.getTarget()==null?"none":mob.getTarget().getName())+" health="+mob.getHealth()+" fire="+mob.getFireTicks()+" location="+mob.getLocation()+" ticks="+mob.getNoDamageTicks()+" lastDamage="+mob.getLastDamage()+" event="+damageEvents.get(mob.getUniqueId())+" guard="+delegateEvents.get(mob.getUniqueId()));}
                case "damage"->{
                    var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));p.setNoDamageTicks(0);double before=p.getHealth();damageEvents.remove(p.getUniqueId());
                    // Model an enemy actually attacking this player. WorldGuard
                    // attributes a Creature's damage to its current target; a
                    // hit on somebody else correctly becomes a PvP denial.
                    LivingEntity previous=mob.getTarget();
                    try{mob.setTarget(p);p.damage(Double.parseDouble(args[2]),mob);}finally{mob.setTarget(previous);}
                    sender.sendMessage("damage="+(before-p.getHealth())+" "+damageEvents.get(p.getUniqueId())+" invulnerable="+p.isInvulnerable()+" absorption="+p.getAbsorptionAmount()+" effects="+p.getActivePotionEffects()+" difficulty="+p.getWorld().getDifficulty()+" location="+p.getLocation()+" guard="+delegateEvents.get(p.getUniqueId()));
                }
                case "finish"->{var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));mob.setNoDamageTicks(0);mob.damage(100,p);}
                case "heal"->{p.setHealth(8);p.setNoDamageTicks(0);}
                case "state"->{var combat=call(plugin,"combatRpg",new Class<?>[]{});sender.sendMessage(call(combat,"state",new Class<?>[]{Player.class},p).toString());}
                case "castle"->{var w=Bukkit.getWorld("aincrad");if(!p.teleport(new Location(w,856.5,69,-1143.5)))throw new IllegalStateException("fixture teleport rejected");}
                case "guide"->{if(!p.teleport(new Location(Bukkit.getWorld("world"),10.5,5,10.5)))throw new IllegalStateException("guide teleport rejected");}
                case "protection"->{
                    var w=Bukkit.getWorld("aincrad");var inside=w.getBlockAt(856,68,-1144);var outside=w.getBlockAt(896,68,-1144);
                    var a=new org.bukkit.event.block.BlockBreakEvent(inside,p);Bukkit.getPluginManager().callEvent(a);
                    var b=new org.bukkit.event.block.BlockBreakEvent(outside,p);Bukkit.getPluginManager().callEvent(b);
                    var flow=new org.bukkit.event.block.BlockFromToEvent(inside.getRelative(0,1,0),inside);Bukkit.getPluginManager().callEvent(flow);
                    var blocks=new ArrayList<org.bukkit.block.Block>(List.of(inside,outside));
                    var explosion=new org.bukkit.event.block.BlockExplodeEvent(outside,outside.getState(),blocks,1,ExplosionResult.DESTROY);Bukkit.getPluginManager().callEvent(explosion);
                    sender.sendMessage("inside="+a.isCancelled()+" outside="+b.isCancelled()+" fluid="+flow.isCancelled()+" explosionPreserved="+!explosion.blockList().contains(inside)+" explosionOutside="+explosion.blockList().contains(outside));
                }
                case "trusted"->{
                    var file=new java.io.File(((JavaPlugin)plugin).getDataFolder(),"block-access.yml");
                    byte[] before=java.nio.file.Files.readAllBytes(file.toPath());
                    try{
                        var data=org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(file);
                        var editors=new ArrayList<>(data.getStringList("editors"));editors.add(p.getUniqueId().toString());data.set("editors",editors);data.save(file);
                        Bukkit.dispatchCommand(Bukkit.getConsoleSender(),"mycli admin blockaccess reload");
                        var block=Bukkit.getWorld("aincrad").getBlockAt(856,68,-1144);
                        var broken=new org.bukkit.event.block.BlockBreakEvent(block,p);Bukkit.getPluginManager().callEvent(broken);
                        var placed=new org.bukkit.event.block.BlockPlaceEvent(block,block.getState(),block.getRelative(0,-1,0),new ItemStack(Material.COBBLESTONE),p,true,org.bukkit.inventory.EquipmentSlot.HAND);Bukkit.getPluginManager().callEvent(placed);
                        if(broken.isCancelled()||placed.isCancelled()||!placed.canBuild())throw new IllegalStateException("trusted editor blocked by encounter protection");
                        sender.sendMessage("trustedBreak=true trustedPlace=true");
                    }finally{
                        java.nio.file.Files.write(file.toPath(),before);Bukkit.dispatchCommand(Bukkit.getConsoleSender(),"mycli admin blockaccess reload");
                    }
                }
                case "kit"->{p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.getInventory().clear();
                    p.getInventory().setItem(0,new ItemStack(Material.IRON_SWORD));p.getInventory().setItem(1,new ItemStack(Material.COOKED_BEEF,32));
                    p.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD));
                    p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),new ItemStack(Material.IRON_LEGGINGS),new ItemStack(Material.IRON_CHESTPLATE),new ItemStack(Material.IRON_HELMET)});
                    p.setFoodLevel(20);p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());}
                case "recover"->{p.setFireTicks(0);p.setFoodLevel(20);p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());var u=AuraSkillsApi.get().getUser(p.getUniqueId());u.setMana(u.getMaxMana());}
                case "lethal"->{
                    // Exercise the real cancellable damage/rescue event. Never
                    // mark a player revived, kill a wave, or write a clear proof.
                    Mob source=null;
                    for(var entity:p.getNearbyEntities(24,8,24))if(entity instanceof Mob mob&&mob.getScoreboardTags().contains("afu_site_dungeon")){
                        mob.setAI(false);if(source==null)source=mob;
                    }
                    if(source==null)throw new IllegalStateException("actual encounter enemy required");
                    p.setNoDamageTicks(0);damageEvents.remove(p.getUniqueId());
                    LivingEntity previous=source.getTarget();
                    try{source.setTarget(p);p.damage(1000,source);}finally{source.setTarget(previous);}
                    sender.sendMessage("lethalHealth="+p.getHealth()+" invulnerable="+p.isInvulnerable()+" event="+damageEvents.get(p.getUniqueId())+" at="+p.getLocation());
                }
                case "rescue"->{var rescue=call(plugin,"trialRescue",new Class<?>[]{});sender.sendMessage(call(rescue,"state",new Class<?>[]{Player.class},p).toString());}
                case "receipt"->{var data=((JavaPlugin)plugin).getConfig();sender.sendMessage("receipt="+data.contains("site-dungeons.receipts."+p.getUniqueId()+".aincrad_01")+" claimed="+data.getString("site-dungeons.claimed."+p.getUniqueId()+".aincrad_01","")+" floorProof="+data.contains("site-dungeons.conquest-proofs."+p.getUniqueId()+".1"));}
                case "cooldown"->{((JavaPlugin)plugin).getConfig().set("site-dungeons.cooldowns.aincrad_01",0);}
                case "floors"->{var w=Bukkit.getWorld("aincrad");int x=Integer.parseInt(args[1]),z=Integer.parseInt(args[2]);var rows=new ArrayList<Integer>();for(int y=70;y<112;y++)if(w.getBlockAt(x,y,z).isPassable()&&w.getBlockAt(x,y+1,z).isPassable()&&w.getBlockAt(x,y-1,z).getType().isSolid())rows.add(y);sender.sendMessage(rows.toString());}
                default->throw new IllegalArgumentException("unknown fixture operation");
            }
            sender.sendMessage("QDQA_OK "+op);
        }catch(Exception e){sender.sendMessage("QDQA_ERROR "+e);getLogger().log(java.util.logging.Level.WARNING,"fixture failure",e);}
        return true;
    }
}
