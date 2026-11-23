package org.afuhome.agentfriend;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.entity.Player;

// Regression for #35 (黑旗林营 illager_camp could not start): a ready starter standing in the first
// room was blocked with confirmation_required because a co-located SPECTATOR bystander (the operator
// spectating the agent) was auto-included in the entry roster and musterAdmission rejects observers.
// selectMusterBystanders must drop ineligible bystanders while keeping eligible ones, exclude the
// starter, sort by UUID, and apply the party limit AFTER eligibility filtering.
public final class SiteDungeonRosterTest {
    private static int passed;
    private static void check(boolean value){ if(!value) throw new AssertionError(); passed++; }

    private static Player player(UUID id){
        return (Player)Proxy.newProxyInstance(Player.class.getClassLoader(),new Class<?>[]{Player.class},
            (proxy,method,args)->{
                switch(method.getName()){
                    case "getUniqueId": return id;
                    case "toString": return "Player("+id+")";
                    case "hashCode": return id.hashCode();
                    case "equals": return proxy==args[0];
                    default:
                        Class<?> rt=method.getReturnType();
                        if(rt==boolean.class) return false;
                        if(rt.isPrimitive()&&rt!=void.class) return 0;
                        return null;
                }
            });
    }

    private static List<UUID> ids(List<Player> players){
        var out=new ArrayList<UUID>();
        for(Player p:players) out.add(p.getUniqueId());
        return out;
    }

    public static void main(String[] args){
        UUID starter =UUID.fromString("00000000-0000-0000-0000-000000000001");
        UUID observer=UUID.fromString("00000000-0000-0000-0000-000000000002");
        UUID readyA  =UUID.fromString("00000000-0000-0000-0000-000000000003");
        UUID readyB  =UUID.fromString("00000000-0000-0000-0000-000000000004");
        String blocked="当前状态不允许进入";
        String reward ="请先领取这处遗迹的旧奖励";

        Map<UUID,String> admissions=new HashMap<>();
        admissions.put(starter,"");
        admissions.put(observer,blocked);
        admissions.put(readyA,"");
        admissions.put(readyB,"");
        java.util.function.Function<Player,String> admission=p->admissions.getOrDefault(p.getUniqueId(),"");

        // 1. THE #35 REGRESSION: ready starter + co-located observer => observer excluded, no bystander.
        check(SiteDungeonManager.selectMusterBystanders(
                List.of(player(starter),player(observer)),starter,admission,39).isEmpty());

        // 2. An eligible bystander is still included (party play preserved).
        check(ids(SiteDungeonManager.selectMusterBystanders(
                List.of(player(starter),player(readyA)),starter,admission,39)).equals(List.of(readyA)));

        // 3. The starter is never re-added as a bystander even when eligible.
        check(SiteDungeonManager.selectMusterBystanders(
                List.of(player(starter)),starter,admission,39).isEmpty());

        // 4. Mixed roster: observer + starter dropped, eligible kept and sorted by UUID.
        check(ids(SiteDungeonManager.selectMusterBystanders(
                List.of(player(readyB),player(observer),player(starter),player(readyA)),starter,admission,39))
                .equals(List.of(readyA,readyB)));

        // 5. Party limit applies AFTER eligibility: observer has the smallest UUID but is filtered out,
        //    so the eligible bystander still gets the single remaining slot.
        check(ids(SiteDungeonManager.selectMusterBystanders(
                List.of(player(observer),player(readyA)),starter,admission,1)).equals(List.of(readyA)));

        // 6. A bystander holding an unclaimed reward is ineligible and excluded.
        admissions.put(readyB,reward);
        check(ids(SiteDungeonManager.selectMusterBystanders(
                List.of(player(readyA),player(readyB)),starter,admission,39)).equals(List.of(readyA)));

        // 7. Empty candidate list yields an empty bystander roster.
        check(SiteDungeonManager.selectMusterBystanders(List.of(),starter,admission,39).isEmpty());

        // 8. All observers => no bystanders (a ready starter can still start solo).
        check(SiteDungeonManager.selectMusterBystanders(
                List.of(player(observer),player(observer)),starter,admission,39).isEmpty());

        System.out.println("PASS "+passed+" muster bystander roster checks");
    }
}