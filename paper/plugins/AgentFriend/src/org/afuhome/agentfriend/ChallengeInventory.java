package org.afuhome.agentfriend;

import java.util.*;

/** Pure accounting for a fresh open / deposit / close / reopen / withdraw cycle. */
final class ChallengeInventory {
    record Snapshot(Map<String,Integer> player,Map<String,Integer> container,boolean cursorEmpty) {
        Snapshot {player=Map.copyOf(player);container=Map.copyOf(container);}
        Map<String,Integer> total(){Map<String,Integer> out=new HashMap<>(player);container.forEach((k,n)->out.merge(k,n,Integer::sum));return out;}
    }
    final String item;
    final int count;
    Snapshot first, opened;
    int phase;
    ChallengeInventory(String item,int count){this.item=item;this.count=count;}
    String open(Snapshot snapshot){
        if(opened!=null)return "duplicate";
        if(!snapshot.cursorEmpty())return "cursor_not_empty";
        if(first==null){
            if(snapshot.player().getOrDefault(item,0)<count)return "missing_material";
            first=snapshot;opened=snapshot;phase=1;return "bag_open";
        }
        if(!first.total().equals(snapshot.total()))return "inventory_changed";
        opened=snapshot;
        if(phase==2 && snapshot.container().getOrDefault(item,0)-first.container().getOrDefault(item,0)>=count){phase=3;return "bag_reopen";}
        return "no_change";
    }
    String close(Snapshot snapshot){
        if(opened==null)return "duplicate";
        Snapshot before=opened;opened=null;
        if(!first.total().equals(snapshot.total()))return "inventory_changed";
        if(!snapshot.cursorEmpty())return "cursor_not_empty";
        if(phase==1 && deposit(before,snapshot,item,count)) {phase=2;return "bag_deposit";}
        if(phase==3 && first.player().equals(snapshot.player()) && first.container().equals(snapshot.container())){phase=4;return "bag_return";}
        return "no_change";
    }
    static boolean deposit(Snapshot before,Snapshot after,String item,int count){
        int delta=after.container().getOrDefault(item,0)-before.container().getOrDefault(item,0);
        return after.cursorEmpty()&&delta>=count&&before.player().getOrDefault(item,0)-after.player().getOrDefault(item,0)==delta&&before.total().equals(after.total());
    }
}
