package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.google.gson.Gson;
import java.nio.file.*;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.*;
import net.minecraft.world.item.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic identities and a marked loopback lab only. Never install in production. */
public final class MaidVoicePatrolQa extends JavaPlugin {
    static final UUID ID=UUID.fromString("00000000-0000-4000-8000-000000009031");
    final List<Mob> mobs=new ArrayList<>();EntityMaid maid;
    public void onEnable(){
        try{if(!Bukkit.getIp().equals("127.0.0.1")||Bukkit.getPort()!=29467||!Files.readString(Path.of(".maid-render-qa")).strip().equals("20261106 127.0.0.1:29467"))throw new IllegalStateException("Marked loopback only");}
        catch(Exception e){throw new IllegalStateException(e);}
        Bukkit.getCommandMap().register("maidvoiceqa",new Command("maidvoiceqa"){
            public boolean execute(CommandSender sender,String label,String[] args){
                if(!(sender instanceof ConsoleCommandSender)&&!(sender instanceof RemoteConsoleCommandSender))return false;
                if(args.length!=2||!args[1].equals("ag_MaidQApat"))throw new IllegalArgumentException("Synthetic owner only");
                Player player=Bukkit.getPlayerExact(args[1]);if(player==null)throw new IllegalStateException("Synthetic owner offline");
                try{run(args[0],player);sender.sendMessage("MAID_VOICE_QA "+new Gson().toJson(state()));}catch(Exception e){throw new IllegalStateException(e);}return true;
            }
        });
    }
    Object plugin(){return Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("QiandengjiMaidBridge"));}
    void invoke(String name,Object...args)throws Exception{
        var target=plugin();var method=Arrays.stream(target.getClass().getDeclaredMethods()).filter(m->m.getName().equals(name)).findFirst().orElseThrow();method.setAccessible(true);method.invoke(target,args);
    }
    void clear(){for(Mob mob:mobs)mob.discard();mobs.clear();}
    void run(String action,Player p)throws Exception{
        if(action.equals("scene")){
            clear();if(maid!=null)maid.discard();
            // Remove only this fixture's prior synthetic mobs after a failed/restarted run.
            for(var entity:p.getWorld().getEntities())if(entity instanceof org.bukkit.craftbukkit.entity.CraftEntity craft&&craft.getHandle() instanceof Mob mob&&mob.getPersistentData().getBoolean("qiandengji_voice_patrol_qa"))mob.discard();
            var old=Bukkit.getEntity(ID);
            if(old instanceof org.bukkit.craftbukkit.entity.CraftEntity craft&&craft.getHandle() instanceof EntityMaid previous&&p.getUniqueId().equals(previous.getOwnerUUID())&&previous.getName().getString().equals("隔离语音护卫"))previous.discard();
            else if(old!=null)throw new IllegalStateException("Synthetic UUID has unexpected owner or name; preserve it");
            var world=p.getWorld();world.setDifficulty(Difficulty.NORMAL);world.setTime(18000);world.setStorm(false);world.setGameRule(GameRule.DO_MOB_SPAWNING,false);
            for(int x=190;x<=210;x++)for(int z=190;z<=210;z++)for(int y=89;y<=94;y++)world.getBlockAt(x,y,z).setType(y==89?Material.STONE:Material.AIR,false);
            p.setOp(false);p.setGameMode(GameMode.CREATIVE);p.teleport(new Location(world,200.5,90,204.5));
            var level=((CraftPlayer)p).getHandle().serverLevel();maid=(EntityMaid)BuiltInRegistries.ENTITY_TYPE.get(ResourceLocation.parse("touhou_little_maid:maid")).create(level);
            maid.setUUID(ID);maid.setOwnerUUID(p.getUniqueId());maid.setTame(true,true);maid.setInvulnerable(true);maid.setNoAi(false);maid.setSilent(true);
            maid.setCustomName(net.minecraft.network.chat.Component.literal("隔离语音护卫"));maid.moveTo(200.5,90,201.5,0,0);maid.setTask(TaskManager.getIdleTask());maid.setInSittingPose(false);maid.setHomeModeEnable(false);
            // Deterministic audio test: no random event consumes the cooldown before
            // the synthetic SVC peer is connected. The ambient action enables it.
            maid.getConfigManager().setSoundFreq(0.0F);
            maid.setItemSlot(EquipmentSlot.MAINHAND,new ItemStack(Items.IRON_SWORD));level.addFreshEntity(maid);invoke("bind",maid);
        }else if(maid==null||!maid.isAlive())throw new IllegalStateException("Synthetic scene required");
        else if(action.equals("clear")){clear();maid.setTarget(null);maid.setHealth(20);maid.moveTo(200.5,90,201.5,0,0);}
        else if(action.equals("hostile")||action.equals("frozen")||action.equals("neutral")||action.equals("friendly")||action.equals("stationed-hostile")){
            clear();maid.setSilent(true);maid.setTarget(null);maid.setTask(TaskManager.getIdleTask());if(!action.equals("stationed-hostile")){maid.setInSittingPose(false);maid.setHomeModeEnable(false);}maid.moveTo(200.5,90,201.5,0,0);
            EntityType<?> type=switch(action){case "neutral"->EntityType.ENDERMAN;case "friendly"->EntityType.COW;default->EntityType.ZOMBIE;};
            Mob mob=(Mob)type.create(maid.level());mob.getPersistentData().putBoolean("qiandengji_voice_patrol_qa",true);mob.moveTo(203,90,201.5,0,0);mob.setSilent(true);mob.setNoAi(action.equals("frozen"));mob.setPersistenceRequired();maid.level().addFreshEntity(mob);mobs.add(mob);
        }else if(action.equals("stay")){clear();maid.setInSittingPose(true);maid.setHomeModeEnable(true);}
        else if(action.equals("mixed")){
            run("hostile",p);mobs.getFirst().moveTo(204.5,90,201.5,0,0);
            for(EntityType<?> type:List.of(EntityType.ZOMBIE,EntityType.ENDERMAN)){
                Mob mob=(Mob)type.create(maid.level());mob.getPersistentData().putBoolean("qiandengji_voice_patrol_qa",true);
                mob.moveTo(type==EntityType.ZOMBIE?202:199,90,201.5,0,0);mob.setSilent(true);mob.setNoAi(type==EntityType.ZOMBIE);mob.setPersistenceRequired();maid.level().addFreshEntity(mob);mobs.add(mob);
            }
        }
        else if(action.equals("low")){maid.setHealth(3);}
        else if(action.equals("public-bubble")){
            p.sendMessage("[附近·女仆] 隔离语音护卫：一起去冒险吧。");
            invoke("publishPublicSpeech",maid,"qa-public-bubble-1","一起去冒险吧。",1);invoke("publishPublicSpeech",maid,"qa-public-bubble-1","一起去冒险吧。",1);
        }else if(action.equals("ambient")||action.equals("ambient-idle")){
            clear();maid.setSilent(false);maid.getConfigManager().setSoundFreq(1.0F);
            com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig.GLOBAL_MAID_SOUND_FREQUENCY.set(100);
            maid.playSound(action.equals("ambient-idle")?com.github.tartaricacid.touhoulittlemaid.init.InitSounds.MAID_IDLE.get():com.github.tartaricacid.touhoulittlemaid.init.InitSounds.MAID_ITEM_GET.get());
        }else if(action.equals("remove")){clear();maid.discard();maid=null;}
        else if(!action.equals("state"))throw new IllegalArgumentException("Unknown synthetic action");
    }
    Map<String,Object> state(){
        if(maid==null)return Map.of("removed",true);
        var task=TaskManager.getTaskMap().get(ResourceLocation.parse("touhou_little_maid:attack"));
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("maid",ID.toString());out.put("task",maid.getTask().getUid().toString());
        out.put("canMove",maid.canBrainMoving());out.put("sitting",maid.isMaidInSittingPose());
        out.put("bubbles",maid.getChatBubbleManager().getChatBubbleDataCollection().size());
        out.put("savedSchedule",maid.getSchedule().toString());out.put("brainActivities",maid.getBrain().getActiveActivities().toString());
        out.put("target",maid.getTarget()==null?"none":maid.getTarget().getUUID().toString());
        out.put("mobs",mobs.stream().map(m->Map.of("id",m.getUUID().toString(),"health",m.getHealth(),"alive",m.isAlive(),"noAi",m.isNoAi(),"target",m.getTarget()==null?"none":m.getTarget().getUUID().toString(),"nativeAllowed",((com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask)task).canAttack(maid,m),"entityAllowed",maid.canAttack(m),"inRestriction",maid.isWithinRestriction(m.blockPosition()),"distance",maid.distanceTo(m))).toList());
        return out;
    }
}
