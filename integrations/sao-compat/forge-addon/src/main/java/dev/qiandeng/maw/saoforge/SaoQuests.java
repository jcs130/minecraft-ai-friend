package dev.qiandeng.maw.saoforge;

import com.google.gson.*;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import java.util.*;
import java.util.function.Consumer;
import static dev.qiandeng.maw.saoforge.SaoReflection.*;

/** Own-team FTB views and the same submit/claim calls as the original GUI. */
final class SaoQuests {
    static final String BASE="dev.ftb.mods.ftbquests.quest.";
    static Object file(){Object value=field(type(BASE+"ServerQuestFile"),"INSTANCE");if(value==null)throw new IllegalStateException("quest_file_not_ready");return value;}
    static Object team(ServerPlayer p){Object value=call(type(BASE+"TeamData"),"get",p);if(value==null)throw new IllegalStateException("quest_team_not_ready");return value;}
    static String id(Object value){return(String)call(value,"getCodeString");}
    static String title(Object value){String raw=(String)call(value,"getRawTitle");return raw.isBlank()?"["+value.getClass().getSimpleName()+" "+id(value)+"]":raw;}
    static long numberId(String value){return Long.parseUnsignedLong(value,16);}
    static boolean completed(Object team,Object object){return yes(call(team,"isCompleted",object));}
    static boolean visible(Object team,Object quest){return yes(call(quest,"isSearchable",team));}
    static boolean canStart(Object team,Object quest){return !yes(call(team,"isLocked"))&&yes(call(team,"canStartTasks",quest));}
    static Object quest(String value){Object q=call(file(),"getQuest",numberId(value));if(q==null)throw new IllegalArgumentException("quest_not_found");return q;}
    static void requireVisible(Object t,Object q){if(!visible(t,q))throw new IllegalArgumentException("quest_not_visible");}
    static JsonObject row(ServerPlayer p,Object t,Object q){
        var out=new JsonObject();out.addProperty("id",id(q));out.addProperty("title",title(q));Object chapter=call(q,"getChapter");out.addProperty("chapterId",id(chapter));out.addProperty("chapter",title(chapter));
        out.addProperty("completed",completed(t,q));out.addProperty("canStart",canStart(t,q));out.addProperty("tracked",yes(call(t,"isQuestPinned",p,(long)field(q,"id"))));
        out.addProperty("hasUnclaimedRewards",yes(call(t,"hasUnclaimedRewards",p.getUUID(),q)));return out;
    }
    static JsonObject list(ServerPlayer p,JsonObject args){
        Object f=file(),t=team(p);List<Object> all=new ArrayList<>();call(f,"forAllQuests",(Consumer<Object>)all::add);
        String filter=args.has("filter")?args.get("filter").getAsString():"available";
        List<Object> selected=new ArrayList<>();for(Object q:all)if(visible(t,q)){
            if(args.has("chapter_id")&&!id(call(q,"getChapter")).equalsIgnoreCase(args.get("chapter_id").getAsString()))continue;
            if(args.has("query")&&!title(q).toLowerCase(Locale.ROOT).contains(args.get("query").getAsString().toLowerCase(Locale.ROOT)))continue;
            boolean done=completed(t,q),unclaimed=yes(call(t,"hasUnclaimedRewards",p.getUUID(),q));
            if(filter.equals("visible")||filter.equals("completed")&&done||filter.equals("unclaimed")&&unclaimed||filter.equals("available")&&(!done&&canStart(t,q)||unclaimed))selected.add(q);
        }
        int offset=args.has("offset")?args.get("offset").getAsInt():0,limit=args.has("limit")?args.get("limit").getAsInt():8,end=Math.min(selected.size(),offset+limit);var rows=new JsonArray();
        for(int i=Math.min(offset,selected.size());i<end;i++)rows.add(row(p,t,selected.get(i)));
        var out=new JsonObject();out.addProperty("filter",filter);out.addProperty("offset",offset);out.addProperty("totalVisibleMatching",selected.size());out.addProperty("returnedCount",rows.size());out.addProperty("complete",end>=selected.size());out.addProperty("remainingCount",Math.max(0,selected.size()-end));if(end<selected.size())out.addProperty("nextOffset",end);out.add("quests",rows);out.addProperty("progressScope","own_ftb_team");out.addProperty("teamId",String.valueOf(call(t,"getTeamId")));return out;
    }
    static String mode(Object task){
        Class<?> c=task.getClass();String name=c.getSimpleName();
        if(name.equals("CheckmarkTask")||name.equals("XPTask"))return "submit";
        if(name.equals("ObservationTask"))return "client_observation";
        if(type(BASE+"task.ItemTask").isInstance(task)){
            if(yes(call(task,"isTaskScreenOnly")))return "task_screen";
            if(yes(call(task,"isOnlyFromCrafting")))return "actual_crafting_event";
            return yes(call(task,"consumesResources"))?"submit":"automatic_inventory";
        }
        if(name.equals("CustomTask"))return "pack_script_automatic";
        return "automatic_native_event";
    }
    static JsonObject taskRow(Object t,Object task){
        var out=new JsonObject();out.addProperty("id",id(task));out.addProperty("title",title(task));out.addProperty("type",task.getClass().getSimpleName());out.addProperty("completed",completed(t,task));out.addProperty("progress",(Number)call(t,"getProgress",task));out.addProperty("required",(Number)call(task,"getMaxProgress"));out.addProperty("submissionMode",mode(task));
        var tag=new CompoundTag();call(task,"writeData",tag);String definition=tag.toString();out.addProperty("definitionSnbt",definition.length()>1200?definition.substring(0,1200):definition);out.addProperty("definitionComplete",definition.length()<=1200);return out;
    }
    static JsonObject rewardRow(ServerPlayer p,Object t,Object reward){
        var out=new JsonObject();out.addProperty("id",id(reward));out.addProperty("title",title(reward));out.addProperty("type",reward.getClass().getSimpleName());out.addProperty("claimed",yes(call(t,"isRewardClaimed",p.getUUID(),reward)));out.addProperty("blocked",yes(call(t,"isRewardBlocked",reward)));var tag=new CompoundTag();call(reward,"writeData",tag);String definition=tag.toString();out.addProperty("definitionSnbt",definition.length()>1200?definition.substring(0,1200):definition);out.addProperty("definitionComplete",definition.length()<=1200);return out;
    }
    static boolean fitsItemReward(ServerPlayer p,Object reward){
        ItemStack item=(ItemStack)call(reward,"getItem");var tag=new CompoundTag();call(reward,"writeData",tag);
        long required=((Number)call(reward,"getCount")).longValue()+Math.max(0,tag.getInt("random_bonus"));
        long space=0;for(var slot:p.getInventory().items){if(slot.isEmpty())space+=item.getMaxStackSize();else if(ItemStack.isSameItemSameTags(slot,item))space+=Math.max(0,slot.getMaxStackSize()-slot.getCount());}
        return !item.isEmpty()&&space>=required;
    }
    static JsonObject show(ServerPlayer p,JsonObject args){
        Object t=team(p),q=quest(args.get("quest_id").getAsString());requireVisible(t,q);var out=row(p,t,q);
        var dependencies=new JsonArray();for(Object dependency:((java.util.stream.Stream<?>)call(q,"streamDependencies")).toList()){var d=new JsonObject();d.addProperty("id",id(dependency));d.addProperty("completed",completed(t,dependency));if(type(BASE+"Quest").isInstance(dependency)&&visible(t,dependency))d.addProperty("title",title(dependency));dependencies.add(d);}out.add("dependencies",dependencies);
        boolean hidden=!canStart(t,q)&&yes(call(q,"hideDetailsUntilStartable"));out.addProperty("detailsHidden",hidden);if(hidden)return out;
        boolean textHidden=yes(call(call(q,"getHideTextUntilComplete"),"get",false))&&!completed(t,q);
        out.addProperty("descriptionHidden",textHidden);if(!textHidden){String description=String.join("\n",SaoReflection.list(call(q,"getRawDescription")).stream().map(String::valueOf).toList());out.addProperty("description",description.length()>6000?description.substring(0,6000):description);out.addProperty("descriptionComplete",description.length()<=6000);}
        List<?> tasks=SaoReflection.list(call(q,"getTasksAsList"));var shown=new ArrayList<>();boolean sequential=yes(call(q,"getRequireSequentialTasks"));for(Object task:tasks){shown.add(task);if(sequential&&!completed(t,task))break;}
        int offset=args.has("task_offset")?args.get("task_offset").getAsInt():0,end=Math.min(shown.size(),offset+8);var taskRows=new JsonArray();for(int i=Math.min(offset,shown.size());i<end;i++)taskRows.add(taskRow(t,shown.get(i)));out.add("tasks",taskRows);out.addProperty("taskCountVisible",shown.size());if(end<shown.size())out.addProperty("nextTaskOffset",end);out.addProperty("laterSequentialTasksHidden",tasks.size()-shown.size());
        var rewards=new ArrayList<>();for(Object r:SaoReflection.list(call(q,"getRewards")))if(!yes(call(t,"isRewardBlocked",r))&&!String.valueOf(call(r,"getAutoClaimType")).equals("INVISIBLE"))rewards.add(r);
        offset=args.has("reward_offset")?args.get("reward_offset").getAsInt():0;end=Math.min(rewards.size(),offset+8);var rewardRows=new JsonArray();for(int i=Math.min(offset,rewards.size());i<end;i++)rewardRows.add(rewardRow(p,t,rewards.get(i)));out.add("rewards",rewardRows);out.addProperty("rewardCountVisible",rewards.size());if(end<rewards.size())out.addProperty("nextRewardOffset",end);return out;
    }
    static JsonObject mutate(ServerPlayer p,String operation,JsonObject args){
        Object f=file(),t=team(p);var out=new JsonObject();if(yes(call(t,"isLocked"))){out.addProperty("ok",false);out.addProperty("reason","quest_team_locked");return out;}
        if(operation.equals("sao.quest.track")){Object q=quest(args.get("quest_id").getAsString());requireVisible(t,q);call(t,"setQuestPinned",p,(long)field(q,"id"),true);out.addProperty("ok",true);out.addProperty("changed",true);out.addProperty("reason","quest_pinned_not_completed");out.add("quest",row(p,t,q));return out;}
        if(operation.equals("sao.task.submit")){
            Object task=call(f,"getTask",numberId(args.get("task_id").getAsString()));if(task==null)throw new IllegalArgumentException("task_not_found");Object q=call(task,"getQuest");requireVisible(t,q);
            if(!canStart(t,q)){out.addProperty("ok",false);out.addProperty("reason","quest_prerequisites_or_cooldown");return out;}
            if(completed(t,task)){out.addProperty("ok",true);out.addProperty("changed",false);out.addProperty("reason","already_completed");return out;}
            if(!mode(task).equals("submit")){out.addProperty("ok",false);out.addProperty("reason","condition_requires_"+mode(task));out.add("task",taskRow(t,task));return out;}
            long before=((Number)call(t,"getProgress",task)).longValue();call(f,"withPlayerContext",p,(Runnable)()->call(task,"submitTask",t,p));long after=((Number)call(t,"getProgress",task)).longValue();
            out.addProperty("ok",after>before);out.addProperty("changed",after!=before);out.addProperty("reason",after>before?"native_task_progressed":"native_task_no_progress_check_materials");out.addProperty("beforeProgress",before);out.add("task",taskRow(t,task));out.addProperty("questCompleted",completed(t,q));return out;
        }
        Object reward=call(f,"getReward",numberId(args.get("reward_id").getAsString()));if(reward==null)throw new IllegalArgumentException("reward_not_found");Object q=call(reward,"getQuest");requireVisible(t,q);
        if(!completed(t,q)||yes(call(t,"isRewardBlocked",reward))){out.addProperty("ok",false);out.addProperty("reason","quest_incomplete_or_reward_blocked");return out;}
        if(yes(call(t,"isRewardClaimed",p.getUUID(),reward))){out.addProperty("ok",true);out.addProperty("changed",false);out.addProperty("reason","already_claimed");return out;}
        String kind=reward.getClass().getSimpleName();if(!Set.of("ItemReward","XPReward","XPLevelsReward","CustomReward").contains(kind)){out.addProperty("ok",false);out.addProperty("reason","reward_type_requires_dedicated_native_selection");return out;}
        if(kind.equals("ItemReward")&&!fitsItemReward(p,reward)){out.addProperty("ok",false);out.addProperty("reason","inventory_capacity_insufficient_before_claim");return out;}
        call(f,"withPlayerContext",p,(Runnable)()->call(t,"claimReward",p,reward,false));boolean claimed=yes(call(t,"isRewardClaimed",p.getUUID(),reward));out.addProperty("ok",claimed);out.addProperty("changed",claimed);out.addProperty("reason",claimed?"native_reward_claimed":"native_claim_refused");out.add("reward",rewardRow(p,t,reward));return out;
    }
}
