package local.hosting;

import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Complete only an operator-prepared cold conversion, after login RPG attributes load.
 * No entity creation, inventory insertion or UUID replacement is performed here. */
public final class HostedMigration {
    private static final java.util.Map<ServerPlayer,Long> waiting=new java.util.WeakHashMap<>();
    private static final java.util.Map<ServerPlayer,Admission> admissions=new java.util.WeakHashMap<>();
    private static final class Admission {
        final float health; final long started=System.nanoTime(); boolean damaged;
        Admission(float health){this.health=health;}
    }
    private HostedMigration(){}
    public static void loaded(ServerPlayer player,net.minecraft.nbt.CompoundTag saved){
        if(!player.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer"))return;
        float health=saved.getFloat("Health");
        if(Float.isFinite(health)&&health>0)admissions.putIfAbsent(player,new Admission(health));
    }
    public static void damage(net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent event){
        if(!(event.getEntity() instanceof ServerPlayer player)
            ||!player.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer"))return;
        var tag=player.getPersistentData().getCompound("qd_hosted_migration");
        var pending=admissions.get(player);if(pending!=null)pending.damaged=true;
        // Remember even an early hit while login attributes are still loading.
        // getLastDamageSource() expires; a later login tick must not erase it.
        if("prepared".equals(tag.getString("phase")))tag.putBoolean("damageObserved",true);
    }
    public static void tick(MinecraftServer server){
        for(ServerPlayer player:server.getPlayerList().getPlayers()){
            if(!player.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer"))continue;
            var admission=admissions.get(player);
            if(admission!=null){
                long elapsed=System.nanoTime()-admission.started;
                if(admission.damaged||!player.isAlive()||elapsed>java.util.concurrent.TimeUnit.SECONDS.toNanos(30))admissions.remove(player);
                else if(elapsed>=java.util.concurrent.TimeUnit.SECONDS.toNanos(2)&&admission.health<=player.getMaxHealth()){
                    // Use THIS login's saved health, never the original migration's
                    // health. Preserve actual post-login damage and healing.
                    if(player.getHealth()<admission.health)player.setHealth(admission.health);
                    admissions.remove(player);
                }
            }
            var tag=player.getPersistentData().getCompound("qd_hosted_migration");
            if(!"prepared".equals(tag.getString("phase")))continue;
            long elapsed=System.nanoTime()-waiting.computeIfAbsent(player,unused->System.nanoTime());
            if(elapsed<java.util.concurrent.TimeUnit.SECONDS.toNanos(2))continue;
            if(!player.getStringUUID().equals(tag.getString("body"))||!tag.getString("sourceSha256").matches("[a-f0-9]{64}")){
                tag.putString("phase","blocked_identity");continue;
            }
            float health=tag.getFloat("health");
            // Do not erase damage incurred after admission or increase the RPG cap.
            if(!Float.isFinite(health)||health<=0||tag.getBoolean("damageObserved")||player.getLastDamageSource()!=null){
                tag.putString("phase","blocked_health_requires_review");continue;
            }
            if(health>player.getMaxHealth()){
                if(elapsed>java.util.concurrent.TimeUnit.SECONDS.toNanos(30))tag.putString("phase","blocked_rpg_attributes_not_ready");
                continue;
            }
            player.setHealth(health);tag.putString("phase","health_committed");
            try{((local.hosting.mixin.PlayerSaveAccess)server.getPlayerList()).hosted$save(player);}
            catch(Exception error){tag.putString("phase","blocked_save_requires_review");}
        }
    }
}
