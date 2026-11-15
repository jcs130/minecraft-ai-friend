package org.qiandengji.vortex;

import io.vortexcore.quest.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;

/** Reads the native quest ledger; never claims, accepts or resets a quest. */
final class QuestReadyNotifier {
    private record Notice(String signature,long at) { }
    private final Map<UUID,Notice> notices=new HashMap<>();
    private final Set<UUID> pending=new HashSet<>();
    private final JavaPlugin plugin;
    private final QuestService quests;
    QuestReadyNotifier(JavaPlugin plugin,QuestService quests) {
        this.plugin=plugin;this.quests=quests;
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,100,200);
    }
    private void tick() {
        notices.keySet().removeIf(id->Bukkit.getPlayer(id)==null);
        for(Player player:Bukkit.getOnlinePlayers()) {
            if(player.isDead()||player.getGameMode()==org.bukkit.GameMode.SPECTATOR||!pending.add(player.getUniqueId()))continue;
            quests.questData(player.getUniqueId()).whenComplete((data,error)->{
                if(!plugin.isEnabled())return;
                Bukkit.getScheduler().runTask(plugin,()->{
                    pending.remove(player.getUniqueId());
                    if(error!=null||Bukkit.getPlayer(player.getUniqueId())!=player||!player.isOnline())return;
                    deliver(player,data);
                });
            });
        }
    }
    private void deliver(Player player,PlayerQuestData data) {
        var ready=data.quests().values().stream()
            .filter(p->quests.registry().find(p.questId()).map(q->QuestText.ready(q,p)).orElse(false))
            .sorted(Comparator.comparing(QuestProgress::questId)).limit(5).toList();
        if(ready.isEmpty()){notices.remove(player.getUniqueId());return;}
        String signature=String.join(",",ready.stream().map(QuestProgress::questId).toList());
        long now=System.currentTimeMillis();Notice previous=notices.get(player.getUniqueId());
        if(previous!=null&&previous.signature.equals(signature)&&now-previous.at<600_000)return;
        notices.put(player.getUniqueId(),new Notice(signature,now));
        player.sendMessage("§a[任务待交付] "+ready.size()+" 项目标已达成，尚未领奖。右侧是接单名额，不是目标进度；交付后释放名额。");
        for(var progress:ready) {
            String id=progress.questId();if(!id.matches("[a-z0-9_]{1,64}"))continue;
            String name=quests.registry().find(id).map(QuestDefinition::name).orElse(id);
            player.sendMessage(Component.text("[点击交付] "+name,NamedTextColor.GREEN)
                .clickEvent(ClickEvent.runCommand("/mycli tasks claim "+id)));
            player.sendMessage("MC_QUEST_READY id="+id+" phase=ready_to_claim goalCompleted=true rewardClaimed=false nextCommand=\"/mycli tasks claim "+id+"\"");
        }
    }
}
