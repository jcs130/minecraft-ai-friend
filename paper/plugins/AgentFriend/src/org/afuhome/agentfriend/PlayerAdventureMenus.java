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
    private record Session(Ticket ticket,View view,Inventory inventory,org.bukkit.Location aim) { }
    private record WheelSkill(Action action, String id, String icon, String name, List<String> lore) { }
    private final AgentFriendPlugin owner;
    private final BedrockMenuForms forms;
    private final GuideCompanionMenu guides;
    private final Map<UUID,Session> sessions=new HashMap<>();
    private final Map<Inventory,Session> inventories=new IdentityHashMap<>();
    private volatile boolean stopped;
    PlayerAdventureMenus(AgentFriendPlugin owner){
        this.owner=owner;forms=BedrockMenuForms.available();guides=new GuideCompanionMenu(owner,this);
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
        var aim=page==Page.WHEEL?p.getEyeLocation():null;
        if(forms!=null&&forms.isPlayer(p.getUniqueId())){
            // Close a real container before sending a form; it must not outlive another screen.
            p.closeInventory();
            Session s=new Session(new Ticket(p.getUniqueId(),System.currentTimeMillis()),view,null,aim);
            sessions.put(p.getUniqueId(),s);
            if(forms.show(p.getUniqueId(),view,index->onForm(p.getUniqueId(),s,index),()->onFormClosed(p.getUniqueId(),s))){
                if(page==Page.COMMON)owner.recordWorldLesson(p,"catalog");
                return;
            }
            forget(p.getUniqueId()); // a late response cannot activate the chest fallback
        }
        var title=page==Page.WHEEL
                ? net.kyori.adventure.text.Component.translatable().key("screen.qiandeng_controls.spell_wheel").fallback(view.title()).build()
                : net.kyori.adventure.text.Component.text(view.title(),net.kyori.adventure.text.format.NamedTextColor.DARK_AQUA);
        Inventory inv=Bukkit.createInventory(null,SIZE,title);
        ItemStack frame=item(button(0,Action.NONE,page==Page.ONBOARDING?"CYAN_STAINED_GLASS_PANE":"GRAY_STAINED_GLASS_PANE"," "));
        for(int slot=0;slot<SIZE;slot++)inv.setItem(slot,frame);
        for(Button b:view.buttons())inv.setItem(b.slot(),item(b));
        // openInventory closes the previous screen synchronously; install this session afterwards.
        p.openInventory(inv);
        if(p.getOpenInventory().getTopInventory()==inv){
            Session s=new Session(new Ticket(p.getUniqueId(),System.currentTimeMillis()),view,inv,aim);
            sessions.put(p.getUniqueId(),s);inventories.put(inv,s);
            if(page==Page.COMMON)owner.recordWorldLesson(p,"catalog");
        }
    }
    View view(Player p,Page page,String detail){
        var buttons=new ArrayList<Button>();String content="浏览不会选职、接任务或购买。";String title=switch(page){
            case HOME->"千灯纪 · 冒险大厅";case TRAVEL->"传送与集合";case GROWTH->"角色与技能";case BOOK->"命格书 · 角色与技能";case ADVENTURE->"冒险与任务";
            case STORAGE->"背包与仓库";case TRADE->"商城与交易";case SOCIAL->"队伍与伙伴";
            case MEMORIES->"留影与生活";case COMMON->"通用生存技能";case COMMON_DETAIL->"技能说明";
            case WHEEL->"施法轮盘";case WHEEL_EDIT->"配置快捷施法";case WHEEL_PICK->"选择槽位技能";
            case CHARACTER->"我的角色";case TIDY_BAG,TIDY_STASH->"确认无损合并";case PARTY->"组队大厅";case PARTY_CONFIRM->"确认组队操作";case HELP->"聊天与入门";case ONBOARDING->"初来千灯纪";case GUIDE_COMPANION->"我的伙伴";case GUIDE_CLASS->"伙伴 · 职业";case GUIDE_SKILLS->"伙伴 · 技能";case ERROR->"入口暂不可用";
        };
        buttons.addAll(category(page));
        if(page==Page.HOME){
            content="你好，"+p.getName()+"。\n使用罗盘打开大厅；潜行时使用罗盘打开施法轮盘。";
            buttons.add(button(4,Action.NONE,"COMPASS","欢迎，"+p.getName(),"点击图标浏览；物品只是按钮","按 Esc 关闭；CLI仍可使用"));
            buttons.add(button(28,Action.TRAVEL,"ENDER_PEARL","传送与集合","公共地标、个人传送点、归乡、战斗增援"));
            buttons.add(button(30,Action.STASH,"ENDER_CHEST","个人仓库 · 10页540格","直接选择页码；与大背包、公共箱分开"));
            buttons.add(button(29,Action.ONBOARDING,"BOOK","我的下一步","查看入门进度，继续当前目标"));
            buttons.add(button(34,Action.GUIDE_COMPANION,"LANTERN","我的伙伴","领取或管理自己的冒险伙伴"));
            buttons.add(button(32,Action.WHEEL,"END_CRYSTAL","施法轮盘","八槽混排通用技与职业技；可按习惯配置"));
            buttons.add(button(33,Action.WHEEL_EDIT,"REPEATER","选择快捷技能","选槽位，再选技能，立即保存"));
        }else if(page!=Page.ONBOARDING&&page!=Page.GUIDE_COMPANION&&page!=Page.GUIDE_CLASS&&page!=Page.GUIDE_SKILLS&&page!=Page.WHEEL&&page!=Page.WHEEL_EDIT&&page!=Page.WHEEL_PICK)buttons.add(button(4,Action.NONE,"PAPER",title,"先查看内容与条件，再自行决定","下方箭头返回；罗盘回到大厅"));
        if(page==Page.GROWTH){
            buttons.add(staffSpellButton());
            buttons.add(button(32,Action.WHEEL,"END_CRYSTAL","施法轮盘","八槽混排通用技与职业技；可按习惯配置"));
            buttons.add(button(33,Action.WHEEL_EDIT,"REPEATER","选择快捷技能","选一个槽位，再选要放进去的技能"));
        }
        if(page==Page.BOOK)content="学习职业技能后，可单独选择法杖的右键法术或配置八个快捷槽位。通用技能可直接加入轮盘。";
        if(page==Page.COMMON){
            content=NativeRpg.COMMON_IDS.size()+"项通用技能无需选职；公用同一个魔力池。选择页码，再点技能看条件和消耗。";
            int pageNumber=detail.equals("2")?1:0,start=pageNumber*CONTENT.length;
            for(int i=start;i<Math.min(start+CONTENT.length,NativeRpg.COMMON_IDS.size());i++){
                String id=NativeRpg.COMMON_IDS.get(i);var e=guide(id);
                buttons.add(new Button(CONTENT[i-start],Action.COMMON_DETAIL,id,e.icon().name(),e.name(),List.of(e.costLine(),"点击查看说明；此处不会施法")));
            }
            if(pageNumber>0)buttons.add(new Button(28,Action.COMMON_PAGE,"1","ARROW","通用技能 · 上一页",List.of("不施法、不扣魔力")));
            if(start+CONTENT.length<NativeRpg.COMMON_IDS.size())buttons.add(new Button(30,Action.COMMON_PAGE,"2","ARROW","通用技能 · 下一页",List.of("跃空与留影特效也在通用目录中")));
        }else if(page==Page.COMMON_DETAIL){
            if(!NativeRpg.COMMON.contains(detail))return view(p,Page.COMMON,"");
            var e=guide(detail);title=e.name();
            content=e.effect()+"\n目标："+e.target()+"\n"+e.costLine()+"\n条件："+e.requires()+"\n失败："+e.failure()+"\n提示："+e.tip();
            buttons.add(button(10,Action.NONE,e.icon().name(),"实际效果",e.effect(),"目标："+e.target()));
            buttons.add(button(12,Action.NONE,"REDSTONE","条件与消耗",e.costLine(),e.requires()));
            buttons.add(button(14,Action.NONE,"OAK_SIGN","使用提示",e.tip(),"失败："+e.failure()));
            String use=Set.of("travel","team","give","prospect").contains(detail)?"选择目标或配方":"使用一次";
            buttons.add(new Button(22,Action.COMMON_USE,detail,"LIME_DYE",use,List.of(e.costLine(),e.command(),"关闭本页后按当前状态检查；失败不自动重试")));
            buttons.add(new Button(24,Action.COMMON_EQUIP,detail,"REPEATER","加入轮盘",List.of("选择一个快捷槽位，只配置，不施法")));
        }else if(page==Page.WHEEL){
            content=wheel(p,detail,buttons);
        }else if(page==Page.WHEEL_EDIT){content=wheelEdit(p,detail,buttons);
        }else if(page==Page.WHEEL_PICK){content=wheelPick(p,detail,buttons);
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
            buttons.add(button(10,Action.ONBOARDING,"BOOK","查看入门进度"));
            buttons.add(button(12,Action.CHAT_RULES,"OAK_SIGN","查看聊天规则"));
            buttons.add(button(14,Action.COMMON,"BLAZE_ROD","生存技能","全部通用技能的实际效果和使用条件"));
        }else if(page==Page.ONBOARDING){
            content=onboarding(p,buttons);
        }else if(page==Page.GUIDE_COMPANION||page==Page.GUIDE_CLASS||page==Page.GUIDE_SKILLS){
            content=guides.view(p,page,detail,buttons);
        }else if(page==Page.ERROR){
            content="这次入口未能确认完成，已停止。若是交易、学习或领取，不要连续重试；先查原记录或联系服主并说明时间。";
            buttons.add(button(13,Action.NONE,"BARRIER","服务暂不可用",content));
        }
        if(page!=Page.HOME)buttons.add(button(27,Action.BACK,"ARROW","返回上一页"));
        if(page!=Page.WHEEL&&page!=Page.ONBOARDING)buttons.add(button(31,Action.HOME,"COMPASS","冒险大厅"));
        buttons.add(button(35,Action.CLOSE,"BARRIER","关闭"));
        return new View(page,detail,title,content,buttons);
    }
    private String onboarding(Player player,List<Button> buttons){
        JsonObject state=owner.agentCoach().entryState(player);
        if(!state.get("eligible").getAsBoolean()){
            String reason="观战账号不参加新手实习。";
            buttons.add(button(13,Action.NONE,"SPYGLASS",reason));
            return reason;
        }
        var checklist=state.getAsJsonArray("checklist");
        int done=0;
        for(int i=0;i<checklist.size();i++){
            JsonObject milestone=checklist.get(i).getAsJsonObject();
            boolean completed=milestone.get("done").getAsBoolean();
            if(completed)done++;
            buttons.add(button(11+i,Action.NONE,completed?"LIME_DYE":"GRAY_DYE",
                    (completed?"已完成 · ":"待完成 · ")+milestone.get("title").getAsString()));
        }
        String summary="入门进度 "+done+"/"+checklist.size();
        Button next=onboardingNext(state.get("step").getAsString());
        buttons.add(button(4,Action.NONE,"LANTERN",summary));
        if(next!=null)buttons.add(next);
        buttons.add(button(30,Action.ONBOARDING_DETAILS,"WRITABLE_BOOK","查看详细清单与专项实练"));
        buttons.add(button(34,Action.GUIDE_COMPANION,"LANTERN","我的伙伴","可以和她一起完成入门"));
        return summary+(next==null?"":"\n当前目标 · "+next.title());
    }
    private List<WheelSkill> wheelSkills(Player player, boolean profession) {
        List<WheelSkill> skills = new ArrayList<>();
        if (profession) {
            for (var spell : owner.nativeRpg().classSpells(owner.nativeRpg().state(player))) {
                boolean circle=spell.id().equals(NativeRpg.HEALING_CIRCLE);
                skills.add(new WheelSkill(Action.WHEEL_CAST,spell.id(),circle?"GLISTERING_MELON_SLICE":"ENCHANTED_BOOK",spell.name(),
                        List.of("魔力 "+spell.mana()+" · "+cooldown(spell.cooldownRemainingMs()),
                            circle?"目标：12格内可见地面。站在环内持续回血。"
                                :spell.targetHint().isBlank()?"点击施放职业技能":spell.targetHint(),
                            spell.source().equals("weapon")?"来源：主手武器刻印，换下武器即不可用":"来源：职业所学")));
            }
        } else {
            for (String id : NativeRpg.COMMON_IDS) {
                var spell = guide(id);
                boolean selectTarget = Set.of("travel", "team", "give", "prospect").contains(id);
                skills.add(new WheelSkill(Action.COMMON_USE, id, spell.icon().name(), spell.name(),
                        List.of(spell.costLine(), cooldown(owner.readBasicCooldown(player, id)),
                                selectTarget ? "点击选择目标" : "点击施放")));
            }
        }
        return List.copyOf(skills);
    }
    private static String wheelKey(Player p) { return "spell-wheel.players." + p.getUniqueId() + ".slots"; }
    private List<String> wheelSlots(Player p, List<WheelSkill> learned) {
        return SpellWheelLoadout.read(owner.getConfig().get(wheelKey(p)), learned.stream().map(WheelSkill::id).toList());
    }
    private Map<String,WheelSkill> wheelCatalogue(Player p, List<WheelSkill> learned) {
        var result = new LinkedHashMap<String,WheelSkill>();
        wheelSkills(p,false).forEach(s -> result.put(s.id(),s));
        learned.forEach(s -> result.put(s.id(),s));
        return result;
    }
    private String wheel(Player player, String detail, List<Button> buttons) {
        boolean profession = detail.startsWith("profession:"), quick = !detail.matches("(?:common|profession):[0-9]{1,2}");
        String group = profession ? "profession:" : "common:";
        int requested = quick ? 0 : Integer.parseInt(detail.substring(group.length()));
        List<WheelSkill> learned = wheelSkills(player,true);
        String message = "瞄准后打开轮盘并点技能。通用技与已学职业技可混排；配置不施法、不花学习点。";
        if (quick) {
            var catalogue = wheelCatalogue(player,learned);
            List<String> slots;
            try { slots=wheelSlots(player,learned); }
            catch(IllegalArgumentException invalid) { slots=Collections.nCopies(8,"");message="快捷配置暂不可读，请打开配置并选择恢复推荐；旧资料保留。"; }
            buttons.add(button(4,Action.NONE,"END_CRYSTAL","我的快捷轮盘 · 8槽",message));
            for (int index=0;index<slots.size();index++) {
                String id=slots.get(index);WheelSkill spell=catalogue.get(id);
                if(spell==null) {
                    buttons.add(new Button(WHEEL_CELLS[index],Action.WHEEL_SLOT,Integer.toString(index),id.isEmpty()?"LIGHT_GRAY_DYE":"BARRIER",
                            (index+1)+" · "+(id.isEmpty()?"空槽":"技能暂不可用"),
                            List.of(id.isEmpty()?"点击选择通用技或已学职业技":"保留原绑定："+id,"点击配置；不会自动学习或施放")));
                } else buttons.add(new Button(WHEEL_CELLS[index],spell.action(),spell.id(),spell.icon(),(index+1)+" · "+spell.name(),spell.lore()));
            }
        } else {
            List<WheelSkill> skills=profession?learned:wheelSkills(player,false);
            int pages=Math.max(1,(skills.size()+7)/8),page=Math.max(0,Math.min(requested,pages-1)),start=page*8;
            if(profession&&skills.isEmpty())message=owner.nativeRpg().state(player).has("abilities")
                    ?"尚无可用的已学职业技能，打开职业技能书查看条件；本页不会替你学习。"
                    :"职业技能资料暂不可用，请稍后重新打开；已保存的快捷位置保持。";
            buttons.add(button(4,Action.NONE,"END_CRYSTAL",(profession?"已学职业技":"通用技能")+" · "+(page+1)+"/"+pages,message));
            for(int index=start;index<Math.min(start+8,skills.size());index++) {
                var spell=skills.get(index);
                buttons.add(new Button(WHEEL_CELLS[index-start],spell.action(),spell.id(),spell.icon(),spell.name(),spell.lore()));
            }
            if(page>0)buttons.add(wheelPage(28,group+(page-1),"ARROW","上一页"));
            if(page+1<pages)buttons.add(wheelPage(30,group+(page+1),"ARROW","下一页"));
            if(profession&&skills.isEmpty())buttons.add(button(13,Action.SKILL_MENU,"BOOK","打开职业技能书","查看学习条件与已学技能"));
        }
        buttons.add(wheelPage(31,quick?"profession:0":profession?"common:0":"quick:0","BOOK",quick?"职业技能":profession?"通用技能":"我的快捷"));
        buttons.add(button(33,Action.WHEEL_EDIT,"REPEATER","配置轮盘","选择槽位，再选技能；保存后再次打开即用"));
        return message;
    }
    private String wheelEdit(Player p,String detail,List<Button> buttons) {
        var learned=wheelSkills(p,true);var catalogue=wheelCatalogue(p,learned);List<String> slots;
        WheelSkill selected=catalogue.get(detail);
        if(!detail.isEmpty()&&selected==null) {
            buttons.add(button(4,Action.NONE,"BARRIER","技能暂不可用","重新查看职业技能或通用技能目录"));
            buttons.add(button(33,Action.WHEEL_EDIT,"REPEATER","回到轮盘配置","保留当前快捷技能"));
            return "该技能暂不可用。请从技能目录重新选择。";
        }
        String message="选一个槽位，更换或清空。可混排通用技和已学职业技，保存后跨设备、重登及重启保留。";
        try{slots=wheelSlots(p,learned);}catch(IllegalArgumentException invalid){
            slots=Collections.nCopies(8,"");message="配置资料暂不可读；可点恢复推荐，或保留资料并联系服主。";
            selected=null;
        }
        if(selected!=null)message="将「"+selected.name()+"」放入选定槽位。已有技能会被替换。";
        buttons.add(button(4,Action.NONE,"REPEATER","选择要调整的槽位",message));
        for(int index=0;index<8;index++) {
            String id=slots.get(index);WheelSkill spell=catalogue.get(id);
            buttons.add(new Button(WHEEL_CELLS[index],selected==null?Action.WHEEL_SLOT:Action.WHEEL_ASSIGN,
                    selected==null?Integer.toString(index):index+"|"+detail,spell==null?"LIGHT_GRAY_DYE":spell.icon(),
                    "槽位 "+(index+1)+" · "+(id.isEmpty()?"空":spell==null?id:spell.name()),
                    List.of(selected==null?"点击更换或清空":"将「"+selected.name()+"」装入此处","只调整快捷位置，不施法、不学习")));
        }
        if(selected==null)buttons.add(button(22,Action.WHEEL_DEFAULTS,"CLOCK","恢复推荐布局","优先本人已学职业技，再加入治疗、控制与位移","这是恢复快捷位置，不会遗忘技能"));
        buttons.add(button(33,Action.WHEEL,"END_CRYSTAL","完成 · 打开轮盘","配置即时保存，无需再点保存"));
        return message;
    }
    private String wheelPick(Player p,String detail,List<Button> buttons) {
        if(!detail.matches("[0-7]\\|(?:common|profession):[0-9]{1,2}"))return "槽位无效，请返回配置页。";
        int slot=detail.charAt(0)-'0';String section=detail.substring(2);boolean profession=section.startsWith("profession:");
        var skills=wheelSkills(p,profession);int pages=Math.max(1,(skills.size()+13)/14);
        int page=Math.min(Integer.parseInt(section.substring(section.indexOf(':')+1)),pages-1),start=page*14;
        buttons.add(button(4,Action.NONE,"REPEATER","槽位 "+(slot+1)+" · "+(profession?"职业技能":"通用技能")+" · "+(page+1)+"/"+pages,
                "点选即保存，不施法、不学习；下方可清空或切换目录"));
        for(int index=start;index<Math.min(start+14,skills.size());index++) {
            var spell=skills.get(index);
            var lore=new ArrayList<>(spell.lore());lore.removeIf(s->s.startsWith("点击"));
            lore.add("放入槽位 "+(slot+1)+"；只配置，不施法");
            lore.add("若已在其它槽位，会移动到此处");
            buttons.add(new Button(CONTENT[index-start],Action.WHEEL_ASSIGN,slot+"|"+spell.id(),spell.icon(),spell.name(),lore));
        }
        if(profession&&skills.isEmpty())buttons.add(button(13,Action.SKILL_MENU,"BOOK","查看职业技能书","只显示本人已学会且可用的技能"));
        String prefix=slot+"|"+(profession?"profession:":"common:");
        if(page>0)buttons.add(new Button(28,Action.WHEEL_PICK_PAGE,prefix+(page-1),"ARROW","上一页",List.of()));
        if(page+1<pages)buttons.add(new Button(30,Action.WHEEL_PICK_PAGE,prefix+(page+1),"ARROW","下一页",List.of()));
        buttons.add(new Button(32,Action.WHEEL_CLEAR,Integer.toString(slot),"RED_DYE","清空此槽位",List.of("只移除快捷位置，不会遗忘技能")));
        buttons.add(new Button(33,Action.WHEEL_PICK_PAGE,slot+"|"+(profession?"common:0":"profession:0"),"BOOK",profession?"选择通用技":"选择职业技",List.of("切换候选目录，不修改槽位")));
        return "配置槽位 "+(slot+1)+" · "+(profession?"已学职业技":"通用技能")+" · "+(page+1)+"/"+pages+"。点击技能后即时保存，战斗时在轮盘释放。";
    }
    void equipHealingCircle(Player p) {
        var learned=wheelSkills(p,true);
        if(learned.stream().noneMatch(spell->spell.id().equals(NativeRpg.HEALING_CIRCLE))){
            p.sendMessage("§e技能还未读回，请稍后从遗迹结算页再次装入。");
            return;
        }
        List<String> slots;
        try { slots=wheelSlots(p,learned); }
        catch (IllegalArgumentException invalid) { open(p,Page.WHEEL_EDIT,"");return; }
        int existing=slots.indexOf(NativeRpg.HEALING_CIRCLE);
        int slot=existing>=0?existing:slots.indexOf("");
        if(slot<0){open(p,Page.WHEEL_EDIT,NativeRpg.HEALING_CIRCLE);return;}
        changeWheel(p,new Button(WHEEL_CELLS[slot],Action.WHEEL_ASSIGN,slot+"|"+NativeRpg.HEALING_CIRCLE,
            "GLISTERING_MELON_SLICE","治愈之环",List.of()),Page.WHEEL);
    }

    private void changeWheel(Player p,Button b,Page returnTo) {
        String key=wheelKey(p);Object before=owner.getConfig().get(key);Object after=null;
        try {
            if(b.action()!=Action.WHEEL_DEFAULTS) {
                String[] parts=b.payload().split("\\|",-1);
                if(!parts[0].matches("[0-7]")||b.action()==Action.WHEEL_ASSIGN&&parts.length!=2)throw new IllegalArgumentException("invalid_slot");
                var learned=wheelSkills(p,true);var available=List.copyOf(wheelCatalogue(p,learned).keySet());
                after=SpellWheelLoadout.assign(wheelSlots(p,learned),Integer.parseInt(parts[0]),b.action()==Action.WHEEL_CLEAR?"":parts[1],available);
            }
        } catch(IllegalArgumentException unavailable) {
            p.sendMessage("§e该技能或配置状态已变化，本次未保存、未施法。请重新选择；学习条件在职业技能书里查看。");
            open(p,Page.WHEEL_EDIT,"");return;
        }
        owner.getConfig().set(key,after);
        try {owner.nativeRpg().saveConfigVerified();}
        catch(RuntimeException failure) {
            owner.getConfig().set(key,before);
            owner.getLogger().log(java.util.logging.Level.WARNING,"Wheel preferences save unconfirmed for "+p.getUniqueId(),failure);
            p.sendMessage("§e轮盘保存未确认，本次未施法。请重新打开查看；不要反复点击，必要时联系服主。");return;
        }
        p.sendMessage("§a快捷轮盘已保存；再次打开即用。技能学习、魔力与冷却没有改变。");
        open(p,returnTo,"");
    }

    private static Button wheelPage(int slot, String next, String icon, String title) {
        return new Button(slot, Action.WHEEL_PAGE, next, icon, title, List.of());
    }
    private static String cooldown(Long millis) {
        return millis == null ? "冷却按技能或目标计算" : millis <= 0 ? "冷却已就绪" : "冷却还有 " + ((millis + 999) / 1000) + " 秒";
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
            sessions.remove(player,s);run(p,s,s.view.actions().get(index));
        });
    }
    private void onFormClosed(UUID player,Session s){
        s.ticket.close();if(stopped||!owner.isEnabled())return;
        Bukkit.getScheduler().runTask(owner,()->sessions.remove(player,s));
    }
    private void run(Player p,Session session,Button b){
        View view=session.view;
        Page target=destination(b.action());
        if(target!=null){open(p,target,"");return;}
        if(b.action()==Action.BACK){open(p,parent(view.page()),"");return;}
        if(b.action()==Action.GUIDE_CLASS_DETAIL){open(p,Page.GUIDE_CLASS,b.payload());return;}
        if(b.action()==Action.GUIDE_SKILL_DETAIL){open(p,Page.GUIDE_SKILLS,b.payload());return;}
        if(b.action()==Action.GUIDE_ACTION){guides.perform(p,b.payload());return;}
        if(b.action()==Action.COMMON_PAGE){open(p,Page.COMMON,b.payload());return;}
        if(b.action()==Action.COMMON_EQUIP){open(p,Page.WHEEL_EDIT,b.payload());return;}
        if(b.action()==Action.WHEEL_PAGE){open(p,Page.WHEEL,b.payload());return;}
        if(b.action()==Action.WHEEL_SLOT){open(p,Page.WHEEL_PICK,b.payload()+"|common:0");return;}
        if(b.action()==Action.WHEEL_PICK_PAGE){open(p,Page.WHEEL_PICK,b.payload());return;}
        if(b.action()==Action.WHEEL_ASSIGN||b.action()==Action.WHEEL_CLEAR||b.action()==Action.WHEEL_DEFAULTS){
            boolean singleSkill=view.page()==Page.WHEEL_EDIT&&!view.detail().isEmpty()&&b.action()==Action.WHEEL_ASSIGN;
            changeWheel(p,b,singleSkill?Page.WHEEL:Page.WHEEL_EDIT);return;
        }
        if(b.action()==Action.WHEEL_CAST&&b.payload().equals(NativeRpg.HEALING_CIRCLE)){
            owner.nativeRpg().castHealingCircle(p,session.aim);
            return;
        }
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
            forget(p.getUniqueId());p.closeInventory();run(p,s,b);
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
