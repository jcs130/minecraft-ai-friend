package local.tlmcompat.hybrid;

import java.util.*;
import com.github.tartaricacid.touhoulittlemaid.item.ItemSmartSlab;
import net.minecraft.core.registries.BuiltInRegistries;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.event.*;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;

/** Explains native ownership without changing an item, a binding or an existing maid. */
final class SoulTalismanGuidance implements Listener {
    private final Map<UUID,Long> last=new HashMap<>();
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=false)
    public void use(PlayerInteractEvent event) {
        if(event.getAction()!=Action.RIGHT_CLICK_BLOCK||event.getItem()==null)return;
        var stack=CraftItemStack.asNMSCopy(event.getItem());
        if(!BuiltInRegistries.ITEM.getKey(stack.getItem()).toString().equals("touhou_little_maid:smart_slab_init"))return;
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
