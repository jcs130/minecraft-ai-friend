package org.qiandengji.usabilityqa;
import java.nio.file.*;import org.bukkit.*;import org.bukkit.entity.*;import org.bukkit.command.*;import org.bukkit.inventory.*;import org.bukkit.plugin.java.JavaPlugin;import io.vortexcore.VortexCorePlugin;
/** Console-only bounded setup and independent observations, marked QA port only. */
public final class UsabilityQA extends JavaPlugin implements org.bukkit.event.Listener {
    private VortexCorePlugin vortex;
    private record DamageRead(long count,double damage,boolean cancelled){}
    private final java.util.Map<java.util.UUID,DamageRead> observed=new java.util.HashMap<>();
    @Override public void onEnable(){try{if(getServer().getPort()!=25928||!getServer().getIp().equals("127.0.0.1")||!Files.readString(Path.of(".qa-only")).equals("VORTEX_TAKEOVER_QA_ONLY"))throw new IllegalStateException("not marked QA");}catch(Exception e){throw new IllegalStateException(e);}vortex=(VortexCorePlugin)getServer().getPluginManager().getPlugin("VortexRPG");Bukkit.getPluginManager().registerEvents(this,this);}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR)
    public void damage(org.bukkit.event.entity.EntityDamageEvent event){if(event.getEntity() instanceof Player p&&p.getName().matches("ag_RU[a-zA-Z0-9]{1,10}")){var old=observed.get(p.getUniqueId());observed.put(p.getUniqueId(),new DamageRead(old==null?1:old.count()+1,event.getFinalDamage(),event.isCancelled()));}}
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args){
        if(sender instanceof Player)throw new IllegalArgumentException("console fixture only");if(args.length<2)throw new IllegalArgumentException("action and QA actor required");
        Player p=Bukkit.getPlayerExact(args[1]);if(p==null||!p.getName().matches("ag_RU[a-zA-Z0-9]{1,10}"))throw new IllegalArgumentException("new QA identities only");
        var state=vortex.playerProfileService().profile(p);
        switch(args[0]){
            case "mana"->{double n=Double.parseDouble(args[2]);if(!Double.isFinite(n)||n<0||n>500)throw new IllegalArgumentException("bounded mana");vortex.qiandengjiMana().setMana(p.getUniqueId(),n);}
            case "xp"->{long n=Long.parseLong(args[2]);if(n<0||n>10000)throw new IllegalArgumentException("bounded xp");vortex.playerProfileService().grantExperience(p,n,"isolated-usability-fixture");}
            case "points"->{int n=Integer.parseInt(args[2]);if(n<0||n>20)throw new IllegalArgumentException("bounded points");state.putMetadata("rpg.skill_points",Integer.toString(n));}
            case "armor"->{p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),new ItemStack(Material.IRON_LEGGINGS),new ItemStack(Material.IRON_CHESTPLATE),new ItemStack(Material.IRON_HELMET)});}
            case "heal"->{p.setHealth(p.getMaxHealth());p.setNoDamageTicks(0);}
            case "hunger"->{int n=Integer.parseInt(args[2]);if(n<0||n>20)throw new IllegalArgumentException("bounded hunger");p.setFoodLevel(n);p.setSaturation(0);}
            case "fullbag"->{for(int i=0;i<36;i++)p.getInventory().setItem(i,new ItemStack(Material.STONE,64));}
            case "emptybag"->{for(int i=0;i<36;i++)p.getInventory().setItem(i,null);}
            case "clearhostiles"->{for(var entity:p.getNearbyEntities(24,24,24))if(entity instanceof Monster)entity.remove();}
            case "inspect"->{}
            default->throw new IllegalArgumentException("unknown fixture action");
        }
        var resistance=p.getPotionEffect(org.bukkit.potion.PotionEffectType.RESISTANCE);var damage=observed.get(p.getUniqueId());
        var ray=p.getWorld().rayTraceBlocks(p.getEyeLocation(),p.getEyeLocation().getDirection(),25);
        String party=vortex.expeditionPartyManager().partyOf(p.getUniqueId()).map(s->s.name()+"/"+s.members().size()).orElse("none");sender.sendMessage("QA mana="+vortex.qiandengjiMana().getMana(p.getUniqueId())+" health="+p.getHealth()+" maxHealth="+p.getMaxHealth()+" level="+state.level()+" xp="+state.experience()+" points="+vortex.classSkillService().unspentSkillPoints(state)+" balance="+vortex.qiandengjiVault().balance(p)+" party="+party+" resistance="+(resistance==null?-1:resistance.getAmplifier())+" resistanceTicks="+(resistance==null?0:resistance.getDuration())+" damageEvents="+(damage==null?0:damage.count())+" cancelled="+(damage!=null&&damage.cancelled()?1:0)+" finalDamage="+(damage==null?-1:damage.damage())+" yaw="+p.getYaw()+" pitch="+p.getPitch()+" ray="+(ray==null?"none":ray.getHitBlock().getLocation().toVector()));return true;
    }
}
