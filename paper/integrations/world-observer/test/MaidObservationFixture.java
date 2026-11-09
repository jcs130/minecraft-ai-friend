package org.qiandeng.observer.tests;

import java.nio.file.*;
import java.util.*;
import com.google.gson.Gson;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;

/** Disposable loopback world only; never install this fixture in production. */
public final class MaidObservationFixture extends JavaPlugin {
    final List<Entity> maids=new ArrayList<>();
    @Override public void onEnable() {
        try {
            if(!getServer().getIp().equals("127.0.0.1")||getServer().getPort()!=29467||
                !Files.readString(Path.of(".maid-render-qa")).strip().equals("20261106 127.0.0.1:29467"))throw new IllegalStateException("Marked loopback only");
        } catch(Exception e){throw new IllegalStateException(e);}
        getServer().getCommandMap().register("maidfixture",new Command("maidqa"){
            @Override public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                if(args.length!=2||!args[1].matches("ag_MaidQA[a-z0-9]{1,7}"))throw new IllegalArgumentException("Own QA actor only");
                Player p=Bukkit.getPlayerExact(args[1]);if(p==null)throw new IllegalStateException("QA offline");
                try{run(p,args[0]);sender.sendMessage("MAID_QA "+new Gson().toJson(maids.stream().map(e->Map.of("uuid",e.getUUID().toString(),"entityId",e.getId())).toList()));}
                catch(Exception e){throw new IllegalStateException(e);}return true;
            }
        });
    }
    void run(Player p,String action)throws Exception{
        if(action.equals("scene")){
            maids.forEach(Entity::discard);maids.clear();var world=p.getWorld();
            for(int x=-8;x<=8;x++)for(int z=-8;z<=8;z++)for(int y=79;y<=84;y++)world.getBlockAt(x,y,z).setType(y==79?Material.STONE:Material.AIR,false);
            world.setGameRule(GameRule.DO_MOB_SPAWNING,false);world.setTime(6000);world.setStorm(false);
            p.setOp(false);p.setGameMode(GameMode.SURVIVAL);p.setInvulnerable(true);p.teleport(new Location(world,0.5,80,6.5,180,0));
            String[] models={"authors_and_credits:clocklalier","authors_and_credits:wine_fox_maid","touhou_little_maid:hakurei_reimu"};
            var level=((CraftPlayer)p).getHandle().serverLevel();
            for(int i=0;i<models.length;i++){
                Entity e=BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse("touhou_little_maid:maid")).create(level);
                e.getClass().getMethod("setModelId",String.class).invoke(e,models[i]);((Mob)e).setNoAi(true);
                e.moveTo((i-1)*2.5,80,0,0,0);e.setCustomName(net.minecraft.network.chat.Component.literal("原模型联测 "+i));e.setCustomNameVisible(true);level.addFreshEntity(e);maids.add(e);
            }
        } else if(action.equals("ysm")){
            if(maids.isEmpty())throw new IllegalStateException("scene first");Entity e=maids.getFirst();
            e.getClass().getMethod("setOwnerUUID",java.util.UUID.class).invoke(e,p.getUniqueId());
            e.getClass().getMethod("setIsYsmModel",boolean.class).invoke(e,true);
            e.getClass().getMethod("setYsmModel",String.class,String.class,net.minecraft.network.chat.Component.class)
                .invoke(e,"大肥鱼_1.1.ysm","white",net.minecraft.network.chat.Component.literal("原资源联测"));
        } else if(action.equals("public-speech")){
            if(maids.isEmpty())throw new IllegalStateException("scene first");Entity e=maids.getFirst();
            var plugin=Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge");if(plugin==null)throw new IllegalStateException("bridge required");
            var publish=Arrays.stream(plugin.getClass().getDeclaredMethods()).filter(m->m.getName().equals("publishPublicSpeech")).findFirst().orElseThrow();publish.setAccessible(true);
            p.sendMessage("[附近·女仆] 原资源联测：一起去公会吧。");
            publish.invoke(plugin,e,"qa-original-public-speech","一起去公会吧。",1);
            publish.invoke(plugin,e,"qa-original-public-speech","一起去公会吧。",1);
        } else if(action.equals("sit")||action.equals("stand")){
            for(Entity e:maids)e.getClass().getMethod("setInSittingPose",boolean.class).invoke(e,action.equals("sit"));
        } else if(action.equals("move")){
            for(Entity e:maids)e.moveTo(e.getX()+.5,e.getY(),e.getZ()+.2,30,10);
        } else if(action.equals("remove")){maids.forEach(Entity::discard);maids.clear();}
        else throw new IllegalArgumentException("scene|sit|stand|move|remove");
    }
}
