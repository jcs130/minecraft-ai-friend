package org.afuhome.agentfriend;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** A real, consumable vanilla book that advances one existing spell's mastery. */
final class SkillTome {
    private static final NamespacedKey SPELL = NamespacedKey.fromString("agentfriend:skill_tome_spell");
    private static final NamespacedKey PRACTICE = NamespacedKey.fromString("agentfriend:skill_tome_practice");
    private static final List<String> SPELLS = List.of("starbolt", "frostnova", "flamewave",
            "leap", "flight", "golem", "sense", "prospect");

    static ItemStack random(int practice) {
        return create(SPELLS.get(ThreadLocalRandom.current().nextInt(SPELLS.size())), practice);
    }

    static ItemStack create(String spell, int practice) {
        if (!SpellMastery.NAMES.containsKey(spell) || practice != 4 && practice != 8)
            throw new IllegalArgumentException("Invalid skill tome");
        ItemStack book = new ItemStack(Material.BOOK);
        ItemMeta meta = book.getItemMeta();
        meta.setDisplayName(ChatColor.LIGHT_PURPLE + "技艺研习书 · " + SpellMastery.NAMES.get(spell));
        meta.setLore(List.of(ChatColor.GRAY + "千灯纪 · 可使用的试炼战利品",
                ChatColor.AQUA + "使用后：" + SpellMastery.NAMES.get(spell) + "熟练度 +" + practice,
                ChatColor.GRAY + "手持使用，或 /mycli skillbook use <背包槽位>",
                ChatColor.GRAY + "技能已达 3 级时不会消耗"));
        meta.getPersistentDataContainer().set(SPELL, PersistentDataType.STRING, spell);
        meta.getPersistentDataContainer().set(PRACTICE, PersistentDataType.INTEGER, practice);
        book.setItemMeta(meta);
        return book;
    }

    private static String spell(ItemStack item) {
        if (item == null || item.getType() != Material.BOOK || !item.hasItemMeta()) return null;
        String id = item.getItemMeta().getPersistentDataContainer().get(SPELL, PersistentDataType.STRING);
        Integer practice = item.getItemMeta().getPersistentDataContainer().get(PRACTICE, PersistentDataType.INTEGER);
        return id != null && SPELLS.contains(id) && practice != null && (practice == 4 || practice == 8)
                ? id : null;
    }

    static boolean isTome(ItemStack item) { return spell(item) != null; }
    static String spellId(ItemStack item) { return spell(item); }

    static void command(Player player, String[] args, SpellMastery mastery) {
        if (args.length == 2 && args[1].equalsIgnoreCase("list")) {
            int count = 0;
            for (int slot = 0; slot < 36; slot++) {
                ItemStack item = player.getInventory().getItem(slot);
                String id = spell(item);
                if (id == null) continue;
                int practice = item.getItemMeta().getPersistentDataContainer().get(PRACTICE, PersistentDataType.INTEGER);
                player.sendMessage("MC_SKILLBOOK action=list slot=" + slot + " id=" + id
                        + " count=" + item.getAmount() + " practice=" + practice
                        + " level=" + mastery.rank(player, id) + " uses=" + mastery.uses(player, id)
                        + " requiredUses=" + mastery.nextRequired(player, id));
                count++;
            }
            player.sendMessage("MC_SKILLBOOK action=summary count=" + count);
            return;
        }
        if (args.length >= 2 && args[1].equalsIgnoreCase("use") && args.length <= 3) {
            int slot = player.getInventory().getHeldItemSlot();
            if (args.length == 3) try { slot = Integer.parseInt(args[2]); }
            catch (NumberFormatException ignored) { slot = -1; }
            if (slot < 0 || slot >= 36) {
                player.sendMessage("MC_SKILLBOOK action=use ok=false reason=invalid_slot"); return;
            }
            use(player, slot, mastery);
            return;
        }
        player.sendMessage("用法：/mycli skillbook list | /mycli skillbook use [背包槽位0–35]");
    }

    static void use(Player player, int slot, SpellMastery mastery) {
        ItemStack item = player.getInventory().getItem(slot);
        String id = spell(item);
        if (id == null) {
            player.sendMessage("MC_SKILLBOOK action=use ok=false reason=not_skillbook slot=" + slot); return;
        }
        if (player.getGameMode() == GameMode.SPECTATOR) {
            player.sendMessage("MC_SKILLBOOK action=use ok=false reason=spectator slot=" + slot); return;
        }
        if (mastery.rank(player, id) >= 3) {
            player.sendMessage(ChatColor.YELLOW + "这项技艺已经练到 3 级；研习书留在背包中。");
            player.sendMessage("MC_SKILLBOOK action=use ok=false reason=max_level slot=" + slot + " id=" + id);
            return;
        }
        int practice = item.getItemMeta().getPersistentDataContainer().get(PRACTICE, PersistentDataType.INTEGER);
        int gained = mastery.grantTraining(player, id, practice);
        if (gained <= 0) return;
        if (item.getAmount() == 1) player.getInventory().setItem(slot, null);
        else {
            item.setAmount(item.getAmount() - 1);
            player.getInventory().setItem(slot, item);
        }
        mastery.save();
        player.sendMessage(ChatColor.LIGHT_PURPLE + "研习了" + SpellMastery.NAMES.get(id)
                + "：熟练度 +" + gained + "，当前 " + mastery.uses(player, id) + "/24。");
        player.sendMessage("MC_SKILLBOOK action=use ok=true slot=" + slot + " id=" + id
                + " gained=" + gained + " level=" + mastery.rank(player, id)
                + " uses=" + mastery.uses(player, id) + " requiredUses=" + mastery.nextRequired(player, id));
        player.playSound(player.getLocation(), Sound.BLOCK_ENCHANTMENT_TABLE_USE, 0.8f, 1.2f);
        player.spawnParticle(Particle.ENCHANT, player.getLocation().add(0, 1.2, 0), 24, 0.5, 0.5, 0.5, 0.1);
    }

    private SkillTome() { }
}
