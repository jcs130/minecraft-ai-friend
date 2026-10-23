package org.afuhome.agentfriend;

import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.domains.Association;
import com.sk89q.worldguard.protection.RegionResultSet;
import com.sk89q.worldguard.protection.association.RegionAssociable;
import com.sk89q.worldguard.protection.flags.*;
import com.sk89q.worldguard.protection.regions.*;
import java.util.*;

/** Exercise the installed WorldGuard flag resolver, independently of Bukkit events. */
public final class PublicFacilityTest {
    private static int checks;
    private static void check(boolean ok, String message) {
        checks++; if (!ok) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        ProtectedRegion region = new ProtectedCuboidRegion("public_facility_test", BlockVector3.at(0,0,0), BlockVector3.at(8,8,8));
        UUID owner = UUID.fromString("12345678-1234-1234-1234-123456789012");
        region.getOwners().addPlayer(owner);
        region.setFlag(Flags.BLOCK_BREAK, StateFlag.State.DENY);
        region.setFlag(Flags.BLOCK_BREAK.getRegionGroupFlag(), RegionGroup.NON_MEMBERS);
        region.setFlag(Flags.BLOCK_PLACE, StateFlag.State.DENY);
        region.setFlag(Flags.BLOCK_PLACE.getRegionGroupFlag(), RegionGroup.NON_MEMBERS);
        RegionAssociable visitor = ignored -> Association.NON_MEMBER;
        for (boolean publicFacility : new boolean[]{false, true, false}) {
            LandManager.configureSupplies(region, publicFacility);
            var result = new RegionResultSet(new ArrayList<>(List.of(region)), null);
            for (StateFlag flag : List.of(Flags.CHEST_ACCESS, Flags.ITEM_DROP, Flags.ITEM_PICKUP)) {
                check(result.queryState(visitor, flag) == (publicFacility ? StateFlag.State.ALLOW : StateFlag.State.DENY),
                        flag.getName()+" visitor policy "+publicFacility);
            }
            check(result.queryState(visitor, Flags.BLOCK_BREAK) == StateFlag.State.DENY, "building cannot be dismantled");
            check(result.queryState(visitor, Flags.BLOCK_PLACE) == StateFlag.State.DENY, "building cannot be overwritten");
            check(region.getFlag(Flags.BUILD) == null, "supply permission must not grant BUILD");
            check(region.getOwners().getUniqueIds().equals(Set.of(owner)), "administrative owner retained");
            check(region.getMembers().getUniqueIds().isEmpty(), "visitors are not made members");
        }
        System.out.println("PUBLIC_FACILITY_TEST "+checks+" checks passed");
    }
}
