package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import static org.afuhome.agentfriend.AdventureMenuModel.*;

/** A view over existing RPG authorities. Browsing never starts, trades, casts or selects a class. */
final class PlayerAdventureMenus implements Listener {
    private record Session(Ticket ticket,View view,Inventory inventory) { }
    private final AgentFriendPlugin owner;
    private final BedrockMenuForms forms;
    private final Map<UUID,Session> sessions=new HashMap<>();
    private final Map<Inventory,Session> inventories=new IdentityHashMap<>();
    private volatile boolean stopped;
    PlayerAdventureMenus(AgentFriendPlugin owner){
        this.owner=owner;forms=BedrockMenuForms.available();
        Bukkit.getPluginManager().registerEvents(this,owner);
    }
    void open(Player p){open(p,Page.HOME,"");}
    void open(Player p,Page page,String detail){
        if(stopped||!p.isOnline())return;
        Session previous=sessions.get(p.getUniqueId());
        // Close protected icons before revoking their click guard, even if the new open is canceled.
        if(previous!=null&&previous.inventory!=null&&p.getOpenInventory().getTopInventory()==previous.inventory)p.closeInventory();
        forget(p.getUniqueId());
        View view=view(p,page,detail);
        if(forms!=null&&forms.isPlayer(p.getUniqueId())){
            // Close a real container before sending a form; it must not outlive another screen.
            p.closeInventory();
            Session s=new Session(new Ticket(p.getUniqueId(),System.currentTimeMillis()),view,null);
            sessions.put(p.getUniqueId(),s);
            if(forms.show(p.getUniqueId(),view,index->onForm(p.getUniqueId(),s,index),()->onFormClosed(p.getUniqueId(),s)))return;
            forget(p.getUniqueId()); // a late response cannot activate the chest fallback
        }
        Inventory inv=Bukkit.createInventory(null,SIZE,"§3"+view.title());
        ItemStack frame=item(button(0,Action.NONE,"GRAY_STAINED_GLASS_PANE"," "));
        for(int slot=0;slot<SIZE;slot++)inv.setItem(slot,frame);
        for(Button b:view.buttons())inv.setItem(b.slot(),item(b));
        // openInventory closes the previous screen synchronously; install this session afterwards.
        p.openInventory(inv);
        if(p.getOpenInventory().getTopInventory()==inv){
            Session s=new Session(new Ticket(p.getUniqueId(),System.currentTimeMillis()),view,inv);
            sessions.put(p.getUniqueId(),s);inventories.put(inv,s);
        }
    }
    View view(Player p,Page page,String detail){
        var buttons=new ArrayList<Button>();String content="浏览不会选职、接任务或购买。";String title=switch(page){
            case HOME->"千灯纪 · 冒险大厅";case TRAVEL->"传送与集合";case GROWTH->"角色与技能";case ADVENTURE->"冒险与任务";
            case STORAGE->"背包与仓库";case TRADE->"商城与交易";case SOCIAL->"队伍与伙伴";
            case MEMORIES->"留影与生活";case COMMON->"通用生存技能";case COMMON_DETAIL->"技能说明";
            case CHARACTER->"我的角色";case TIDY_BAG,TIDY_STASH->"确认无损合并";case PARTY->"组队大厅";case PARTY_CONFIRM->"确认组队操作";case HELP->"聊天与入门";case ERROR->"入口暂不可用";
        };
        buttons.addAll(category(page));
        if(page==Page.HOME){
            content="你好，"+p.getName()+"。\n右键罗盘打开大厅；潜行右键打开快捷栏。\n选择分区，再查看具体内容。";
            buttons.add(button(4,Action.NONE,"COMPASS","欢迎，"+p.getName(),"点击图标浏览；物品只是按钮","按 Esc 关闭；CLI仍可使用"));
            buttons.add(button(28,Action.TRAVEL,"ENDER_PEARL","传送与集合","公共地标、个人传送点、归乡、战斗增援"));
            buttons.add(button(29,Action.ONBOARDING,"OAK_SIGN","我的下一步","查看自己的当前入门建议，不自动执行"));
        }else buttons.add(button(4,Action.NONE,"PAPER",title,"先查看内容与条件，再自行决定","下方箭头返回；罗盘回到大厅"));
        if(page==Page.COMMON){
            content="13项通用技能无需选职。先点技能看效果、条件和消耗；在说明页主动使用。";
            for(int i=0;i<NativeRpg.COMMON_IDS.size();i++){
                String id=NativeRpg.COMMON_IDS.get(i);var e=guide(id);
                buttons.add(new Button(CONTENT[i],Action.COMMON_DETAIL,id,e.icon().name(),e.name(),List.of(e.costLine(),"点击查看说明；此处不会施法")));
            }
        }else if(page==Page.COMMON_DETAIL){
            if(!NativeRpg.COMMON.contains(detail))return view(p,Page.COMMON,"");
            var e=guide(detail);title=e.name();
            content=e.effect()+"\n目标："+e.target()+"\n"+e.costLine()+"\n条件："+e.requires()+"\n失败："+e.failure()+"\n提示："+e.tip();
            buttons.add(button(10,Action.NONE,e.icon().name(),"实际效果",e.effect(),"目标："+e.target()));
            buttons.add(button(12,Action.NONE,"REDSTONE","条件与消耗",e.costLine(),e.requires()));
            buttons.add(button(14,Action.NONE,"OAK_SIGN","使用提示",e.tip(),"失败："+e.failure()));
            String use=Set.of("travel","team","give","prospect").contains(detail)?"选择目标或配方":"使用一次";
            buttons.add(new Button(22,Action.COMMON_USE,detail,"LIME_DYE",use,List.of(e.costLine(),e.command(),"关闭本页后按当前状态检查；失败不自动重试")));
        }else if(page==Page.CHARACTER){
            JsonObject state=owner.nativeRpg().state(p);boolean available=state.has("available")&&state.get("available").getAsBoolean();
            double max=p.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue();
            String hp=number(p.getHealth())+"/"+number(max);
            String profession=available?value(state,"className","未选职"):"资料暂不可用";
            String level=available?value(state,"level","?"):"?";
            String xp=available?(state.has("isMaxLevel")&&state.get("isMaxLevel").getAsBoolean()?"已满级":value(state,"xpProgress","?")+"/"+value(state,"xpRequired","?")):"待加载";
            JsonObject mana=state.has("mana")&&state.get("mana").isJsonObject()?state.getAsJsonObject("mana"):new JsonObject();
            content="职业："+profession+" · Lv."+level+"\n本级经验："+xp+" · 学习点："+value(state,"skillPoints","?")+"\n冒险者："+owner.adventurerRankName(p)+"\n生命："+hp+" · 魔力："+value(mana,"current","?")+"/"+value(mana,"max","?")+"\n世界："+p.getWorld().getName()+"\n数据为打开页面时的快照；重新打开刷新。";
            buttons.add(button(10,Action.NONE,"IRON_CHESTPLATE","职业与等级",profession+" · Lv."+level,"本级经验："+xp,"学习点："+value(state,"skillPoints","?")));
            buttons.add(button(13,Action.NONE,"GOLDEN_APPLE","生命与魔力","生命："+hp,"魔力："+value(mana,"current","?")+"/"+value(mana,"max","?")));
            buttons.add(button(16,Action.NONE,"MAP","冒险者身份",owner.adventurerRankName(p),"世界："+p.getWorld().getName(),"职业等级与冒险段位分别计算"));
            buttons.add(button(22,Action.CHARACTER,"CLOCK","刷新资料","重新读取当前数据，不修改角色"));
        }else if(page==Page.TIDY_BAG||page==Page.TIDY_STASH){
            boolean stash=page==Page.TIDY_STASH;
            content="只合并组件完全相同的可堆叠物品，不销毁、不出售、不转移到别人名下。装备、附魔和特殊物品保持。\n范围："+(stash?"个人箱全部10页":"本人随身背包（不包含Minepacks大背包）")+"。";
            buttons.add(button(13,Action.NONE,"CHEST","请核对整理范围",content));
            buttons.add(button(22,stash?Action.TIDY_STASH_CONFIRM:Action.TIDY_BAG_CONFIRM,"LIME_DYE","确认合并一次","只合并同组件堆叠；不丢弃、不出售"));
        }else if(page==Page.PARTY){
            JsonObject state=owner.nativeRpg().party(p);
            boolean available=state.has("available")&&state.get("available").getAsBoolean();
            boolean inParty=state.has("inParty")&&state.get("inParty").getAsBoolean();
            content=available?value(state,"nextAction","先查看当前队伍状态")+"\n组队不代表已参战，也不会自动传送。":"队伍资料暂不可用；本次不创建或接受。稍后刷新，或联系服主。";
            if(available&&inParty){
                buttons.add(button(10,Action.PARTY_MENU,"CAMPFIRE","管理当前队伍","打开原生队伍菜单，邀请在线伙伴"));
                buttons.add(button(14,Action.PLAYERS_MENU,"PLAYER_HEAD","寻找与支援伙伴","先核对世界，再选择传送目标"));
            }else if(available&&state.has("pendingInvite")&&state.get("pendingInvite").isJsonObject()){
                var invite=state.getAsJsonObject("pendingInvite");String inviter=value(invite,"inviter","邀请者"),id=value(invite,"inviterUuid","");
                buttons.add(new Button(10,Action.PARTY_CONFIRM,"accept|"+id,"LIME_DYE","接受 "+inviter+" 的当前邀请",List.of("先核对邀请者，再确认；不会代队友接受")));
                buttons.add(new Button(14,Action.PARTY_CONFIRM,"decline|"+id,"RED_DYE","拒绝当前邀请",List.of("拒绝前会再次确认")));
            }else if(available){
                buttons.add(new Button(10,Action.PARTY_CONFIRM,"create","CAMPFIRE","创建自己的队伍",List.of("确认后创建一人队伍，再邀请伙伴","浏览不会建队")));
                buttons.add(button(14,Action.PLAYERS_MENU,"PLAYER_HEAD","先找在线伙伴","查看实际世界和位置"));
            }
            buttons.add(button(22,Action.PARTY,"CLOCK","刷新队伍状态","不代替接受邀请，也不会重放旧请求"));
        }else if(page==Page.PARTY_CONFIRM){
            String[] parts=detail.split("\\|",-1);
            if(!detail.equals("create")&&!(parts.length==2&&Set.of("accept","decline").contains(parts[0])&&parts[1].matches("[0-9a-f-]{36}")))return view(p,Page.PARTY,"");
            String operation=detail.equals("create")?"创建自己的队伍":parts[0].equals("accept")?"接受该邀请者的当前邀请":"拒绝该邀请者的当前邀请";
            if(parts.length==2){
                JsonObject state=owner.nativeRpg().party(p);
                if(state.has("pendingInvite")&&state.get("pendingInvite").isJsonObject()){
                    var invite=state.getAsJsonObject("pendingInvite");
                    if(value(invite,"inviterUuid","").equals(parts[1]))operation=(parts[0].equals("accept")?"接受 ":"拒绝 ")+value(invite,"inviter","邀请者")+" 的当前邀请";
                }
            }
            content=operation+"。确认时会重新读取队伍与邀请；状态改变时不会换成别人的邀请。\n不会自动拉入其他玩家、传送或开始副本。";
            buttons.add(button(13,Action.NONE,"OAK_SIGN",operation,content));
            buttons.add(new Button(22,Action.PARTY_APPLY,detail,"LIME_DYE","确认一次",List.of("操作后查看实际队伍状态，不自动重试")));
        }else if(page==Page.HELP){
            content="普通聊天与全服喊话以服务器当前设置为准。点击下方按钮获取当前范围与准确用法。\n大多数功能无需打指令：右键罗盘 → 选择分区。\n原生子菜单关闭后，再右键罗盘即可回到大厅。";
            buttons.add(button(10,Action.ONBOARDING,"OAK_SIGN","查询聊天与入门","返回当前聊天规则和本人下一步"));
            buttons.add(button(14,Action.COMMON,"BLAZE_ROD","生存技能","13项通用技能的实际说明"));
        }else if(page==Page.ERROR){
            content="这次入口未能确认完成，已停止。若是交易、学习或领取，不要连续重试；先查原记录或联系服主并说明时间。";
            buttons.add(button(13,Action.NONE,"BARRIER","服务暂不可用",content));
        }
        if(page!=Page.HOME)buttons.add(button(27,Action.BACK,"ARROW","返回上一页"));
        buttons.add(button(31,Action.HOME,"COMPASS","冒险大厅"));
        buttons.add(button(35,Action.CLOSE,"BARRIER","关闭"));
        return new View(page,detail,title,content,buttons);
    }
    private SpellGuide.Entry guide(String id){return owner.nativeRpg().selected()?NativeRpg.commonGuide(id):SpellGuide.find(id);}
    private static String value(JsonObject object,String key,String fallback){
        return object.has(key)&&object.get(key).isJsonPrimitive()?object.get(key).getAsString():fallback;
    }
    private static String number(double value){return String.format(Locale.ROOT,"%.1f",value).replaceAll("\\.0$","");}
    private ItemStack item(Button b){
        Material material=Material.matchMaterial(b.icon());
        ItemStack stack=new ItemStack(material==null?Material.PAPER:material);
        var meta=stack.getItemMeta();meta.setDisplayName("§e"+b.title());
        var lore=new ArrayList<String>();
        for(String text:b.lore())for(String line:lines(text,42,5))lore.add("§7"+line);
        meta.setLore(lore);meta.addItemFlags(org.bukkit.inventory.ItemFlag.HIDE_ATTRIBUTES);stack.setItemMeta(meta);return stack;
    }
    private void onForm(UUID player,Session s,int index){
        if(stopped||!owner.isEnabled())return;
        Bukkit.getScheduler().runTask(owner,()->{
            Player p=Bukkit.getPlayer(player);if(p==null||sessions.get(player)!=s)return;
            if(!s.ticket.consume(player,index,s.view.actions().size(),System.currentTimeMillis())){
                if(System.currentTimeMillis()>s.ticket.expires){forget(player);p.sendMessage("§e菜单已过期，本次未执行；请重新右键罗盘打开。");}return;
            }
            sessions.remove(player,s);run(p,s.view,s.view.actions().get(index));
        });
    }
    private void onFormClosed(UUID player,Session s){
        s.ticket.close();if(stopped||!owner.isEnabled())return;
        Bukkit.getScheduler().runTask(owner,()->sessions.remove(player,s));
    }
    private void run(Player p,View view,Button b){
        Page target=destination(b.action());
        if(target!=null){open(p,target,"");return;}
        if(b.action()==Action.BACK){open(p,parent(view.page()),"");return;}
        if(b.action()==Action.COMMON_DETAIL){open(p,Page.COMMON_DETAIL,b.payload());return;}
        if(b.action()==Action.PARTY_CONFIRM){open(p,Page.PARTY_CONFIRM,b.payload());return;}
        if(b.action()==Action.CLOSE)return;
        try{owner.executePlayerMenuAction(p,b.action(),b.payload());}
        catch(RuntimeException failure){
            owner.getLogger().log(java.util.logging.Level.WARNING,"Player menu action unavailable: "+b.action(),failure);
            open(p,Page.ERROR,"");
        }
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=false) public void click(InventoryClickEvent event){
        Session s=inventories.get(event.getView().getTopInventory());
        if(s==null)return;
        event.setCancelled(true);
        if(!(event.getWhoClicked() instanceof Player p)||sessions.get(p.getUniqueId())!=s||event.getClickedInventory()!=s.inventory
                ||event.getRawSlot()<0||event.getRawSlot()>=SIZE
                ||event.getClick()!=ClickType.LEFT&&event.getClick()!=ClickType.RIGHT
                ||event.getCursor()!=null&&!event.getCursor().getType().isAir())return;
        Button b=s.view.at(event.getRawSlot());if(b==null||b.action()==Action.NONE)return;
        if(!s.ticket.consume(p.getUniqueId(),event.getRawSlot(),SIZE,System.currentTimeMillis())){
            if(System.currentTimeMillis()>s.ticket.expires)Bukkit.getScheduler().runTask(owner,()->{
                if(sessions.get(p.getUniqueId())==s){forget(p.getUniqueId());p.closeInventory();p.sendMessage("§e菜单已过期，本次未执行；请重新右键罗盘打开。");}
            });return;
        }
        // Next tick avoids opening/closing inventories from inside a Bukkit click callback.
        Bukkit.getScheduler().runTask(owner,()->{
            if(stopped||!p.isOnline()||sessions.get(p.getUniqueId())!=s||p.getOpenInventory().getTopInventory()!=s.inventory)return;
            forget(p.getUniqueId());p.closeInventory();run(p,s.view,b);
        });
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=false) public void drag(InventoryDragEvent event){
        if(inventories.containsKey(event.getView().getTopInventory()))event.setCancelled(true);
    }
    @EventHandler public void close(InventoryCloseEvent event){
        Session s=sessions.get(event.getPlayer().getUniqueId());
        if(s!=null&&s.inventory==event.getInventory())forget(event.getPlayer().getUniqueId());
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true) public void otherScreen(InventoryOpenEvent event){
        // Also revokes a Bedrock form when another plugin opens a container.
        Session s=sessions.get(event.getPlayer().getUniqueId());
        if(s!=null&&s.inventory==null)forget(event.getPlayer().getUniqueId());
    }
    @EventHandler public void quit(PlayerQuitEvent event){forget(event.getPlayer().getUniqueId());}
    private void forget(UUID id){Session s=sessions.remove(id);if(s!=null){s.ticket.close();if(s.inventory!=null)inventories.remove(s.inventory);}}
    void shutdown(){
        stopped=true;
        for(var s:List.copyOf(sessions.values())){
            s.ticket.close();Player p=Bukkit.getPlayer(s.ticket.owner);
            if(p!=null&&s.inventory!=null&&p.getOpenInventory().getTopInventory()==s.inventory)p.closeInventory();
        }
        sessions.clear();inventories.clear();HandlerList.unregisterAll(this);
    }
}
