package org.afuhome.agentfriend;

import org.bukkit.entity.Villager;

/** Only the plugin's fixed guild hosts use this initializer. Existing offers remain intact. */
final class GuildHostTrades {
    private GuildHostTrades() { }

    static void ensure(Villager host) {
        int level = host.getVillagerLevel();
        boolean novice = host.getProfession() == Villager.Profession.CARTOGRAPHER && level > 1;
        // getRecipes lazily generates vanilla offers. A level-2 cartographer can synchronously
        // search thousands of chunks for an explorer map, even with AI disabled. Initialize
        // this fixed reception host at novice tier; never clear or replace existing offers.
        try {
            if (novice) host.setVillagerLevel(1);
            if (host.getRecipes().isEmpty()) host.addTrades(2);
        } finally {
            if (novice) host.setVillagerLevel(level);
        }
    }
}
