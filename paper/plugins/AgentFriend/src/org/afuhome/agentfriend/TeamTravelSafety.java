package org.afuhome.agentfriend;

import org.bukkit.Location;

final class TeamTravelSafety {
    static boolean insideBorder(Location at) {
        var border=at.getWorld().getWorldBorder();var center=border.getCenter();double half=border.getSize()/2;
        return at.getX()-.3>=center.getX()-half&&at.getX()+.3<=center.getX()+half
            &&at.getZ()-.3>=center.getZ()-half&&at.getZ()+.3<=center.getZ()+half;
    }
}
