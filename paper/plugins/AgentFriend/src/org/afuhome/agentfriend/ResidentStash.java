package org.afuhome.agentfriend;

import com.google.gson.*;
import java.time.Instant;
import java.util.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/** Same personal storage service; completion is verified from both real inventories. */
final class ResidentStash {
    static JsonObject run(AgentFriendPlugin plugin,Player player,String[] args) {
        var dungeon=plugin.dungeon();String action=args[2];UUID id=player.getUniqueId();
        if(action.equals("collect")){
            if(args.length!=3)return fail(new JsonObject(),"expected_arena_stash_collect");
            var collected=dungeon.collectRewards(player);
            if(collected.has("goalCompleted")){collected.add("queueCompleted",collected.remove("goalCompleted"));}
            collected.addProperty("destination","personal_reward_stash");collected.addProperty("transferredToInventory",false);
            collected.addProperty("nextSafeRead","arena stash list 1");
            collected.addProperty("nextAction","奖励已进入个人箱；按物品槽位执行 arena stash take <slot> <count> 才会进入随身背包。");return collected;
        }
        var out=new JsonObject();out.addProperty("actorId",id.toString());out.addProperty("action",action);
        out.addProperty("observedAt",Instant.now().toString());out.addProperty("schemaVersion",1);
        int queued=dungeon.queuedRewardEntries(id);out.addProperty("queuedEntries",queued);
        if(queued>0){out.addProperty("nextAction","arena stash collect");out.addProperty("queueNote","待领取队列不占箱子槽位；先 collect 入个人箱，再按实际槽位 take 到随身背包。");}
        ItemStack[] bag=clone(player.getInventory().getStorageContents()),stash=clone(dungeon.stashContents(id));
        if(Set.of("list","inventory","summary").contains(action)) {
            int page=1;if(args.length==4)try{page=Integer.parseInt(args[3]);}catch(NumberFormatException invalid){return fail(out,"invalid_page_1_to_10");}
            if(page<1||page>10||args.length>4)return fail(out,"invalid_page_1_to_10");
            if(action.equals("summary")){out.addProperty("success",true);out.addProperty("reason","observed");out.addProperty("occupied",Arrays.stream(stash).filter(ResidentStash::present).count());out.addProperty("capacity",stash.length);out.addProperty("queuedEntries",dungeon.queuedRewardEntries(id));return out;}
            boolean nativeBag=action.equals("inventory");var items=nativeBag?bag:stash;
            int start=nativeBag?0:(page-1)*54,end=nativeBag?bag.length:Math.min(start+54,stash.length);
            var rows=new JsonArray();var names=new ItemIdentity(plugin);
            for(int slot=start;slot<end;slot++)if(present(items[slot])){var item=new JsonObject();item.addProperty("slot",nativeBag?slot:slot+1);item.addProperty("count",items[slot].getAmount());names.describe(items[slot]).append(item,true);rows.add(item);}
            out.add("items",rows);out.addProperty("slotBase",nativeBag?0:1);out.addProperty("capacity",items.length);out.addProperty("page",page);out.addProperty("complete",true);
            if(!nativeBag&&end<stash.length)out.addProperty("nextCommand","arena stash list "+(page+1));
            out.addProperty("queuedEntries",dungeon.queuedRewardEntries(id));out.addProperty("success",true);out.addProperty("reason","observed");return out;
        }
        boolean take=action.equals("take");if(!take&&!action.equals("putslot"))return fail(out,"unsupported_storage_action");
        int slot,wanted;
        try{if(args.length!=5)throw new NumberFormatException();slot=Integer.parseInt(args[3])-(take?1:0);wanted=Integer.parseInt(args[4]);}
        catch(NumberFormatException invalid){return fail(out,"expected_slot_and_count_1_to_64");}
        var from=take?stash:bag;if(slot<0||slot>=from.length||wanted<1||wanted>64)return fail(out,"slot_or_count_out_of_range");
        ItemStack source=from[slot];if(!present(source)){out.addProperty("nextSafeRead",take?"arena stash list "+(slot/54+1):"arena stash inventory");return fail(out,"empty_slot");}
        out.addProperty("requested",wanted);out.addProperty("availableBefore",source.getAmount());out.addProperty("slot",take?slot+1:slot);
        new ItemIdentity(plugin).describe(source).append(out,true);
        dungeon.command(player,args); // Permissions, mana, soulbinding and durable storage are unchanged.
        ItemStack[] bagAfter=player.getInventory().getStorageContents(),stashAfter=dungeon.stashContents(id);
        int bagDelta=count(bagAfter,source)-count(bag,source),stashDelta=count(stashAfter,source)-count(stash,source);
        int moved=take?bagDelta:stashDelta;
        if(bagDelta+stashDelta!=0||moved<0||moved>Math.min(wanted,source.getAmount()))throw new IllegalStateException("storage_change_requires_reconciliation");
        out.addProperty("moved",moved);out.addProperty("remaining",Math.max(0,wanted-moved));out.addProperty("goalCompleted",moved==wanted);
        out.addProperty("success",moved>0);out.addProperty("reason",moved==wanted?"transferred":moved>0?"partial_transfer":"storage_conditions_not_met");
        out.addProperty("retrySameAction",false);out.addProperty("nextSafeRead","arena stash inventory");return out;
    }
    private static JsonObject fail(JsonObject out,String reason){out.addProperty("success",false);out.addProperty("reason",reason);out.addProperty("moved",0);out.addProperty("goalCompleted",false);return out;}
    private static boolean present(ItemStack item){return item!=null&&!item.getType().isAir()&&item.getAmount()>0;}
    private static ItemStack[] clone(ItemStack[] values){return Arrays.stream(values).map(i->i==null?null:i.clone()).toArray(ItemStack[]::new);}
    private static int count(ItemStack[] items,ItemStack match){return Arrays.stream(items).filter(i->present(i)&&i.isSimilar(match)).mapToInt(ItemStack::getAmount).sum();}
}
