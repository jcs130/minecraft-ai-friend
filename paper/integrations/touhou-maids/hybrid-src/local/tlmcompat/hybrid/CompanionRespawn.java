package local.tlmcompat.hybrid;

import java.util.*;
import java.util.function.Consumer;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import net.minecraft.nbt.CompoundTag;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Player-like recovery for the configured companion, retaining the same native body and inventory. */
final class CompanionRespawn implements AutoCloseable {
    static final String TAG="qiandengji_companion_respawn";
    private final HybridMaidPlugin plugin;
    private final NativeMaidOwnerTravel travel;
    private final Consumer<LivingDeathEvent> death=this::lethal;
    private record Held(org.bukkit.World world,int x,int z,boolean owned,long until){
        void release(HybridMaidPlugin plugin){if(owned)world.removePluginChunkTicket(x,z,plugin);}
    }
    private final Map<UUID,Held> held=new HashMap<>();
    private long lastWarning;
    CompanionRespawn(HybridMaidPlugin plugin,NativeMaidOwnerTravel travel){
        this.plugin=plugin;this.travel=travel;
        NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.HIGHEST,false,death);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,5,5);
    }
    private void lethal(LivingDeathEvent event){
        if(!Bukkit.isPrimaryThread()||!(event.getEntity() instanceof EntityMaid maid)||!plugin.configuredCompanionIdentity(maid)||maid.getOwnerUUID()==null)return;
        // Keep inventory on this original entity; never create a second body or a loot-bearing grave.
        CompoundTag data=maid.getPersistentData();
        boolean first=!data.contains(TAG);
        if(first){
            CompoundTag phase=new CompoundTag();phase.putString("eventId",UUID.randomUUID().toString());
            phase.putLong("readyAt",System.currentTimeMillis()+5000);
            phase.putBoolean("invulnerable",maid.isInvulnerable());phase.putBoolean("noAI",maid.isNoAi());
            data.put(TAG,phase);
        }
        event.setCanceled(true);maid.setHealth(1);maid.clearFire();maid.setInvulnerable(true);maid.setNoAi(true);
        maid.getNavigation().stop();maid.setDeltaMovement(net.minecraft.world.phys.Vec3.ZERO);
        if(first){
            // The normal residence finder already persists and reloads this exact original identity.
            try{
                plugin.rememberResidenceDeparture(maid);
                var at=maid.getBukkitEntity().getLocation();var world=at.getWorld();int x=at.getBlockX()>>4,z=at.getBlockZ()>>4;
                Held previous=held.remove(maid.getUUID());if(previous!=null)previous.release(plugin);
                held.put(maid.getUUID(),new Held(world,x,z,world.addPluginChunkTicket(x,z,plugin),System.currentTimeMillis()+12000));
            }catch(RuntimeException unavailable){warn(unavailable);}
            Player partner=Bukkit.getPlayer(maid.getOwnerUUID());
            if(partner!=null)partner.sendMessage("§e[伙伴重生] "+maid.getName().getString()+" 倒下了，5秒后在你附近安全重生，装备保留；无需墓碑、遗物或魂符。");
            plugin.getLogger().info("Companion respawn waiting: maid="+maid.getUUID()+" owner="+maid.getOwnerUUID()+" event="+data.getCompound(TAG).getString("eventId"));
        }
    }
    void describe(EntityMaid maid,com.google.gson.JsonObject context){
        if(!plugin.configuredCompanionIdentity(maid))return;
        com.google.gson.JsonObject recovery=new com.google.gson.JsonObject();
        boolean waiting=maid.getPersistentData().contains(TAG);
        recovery.addProperty("mode","automatic_partner_respawn");
        recovery.addProperty("state",waiting?"waiting_for_safe_respawn":"ready");
        recovery.addProperty("inventoryKept",true);recovery.addProperty("requiresTombstone",false);
        if(waiting){
            CompoundTag phase=maid.getPersistentData().getCompound(TAG);
            recovery.addProperty("eventId",phase.getString("eventId"));
            recovery.addProperty("readyAt",java.time.Instant.ofEpochMilli(phase.getLong("readyAt")).toString());
            context.addProperty("nextStep","伙伴倒下后自动在可米附近安全重生；保留原身份和装备。无需墓碑、遗物、魂符或重复恢复请求。可米离线或落点不安全时等待安全落点。");
        }
        context.add("respawn",recovery);
    }
    private void tick(){
        held.entrySet().removeIf(e->{if(System.currentTimeMillis()<e.getValue().until)return false;e.getValue().release(plugin);return true;});
        for(String id:plugin.registeredMaids().keySet()){
            EntityMaid maid;
            try{maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(id)));}catch(IllegalArgumentException invalid){continue;}
            if(maid==null||!maid.isAlive()||maid.isRemoved()||!maid.getPersistentData().contains(TAG)||!plugin.configuredCompanionIdentity(maid))continue;
            CompoundTag phase=maid.getPersistentData().getCompound(TAG);
            if(System.currentTimeMillis()<phase.getLong("readyAt"))continue;
            Player partner=Bukkit.getPlayer(maid.getOwnerUUID());
            if(partner==null||!partner.isOnline()||partner.isDead()||partner.getGameMode()==org.bukkit.GameMode.SPECTATOR)continue;
            try{
                var landing=travel.recallLanding(partner);
                if(!travel.transfer(maid,landing))continue;
                EntityMaid arrived=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(maid.getUUID()));
                if(arrived==null||!arrived.getOwnerUUID().equals(partner.getUniqueId()))continue;
                arrived.setHealth(arrived.getMaxHealth());arrived.clearFire();arrived.removeAllEffects();arrived.fallDistance=0;
                arrived.setInvulnerable(phase.getBoolean("invulnerable"));arrived.setNoAi(phase.getBoolean("noAI"));
                arrived.getPersistentData().remove(TAG);plugin.rememberResidenceDeparture(arrived);
                Held ticket=held.remove(arrived.getUUID());if(ticket!=null)ticket.release(plugin);
                partner.sendMessage("§a[伙伴重生] "+arrived.getName().getString()+" 已回到你身边，原身份和装备保持，可以继续冒险。");
                plugin.getLogger().info("Companion respawn completed: maid="+arrived.getUUID()+" owner="+partner.getUniqueId()+" event="+phase.getString("eventId"));
            }catch(local.tlmcompat.core.CompatibilityException noLanding){/* Retain this original body and retry when the partner has a safe landing. */}
            catch(RuntimeException unavailable){warn(unavailable);}
        }
    }
    private void warn(RuntimeException error){long now=System.currentTimeMillis();if(now-lastWarning>=30000){lastWarning=now;plugin.getLogger().warning("Companion respawn retained for retry: "+error.getClass().getSimpleName());}}
    @Override public void close(){NeoForge.EVENT_BUS.unregister(death);held.values().forEach(h->h.release(plugin));held.clear();}
}
