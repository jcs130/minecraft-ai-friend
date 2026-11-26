package local.tlmcompat.hybrid;

import java.util.*;
import com.github.tartaricacid.touhoulittlemaid.item.ItemSmartSlab;
import net.minecraft.core.registries.BuiltInRegistries;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.event.*;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;

/** The shared native item route is fenced before item use, never by deleting a spawned body. */
final class SoulTalismanGuidance implements Listener {
    private static final String INIT="touhou_little_maid:smart_slab_init";
    private static final String FILLED="touhou_little_maid:smart_slab_has_maid";
    private static final String EMPTY="touhou_little_maid:smart_slab_empty";
    private final HybridMaidPlugin plugin;
    private final Map<UUID,Long> last=new HashMap<>();
    SoulTalismanGuidance(HybridMaidPlugin plugin){this.plugin=plugin;}

    private void explain(Player actor, String text) {
        long now=System.currentTimeMillis();
        if(now-last.getOrDefault(actor.getUniqueId(),0L)<2000)return;
        if(last.size()>256)last.clear();last.put(actor.getUniqueId(),now);
        actor.sendMessage("§e[伙伴] "+text);
    }

    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=false)
    public void capture(PlayerInteractEntityEvent event) {
        if(!plugin.singlePlayerPartner())return;
        var maid = HybridMaidPlugin.nativeMaid(event.getRightClicked());
        if(maid==null)return;
        var player = event.getPlayer();
        var item = event.getHand() == EquipmentSlot.HAND ? player.getInventory().getItemInMainHand() : player.getInventory().getItemInOffHand();
        var stack=CraftItemStack.asNMSCopy(item);
        String key=BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
        if(EMPTY.equals(key)) {
            event.setCancelled(true);
            explain(player,"魂符不再收纳女仆；用技能罗盘召回已有伙伴。物品未消耗。");
        } else if("minecraft:cake".equals(key)&&maid.getOwnerUUID()==null&&
                (plugin.primaryPartner(player.getUniqueId())!=null||!plugin.registeredBodies(player.getUniqueId()).isEmpty())) {
            event.setCancelled(true);
            explain(player,"每人只有一位伙伴。已有绑定时不能再领养一位。");
        }
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=false)
    public void use(PlayerInteractEvent event) {
        if(event.getAction()!=Action.RIGHT_CLICK_BLOCK||event.getItem()==null)return;
        var stack=CraftItemStack.asNMSCopy(event.getItem());
        String key=BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
        if(plugin.singlePlayerPartner()&&(INIT.equals(key)||FILLED.equals(key))) {
            event.setUseItemInHand(Event.Result.DENY);
            explain(event.getPlayer(),"每人只有一位伙伴。请用技能罗盘领取或召回；魂符未消耗，也没有放出女仆。");
            return;
        }
        if(!INIT.equals(key))return;
        UUID owner=ItemSmartSlab.getInitMaidOwner(stack),actor=event.getPlayer().getUniqueId();
        if(owner.equals(new UUID(0,0))||owner.equals(actor))return;
        event.setUseItemInHand(Event.Result.DENY);
        long now=System.currentTimeMillis();if(now-last.getOrDefault(actor,0L)<2000)return;
        if(last.size()>256)last.clear();last.put(actor,now);
        String name=Bukkit.getOfflinePlayer(owner).getName();
        event.getPlayer().sendMessage("§e[魂符归属不符] 这枚初始魂符属于 "+(name==null?owner:name)+"，你当前是 "+event.getPlayer().getName()+"。魂符未消耗，也没有放出女仆。");
        event.getPlayer().sendMessage("§7请使用绑定本人或未绑定的初始魂符；共享箱拿到的他人初始魂符不能代用。首次领取有问题请联系服主核对，不要重复右键。已经收纳女仆的魂符不可改绑。");
    }
}
