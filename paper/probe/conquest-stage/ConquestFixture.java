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
    final Map<UUID,String> damageEvents=new HashMap<>();
    @Override public void onEnable(){
        if(Bukkit.getPort()!=25924||!Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("isolated_fixture_only");
        getCommand("qdqa").setExecutor(this);
        Bukkit.getPluginManager().registerEvents(this,this);
    }
    @Override public void onDisable(){for(UUID id:mobs.values()){var mob=Bukkit.getEntity(id);if(mob!=null)mob.remove();}}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.LOWEST)
    public void veto(org.bukkit.event.entity.EntityTargetLivingEntityEvent e){if(e.getReason()==org.bukkit.event.entity.EntityTargetEvent.TargetReason.CUSTOM&&e.getTarget()!=null&&vetoTargets.contains(e.getTarget().getUniqueId()))e.setCancelled(true);}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void damageObserved(org.bukkit.event.entity.EntityDamageEvent e){if(e.getEntity() instanceof Player p)damageEvents.put(p.getUniqueId(),"cancelled="+e.isCancelled()+" final="+e.getFinalDamage()+" cause="+e.getCause());}
    Object call(Object target,String name,Class<?>[] types,Object...args)throws Exception{var m=target.getClass().getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(target,args);}
    // QA-only observer preserves listener order and delegates each listener exactly
    // once. Restore immediately; never cancel/uncancel a protected damage event.
    String traceDamage(Player p,Mob mob,double amount){
        var handlers=org.bukkit.event.entity.EntityDamageEvent.getHandlerList();
        var original=handlers.getRegisteredListeners();var wrapped=new ArrayList<org.bukkit.plugin.RegisteredListener>();
        var changes=new ArrayList<String>();
        for(var listener:original){handlers.unregister(listener);var wrapper=new org.bukkit.plugin.RegisteredListener(listener.getListener(),(ignored,event)->{
            var e=(org.bukkit.event.entity.EntityDamageEvent)event;boolean before=e.isCancelled();listener.callEvent(event);
            if(e.getEntity()==p&&before!=e.isCancelled())changes.add(listener.getPlugin().getName()+":"+listener.getListener().getClass().getSimpleName()+" cancelled="+e.isCancelled());
        },listener.getPriority(),listener.getPlugin(),false);handlers.register(wrapper);wrapped.add(wrapper);}
        try{p.damage(amount,mob);}finally{for(var listener:wrapped)handlers.unregister(listener);for(var listener:original)handlers.register(listener);}
        return changes.toString();
    }
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
                case "metrics"->{sender.sendMessage("mana="+AuraSkillsApi.get().getUser(p.getUniqueId()).getMana()+" health="+p.getHealth());}
                case "mob"->{var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));sender.sendMessage(mob==null?"missing":"target="+(mob.getTarget()==null?"none":mob.getTarget().getName())+" health="+mob.getHealth()+" fire="+mob.getFireTicks()+" location="+mob.getLocation());}
                case "damage"->{var mob=(Mob)Bukkit.getEntity(mobs.get(p.getName()));p.setNoDamageTicks(0);double before=p.getHealth();damageEvents.remove(p.getUniqueId());var changes=traceDamage(p,mob,Double.parseDouble(args[2]));sender.sendMessage("damage="+(before-p.getHealth())+" "+damageEvents.get(p.getUniqueId())+" invulnerable="+p.isInvulnerable()+" absorption="+p.getAbsorptionAmount()+" effects="+p.getActivePotionEffects()+" difficulty="+p.getWorld().getDifficulty()+" location="+p.getLocation()+" transitions="+changes);}
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
                case "kit"->{p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.getInventory().clear();
                    p.getInventory().setItem(0,new ItemStack(Material.IRON_SWORD));p.getInventory().setItem(1,new ItemStack(Material.COOKED_BEEF,32));
                    p.getInventory().setItemInOffHand(new ItemStack(Material.SHIELD));
                    p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),new ItemStack(Material.IRON_LEGGINGS),new ItemStack(Material.IRON_CHESTPLATE),new ItemStack(Material.IRON_HELMET)});
                    p.setFoodLevel(20);p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());}
                case "recover"->{p.setFireTicks(0);p.setFoodLevel(20);p.setHealth(p.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue());var u=AuraSkillsApi.get().getUser(p.getUniqueId());u.setMana(u.getMaxMana());}
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
