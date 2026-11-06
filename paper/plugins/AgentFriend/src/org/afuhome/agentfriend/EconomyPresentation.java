package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Navigation and bounded text only. Prices, eligibility, bank and delivery remain in the existing services. */
final class EconomyPresentation {
    private EconomyPresentation() {}
    static List<String> complete(String[] args){
        if(args.length<2||!args[0].equalsIgnoreCase("trade"))return null;
        List<String> choices=null;
        if(args.length==2)choices=List.of("shop","recycle","wallet","menu","list","find","buy","sell","info","locate","stop","hall","auction");
        else if(args[1].equalsIgnoreCase("shop")){
            if(args.length==3)choices=List.of("menu","list","buy");
            else if(args.length==4&&args[2].equalsIgnoreCase("buy"))choices=ArenaEconomy.offerIds();
        }else if(args[1].equalsIgnoreCase("recycle")){
            if(args.length==3)choices=List.of("menu","list","quote","sell","status");
            else if(args.length==4&&args[2].equalsIgnoreCase("quote"))choices=List.of("bag","chest");
        }
        String prefix=args[args.length-1].toLowerCase(Locale.ROOT);
        return choices==null?null:choices.stream().filter(c->c.startsWith(prefix)).toList();
    }
    static boolean route(AgentFriendPlugin plugin,Player p,String[] args){
        if(args.length<2||!args[0].equalsIgnoreCase("trade")
                ||!Set.of("shop","recycle").contains(args[1].toLowerCase(Locale.ROOT)))return false;
        if(plugin.isObserver(p)){p.sendMessage("§e[observer_read_only] 观战账号不能购买、回收或打开自己的仓库；请由被观战角色操作。");return true;}
        boolean json=Arrays.asList(args).contains("--json");
        var words=new ArrayList<String>();words.add("arena");words.add(args[1].toLowerCase(Locale.ROOT));
        for(int n=2;n<args.length;n++){
            if(args[n].equals("--json"))continue;
            if(args[n].startsWith("--")){p.sendMessage("§e[invalid_argument] 只支持可选 --json；未进行交易。用法：/mycli trade "+args[1].toLowerCase(Locale.ROOT)+" --help");return true;}
            words.add(args[n]);
        }
        if(words.size()==2)words.add(words.get(1).equals("shop")&&!json?"menu":"list");
        if(!json)words.add("--text");
        plugin.dungeon().command(p,words.toArray(String[]::new));return true;
    }
    static void decorateCompass(Inventory inv){
        ItemStack icon=new ItemStack(Material.GOLD_INGOT);var meta=icon.getItemMeta();
        meta.setDisplayName("§6金币商城 · 装备回收");
        meta.setLore(List.of("§7出售多余装备 → 金币 → 购买装备与物资",
                "§7点击打开；先看价格再确认，不会自动买卖",
                "§7商品送入个人箱；与任务奖励共用金币"));
        icon.setItemMeta(meta);inv.setItem(30,icon);
    }
    static boolean compassClick(Player p,int slot){
        if(slot!=30)return false;
        p.performCommand("mycli trade shop menu");return true;
    }
    static String value(JsonObject o,String key,String fallback){
        JsonElement e=o.get(key);return e==null||e.isJsonNull()?fallback:e.getAsString();
    }
    static String balance(JsonObject o){return value(o,"balance","暂不可用");}
    static String text(JsonObject r){
        String action=value(r,"action",""),reason=value(r,"reason","unknown"),money=balance(r);
        if(!r.has("success")||!r.get("success").getAsBoolean())return "§e["+reason+"] "+failure(reason,money);
        JsonObject item=r.has("item")&&r.get("item").isJsonObject()?r.getAsJsonObject("item"):new JsonObject();
        String name=value(item,"name",value(item,"id","物品"));
        return switch(action){
            case "shop_list" -> "§b"+value(r,"offerId","")+" · "+name+" ×"+value(item,"quantity","1")
                    +" / "+value(r,"unitPrice","?")+"金币每份；购买：/mycli trade shop buy "+value(r,"offerId","")+" 1";
            case "shop_list_end" -> "§b【金币商城】"+value(r,"quantity","0")+"种商品；余额 "+money+" 金币。购买不耗魔力，物品送入个人箱；份数受单格堆叠上限限制。真人：罗盘→金币商城；取货：/mycli arena stash page 1（成功远程开箱2魔力）。";
            case "recycle_list" -> "§b"+value(r,"source","")+" 槽"+value(r,"slot","")+" · "+name+" ×"+value(item,"quantity","1")
                    +condition(item)+"；单价 "+value(r,"unitPrice","?")+"金币。报价：/mycli trade recycle quote "+value(r,"source","")+" "+value(r,"slot","")+" 1";
            case "recycle_list_end" -> "§b【装备回收】第"+value(r,"page","1")+"/"+value(r,"pages","1")+"页，共"+value(r,"total","0")
                    +"项；手持、穿戴、绑定和特殊装备保留，材料可远程存箱。报价后再确认sell；下一页 /mycli trade recycle list <页码>；真人菜单 /mycli trade recycle menu。";
            case "quote" -> "§e【回收报价】"+name+" ×"+value(r,"quantity","0")+"，可得 "+value(r,"price","?")+" 金币；尚未卖出，30秒有效。确认：/mycli trade recycle sell "+value(r,"quoteId","")+"；取消无需操作。";
            case "sell" -> "§a【回收成功】"+name+" ×"+value(r,"quantity","0")+"；金币 +"+value(r,"earned","?")+"，余额 "+money+"。购买补给：/mycli trade shop list";
            case "buy" -> "§a【购买成功】"+name+" ×"+value(r,"quantity","0")+"；已扣 "+value(r,"spent","?")+" 金币，余额 "+money+"。商品已保存至个人箱待入箱队列；取货 /mycli arena stash page 1。箱满则继续保留，不要重复购买。";
            case "wallet","recycle_status" -> (r.has("pending")&&r.get("pending").getAsBoolean()
                    ?"§e【交易待对账】余额 "+money+"；不要重复买卖，保留记录并联系服主。"
                    :"§b【金币】余额 "+money+"；与Vortex任务、公会、试炼共用。卖装备 /mycli trade recycle list；买物资 /mycli trade shop list。");
            default -> "§b【商城】操作完成；余额 "+money+"。查询 /mycli trade wallet";
        };
    }
    private static String condition(JsonObject item){
        StringBuilder s=new StringBuilder();
        if(item.has("maxDurability")&&item.get("maxDurability").getAsInt()>0)s.append("；耐久 ").append(value(item,"remainingDurability","?")).append('/').append(value(item,"maxDurability","?"));
        if(item.has("enchantments")){int n=0;for(JsonElement e:item.getAsJsonArray("enchantments")){
            if(n++>=4){s.append(" 等");break;}var enchant=e.getAsJsonObject();s.append(" ").append(value(enchant,"id","").replace("minecraft:","")).append(' ').append(value(enchant,"level",""));
        }}
        return s.toString();
    }
    private static String failure(String reason,String money){return switch(reason){
        case "insufficient_balance" -> "金币不足（余额 "+money+"），未购买。完成冒险任务或回收多余装备赚金币：/mycli trade recycle list";
        case "economy_unavailable" -> "金币服务暂不可用，未确认成交；稍后 /mycli trade recycle status 核对，不要连续重试交易。";
        case "recycle_pending","recycle_unverified","money_pending","money_unverified","receipt_unavailable" -> "交易结果待对账，不重复出售、购买或补发。查询 /mycli trade recycle status，保留原记录并联系服主。";
        case "pending_queue_full" -> "个人箱待入箱队列已满，未购买、未扣费。用 /mycli arena stash page 1 整理箱子，再重新开箱接收排队物品。";
        case "not_recyclable_or_protected" -> "这件装备受保护或不在回收范围；当前手持、穿戴、绑定和特殊装备不能卖。用 /mycli trade recycle list 选服务器列出的装备，材料用个人箱保存。";
        case "quote_expired","quote_unknown_or_consumed","item_changed" -> "报价已过期、已用过或物品已改变；本次未再次出售。先 /mycli trade wallet 核对，再 /mycli trade recycle list 获取新报价。";
        case "invalid_offer_or_quantity","usage_shop_list_buy_wallet" -> "商品ID或份数不正确；未购买。先 /mycli trade shop list 复制ID；/mycli trade shop buy <ID> [份数]。非堆叠装备一次1件，物资每次最多一组。";
        case "wallet_limit" -> "金币余额将超过上限，未出售。先 /mycli trade wallet 核对；按需 /mycli trade shop list 购买补给后再报价。";
        default -> "参数不正确，未成交。/mycli trade recycle list 查物品；quote bag <0–35槽> [数量] 或 quote chest <1–540槽> [数量]；收到报价后 sell <报价ID>。";
    };}
}
