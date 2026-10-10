package org.afuhome.agentfriend;

import com.google.gson.*;
import java.security.MessageDigest;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.*;
import org.bukkit.persistence.PersistentDataType;

/** Optional native-action lessons. Never moves items or purchases skills for a learner. */
final class FeatureTutorials implements Listener {
    private final AgentFriendPlugin plugin;
    private final Map<UUID,Open> open=new HashMap<>();
    private record Open(Inventory inventory,Map<String,Integer> bag,Map<String,Integer> player,Map<String,Integer> credit,boolean reopened) { }
    private final Set<UUID> interacted=new HashSet<>();
    FeatureTutorials(AgentFriendPlugin p) {plugin=p;Bukkit.getPluginManager().registerEvents(this,p);}
    private NamespacedKey key(String id) {return new NamespacedKey(plugin,"feature_lesson_"+id);}
    private boolean has(Player p,String id) {return p.getPersistentDataContainer().has(key(id),PersistentDataType.BYTE);}
    boolean enrolled(Player p) {return has(p,"enrolled") && !plugin.isObserver(p);}
    void note(Player p,String id) {
        if(!enrolled(p) || has(p,id))return;
        p.getPersistentDataContainer().set(key(id),PersistentDataType.BYTE,(byte)1);
        JsonObject r=new JsonObject();r.addProperty("schemaVersion",1);r.addProperty("type","feature_proof");r.addProperty("lesson",id);r.addProperty("source","server_observed_action");
        p.sendMessage("MC_COACH "+r);p.sendMessage("§a[特色实练] 已记录实际操作："+id+"；/mycli coach lessons 查下一步。没有代发物品或技能点。");
    }
    void cast(Player p,String raw) {
        String id=raw.split("\\s+",2)[0];
        if(Set.of("night","prospect","heart_sight","heartsight","sense","sense_enemy").contains(id))note(p,"vision");
        if(Set.of("selfheal","heal","healer_mend","healer_cleanse","healer_beacon","food").contains(id))note(p,"recovery");
        if(Set.of("blink","home","travel","support","leap","flight").contains(id))note(p,"travel");
    }
    private Map<String,Integer> credit(Player p) {
        Map<String,Integer> out=new HashMap<>();String raw=p.getPersistentDataContainer().get(key("deposit_credit"),PersistentDataType.STRING);
        if(raw!=null)try{JsonParser.parseString(raw).getAsJsonObject().entrySet().stream().limit(64).forEach(e->{if(e.getKey().matches("[a-f0-9]{64}") && e.getValue().getAsInt()>0)out.put(e.getKey(),Math.min(4096,e.getValue().getAsInt()));});}catch(RuntimeException ignored) { }
        return out;
    }
    private Map<String,Integer> items(ItemStack[] items) {
        Map<String,Integer> out=new HashMap<>();
        for(ItemStack item:items)if(item!=null && !item.getType().isAir() && !BackpackShortcutMigration.isShortcut(item))try{
            ItemStack one=item.clone();one.setAmount(1);
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(one.serializeAsBytes()));
            out.merge(hash,item.getAmount(),Integer::sum);
        }catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
        return out;
    }
    private Map<String,Integer> playerItems(Player p) {
        var contents=new ArrayList<ItemStack>(Arrays.asList(p.getInventory().getContents()));contents.add(p.getItemOnCursor());
        return items(contents.toArray(ItemStack[]::new));
    }
    private boolean ownBackpack(Player p,Inventory inv) {
        var minepacks=Bukkit.getPluginManager().getPlugin("Minepacks");if(minepacks==null || !minepacks.isEnabled() || inv.getHolder()==null)return false;
        try{
            Class<?> api=Class.forName("at.pcgamingfreaks.Minepacks.Bukkit.API.Backpack",false,minepacks.getClass().getClassLoader());
            return api.isInstance(inv.getHolder()) && p.getUniqueId().equals(api.getMethod("getOwnerId").invoke(inv.getHolder()));
        }catch(ReflectiveOperationException ignored){return false;}
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void opened(InventoryOpenEvent e) {
        if(!(e.getPlayer() instanceof Player p) || !enrolled(p) || !ownBackpack(p,e.getInventory()))return;
        var c=credit(p);open.put(p.getUniqueId(),new Open(e.getInventory(),items(e.getInventory().getContents()),playerItems(p),c,!c.isEmpty()));
        interacted.remove(p.getUniqueId());note(p,"backpack_open");if(!c.isEmpty())note(p,"backpack_reopen");
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void clicked(InventoryClickEvent e) {if(open.containsKey(e.getWhoClicked().getUniqueId()) && e.getAction()!=InventoryAction.NOTHING)interacted.add(e.getWhoClicked().getUniqueId());}
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void dragged(InventoryDragEvent e) {if(open.containsKey(e.getWhoClicked().getUniqueId()))interacted.add(e.getWhoClicked().getUniqueId());}
    @EventHandler(priority=EventPriority.MONITOR)
    public void closed(InventoryCloseEvent e) {
        if(!(e.getPlayer() instanceof Player p))return;Open before=open.remove(p.getUniqueId());
        if(before==null || before.inventory()!=e.getInventory() || !interacted.remove(p.getUniqueId()) || !enrolled(p))return;
        Map<String,Integer> after=items(e.getInventory().getContents()),inventory=playerItems(p),c=new HashMap<>(before.credit());
        Set<String> keys=new HashSet<>(before.bag().keySet());keys.addAll(after.keySet());boolean deposited=false,retrieved=false;
        for(String id:keys) {
            int bag=after.getOrDefault(id,0)-before.bag().getOrDefault(id,0),body=inventory.getOrDefault(id,0)-before.player().getOrDefault(id,0);
            if(bag>0 && body==-bag && c.size()<64){c.merge(id,bag,Integer::sum);deposited=true;}
            if(bag<0 && body==-bag && before.reopened() && before.credit().getOrDefault(id,0)>0){retrieved=true;c.computeIfPresent(id,(k,n)->n+bag>0?n+bag:null);}
        }
        p.getPersistentDataContainer().set(key("deposit_credit"),PersistentDataType.STRING,new Gson().toJson(c));
        if(deposited)note(p,"backpack_deposit");if(retrieved)note(p,"backpack_retrieve");
    }
    @EventHandler public void quit(PlayerQuitEvent e) {open.remove(e.getPlayer().getUniqueId());interacted.remove(e.getPlayer().getUniqueId());}
    private void lesson(JsonArray lessons,Player p,String id,String title,boolean done,String command,String instruction) {
        JsonObject o=new JsonObject();o.addProperty("id",id);o.addProperty("title",title);o.addProperty("done",done);o.addProperty("command",command);o.addProperty("instruction",instruction);lessons.add(o);
    }
    JsonObject state(Player p) {
        JsonObject out=new JsonObject();out.addProperty("enrolled",enrolled(p));out.addProperty("eligible",!plugin.isObserver(p));JsonArray lessons=new JsonArray();
        lesson(lessons,p,"backpack","大背包存取实练",has(p,"backpack_retrieve"),"/minepacks:backpack open","54格普通储物：打开黄色大背包，存一件普通物品，关闭，再重开取回并关闭；认本人Minepacks真实存取。不是/questbag，也不是540格奖励箱。当前阶段："+(has(p,"backpack_retrieve")?"已取回":has(p,"backpack_reopen")?"请取回再关闭":has(p,"backpack_deposit")?"请重开取回":has(p,"backpack_open")?"请存入再关闭":"请打开"));
        lesson(lessons,p,"cli","会查命令与本人状态",has(p,"cli_list")&&has(p,"cli_detail")&&has(p,"cli_status"),"/mycli list","实际成功查询/mycli list、/mycli explain skills和/mycli status；按页码继续读，报错不算，自称读过不算。查询免费。");
        lesson(lessons,p,"vision","照亮与感知",has(p,"vision"),"/mycli skills info night","先读night夜视、prospect探矿或sense心眼详情，选已学且适合场景的一项成功施放；探矿线是方位，不保证可走。不代花技能点。");
        lesson(lessons,p,"recovery","恢复与援助",has(p,"recovery"),"/mycli skills info selfheal","需要恢复时选择已学的圣愈、范围治疗、牧师治疗或饱食，真实成功施放才算；无须故意受伤，不为教程伤害队友，缺资格可稍后再做。");
        lesson(lessons,p,"travel","安全魔法出行",has(p,"travel"),"/mycli skills info blink","选已学的闪现、归乡、传送点、支援、跃空或飞行，先查安全落点、资格、魔力及冷却，真实成功才算；地图标记/地点查询不算传送。");
        lesson(lessons,p,"traversal","开门与爬梯",plugin.traversalPractice().verified(p,"door_passage")&&plugin.traversalPractice().verified(p,"ladder_ascent"),"/mycli world practice start","打开合法现有木门并走过，沿现有梯井连续上爬3格；传送/飞行不算。已有真实通行证明保留，查询practice status。");
        out.add("lessons",lessons);out.addProperty("completed",lessons.asList().stream().allMatch(x->x.getAsJsonObject().get("done").getAsBoolean()));
        out.addProperty("scope","自愿的服务器特色实练；旧实习三证/毕业保留，不自动学习、不改物品、不赠技能点。");return out;
    }
    void show(Player p) {
        if(plugin.isObserver(p)){p.sendMessage("§7观战账号不参加特色实练；请由对应生存角色学习。");return;}
        p.getPersistentDataContainer().set(key("enrolled"),PersistentDataType.BYTE,(byte)1);
        JsonObject out=state(p);out.addProperty("schemaVersion",1);out.addProperty("type","lessons");p.sendMessage("MC_COACH "+out);
        for(var e:out.getAsJsonArray("lessons")){var o=e.getAsJsonObject();p.sendMessage((o.get("done").getAsBoolean()?"§a✓ ":"§e○ ")+o.get("title").getAsString()+"："+o.get("instruction").getAsString()+" "+o.get("command").getAsString());}
    }
}
