package org.afuhome.agentfriend;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/** Transient mechanic for the final room of an opted-in altar run. */
final class AltarPoison {
    static final String SITE = "jungle_covenant";
    static final String BOSS = "QD_Ruin_jungle_covenant";
    private static final long INTERVAL = 18_000, WARNING = 2_000, PULSE = 1_000;
    private static final double RADIUS = 2;
    private static final int PULSES = 4;
    private static final Particle.DustOptions WARNING_DUST = new Particle.DustOptions(Color.YELLOW, 1);
    private static final Particle.DustOptions POISON_DUST = new Particle.DustOptions(Color.PURPLE, 1);
    private long nextCast, nextPulse;
    private int remaining;
    private Location ground;

    Map<String, Object> observation(long now){
        if(ground==null)return Map.of();
        boolean warning=remaining==PULSES&&now<nextPulse;
        return Map.of("id","altar_poison","phase",warning?"warning":"active", "radius",RADIUS,
            "ground",Map.of("world",ground.getWorld().getName(),"x",ground.getX(),"y",ground.getY(),"z",ground.getZ()),
            "nextPulseInMs",Math.max(0,nextPulse-now),"remainingPulses",remaining,"nextStep","离开黄圈；有反制技能且看得到首领时可尝试打断。");
    }

    boolean interrupt(long now, boolean apply) {
        if (ground == null || remaining != PULSES || now >= nextPulse) return false;
        if (apply) ground = null;
        return true;
    }

    void tick(Mob boss, List<Player> participants, long now) {
        if (nextCast == 0) nextCast = now + INTERVAL;
        if (ground != null) {
            if (now < nextPulse) {
                ring(WARNING_DUST);
                return;
            }
            ring(POISON_DUST);
            for (Player player : participants) {
                var body = ResidentCli.living(player);
                if (body != null && inside(body.getLocation())) body.damage(1, boss);
            }
            if (--remaining == 0) ground = null;
            else nextPulse = now + PULSE;
            return;
        }
        if (now < nextCast || boss.getTarget() == null) return;
        UUID targetId = boss.getTarget().getUniqueId();
        Player target = participants.stream().filter(p -> p.getUniqueId().equals(targetId)).findFirst().orElse(null);
        if (target == null) return;
        ground = target.getLocation().clone();
        nextCast = now + INTERVAL;
        nextPulse = now + WARNING;
        remaining = PULSES;
        ring(WARNING_DUST);
        for (Player participant : participants) {
            participant.sendActionBar(net.kyori.adventure.text.Component.text(
                "毒藤将在黄圈内蔓延 · 离开黄圈", net.kyori.adventure.text.format.NamedTextColor.YELLOW));
        }
    }

    private boolean inside(Location point) {
        if (!ground.getWorld().equals(point.getWorld()) || Math.abs(ground.getY()-point.getY()) > 1.5) return false;
        double x = ground.getX()-point.getX(), z = ground.getZ()-point.getZ();
        return x*x+z*z <= RADIUS*RADIUS;
    }

    private void ring(Particle.DustOptions dust) {
        for (int i = 0; i < 16; i++) {
            double a = i*Math.PI/8;
            ground.getWorld().spawnParticle(Particle.DUST, ground.clone().add(RADIUS*Math.cos(a), .12, RADIUS*Math.sin(a)),
                1, 0, 0, 0, 0, dust);
        }
    }
}
