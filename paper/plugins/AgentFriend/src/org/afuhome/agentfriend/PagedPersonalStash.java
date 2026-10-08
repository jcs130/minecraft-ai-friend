package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.*;

/** Ten ordinary double-chest pages. Persistent slot numbers 0..53 remain unchanged. */
final class PagedPersonalStash implements Listener {
    static final int PAGES=10, PAGE_SIZE=54, CAPACITY=PAGES*PAGE_SIZE;
    private final AgentFriendPlugin plugin;
    private final Map<UUID,Inventory[]> pages=new HashMap<>();
    private final Map<Inventory,Integer> offsets=new IdentityHashMap<>();
    private final Map<Inventory,UUID> selectors=new IdentityHashMap<>();
    PagedPersonalStash(AgentFriendPlugin plugin) { this.plugin=plugin; Bukkit.getPluginManager().registerEvents(this,plugin); }
    Inventory page(UUID id,int index) {
        if(index<0||index>=PAGES)throw new IllegalArgumentException("page");
        Inventory[] rows=pages.computeIfAbsent(id,k->new Inventory[PAGES]);
        if(rows[index]==null) {
            Inventory inv=Bukkit.createInventory(null,PAGE_SIZE,"个人试炼箱 · "+(index+1)+"/"+PAGES);
            for(int slot=0;slot<PAGE_SIZE;slot++) {
                ItemStack saved=plugin.getConfig().getItemStack("dungeon-personal-stash."+id+"."+(index*PAGE_SIZE+slot));
                if(saved!=null)inv.setItem(slot,saved.clone());
            }
            rows[index]=inv; offsets.put(inv,index*PAGE_SIZE);
        }
        return rows[index];
    }
    int offset(Inventory inv) { return offsets.getOrDefault(inv,0); }
    ItemStack item(UUID id,int slot) { return page(id,slot/PAGE_SIZE).getItem(slot%PAGE_SIZE); }
    void set(UUID id,int slot,ItemStack item) { page(id,slot/PAGE_SIZE).setItem(slot%PAGE_SIZE,item); }
    ItemStack[] contents(UUID id) {
        ItemStack[] all=new ItemStack[CAPACITY];
        for(int i=0;i<PAGES;i++)System.arraycopy(page(id,i).getContents(),0,all,i*PAGE_SIZE,PAGE_SIZE);
        return all;
    }
    void write(Inventory inv,UUID id) {
        for(int slot=0;slot<PAGE_SIZE;slot++) {
            ItemStack item=inv.getItem(slot);
            plugin.getConfig().set("dungeon-personal-stash."+id+"."+(offset(inv)+slot),item==null||item.getType().isAir()?null:item.clone());
        }
    }
    int add(UUID id,ItemStack item) {
        int left=item.getAmount();
        for(int i=0;i<PAGES&&left>0;i++) {
            Inventory inv=page(id,i); ItemStack part=item.clone();part.setAmount(left);
            int remaining=inv.addItem(part).values().stream().mapToInt(ItemStack::getAmount).sum();
            if(remaining!=left)write(inv,id);
            left=remaining;
        }
        return left;
    }
    void select(Player p) {
        Inventory inv=Bukkit.createInventory(null,27,"个人箱分页 · 共540格");
        for(int i=0;i<PAGES;i++) {
            Inventory page=page(p.getUniqueId(),i);int used=0;
            for(ItemStack item:page.getContents())if(item!=null&&!item.getType().isAir())used++;
            ItemStack icon=new ItemStack(Material.CHEST);var meta=icon.getItemMeta();
            meta.setDisplayName("第"+(i+1)+"页 · "+used+"/54格");
            meta.setLore(List.of("全局槽位 "+(i*54+1)+"–"+((i+1)*54),"实体箱旁免费；远程开启2魔力","原版箱子操作；不同玩家库存隔离"));icon.setItemMeta(meta);inv.setItem(i,icon);
        }
        selectors.put(inv,p.getUniqueId());p.openInventory(inv);
    }
    @EventHandler public void click(InventoryClickEvent e) {
        UUID owner=selectors.get(e.getView().getTopInventory());if(owner==null)return;e.setCancelled(true);
        if(!(e.getWhoClicked() instanceof Player p)||!owner.equals(p.getUniqueId()))return;
        int slot=e.getRawSlot();if(slot<0||slot>=PAGES)return;
        selectors.remove(e.getView().getTopInventory());p.closeInventory();
        Bukkit.getScheduler().runTask(plugin,()->plugin.dungeon().openStash(p,slot));
    }
    @EventHandler public void drag(InventoryDragEvent e){if(selectors.containsKey(e.getView().getTopInventory()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){selectors.remove(e.getInventory());}
    @EventHandler public void quit(PlayerQuitEvent e){Bukkit.getScheduler().runTask(plugin,()->{Inventory[] old=pages.remove(e.getPlayer().getUniqueId());if(old!=null)for(Inventory inv:old)offsets.remove(inv);});}
}
