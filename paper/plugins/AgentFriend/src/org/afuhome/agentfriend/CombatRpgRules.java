package org.afuhome.agentfriend;

import java.util.*;

/** Minecraft balance, not purported unpublished SAO canon. Farming XP and the
 * practice tower never count as a formal floor clear. All inputs are server facts. */
final class CombatRpgRules {
    static final int MAX_LEVEL = 100;
    static final long MAX_XP = 1_000_000_000L;
    /** One authority owns combat XP and attributes; new content never silently
     * enables a second progression engine for existing accounts. */
    static boolean activate(boolean enabled, boolean vortexEnabled) {
        if (enabled && vortexEnabled) throw new IllegalArgumentException("conflicting_combat_authorities");
        return enabled;
    }
    record Progress(int level, long xp, long inLevel, long toNext) { }
    record Fighter(UUID id, String name, double damage, double tanking, double healing,
                   boolean present, boolean eligible) {
        Fighter {
            Objects.requireNonNull(id);
            if (name == null || name.isBlank() || name.length() > 32
                    || name.chars().anyMatch(Character::isISOControl)) throw new IllegalArgumentException("player name");
            for (double value : new double[]{damage,tanking,healing})
                if (!Double.isFinite(value) || value < 0 || value > 1_000_000) throw new IllegalArgumentException("contribution");
        }
        double contribution() { return damage + tanking * .5 + healing * .5; }
    }
    record Credit(UUID id, String name, int xp, int kills, int floor) {
        Credit {
            new Fighter(id,name,0,0,0,true,true);
            if(xp < 0 || xp > 100_000 || kills < 0 || kills > 1 || floor < 0 || floor > 100)
                throw new IllegalArgumentException("credit bounds");
        }
    }
    static long threshold(int level) {
        if(level < 1 || level > MAX_LEVEL) throw new IllegalArgumentException("level");
        long xp=0;
        for(int n=1;n<level;n++) xp += 40L+20L*n+10L*n*n;
        return xp;
    }
    static Progress progress(long xp) {
        if(xp < 0 || xp > MAX_XP) throw new IllegalArgumentException("xp");
        int level=1;
        while(level < MAX_LEVEL && xp >= threshold(level+1)) level++;
        return new Progress(level,xp,xp-threshold(level),level == MAX_LEVEL ? 0 : threshold(level+1)-xp);
    }
    static double healthBonus(int level) { return (checkedLevel(level)-1)*.5; }
    static double attackBonus(int level) { return (checkedLevel(level)-1)*.08; }
    private static int checkedLevel(int level) { threshold(level); return level; }
    /** An active contribution is required; proximity/party membership alone is not combat. */
    static List<Credit> split(int baseXp, Collection<Fighter> fighters, boolean practice) {
        if(baseXp < 1 || baseXp > 10_000) throw new IllegalArgumentException("mob xp");
        if(fighters.size() > 40 || fighters.stream().map(Fighter::id).distinct().count()!=fighters.size())
            throw new IllegalArgumentException("participants");
        var eligible=fighters.stream().filter(f->f.present&&f.eligible&&f.contribution()>=1)
                .sorted(Comparator.comparing(f->f.id.toString())).toList();
        if(eligible.isEmpty()) return List.of();
        // A bounded cooperative bonus, divided between real contributors. Tank and
        // healer contributions count; no last-hit jackpot or multiplicative XP farm.
        double pool=baseXp*(1+Math.min(eligible.size()-1,3)*.1)*(practice?.2:1);
        int total=(int)Math.floor(pool),each=total/eligible.size(),remainder=total%eligible.size();
        var result=new ArrayList<Credit>();
        for(int i=0;i<eligible.size();i++){var f=eligible.get(i);result.add(new Credit(f.id,f.name,each+(i<remainder?1:0),1,0));}
        return List.copyOf(result);
    }
    static String next(String profession, int level, boolean armed, boolean combatSkill,
                       boolean retiredTask, String runningCommand, int highestFloor, boolean campaignReady) {
        return next(profession,level,armed,combatSkill,combatSkill,retiredTask,runningCommand,highestFloor,campaignReady);
    }
    static String next(String profession, int level, boolean armed, boolean combatSkill,boolean prepared,
                       boolean retiredTask, String runningCommand, int highestFloor, boolean campaignReady) {
        if(runningCommand!=null&&!runningCommand.isBlank()) return runningCommand;
        if(retiredTask) return "/mycli tasks pause";
        if(profession==null||profession.isBlank()) return "/mycli profession menu";
        if(!armed) return "/mycli guild shared";
        if(!combatSkill) return "/mycli skills list "+profession;
        if(!prepared) return "/mycli skills menu";
        if(campaignReady) return "/mycli dungeon info aincrad_"+String.format(Locale.ROOT,"%02d",highestFloor+1);
        return "/mycli tasks list combat";
    }
}
