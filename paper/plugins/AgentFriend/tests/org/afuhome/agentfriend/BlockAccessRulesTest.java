package org.afuhome.agentfriend;

import java.util.*;

/** Inclusive boundaries, exact complement and narrow authorization regression. */
public final class BlockAccessRulesTest {
    private static int checks;
    private static void check(boolean ok, String label) {
        checks++; if (!ok) throw new AssertionError(label);
    }
    public static void main(String[] args) {
        UUID owner = UUID.fromString("00000000-0000-0000-0009-00000d9f9c7b");
        UUID guest = UUID.fromString("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
        var camp = new BlockAccessRules.Area("world",-1146,-638,-1078,-567);
        var town = new BlockAccessRules.Area("world",-634,-530,-458,-365);
        var rules = new BlockAccessRules(true,Set.of(owner),List.of(camp,town));
        check(rules.open(owner,"world",-1100,-600),"exact editor can edit retained village");
        check(!rules.open(guest,"world",-1100,-600),"ordinary player retains village protection");
        check(!rules.open(guest,"world",-1146,-638),"inclusive northwest edge");
        check(!rules.open(guest,"world",-1078,-567),"inclusive southeast edge");
        check(rules.open(guest,"world",-1077,-567),"one block outside is open");
        check(rules.open(guest,"world_nether",-1100,-600),"same coordinates in other dimension are open");
        check(!new BlockAccessRules(false,Set.of(owner),List.of(camp)).open(owner,"world",0,0),"disabled preserves original authorization");
        for (String action : List.of("break","place","bucket","harvest","damage","fertilize"))
            check(BlockAccessRules.blockAction(action),"block action "+action);
        for (String action : List.of("container","inventory","pickup","drop","display","use","interact"))
            check(!BlockAccessRules.blockAction(action),"does not grant other action "+action);
        var overlap = new BlockAccessRules.Area("world",-1120,-620,-1050,-540);
        for (List<BlockAccessRules.Area> retained : List.of(List.of(camp), List.of(camp,town), List.of(camp,overlap))) {
            var selected = new BlockAccessRules(true,Set.of(owner),retained);
            List<BlockAccessRules.Area> outside = selected.outside("world");
            for(int x=-1150;x<=-450;x+=7) for(int z=-645;z<=-350;z+=5) {
                int px=x,pz=z;
                boolean expected=retained.stream().noneMatch(a->a.contains("world",px,pz));
                int actual=0;for(var a:outside)if(a.contains("world",x,z))actual++;
                check(actual==(expected?1:0),"outside overlay exact and nonoverlapping at "+x+","+z);
            }
            for(var a:retained)for(int x:List.of(a.minX()-1,a.minX(),a.maxX(),a.maxX()+1))
                for(int z:List.of(a.minZ()-1,a.minZ(),a.maxZ(),a.maxZ()+1)) {
                    boolean expected=selected.open(guest,"world",x,z);
                    int actual=0;for(var b:outside)if(b.contains("world",x,z))actual++;
                    check(actual==(expected?1:0),"every exact village corner");
                }
            int edge=BlockAccessRules.LIMIT;
            check(outside.stream().anyMatch(a->a.contains("world",-edge,-edge)),"negative world edge");
            check(outside.stream().anyMatch(a->a.contains("world",edge,edge)),"positive world edge");
            check(selected.outside("world_nether").size()==1,"unrestricted dimension needs one region");
        }
        try {new BlockAccessRules(true,Set.of(),List.of());throw new AssertionError("empty retained villages");}
        catch(IllegalArgumentException correct){checks++;}
        System.out.println("BlockAccessRulesTest checks="+checks);
    }
}
