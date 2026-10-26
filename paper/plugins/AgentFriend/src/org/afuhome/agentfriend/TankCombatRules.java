package org.afuhome.agentfriend;

/** Final-damage math, independent of armor/enchantments. A guard may remove at
 * most half of the already mitigated damage and never grants invulnerability. */
final class TankCombatRules {
    static double remaining(double finalDamage,double cap,double fraction){
        if(!Double.isFinite(finalDamage)||!Double.isFinite(cap)||!Double.isFinite(fraction)
                ||finalDamage<0||cap<0||cap>8||fraction<0||fraction>.5)throw new IllegalArgumentException("mitigation");
        return finalDamage-Math.min(cap,finalDamage*fraction);
    }
    static boolean active(boolean online,boolean living,boolean sameWorld,boolean shield,
                          boolean selected,boolean observer,boolean pvp,double distanceSquared,long now,long until){
        return online&&living&&sameWorld&&shield&&selected&&!observer&&!pvp&&Double.isFinite(distanceSquared)
                &&distanceSquared<=144&&distanceSquared>=0&&now<until;
    }
}
