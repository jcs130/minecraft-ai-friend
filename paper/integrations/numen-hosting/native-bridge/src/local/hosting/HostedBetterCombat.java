package local.hosting;

import java.util.*;
import net.bettercombat.logic.AnimatedHand;
import net.bettercombat.logic.PlayerAttackHelper;
import net.bettercombat.network.Packets;
import net.bettercombat.network.ServerNetwork;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.item.ItemStack;

/** The existing Numen attack becomes a real Better Combat swing, with its actual
 * weapon attributes, upswing, combo and damage. No extra model loop or fake damage. */
public final class HostedBetterCombat {
    private HostedBetterCombat(){}
    public static final ThreadLocal<Boolean> EXECUTING=ThreadLocal.withInitial(()->false);
    private record Pending(UUID target,ItemStack weapon,ItemStack offhand,String dimension,int slot,int combo,int charge,long due,double range){}
    private static final Map<UUID,Pending> swings=new HashMap<>();
    public static boolean hosted(Entity entity){return entity.getClass().getName().equals("com.dwinovo.numen.hosted.api.entity.NumenPlayer");}
    public static boolean attack(ServerPlayer player,Entity target){
        if(EXECUTING.get()||!hosted(player))return false;
        if(!player.getServer().isSameThread())throw new IllegalStateException("hosted_combat_server_thread_required");
        if(!(target instanceof LivingEntity living)||!(living instanceof Enemy))return false;
        if(swings.containsKey(player.getUUID())||player.getAttackStrengthScale(0)<.9f)return true;
        int combo=player.getPersistentData().getInt("qd_hosted_bc_combo");
        if(player.serverLevel().getGameTime()-player.getPersistentData().getLong("qd_hosted_bc_last")>80)combo=0;
        var hand=PlayerAttackHelper.getCurrentAttack(player,combo);
        if(hand==null||hand.attack()==null||hand.attributes()==null)return false;
        double range=PlayerAttackHelper.getRangeForItem(player,hand.itemStack())*hand.attack().rangeMultiplier();
        // Use Better Combat's own server target lookup allowance: its range is a
        // weapon hitbox, while Numen's approach uses the target's centre distance.
        double lookup=range*Math.sqrt(Math.max(1,net.bettercombat.BetterCombatMod.config.target_search_range_multiplier));
        if(!living.isAlive()||living.isInvulnerable()||living.level()!=player.level()||!player.hasLineOfSight(living)||player.distanceToSqr(living)>lookup*lookup)return true;
        float duration=PlayerAttackHelper.getAttackCooldownTicksCapped(player);
        int upswing=Math.max(1,(int)Math.ceil(duration*hand.upswingRate()));
        // Swing/animation mixins can reset the vanilla ticker. Capture the
        // accepted charge before sending either animation, not after them.
        int charge=((net.bettercombat.mixin.player.LivingEntityAccessor)player).getAttackStrengthTicker();
        var packet=new Packets.AttackAnimation(player.getId(),AnimatedHand.from(hand.isOffHand(),PlayerAttackHelper.isTwoHandedWielding(player)),
            hand.attack().animation(),duration/20f,(float)hand.upswingRate(),(float)range,upswing,Packets.SwingParticles.EMPTY);
        ServerNetwork.handleAttackAnimation(packet,player.getServer(),player);
        player.swing(hand.isOffHand()?net.minecraft.world.InteractionHand.OFF_HAND:net.minecraft.world.InteractionHand.MAIN_HAND);
        swings.put(player.getUUID(),new Pending(living.getUUID(),player.getMainHandItem().copy(),player.getOffhandItem().copy(),player.level().dimension().location().toString(),player.getInventory().selected,combo,charge,player.serverLevel().getGameTime()+upswing,lookup));
        return true;
    }
    public static void tick(MinecraftServer server){
        for(var entry:new ArrayList<>(swings.entrySet())){
            var player=server.getPlayerList().getPlayer(entry.getKey());var pending=entry.getValue();
            if(player==null||!hosted(player)||!player.isAlive()||!player.level().dimension().location().toString().equals(pending.dimension())){swings.remove(entry.getKey());continue;}
            if(player.serverLevel().getGameTime()<pending.due())continue;
            swings.remove(entry.getKey());var target=player.serverLevel().getEntity(pending.target());
            if(!(target instanceof LivingEntity living)||!living.isAlive()||living.isInvulnerable()||!player.hasLineOfSight(living)
                ||player.distanceToSqr(living)>pending.range()*pending.range()||player.getInventory().selected!=pending.slot()
                ||!ItemStack.isSameItemSameComponents(player.getMainHandItem(),pending.weapon())
                ||!ItemStack.isSameItemSameComponents(player.getOffhandItem(),pending.offhand()))continue;
            var request=new Packets.C2S_AttackRequest(pending.combo(),player.isShiftKeyDown(),pending.slot(),living.getId(),new int[]{living.getId()});
            // Numen's caller may reset the vanilla cooldown when the deferred
            // swing is accepted. Preserve the charge verified BEFORE dispatch.
            var cooldown=(net.bettercombat.mixin.player.LivingEntityAccessor)player;
            cooldown.setLastAttackedTicks(Math.max(pending.charge(),cooldown.getAttackStrengthTicker()));
            ServerNetwork.handleAttackRequest(request,server,player,player.connection);
            player.getPersistentData().putInt("qd_hosted_bc_combo",pending.combo()+1);
            player.getPersistentData().putLong("qd_hosted_bc_last",player.serverLevel().getGameTime());
            // Vanilla and Bedrock viewers still receive the standard swing and particles.
            player.serverLevel().sendParticles(ParticleTypes.SWEEP_ATTACK,living.getX(),living.getY()+.8,living.getZ(),1,0,0,0,0);
        }
    }
}
