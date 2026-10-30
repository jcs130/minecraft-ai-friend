package org.qiandengji.vortex.tests;

import com.google.gson.Gson;
import com.earth2me.essentials.Essentials;
import dev.aurelium.auraskills.api.skill.Skills;
import dev.aurelium.auraskills.bukkit.AuraSkills;
import dev.aurelium.auraskills.bukkit.commands.ReloadExecutor;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.rpg.ExperienceProgress;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.*;
import org.bukkit.plugin.java.JavaPlugin;

/** Test-only console fixture. Never load in the production runtime. */
public final class GrowthPlatformFixture extends JavaPlugin {
    private final Gson gson=new Gson();
    private final List<LivingEntity> targets=new ArrayList<>();
    private Boolean coldAsyncNull;private String coldAsyncError;
    @Override public void onEnable(){
        if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29397)throw new IllegalStateException("Marked loopback fixture only");
        try{if(!java.nio.file.Files.readString(java.nio.file.Path.of(".communication-qa")).strip().equals("127.0.0.1:29397 20261030"))throw new IllegalStateException("Own marker required");}catch(java.io.IOException e){throw new IllegalStateException(e);}
        getServer().getCommandMap().register("growthfixture",new Command("growthqa"){
            @Override public boolean execute(CommandSender s,String label,String[] args){
                if(!(s instanceof ConsoleCommandSender)&&!(s instanceof RemoteConsoleCommandSender))return false;
                if(args.length<2||!args[1].matches("ag_RG[a-z0-9]{3,10}"))throw new IllegalArgumentException("Own fixture actor required");
                Player p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("QA actor offline");
                try{run(s,p,args);}catch(Exception e){throw new IllegalStateException(e);}return true;
            }
        });
    }
    private VortexCorePlugin vortex(){return (VortexCorePlugin)Bukkit.getPluginManager().getPlugin("VortexRPG");}
    private void refill(Player p){vortex().qiandengjiMana().setMana(p.getUniqueId(),vortex().qiandengjiMana().getMaxMana(p));p.setHealth(p.getMaxHealth());p.setFoodLevel(20);}
    private void cleanTargets(World world){for(var e:world.getNearbyEntities(new Location(world,105.5,81,.5),4,3,2))if(e instanceof Husk h&&!h.hasAI())h.remove();targets.clear();}
    private void run(CommandSender s,Player p,String[] a)throws Exception{
        var v=vortex();if(v.playerProfileService().qiandengjiLoading(p.getUniqueId())){s.sendMessage("GROWTH_QA loading");return;}
        var aura=(AuraSkills)Bukkit.getPluginManager().getPlugin("AuraSkills");
        switch(a[0]){
            case "setup"->{
                World w=Bukkit.getWorld("world");
                cleanTargets(w);
                for(int x=98;x<=130;x++)for(int z=-3;z<=3;z++)for(int y=80;y<=85;y++)w.getBlockAt(x,y,z).setType(y==80?Material.STONE:Material.AIR,false);
                for(int x=-545;x<=-543;x++)for(int z=-441;z<=-439;z++)for(int y=65;y<=69;y++)w.getBlockAt(x,y,z).setType(y==65?Material.COBBLESTONE:y==66?Material.GRASS_BLOCK:Material.AIR,false);
                w.getBlockAt(-544,67,-440).setType(Material.REDSTONE_WIRE,false);
                p.setGameMode(GameMode.SURVIVAL);p.teleport(new Location(w,102.5,81,.5));refill(p);
                ((Essentials)Bukkit.getPluginManager().getPlugin("Essentials")).getWarps().setWarp("village",new Location(w,-543.5,66.9375,-439.5));
                aura.getApi().getUser(p.getUniqueId()).setSkillLevel(Skills.AGILITY,9,false);
                aura.getApi().getUser(p.getUniqueId()).setSkillXp(Skills.AGILITY,20);
            }
            case "homefix"->{var ess=(Essentials)Bukkit.getPluginManager().getPlugin("Essentials");Location loc=ess.getWarps().getWarp("village").clone();loc.setY(67);ess.getWarps().setWarp("village",loc);}
            case "refill"->refill(p);
            case "pad"->{p.teleport(new Location(Bukkit.getWorld("world"),102.5,81,.5));refill(p);}
            case "fall"->{refill(p);p.removePotionEffect(org.bukkit.potion.PotionEffectType.SLOW_FALLING);p.teleport(new Location(Bukkit.getWorld("world"),103.5,90,.5));}
            case "wound"->{refill(p);p.setHealth(Math.max(1,p.getMaxHealth()-6));}
            case "hungry"->{refill(p);p.setFoodLevel(12);p.setSaturation(0);}
            case "targets"->{
                cleanTargets(p.getWorld());
                for(int i=0;i<2;i++){var e=p.getWorld().spawn(p.getLocation().clone().add(3+i,0,0),Husk.class);e.setAI(false);e.addScoreboardTag("qa_growth_target");targets.add(e);}refill(p);
            }
            case "ore"->{p.getWorld().getBlockAt(106,80,0).setType(Material.COAL_ORE,false);refill(p);}
            case "xp"->v.playerProfileService().setExperience(p,Long.parseLong(a[2]),"isolated growth fixture");
            case "grant"->v.playerProfileService().grantExperience(p,Long.parseLong(a[2]),"isolated growth fixture");
            case "reload"->new ReloadExecutor(aura).reload(s);
            case "proficiency"->aura.getApi().getUser(p.getUniqueId()).setSkillLevel(Skills.valueOf(a[2].toUpperCase(Locale.ROOT)),Integer.parseInt(a[3]),false);
            case "foundationxp"->aura.getApi().getUser(p.getUniqueId()).addSkillXp(Skills.AGILITY,Double.parseDouble(a[2]));
            case "cold"->{p.teleport(new Location(Bukkit.getWorld("world"),102.5,81,.5));refill(p);Bukkit.getWorld("world").unloadChunk(-34,-28,true);}
            case "asyncprobe"->{coldAsyncNull=null;coldAsyncError=null;Bukkit.getWorld("world").getChunkAtAsync(-34,-28,false).whenComplete((chunk,error)->{coldAsyncNull=chunk==null;coldAsyncError=error==null?null:error.getClass().getSimpleName();});}
            case "status"->{}
            default->throw new IllegalArgumentException("Unknown fixture action");
        }
        var profile=v.playerProfileService().profile(p);var data=new LinkedHashMap<String,Object>(ExperienceProgress.of(profile,v.playerProfileService().experienceCurve()).fields());
        data.put("level",profile.level());data.put("op",p.isOp());data.put("mana",v.qiandengjiMana().getMana(p.getUniqueId()));data.put("maxMana",v.qiandengjiMana().getMaxMana(p));data.put("health",p.getHealth());data.put("food",p.getFoodLevel());
        data.put("position",List.of(p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()));data.put("world",p.getWorld().getKey().toString());
        var old=aura.getApi().getUser(p.getUniqueId());data.put("legacyLevel",old.getSkillLevel(Skills.AGILITY));data.put("legacyXp",old.getSkillXp(Skills.AGILITY));data.put("legacyEnabled",Arrays.stream(Skills.values()).filter(Skills::isEnabled).count());
        data.put("targets",targets.stream().filter(Entity::isValid).map(LivingEntity::getHealth).toList());
        data.put("night",p.hasPotionEffect(org.bukkit.potion.PotionEffectType.NIGHT_VISION));data.put("feather",p.hasPotionEffect(org.bukkit.potion.PotionEffectType.SLOW_FALLING));
        data.put("torches",Arrays.stream(p.getInventory().getStorageContents()).filter(Objects::nonNull).filter(i->i.getType()==Material.TORCH).mapToInt(org.bukkit.inventory.ItemStack::getAmount).sum());
        data.put("foundation",org.afuhome.agentfriend.FoundationGrowth.view(p));
        data.put("scoreboard",p.getScoreboard().getTeams().stream().map(t->t.getPrefix()+t.getSuffix()).toList());
        data.put("rotation",List.of(p.getLocation().getYaw(),p.getLocation().getPitch()));
        var sight=p.getTargetBlockExact(25);data.put("sight",sight==null?null:List.of(sight.getX(),sight.getY(),sight.getZ(),sight.getType().name()));
        data.put("coldGenerated",Bukkit.getWorld("world").isChunkGenerated(-34,-28));data.put("coldLoaded",Bukkit.getWorld("world").isChunkLoaded(-34,-28));data.put("coldAsyncNull",coldAsyncNull);data.put("coldAsyncError",coldAsyncError);
        s.sendMessage("GROWTH_QA "+gson.toJson(data));
    }
}
