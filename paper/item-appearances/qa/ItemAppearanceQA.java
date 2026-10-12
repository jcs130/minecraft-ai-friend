package org.afuhome.itemartqa;

import com.google.gson.Gson;
import java.lang.reflect.Method;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only fixtures in a loopback staging copy. Never bundle with AgentFriend. */
public final class ItemAppearanceQA extends JavaPlugin {
    private final Map<String,ItemStack> before = new HashMap<>();
    private static final NamespacedKey VISUAL = NamespacedKey.fromString("agentfriend:appearance");
    @Override public void onEnable() {
        String root = getServer().getWorldContainer().getAbsolutePath().replace('\\','/').toLowerCase(Locale.ROOT);
        if (!root.contains("/staging/") || !getServer().getIp().equals("127.0.0.1")) throw new IllegalStateException("QA requires loopback staging");
        getCommand("itemartqa").setExecutor(this);
    }
    private Object invoke(String className, String method, Class<?>[] signature, Object... args) throws Exception {
        var plugin = getServer().getPluginManager().getPlugin("AgentFriend");
        Class<?> type = plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend."+className);
        Method target = type.getDeclaredMethod(method,signature); target.setAccessible(true);
        return target.invoke(null,args);
    }
    private ItemStack actual(String id) throws Exception {
        return switch (id) {
            case "frost_sword", "blink_dagger" -> {
                Object bonus = invoke("DungeonLoot","equipmentPiece",new Class<?>[]{int.class},id.equals("frost_sword")?1:0);
                Method item = bonus.getClass().getDeclaredMethod("item");item.setAccessible(true);yield (ItemStack)item.invoke(bonus);
            }
            case "abyss_verdict" -> (ItemStack)invoke("DungeonLoot","bossRelic",new Class<?>[]{});
            case "mechanical_crossbow" -> (ItemStack)invoke("DungeonLoot","named",new Class<?>[]{Material.class,String.class,String.class,int.class,String.class,int.class},Material.CROSSBOW,"机关弩","quick_charge",2,"unbreaking",2);
            case "focus_wand" -> {
                var plugin=getServer().getPluginManager().getPlugin("AgentFriend");
                Method definition=plugin.getClass().getDeclaredMethod("focusDefinition",String.class);definition.setAccessible(true);
                Object spell=definition.invoke(plugin,"prospect");
                Method item=plugin.getClass().getDeclaredMethod("focusItem",spell.getClass());item.setAccessible(true);yield (ItemStack)item.invoke(plugin,spell);
            }
            default -> throw new IllegalArgumentException("Unknown fixture id");
        };
    }
    @Override public boolean onCommand(CommandSender sender,Command command,String label,String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {sender.sendMessage("QA console only");return true;}
        try {
            if (args.length<2) throw new IllegalArgumentException("give|inspect <QA-player> ...");
            Player player=Bukkit.getPlayerExact(args[1]);
            if(player==null || !(player.getName().startsWith("ag_ArtQA") || player.getName().startsWith(".ag_ArtQA")))throw new IllegalArgumentException("QA body only");
            String key=player.getUniqueId()+":0";
            if(args[0].equals("give")) {
                ItemStack item=actual(args[2]);String mode=args.length>3?args[3]:"new";
                ItemMeta meta=item.getItemMeta();
                if(!mode.equals("new")){meta.setCustomModelData(null);meta.getPersistentDataContainer().remove(VISUAL);}
                if(mode.equals("foreign"))meta.setCustomModelData(9876);
                if(mode.equals("impostor")){
                    String name=meta.getDisplayName();item=new ItemStack(item.getType());meta=item.getItemMeta();meta.setDisplayName(name);
                }
                if(mode.equals("legacy")){
                    meta.getPersistentDataContainer().set(NamespacedKey.fromString("agentfriend:soulbound_owner"),PersistentDataType.STRING,player.getUniqueId().toString());
                    if(meta instanceof org.bukkit.inventory.meta.Damageable damage)damage.setDamage(7);
                }
                item.setItemMeta(meta);before.put(key,item.clone());player.getInventory().setItem(0,item);
            }
            ItemStack stack=player.getInventory().getItem(0),original=before.get(key),normalized=stack.clone();ItemMeta meta=normalized.getItemMeta();
            if(original!=null&&!original.getItemMeta().hasCustomModelData()){meta.setCustomModelData(null);meta.getPersistentDataContainer().remove(VISUAL);normalized.setItemMeta(meta);}
            Map<String,Object> out=new LinkedHashMap<>();out.put("name",player.getName());out.put("uuid",player.getUniqueId().toString());out.put("material",stack.getType().getKey().toString());out.put("count",stack.getAmount());
            out.put("modelData",stack.getItemMeta().hasCustomModelData()?stack.getItemMeta().getCustomModelData():null);out.put("appearance",stack.getItemMeta().getPersistentDataContainer().get(VISUAL,PersistentDataType.STRING));
            out.put("originalGameplayEqual",original!=null&&normalized.equals(original));out.put("fingerprint",Base64.getEncoder().encodeToString(stack.serializeAsBytes()));
            sender.sendMessage(new Gson().toJson(out));
        }catch(Exception error){sender.sendMessage("QA_ERROR "+error.getClass().getSimpleName()+" "+error.getMessage());}
        return true;
    }
}
