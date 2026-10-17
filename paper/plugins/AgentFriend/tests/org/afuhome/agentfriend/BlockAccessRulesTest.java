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
        var trial = new BlockAccessRules.Area("world",-610,-338,-570,-270);
        var entrance = new BlockAccessRules.Area("world",-593,-328,-587,-318);
        var deep = new BlockAccessRules.Area("world",-530,-325,-490,-285);
        var challenge = new BlockAccessRules.Area("world",-374,-329,-326,-281);
        var pvp = new BlockAccessRules.Area("world",-716,-566,-684,-534);
        var facilities = List.of(camp,town,trial,entrance,deep,challenge,pvp);
        var publicRules = new BlockAccessRules(true,Set.of(owner),facilities);
        check(!publicRules.open(guest,"world",-590,-317),"trial ground must not use wilderness bypass");
        check(!publicRules.open(guest,"world",-581,-275),"outer trial damage corridor remains protected");
        check(!publicRules.open(guest,"world",-590,-328),"entrance overlap remains protected");
        check(!publicRules.open(guest,"world",-510,-305),"deep trial wing remains protected");
        check(!publicRules.open(guest,"world",-350,-305),"challenge trial wing remains protected");
        check(!publicRules.open(guest,"world",-700,-550),"public PvP arena remains protected");
        check(publicRules.open(guest,"world",-1068,-600),"NEKO field outside new spawn stays editable");
        check(publicRules.open(owner,"world",-590,-317),"exact trusted builder still edits public facilities");
        for (List<BlockAccessRules.Area> retained : List.of(List.of(camp), List.of(camp,town), List.of(camp,overlap),facilities)) {
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
