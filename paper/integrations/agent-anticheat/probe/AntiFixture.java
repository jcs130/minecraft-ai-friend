package org.qiandengji.qa;
import org.bukkit.*;import org.bukkit.command.*;import org.bukkit.entity.Player;import org.bukkit.plugin.java.JavaPlugin;
import java.util.*;import java.util.function.*;import java.lang.reflect.*;

/** Console-only fixture; refuses any production port or non-loopback bind. */
public final class AntiFixture extends JavaPlugin {
    @Override public void onEnable(){if(Bukkit.getPort()!=25924||!Bukkit.getIp().equals("127.0.0.1"))throw new IllegalStateException("isolated_fixture_only");}
    @Override public boolean onCommand(CommandSender sender,Command cmd,String label,String[] args){
        if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return true;
        try{
            Player p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalArgumentException("player_not_found");
            if(args[0].equals("inspect")){
                var guard=Bukkit.getPluginManager().getPlugin("QiandengjiAntiCheat");boolean serverBody=(boolean)guard.getClass().getMethod("isServerBody",Player.class).invoke(guard,p);
                sender.sendMessage("ACQA native="+serverBody+" fly="+p.isFlying()+" allow="+p.getAllowFlight()+" x="+p.getLocation().getX()+" y="+p.getLocation().getY()+" z="+p.getLocation().getZ());
            }else if(args[0].equals("spawn")){
                var api=Bukkit.getPluginManager().getPlugin("numen_api");var loader=api.getClass().getClassLoader();
                Object server=Bukkit.getServer().getClass().getMethod("getServer").invoke(Bukkit.getServer());Object level=p.getWorld().getClass().getMethod("getHandle").invoke(p.getWorld());
                Object pos=loader.loadClass("net.minecraft.world.phys.Vec3").getConstructor(double.class,double.class,double.class).newInstance(p.getLocation().getX()+2,p.getLocation().getY(),p.getLocation().getZ());
                Class<?> factory=loader.loadClass("com.dwinovo.numen.api.entity.CompanionFactory");Method spawn=Arrays.stream(factory.getMethods()).filter(m->m.getName().equals("spawn")&&m.getParameterCount()==8).findFirst().orElseThrow();
                UUID id=UUID.nameUUIDFromBytes("QD_ANTICHEAT_QA_NATIVE_ONLY".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                spawn.invoke(null,server,id,"ACNativeBody",p.getUniqueId(),level,pos,(BooleanSupplier)this::isEnabled,(Consumer<Object>)arrival->sender.sendMessage("ACQA arrival_callback"));
            }else if(args[0].equals("ranged")){
                var mob=p.getWorld().spawn(p.getLocation().clone().add(-10,0,0),org.bukkit.entity.Zombie.class);mob.setAI(false);mob.setSilent(true);mob.addScoreboardTag("qd_ac_ranged");mob.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).setBaseValue(1000);mob.setHealth(1000);mob.getEquipment().setHelmet(new org.bukkit.inventory.ItemStack(Material.IRON_HELMET));sender.sendMessage("ACQA ranged_ready");
            }else if(args[0].equals("hp")){
                var mob=p.getNearbyEntities(16,6,16).stream().filter(e->e.getScoreboardTags().contains("qd_ac_ranged")).findFirst().orElseThrow();sender.sendMessage("ACQA health="+((org.bukkit.entity.LivingEntity)mob).getHealth());
            }else if(args[0].equals("tool")){
                var tool=new org.bukkit.inventory.ItemStack(Material.DIAMOND_PICKAXE);tool.addUnsafeEnchantment(org.bukkit.enchantments.Enchantment.EFFICIENCY,5);p.getInventory().addItem(tool);
                var at=p.getLocation();at.getBlock().getRelative(2,0,0).setType(Material.STONE);sender.sendMessage("ACQA tool_ready");
            }else throw new IllegalArgumentException("unsupported_fixture");
        }catch(Exception e){sender.sendMessage("ACQA_ERROR "+e.getClass().getSimpleName()+":"+e.getMessage());}
        return true;
    }
}
