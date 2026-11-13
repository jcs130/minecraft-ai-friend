package org.afuhome.agentfriend;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.CrossbowMeta;
import org.bukkit.inventory.meta.Damageable;
final class DungeonLoadout {
    private static boolean usable(ItemStack item) {
        return item != null && !item.getType().isAir() && item.getAmount() > 0
            && (!(item.getItemMeta() instanceof Damageable meta) || item.getType().getMaxDurability() == 0
                || meta.getDamage() < item.getType().getMaxDurability());
    }
    private static String type(ItemStack item){return usable(item)?item.getType().name():"AIR";}
    static List<String> missing(Player p){
        var inv=p.getInventory();
        var stacks = new ArrayList<>(Arrays.asList(inv.getStorageContents()));
        var offhand = inv.getItemInOffHand();
        stacks.add(offhand);
        var items = stacks.stream().filter(DungeonLoadout::usable).toList();
        boolean arrows = items.stream().anyMatch(item -> switch (item.getType()) {
            case ARROW, SPECTRAL_ARROW, TIPPED_ARROW -> true;
            default -> false;
        });
        long meleeCount = items.stream().filter(item -> DungeonLoadoutRules.melee(item.getType().name())).count();
        boolean ranged = items.stream().anyMatch(item -> switch (item.getType()) {
            case BOW -> arrows;
            case CROSSBOW -> arrows || usable(offhand) && offhand.getType() == Material.FIREWORK_ROCKET
                || item.getItemMeta() instanceof CrossbowMeta meta && meta.hasChargedProjectiles();
            case TRIDENT -> meleeCount != 1 && !item.containsEnchantment(Enchantment.RIPTIDE);
            default -> false;
        });
        if (!ranged && org.bukkit.Bukkit.getPluginManager().getPlugin("AgentFriend") instanceof AgentFriendPlugin owner
                && owner.nativeRpg()!=null && owner.nativeRpg().selected()) {
            var eligible = meleeCount==1 ? items.stream().filter(item -> !DungeonLoadoutRules.melee(item.getType().name())).toList() : items;
            ranged = owner.nativeRpg().usableRangedClassItem(p,eligible);
        }
        return DungeonLoadoutRules.missing(Arrays.stream(inv.getArmorContents()).map(DungeonLoadout::type).toArray(String[]::new),meleeCount>0,ranged);
    }
    static boolean ready(Player p){var missing=missing(p);if(missing.isEmpty())return true;
        p.sendMessage("§e[无法入场] 缺少："+String.join("、",missing)+"。"+DungeonLoadoutRules.REQUIREMENTS+"。补给："+DungeonLoadoutRules.SUPPLIES);return false;}
}
