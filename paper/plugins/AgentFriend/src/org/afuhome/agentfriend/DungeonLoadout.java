package org.afuhome.agentfriend;
import java.util.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
final class DungeonLoadout {
    private static String type(ItemStack item){return item==null?"AIR":item.getType().name();}
    static List<String> missing(Player p){
        var inv=p.getInventory();List<String> items=new ArrayList<>();
        for(ItemStack stack:inv.getStorageContents())items.add(type(stack));
        items.add(type(inv.getItemInOffHand()));items.add(type(inv.getItemInMainHand()));
        var owner=(AgentFriendPlugin)org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend");
        boolean classItem=owner!=null&&owner.nativeRpg()!=null&&owner.nativeRpg().selected()&&owner.nativeRpg().usableClassItem(p);
        return DungeonLoadoutRules.missing(Arrays.stream(inv.getArmorContents()).map(DungeonLoadout::type).toArray(String[]::new),items,classItem);
    }
    static boolean ready(Player p){var missing=missing(p);if(missing.isEmpty())return true;
        p.sendMessage("§e[无法入场] 缺少："+String.join("、",missing)+"。须穿齐四件护甲，并携带可用战斗装备；弓弩、法杖、圣典等职业装备均可。补给：/mycli guild shared");return false;}
}
