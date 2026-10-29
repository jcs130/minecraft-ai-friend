package org.qiandengji.guidanceqa;
import java.nio.file.*;import java.util.*;
import org.bukkit.*;import org.bukkit.attribute.Attribute;import org.bukkit.command.*;import org.bukkit.enchantments.Enchantment;import org.bukkit.entity.*;import org.bukkit.event.*;import org.bukkit.event.entity.EntityDamageByEntityEvent;import org.bukkit.event.player.PlayerJoinEvent;import org.bukkit.inventory.*;import org.bukkit.persistence.PersistentDataType;import org.bukkit.plugin.java.JavaPlugin;

/** Marked loopback fixture only. Never deployed to production. */
public final class GuidanceQA extends JavaPlugin implements Listener {
 private double base,finalDamage;
 @EventHandler public void join(PlayerJoinEvent e){if(!qa(e.getPlayer()))return;e.getPlayer().setGameMode(GameMode.CREATIVE);e.getPlayer().getPersistentDataContainer().set(new NamespacedKey("agentfriend","coach_enabled"),PersistentDataType.BYTE,(byte)0);}
 @EventHandler(priority=EventPriority.LOWEST,ignoreCancelled=true)public void hitBase(EntityDamageByEntityEvent e){if(e.getDamager()instanceof Player p&&qa(p)&&e.getEntity().getScoreboardTags().contains("qd_enchant_target"))base=e.getDamage();}
 @EventHandler(priority=EventPriority.MONITOR)public void hitFinal(EntityDamageByEntityEvent e){if(e.getEntity()instanceof Player p&&qa(p)&&!e.isCancelled())finalDamage=e.getFinalDamage();}
 private boolean qa(Player p){return p.getName().matches("ag_GQA[a-z0-9]{1,10}");}
 @Override public void onEnable(){try{if(getServer().getPort()!=25928||!"127.0.0.1".equals(getServer().getIp())||!Files.readString(Path.of(".qa-only")).equals("VORTEX_TAKEOVER_QA_ONLY"))throw new Exception("not QA");}catch(Exception e){throw new IllegalStateException(e);}
  getServer().getPluginManager().registerEvents(this,this);
  getServer().getCommandMap().register("qa",new Command("gqa"){@Override public boolean execute(CommandSender s,String label,String[] a){if(!(s instanceof ConsoleCommandSender)&&!(s instanceof RemoteConsoleCommandSender))return true;try{
   Player p=Bukkit.getPlayerExact(a[0]);if(p==null||!qa(p))throw new IllegalArgumentException("QA player required");String op=a[1];
   if(op.equals("gear")){String type=a[2];ItemStack item=new ItemStack(type.startsWith("pick")?Material.DIAMOND_PICKAXE:Material.DIAMOND_SWORD);
    if(type.equals("enchanted")||type.equals("old"))item.addUnsafeEnchantment(Enchantment.SHARPNESS,5);
    if(type.equals("pickench"))item.addUnsafeEnchantment(Enchantment.EFFICIENCY,5);
    if(type.equals("mending")){item=new ItemStack(Material.DIAMOND_PICKAXE);item.addUnsafeEnchantment(Enchantment.MENDING,1);var meta=(org.bukkit.inventory.meta.Damageable)item.getItemMeta();meta.setDamage(100);item.setItemMeta(meta);}
    if(type.equals("old")){var meta=item.getItemMeta();meta.getPersistentDataContainer().set(new NamespacedKey("agentfriend","imprint_spell"),PersistentDataType.STRING,"selfheal");item.setItemMeta(meta);}
    p.getInventory().setItem(0,item);p.getInventory().setHeldItemSlot(0);p.setLevel(12);p.getInventory().setItem(9,new ItemStack(Material.LAPIS_LAZULI,3));s.sendMessage("PASS gear "+type);
   }else if(op.equals("speed")){s.sendMessage("SPEED "+p.getWorld().getBlockAt(p.getLocation().getBlockX()+1,p.getLocation().getBlockY(),p.getLocation().getBlockZ()).getBreakSpeed(p));
   }else if(op.equals("inspect")){var item=p.getInventory().getItemInMainHand();int damage=item.getItemMeta()instanceof org.bukkit.inventory.meta.Damageable m?m.getDamage():0;int rev=p.getPersistentDataContainer().getOrDefault(new NamespacedKey("agentfriend","onboarding_release_revision"),PersistentDataType.INTEGER,0);s.sendMessage("STATE damage="+damage+" level="+p.getLevel()+" lapis="+Arrays.stream(p.getInventory().getContents()).filter(Objects::nonNull).filter(i->i.getType()==Material.LAPIS_LAZULI).mapToInt(ItemStack::getAmount).sum()+" revision="+rev+" sharp="+item.getEnchantmentLevel(Enchantment.SHARPNESS)+" enchantCount="+item.getEnchantments().size()+" hash="+Arrays.hashCode(item.serializeAsBytes()));
   }else if(op.equals("damage")){s.sendMessage("DAMAGE base="+base+" final="+finalDamage);
   }else if(op.equals("armor")){var armor=new ItemStack[]{new ItemStack(Material.LEATHER_BOOTS),new ItemStack(Material.LEATHER_LEGGINGS),new ItemStack(Material.LEATHER_CHESTPLATE),new ItemStack(Material.LEATHER_HELMET)};if(a[2].equals("enchanted"))for(var item:armor)item.addUnsafeEnchantment(Enchantment.PROTECTION,4);p.getInventory().setArmorContents(armor);s.sendMessage("PASS armor");
   }else if(op.equals("hurt")){for(var effect:p.getActivePotionEffects())p.removePotionEffect(effect.getType());p.setNoDamageTicks(0);p.setHealth(p.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue());finalDamage=-1;var enemy=p.getWorld().spawn(p.getLocation().add(2,0,0),Zombie.class,z->{z.setAI(false);z.setSilent(true);});p.damage(8,enemy);enemy.remove();s.sendMessage("DAMAGE final="+finalDamage);
   }else if(op.equals("orb")){p.getWorld().spawn(p.getLocation().add(0,.2,0),ExperienceOrb.class,e->e.setExperience(10));s.sendMessage("PASS orb");
   }else throw new IllegalArgumentException("operation");
  }catch(Exception e){s.sendMessage("FAIL "+e.getMessage());}return true;}});
 }
}
