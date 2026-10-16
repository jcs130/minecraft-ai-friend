package qiandengji.villagerlife;

import java.util.Locale;
import org.bukkit.entity.Villager;
import org.bukkit.event.player.PlayerInteractEntityEvent;

/** Narrow adapter for the pinned VillagerLife 1.0.0 release. */
public final class Compatibility {
    private Compatibility() {}

    public static Villager roamingVillager(Villager villager) {
        // Service NPCs and seated residents keep their original behaviour.
        return villager == null || !villager.hasAI() || villager.isInsideVehicle()
                || villager.hasMetadata("NPC") || villager.hasMetadata("shopkeeper")
                ? null : villager;
    }

    public static boolean mayTalk(PlayerInteractEntityEvent event) {
        // A normal click must still open vanilla merchant offers for every
        // Java/Bedrock/Mineflayer client. Conversations are an explicit gesture.
        return !event.isCancelled() && event.getPlayer().isSneaking()
                && event.getPlayer().getInventory().getItemInMainHand().getType().isAir()
                && event.getRightClicked() instanceof Villager villager
                && roamingVillager(villager) != null;
    }

    public static String chineseIntent(String raw) {
        if (raw == null) return "";
        String text = raw.trim().toLowerCase(Locale.ROOT);
        if (text.contains("再见") || text.equals("退出") || text.equals("结束对话")) return "bye";
        if (text.contains("带路") || text.contains("跟着我") || text.contains("跟我来")) return "follow me";
        if (text.contains("关系") || text.contains("声望") || text.contains("信任")) return "how do you feel about me";
        if (text.contains("怎么样") || text.contains("还好吗")) return "how are you";
        if (text.contains("消息") || text.contains("聊聊") || text.contains("闲聊")
                || text.contains("天气") || text.contains("你好") || text.equals("嗨")) return "any news";
        if (text.contains("哪里") || text.contains("在哪")) {
            String[][] places = {{"床", "bed"}, {"铁匠", "anvil"}, {"农田", "farm"},
                {"堆肥", "composter"}, {"钟", "bell"}, {"图书", "lectern"}, {"水", "water"}};
            for (String[] place : places) if (text.contains(place[0])) return "where is " + place[1];
        }
        return raw; // Keep the author's English/German and unknown-intent handling.
    }

    public static void rejectChatRename(org.bukkit.entity.Player player) {
        player.sendMessage("§e聊天不能替居民改名。请使用原版命名牌，并先取得领地主人的许可；也可请房管协助。");
    }
}
