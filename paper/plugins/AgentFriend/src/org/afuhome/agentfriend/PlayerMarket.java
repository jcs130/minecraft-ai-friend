package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.*;
import org.bukkit.inventory.*;
import org.bukkit.persistence.PersistentDataType;

/** Fixed-price listings. Uses the Vortex bank journal and existing personal-box delivery.
 * All state changes run on the server thread. An uncertain transfer stays reserved;
 * neither a refund nor a second item is guessed from a failed response. */
final class PlayerMarket implements Listener {
    private static final String ROOT="player-market.orders";
    private final AgentFriendPlugin plugin;
    private final NativeRpg bank;
    private final ItemIdentity names;
    private final NamespacedKey proof;
    private final Set<UUID> locked=new HashSet<>();
    private final Map<UUID,Quote> quotes=new HashMap<>();
    private final Map<Inventory,Menu> menus=new IdentityHashMap<>();
    private record Quote(String id, int slot, ItemStack item, long price, long expires){}
    private record Menu(UUID owner,String kind,List<String> ids,int page,long price,String fingerprint){}
    PlayerMarket(AgentFriendPlugin plugin,NativeRpg bank){
        this.plugin=plugin;this.bank=bank;names=new ItemIdentity(plugin);proof=new NamespacedKey(plugin,"market_transfer");
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTask(plugin,()->Bukkit.getOnlinePlayers().forEach(this::recover));
    }
    private void require(boolean ok,String reason){if(!ok)throw new IllegalArgumentException(reason);}
    private ConfigurationSection orders(){
        require(!plugin.getConfig().contains(ROOT)||plugin.getConfig().isConfigurationSection(ROOT),"ledger_invalid");
        return plugin.getConfig().getConfigurationSection(ROOT);
    }
    private List<String> ids(){var c=orders();return c==null?List.of():new ArrayList<>(c.getKeys(false));}
    private ConfigurationSection order(String id){
        require(id.matches("m_[a-f0-9]{24}"),"unknown_listing");
        var c=plugin.getConfig().getConfigurationSection(ROOT+"."+id);require(c!=null,"unknown_listing");
        require(c.isItemStack("item")&&c.getLong("price")>=1&&c.getLong("price")<=100000&&c.isString("seller"),"ledger_invalid");
        return c;
    }
    private String state(String id){return order(id).getString("state","");}
    private boolean own(Player p,String id){return p.getUniqueId().toString().equals(order(id).getString("seller"));}
    private void set(String id,String key,Object value){plugin.getConfig().set(ROOT+"."+id+"."+key,value);}
    private void atomic(Runnable change){
        require(Bukkit.isPrimaryThread(),"server_thread_required");
        String before=plugin.getConfig().saveToString();
        try{orders();change.run();bank.saveConfigVerified();}
        catch(Exception e){
            try{plugin.getConfig().loadFromString(before);}catch(Exception broken){throw new IllegalStateException("market rollback failed",broken);}
            throw new IllegalArgumentException("storage_unavailable");
        }
    }
    private void playable(Player p){
        require(!plugin.isObserver(p),"observer_read_only");require(!locked.contains(p.getUniqueId()),"item_transfer_pending");
        require(p.isOnline()&&!p.isDead()&&p.getGameMode()==GameMode.SURVIVAL&&!plugin.pvpParticipant(p),"survival_required");
        require(p.getItemOnCursor().getType().isAir(),"cursor_not_empty");
    }
    private void available(Player p){var s=bank.recyclingState(p);require(s.has("available")&&s.get("available").getAsBoolean(),"economy_unavailable");require(!s.get("pending").getAsBoolean(),"money_pending");}
    private boolean tradable(ItemStack item){
        if(item==null||item.getType().isAir()||item.getAmount()<1||item.getAmount()>item.getMaxStackSize()||!item.getType().isItem())return false;
        if(Set.of(Material.BARRIER,Material.COMMAND_BLOCK,Material.CHAIN_COMMAND_BLOCK,Material.REPEATING_COMMAND_BLOCK,Material.STRUCTURE_BLOCK,Material.JIGSAW).contains(item.getType()))return false;
        var meta=item.getItemMeta();
        var keys=meta.getPersistentDataContainer().getKeys();
        if(keys.isEmpty())return !meta.isUnbreakable()&&item.serializeAsBytes().length<=24000;
        if(ArenaEconomy.eligible(item))return item.serializeAsBytes().length<=24000;
        // Bound rules are read from the running Vortex item service, never inferred from lore.
        try{
            var identityKeys=Set.of("vortexrpg:vortex_item_id","vortexrpg:profession_item_id","vortexrpg:fracture_item_id");
            var affixKeys=Set.of("vortexrpg:relic_affix","vortexrpg:fracture_rarity","vortexrpg:fracture_state");
            if(keys.stream().noneMatch(k->identityKeys.contains(k.toString()))||keys.stream().anyMatch(k->!identityKeys.contains(k.toString())&&!affixKeys.contains(k.toString())))return false;
            var v=Bukkit.getPluginManager().getPlugin("VortexRPG");if(v==null||!v.isEnabled())return false;
            Object service=v.getClass().getMethod("qiandengjiItems").invoke(v);
            String id=(String)service.getClass().getMethod("resolveId",ItemStack.class).invoke(service,item);
            var definition=(Optional<?>)service.getClass().getMethod("definition",String.class).invoke(service,id);
            return definition.isPresent()&&!((Boolean)service.getClass().getMethod("isLocked",ItemStack.class).invoke(service,item))&&item.serializeAsBytes().length<=24000;
        }catch(Exception unavailable){return false;}
    }
    private String fingerprint(ItemStack item){return item==null?"":Base64.getEncoder().encodeToString(item.serializeAsBytes());}
    private Path playerFile(Player p){return Bukkit.getWorlds().getFirst().getWorldFolder().toPath().resolve("playerdata").resolve(p.getUniqueId()+".dat");}
    private void saveRemoval(Player p,String nonce)throws Exception{
        p.getPersistentDataContainer().set(proof,PersistentDataType.STRING,nonce);p.saveData();
        PvpEscrowFiles.confirmPlayerSave(playerFile(p),proof.toString(),nonce);
    }
    private Quote quote(Player p,long price){
        playable(p);available(p);require(price>=1&&price<=100000,"price_range");
        var item=p.getInventory().getItemInMainHand();require(tradable(item),"protected_item");
        capacity(p);
        var q=new Quote("m_"+UUID.randomUUID().toString().replace("-","").substring(0,24),p.getInventory().getHeldItemSlot(),item.clone(),price,System.currentTimeMillis()+30000);
        quotes.put(p.getUniqueId(),q);return q;
    }
    private void capacity(Player p){
        require(ids().size()<10000,"market_capacity");
        long total=0,mine=0;for(String id:ids())if(Set.of("PREPARED","OPEN","RESERVED","DELIVERED").contains(state(id))){total++;if(own(p,id))mine++;}
        require(total<200&&mine<10,"listing_limit");
    }
    private String listItem(Player p,String id){
        playable(p);available(p);Quote q=quotes.remove(p.getUniqueId());
        require(q!=null&&q.id.equals(id)&&q.expires>=System.currentTimeMillis(),"quote_expired");
        require(q.slot==p.getInventory().getHeldItemSlot()&&q.item.equals(p.getInventory().getItem(q.slot))&&tradable(q.item),"item_changed");
        capacity(p); // Other sellers may have filled the market since this quote was issued.
        String nonce=UUID.randomUUID().toString();
        atomic(()->{set(id,"seller",p.getUniqueId().toString());set(id,"sellerName",p.getName());set(id,"item",q.item.clone());set(id,"price",q.price);set(id,"state","PREPARED");set(id,"slot",q.slot);set(id,"nonce",nonce);set(id,"created",System.currentTimeMillis());});
        locked.add(p.getUniqueId());
        try{
            p.getInventory().setItem(q.slot,null);p.updateInventory();saveRemoval(p,nonce);
            atomic(()->set(id,"state","OPEN"));locked.remove(p.getUniqueId());return "listed";
        }catch(Exception uncertain){throw new IllegalArgumentException("item_transfer_pending");}
    }
    private void recover(Player p){
        try{
            for(String id:ids())if(own(p,id)&&state(id).equals("PREPARED")){
                locked.add(p.getUniqueId());var c=order(id);String nonce=c.getString("nonce","");
                boolean saved=false;
                if(nonce.equals(p.getPersistentDataContainer().get(proof,PersistentDataType.STRING))){
                    try{PvpEscrowFiles.confirmPlayerSave(playerFile(p),proof.toString(),nonce);saved=true;}catch(Exception uncertain){/* Keep escrow and lock. */}
                }
                if(saved){
                    // Join kits may fill the emptied slot with a backpack/compass before
                    // this listener. The saved nonce proves removal; never remove the new item.
                    require(!c.getItemStack("item").equals(p.getInventory().getItem(c.getInt("slot"))),"item_transfer_pending");
                    atomic(()->set(id,"state","OPEN"));
                }
                else if(c.getItemStack("item").equals(p.getInventory().getItem(c.getInt("slot"))))atomic(()->set(id,"state","ABORTED"));
                else throw new IllegalArgumentException("item_transfer_pending");
            }
            locked.remove(p.getUniqueId());
        }catch(Exception uncertain){locked.add(p.getUniqueId());error(p,"item_transfer_pending",false);}
    }
    boolean blockPending(Player p){if(!locked.contains(p.getUniqueId()))return false;recover(p);if(locked.contains(p.getUniqueId()))error(p,"item_transfer_pending",false);return true;}
    private void deliver(String id,UUID recipient,String phase){
        require(plugin.dungeon().queuedItems(recipient)<1024,"personal_box_full");
        atomic(()->{require(plugin.dungeon().queuePurchased(recipient,order(id).getItemStack("item")),"personal_box_full");set(id,"state",phase);});
    }
    private String buy(Player p,String id){
        playable(p);var c=order(id);require(!own(p,id),"own_listing");String state=c.getString("state");
        if(Set.of("SOLD","PAYING","PAID").contains(state)&&p.getUniqueId().toString().equals(c.getString("buyer")))return "already_bought";
        require(state.equals("OPEN")||Set.of("RESERVED","DELIVERED").contains(state)&&p.getUniqueId().toString().equals(c.getString("buyer")),"listing_unavailable");
        if(state.equals("OPEN")){
            available(p);require(bank.goldBalance(p.getUniqueId())>=c.getLong("price"),"insufficient_balance");
            require(plugin.dungeon().queuedItems(p.getUniqueId())<1024,"personal_box_full");
            atomic(()->{set(id,"state","RESERVED");set(id,"buyer",p.getUniqueId().toString());});
        }
        var receipt=bank.settleMoney(p,"market-buy:"+id,-c.getLong("price"),"market="+id+";seller="+c.getString("seller"),()->deliver(id,p.getUniqueId(),"DELIVERED"));
        String reason=receipt.get("reason").getAsString();
        if(!receipt.get("success").getAsBoolean()&&!reason.equals("transaction_already_completed")){
            if(state.equals("OPEN")&&Set.of("insufficient_balance","economy_unavailable","money_pending").contains(reason))atomic(()->{set(id,"state","OPEN");set(id,"buyer",null);});
            throw new IllegalArgumentException(reason);
        }
        require(state(id).equals("DELIVERED"),"money_pending");atomic(()->set(id,"state","SOLD"));
        Player seller=Bukkit.getPlayer(UUID.fromString(order(id).getString("seller")));
        if(seller!=null&&seller.isOnline())try{collect(seller,id);seller.sendMessage("§a[交易行] 商品已售出，收益已入账："+id+"；查询 /mycli trade wallet");}catch(Exception pending){seller.sendMessage("§e[交易行] 商品已成交，收益保留；可正常操作后 /mycli trade auction collect "+id+"。若结算待核对，不重复退款。");}
        return "bought";
    }
    private String cancel(Player p,String id){
        playable(p);require(own(p,id),"not_owner");if(state(id).equals("CANCELLED"))return "already_returned";
        require(state(id).equals("OPEN"),"listing_unavailable");deliver(id,p.getUniqueId(),"CANCELLED");return "returned";
    }
    private String collect(Player p,String id){
        playable(p);require(own(p,id),"not_owner");if(state(id).equals("PAID"))return "already_paid";
        require(Set.of("SOLD","PAYING").contains(state(id)),"not_ready_to_collect");
        var receipt=bank.settleMoney(p,"market-pay:"+id,order(id).getLong("price"),"market="+id+";buyer="+order(id).getString("buyer"),()->atomic(()->set(id,"state","PAYING")));
        if(!receipt.get("success").getAsBoolean()&&!receipt.get("reason").getAsString().equals("transaction_already_completed"))throw new IllegalArgumentException(receipt.get("reason").getAsString());
        atomic(()->set(id,"state","PAID"));return "paid";
    }
    private JsonObject describe(String id){
        var c=order(id);var j=new JsonObject();j.addProperty("id",id);j.addProperty("seller",c.getString("sellerName"));j.addProperty("state",c.getString("state"));j.addProperty("price",c.getLong("price"));
        var item=c.getItemStack("item");j.addProperty("quantity",item.getAmount());j.addProperty("name",names.describe(item).name());j.addProperty("material",item.getType().getKey().toString());
        j.addProperty("details",itemDetails(item));return j;
    }
    private String itemDetails(ItemStack item){
        var parts=new ArrayList<String>();if(item.getItemMeta() instanceof org.bukkit.inventory.meta.Damageable d&&item.getType().getMaxDurability()>0)parts.add("耐久 "+(item.getType().getMaxDurability()-d.getDamage())+"/"+item.getType().getMaxDurability());
        item.getEnchantments().entrySet().stream().limit(8).forEach(e->parts.add(e.getKey().getKey().getKey()+" "+e.getValue()));
        return String.join("；",parts);
    }
    private List<String> visible(Player p,boolean mine){return ids().stream().filter(id->mine?own(p,id)&&!Set.of("ABORTED","CANCELLED","PAID").contains(state(id)):state(id).equals("OPEN")).toList();}
    void command(Player p,String[] raw){
        boolean json=Arrays.asList(raw).contains("--json");String[] a=Arrays.stream(raw).filter(s->!s.equals("--json")).toArray(String[]::new);
        String action=a.length>2?a[2].toLowerCase(Locale.ROOT):"list";
        if(Arrays.asList(a).contains("--help")||action.equals("help")){help(p);return;}
        try{
            require(!plugin.isObserver(p),"observer_read_only");String id=a.length>3?a[3]:"";String result;
            switch(action){
                case "list","mine"->{require(a.length<=4,"usage");int page=id.isEmpty()?1:Integer.parseInt(id);require(page>=1&&page<=1200,"usage");var rows=visible(p,action.equals("mine"));var out=new JsonObject();out.addProperty("success",true);out.addProperty("page",page);out.addProperty("pages",Math.max(1,(rows.size()+7)/8));var list=new JsonArray();for(int i=(page-1)*8;i<Math.min(page*8,rows.size());i++){var row=describe(rows.get(i));list.add(row);if(!json)p.sendMessage("§b"+row.get("id").getAsString()+" · "+row.get("name").getAsString()+" ×"+row.get("quantity").getAsInt()+"，总价 "+row.get("price").getAsLong()+"金币；卖家 "+row.get("seller").getAsString()+"；"+row.get("state").getAsString());}out.add("listings",list);if(json)p.sendMessage("MC_MARKET "+out);else{p.sendMessage("§b【玩家交易行】第"+page+"/"+out.get("pages").getAsInt()+"页；详情 info <ID>，购买 buy <ID>；真人 menu。上架：手持整组物品，sell <总价> 查看确认。我的商品 mine。");}return;}
                case "menu"->{require(a.length==3,"usage");open(p,false,1);return;}
                case "info"->{require(a.length==4,"usage");var row=describe(id);if(!state(id).equals("OPEN"))require(own(p,id)||p.getUniqueId().toString().equals(order(id).getString("buyer")),"listing_unavailable");if(json){row.addProperty("success",true);p.sendMessage("MC_MARKET "+row);}else p.sendMessage("§b"+row.get("name").getAsString()+" ×"+row.get("quantity").getAsInt()+"；"+row.get("details").getAsString()+"；总价 "+row.get("price").getAsLong()+"金币；状态 "+state(id)+"。购买 /mycli trade auction buy "+id+"；下架 /mycli trade auction cancel "+id);return;}
                case "sell"->{require(a.length==4,"usage");var q=quote(p,Long.parseLong(id));var out=new JsonObject();out.addProperty("success",true);out.addProperty("quoteId",q.id);out.addProperty("name",names.describe(q.item).name());out.addProperty("quantity",q.item.getAmount());out.addProperty("price",q.price);out.addProperty("confirmCommand","/mycli trade auction confirm "+q.id);if(json)p.sendMessage("MC_MARKET "+out);else p.sendMessage("§e【上架确认】"+names.describe(q.item).name()+" ×"+q.item.getAmount()+"，整组总价 "+q.price+"金币。未移走物品；30秒内确认 /mycli trade auction confirm "+q.id+"；取消无需操作。");return;}
                case "confirm"->{require(a.length==4,"usage");result=listItem(p,id);}
                case "buy"->{require(a.length==4,"usage");result=buy(p,id);}
                case "cancel"->{require(a.length==4,"usage");result=cancel(p,id);}
                case "collect"->{require(a.length==3||a.length==4,"usage");if(id.isEmpty()){int n=0;for(String entry:ids())if(own(p,entry)&&Set.of("SOLD","PAYING").contains(state(entry))){collect(p,entry);if(++n>=10)break;}result=n>0?"paid":"nothing_to_collect";}else result=collect(p,id);}
                default->throw new IllegalArgumentException("usage");
            }
            var out=new JsonObject();out.addProperty("success",true);out.addProperty("reason",result);out.addProperty("id",id);
            if(json)p.sendMessage("MC_MARKET "+out);else p.sendMessage("§a[交易行:"+result+"] "+switch(result){case "listed"->"已上架，物品由交易行保管。下架 /mycli trade auction cancel "+id;case "bought","already_bought","returned","already_returned"->"物品已保存到个人箱，未重复发放。取货 /mycli arena stash page 1";default->"收益已处理或暂无待领；不会重复入账。余额 /mycli trade wallet";});
        }catch(Exception failure){error(p,failure instanceof NumberFormatException?"usage":failure instanceof IllegalArgumentException?failure.getMessage():"storage_unavailable",json);}
    }
    private void help(Player p){p.sendMessage("§b玩家交易行：/mycli trade auction list|mine [页码]；info|buy|cancel <ID>；手持物品 sell <整组总价1–100000> → confirm <确认ID>；collect [ID] 领取离线收益；menu 真人界面。可加 --json。");p.sendMessage("每人最多10单，上架直到成交或下架；无税。附魔、名称、耐久原样保留；绑定/系统道具不卖。商品送个人箱，卖家离线收益保留；待对账不重复付钱，保留ID联系服主。");}
    private void error(Player p,String reason,boolean json){
        String next=switch(reason){
            case "price_range"->"总价须为1–100000整数金币；sell 10 是整组10金币。";
            case "protected_item"->"手持可交易物品后 sell <总价>；绑定、系统/未知标签道具及过大数据暂不接受，物品未出售。";
            case "quote_expired","item_changed"->"确认过期或主手物品改变；未再次上架。重新手持物品 sell <总价>。";
            case "insufficient_balance"->"金币不足，未购买；/mycli trade wallet 查余额，trade recycle list 可回收多余装备。";
            case "unknown_listing","listing_unavailable","own_listing","not_owner","not_ready_to_collect"->"商品已变化、尚未成交或不是本人可操作的商品；/mycli trade auction list 查在售，mine 查自己的商品。";
            case "personal_box_full"->"个人箱待入箱队列已满；/mycli arena stash page 1 整理后再操作。";
            case "item_transfer_pending"->"上架保存待核实，物品转移已锁定。原物品托管仍保留；请联系服主核对，不要重建商品。";
            case "money_pending","money_unverified","storage_unavailable","ledger_invalid","receipt_unavailable"->"交易待核对，保留商品ID，不重复付钱/退款；/mycli trade recycle status 查看记录并联系服主。";
            case "economy_unavailable"->"金币服务暂不可用；稍后 /mycli trade wallet 核对。";
            case "listing_limit","market_capacity"->"达到挂单/历史容量；mine 查看并下架不卖的商品，历史容量请联系服主归档。";
            case "survival_required","cursor_not_empty","observer_read_only"->"由本人在正常生存状态操作，退出竞技并清空鼠标所持物品；观战账号只观看。";
            default->"用法：/mycli trade auction --help；未确认成交。";
        };
        if(json){var out=new JsonObject();out.addProperty("success",false);out.addProperty("reason",reason);out.addProperty("next",next);p.sendMessage("MC_MARKET "+out);}else p.sendMessage("§e["+reason+"] "+next);
    }
    private ItemStack icon(Material material,String title,String...lore){var i=new ItemStack(material);var m=i.getItemMeta();m.setDisplayName("§6"+title);m.setLore(Arrays.asList(lore));i.setItemMeta(m);return i;}
    private ItemStack preview(String id){var c=order(id);var i=c.getItemStack("item").clone();var m=i.getItemMeta();var lore=new ArrayList<>(m.hasLore()?m.getLore():List.<String>of());lore.addAll(List.of("§e整组总价："+c.getLong("price")+"金币","§7卖家："+c.getString("sellerName"),"§7状态："+c.getString("state"),"§7点击查看并确认"));m.setLore(lore);i.setItemMeta(m);return i;}
    private void open(Player p,boolean mine,int page){
        var rows=visible(p,mine);int pages=Math.max(1,(rows.size()+35)/36);page=Math.max(1,Math.min(page,pages));var shown=rows.subList((page-1)*36,Math.min(page*36,rows.size()));
        Inventory inv=Bukkit.createInventory(null,45,(mine?"我的挂单":"玩家交易行")+" · "+page+"/"+pages);for(int i=0;i<shown.size();i++)inv.setItem(i,preview(shown.get(i)));
        inv.setItem(36,icon(Material.ARROW,"上一页"));inv.setItem(37,icon(Material.CHEST,"我的挂单 / 在售商品"));inv.setItem(38,icon(Material.PAPER,"上架主手整组物品","点击设置总价，再确认；不会直接移走物品"));inv.setItem(40,icon(Material.GOLD_INGOT,"领取成交收益","离线收益保留，重复点击不会多领"));inv.setItem(42,icon(Material.ENDER_CHEST,"个人箱取货"));inv.setItem(43,icon(Material.EMERALD,"返回金币商城"));inv.setItem(44,icon(Material.ARROW,"下一页"));
        menus.put(inv,new Menu(p.getUniqueId(),mine?"mine":"list",List.copyOf(shown),page,0,""));p.openInventory(inv);
    }
    private void draft(Player p,long price,String expected){
        var item=p.getInventory().getItemInMainHand();require(expected.equals(fingerprint(item)),"item_changed");require(tradable(item),"protected_item");
        Inventory inv=Bukkit.createInventory(null,27,"上架物品 · 设置整组总价");inv.setItem(4,item.clone());inv.setItem(10,icon(Material.REDSTONE,"减10金币"));inv.setItem(11,icon(Material.REDSTONE_TORCH,"减1金币"));inv.setItem(13,icon(Material.GOLD_INGOT,"总价 "+price+" 金币","整组 "+item.getAmount()+" 件，不是单件价格"));inv.setItem(15,icon(Material.TORCH,"加1金币"));inv.setItem(16,icon(Material.GLOWSTONE_DUST,"加10金币"));inv.setItem(20,icon(Material.ARROW,"返回"));inv.setItem(24,icon(Material.LIME_CONCRETE,"查看上架确认"));
        menus.put(inv,new Menu(p.getUniqueId(),"draft",List.of(),1,price,expected));p.openInventory(inv);
    }
    private void detail(Player p,String id,boolean listing){
        Inventory inv=Bukkit.createInventory(null,27,listing?"确认上架 · 托管物品":"交易行 · 确认操作");
        if(listing){var q=quotes.get(p.getUniqueId());require(q!=null&&q.id.equals(id),"quote_expired");inv.setItem(4,q.item.clone());inv.setItem(13,icon(Material.GOLD_INGOT,"整组总价 "+q.price+" 金币"));}
        else{inv.setItem(4,preview(id));inv.setItem(13,icon(Material.GOLD_INGOT,"整组总价 "+order(id).getLong("price")+" 金币","商品送入个人箱；保留原附魔与耐久"));}
        inv.setItem(10,icon(Material.ARROW,"取消 / 返回"));inv.setItem(16,icon(Material.LIME_CONCRETE,listing?"确认上架":own(p,id)?(state(id).equals("OPEN")?"下架并退回个人箱":"领取成交收益"):"确认购买"));menus.put(inv,new Menu(p.getUniqueId(),listing?"confirm":"detail",List.of(id),1,0,""));p.openInventory(inv);
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void click(InventoryClickEvent e){
        if(locked.contains(e.getWhoClicked().getUniqueId()))e.setCancelled(true);
        var m=menus.get(e.getView().getTopInventory());if(m==null)return;e.setCancelled(true);if(!(e.getWhoClicked() instanceof Player p)||!m.owner.equals(p.getUniqueId()))return;
        int s=e.getRawSlot();if(s<0||s>=e.getView().getTopInventory().getSize())return;
        menus.put(e.getView().getTopInventory(),new Menu(m.owner,"busy",List.of(),1,0,""));if(m.kind.equals("busy"))return;
        Bukkit.getScheduler().runTask(plugin,()->{if(!p.isOnline())return;try{
            if(m.kind.equals("list")||m.kind.equals("mine")){
                if(s<m.ids.size())detail(p,m.ids.get(s),false);else if(s==36||s==44)open(p,m.kind.equals("mine"),m.page+(s==36?-1:1));else if(s==37)open(p,!m.kind.equals("mine"),1);else if(s==38)draft(p,10,fingerprint(p.getInventory().getItemInMainHand()));else if(s==40){command(p,new String[]{"trade","auction","collect"});open(p,true,1);}else if(s==42)p.performCommand("mycli arena stash page 1");else if(s==43)p.performCommand("mycli trade shop menu");else open(p,m.kind.equals("mine"),m.page);
            }else if(m.kind.equals("draft")){
                if(s==20)open(p,false,1);else if(s==24){require(m.fingerprint.equals(fingerprint(p.getInventory().getItemInMainHand())),"item_changed");detail(p,quote(p,m.price).id,true);}else draft(p,Math.max(1,Math.min(100000,m.price+switch(s){case 10->-10;case 11->-1;case 15->1;case 16->10;default->0;})),m.fingerprint);
            }else{
                if(s==16){String id=m.ids.getFirst();String action=m.kind.equals("confirm")?"confirm":own(p,id)?state(id).equals("OPEN")?"cancel":"collect":"buy";command(p,new String[]{"trade","auction",action,id});}
                open(p,false,1);
            }
        }catch(Exception failed){error(p,failed instanceof IllegalArgumentException?failed.getMessage():"storage_unavailable",false);p.closeInventory();}});
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void drag(InventoryDragEvent e){if(menus.containsKey(e.getView().getTopInventory())||locked.contains(e.getWhoClicked().getUniqueId()))e.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent e){menus.remove(e.getInventory());}
    @EventHandler(priority=EventPriority.LOWEST) public void join(PlayerJoinEvent e){recover(e.getPlayer());Bukkit.getScheduler().runTaskLater(plugin,()->{Player p=e.getPlayer();if(!p.isOnline())return;try{if(ids().stream().anyMatch(id->own(p,id)&&Set.of("SOLD","PAYING").contains(state(id))))p.sendMessage("§e[交易行] 有离线成交收益待领；罗盘→金币商城→玩家交易行→领取收益，或 /mycli trade auction collect。");}catch(Exception ignored){}},80);}
    @EventHandler public void quit(PlayerQuitEvent e){quotes.remove(e.getPlayer().getUniqueId());menus.entrySet().removeIf(entry->entry.getValue().owner.equals(e.getPlayer().getUniqueId()));/* Persistent PREPARED rows keep the lock across reconnect. */}
    @EventHandler(priority=EventPriority.HIGHEST) public void commands(PlayerCommandPreprocessEvent e){
        String command=e.getMessage().toLowerCase(Locale.ROOT);
        if(command.matches("/(?:vortexrpg:)?(?:ah|auction)(?:\\s.*)?")){
            e.setCancelled(true);if(command.matches("/(?:vortexrpg:)?(?:ah|auction)"))command(e.getPlayer(),new String[]{"trade","auction","menu"});else help(e.getPlayer());return;
        }
        if(locked.contains(e.getPlayer().getUniqueId())){e.setCancelled(true);recover(e.getPlayer());if(locked.contains(e.getPlayer().getUniqueId()))error(e.getPlayer(),"item_transfer_pending",false);}
    }
    @EventHandler(priority=EventPriority.HIGHEST) public void drop(PlayerDropItemEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void pickup(EntityPickupItemEvent e){if(locked.contains(e.getEntity().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void arrow(PlayerPickupArrowEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void openInventory(InventoryOpenEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void breakBlock(org.bukkit.event.block.BlockBreakEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void placeBlock(org.bukkit.event.block.BlockPlaceEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void interact(PlayerInteractEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void entityInteract(PlayerInteractEntityEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void swap(PlayerSwapHandItemsEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void consume(PlayerItemConsumeEvent e){if(locked.contains(e.getPlayer().getUniqueId()))e.setCancelled(true);}
    @EventHandler(priority=EventPriority.HIGHEST) public void damage(EntityDamageEvent e){if(locked.contains(e.getEntity().getUniqueId())||e instanceof EntityDamageByEntityEvent by&&locked.contains(by.getDamager().getUniqueId()))e.setCancelled(true);}
}
