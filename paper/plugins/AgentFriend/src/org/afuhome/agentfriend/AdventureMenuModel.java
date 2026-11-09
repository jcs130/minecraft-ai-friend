package org.afuhome.agentfriend;

import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Shared presentation for vanilla inventories and Bedrock forms; no gameplay writes. */
final class AdventureMenuModel {
    static final int SIZE=36;
    static final int[] CONTENT={10,11,12,13,14,15,16,19,20,21,22,23,24,25};
    enum Page { HOME,GROWTH,ADVENTURE,STORAGE,TRADE,SOCIAL,MEMORIES,COMMON,COMMON_DETAIL,CHARACTER,TIDY_BAG,TIDY_STASH,PARTY,PARTY_CONFIRM,HELP,ERROR }
    enum Action {
        NONE,CLOSE,BACK,HOME,GROWTH,ADVENTURE,STORAGE,TRADE,SOCIAL,MEMORIES,COMMON,CHARACTER,HELP,
        CLASS_MENU,SKILL_MENU,TALENT_MENU,QUEST_MENU,COMMON_DETAIL,COMMON_USE,
        TRAINING_MENU,CONQUEST_MENU,DUNGEON_MENU,GUILD_MENU,CONTRACT_MENU,PLACES_MENU,
        BACKPACK,STASH,TIDY_BAG,TIDY_STASH,TIDY_BAG_CONFIRM,TIDY_STASH_CONFIRM,
        SHOP_MENU,RECYCLE_MENU,AUCTION_MENU,PARTY,PARTY_CONFIRM,PARTY_APPLY,PARTY_MENU,PLAYERS_MENU,WAYPOINTS_MENU,
        PHOTO_MENU,ARCHIVE_MENU,SKIN_MENU,LEGACY_SHORTCUTS,ONBOARDING
    }
    record Button(int slot,Action action,String payload,String icon,String title,List<String> lore) {
        Button {
            Objects.requireNonNull(action);Objects.requireNonNull(payload);Objects.requireNonNull(title);
            if(slot<0||slot>=SIZE||!icon.matches("[A-Z_]+")||payload.length()>64)throw new IllegalArgumentException("invalid_menu_button");
            lore=List.copyOf(lore);
        }
    }
    record View(Page page,String detail,String title,String content,List<Button> buttons) {
        View {
            Objects.requireNonNull(page);buttons=List.copyOf(buttons);
            if(buttons.stream().map(Button::slot).distinct().count()!=buttons.size())throw new IllegalArgumentException("duplicate_menu_slot");
        }
        Button at(int slot){return buttons.stream().filter(b->b.slot==slot).findFirst().orElse(null);}
        List<Button> actions(){return buttons.stream().filter(b->b.action!=Action.NONE).toList();}
    }
    static Button button(int slot,Action action,String icon,String title,String... lore){return new Button(slot,action,"",icon,title,List.of(lore));}
    static Page destination(Action action){return switch(action){
        case HOME->Page.HOME;case GROWTH->Page.GROWTH;case ADVENTURE->Page.ADVENTURE;case STORAGE->Page.STORAGE;
        case TRADE->Page.TRADE;case SOCIAL->Page.SOCIAL;case MEMORIES->Page.MEMORIES;case COMMON->Page.COMMON;
        case CHARACTER->Page.CHARACTER;case TIDY_BAG->Page.TIDY_BAG;case TIDY_STASH->Page.TIDY_STASH;case PARTY->Page.PARTY;case HELP->Page.HELP;
        default->null;
    };}
    static Page parent(Page page){return switch(page){
        case COMMON,CHARACTER->Page.GROWTH;case COMMON_DETAIL->Page.COMMON;case TIDY_BAG,TIDY_STASH->Page.STORAGE;case PARTY_CONFIRM->Page.PARTY;case PARTY,HELP->Page.SOCIAL;default->Page.HOME;
    };}
    /** Revalidate an explicit choice against the current native invitation, never a cached roster. */
    static String partyAction(String token,boolean available,boolean inParty,String inviter){
        if(!available||inParty)return null;
        if(token.equals("create"))return inviter==null?"create":null;
        String[] parts=token.split("\\|",-1);
        return parts.length==2&&Set.of("accept","decline").contains(parts[0])&&parts[1].matches("[0-9a-f-]{36}")&&parts[1].equals(inviter)?parts[0]:null;
    }
    static List<Button> category(Page page){return switch(page){
        case HOME->List.of(
            button(10,Action.GROWTH,"EXPERIENCE_BOTTLE","角色与技能","选择职业、学习技能、查看成长"),
            button(13,Action.ADVENTURE,"FILLED_MAP","冒险与任务","练习塔、正式攻略与探索遗迹"),
            button(16,Action.STORAGE,"CHEST","背包与仓库","大背包、个人箱与无损整理"),
            button(19,Action.TRADE,"GOLD_INGOT","商城与交易","买补给、回收装备、玩家交易行"),
            button(22,Action.SOCIAL,"PLAYER_HEAD","队伍与伙伴","组队、找队友、支援与传送点"),
            button(25,Action.MEMORIES,"PAINTING","留影与生活","拍照、阅读日记与更换外观"));
        case GROWTH->List.of(
            button(10,Action.CHARACTER,"PLAYER_HEAD","我的角色","查看实际等级、经验、生命与魔力"),
            button(12,Action.CLASS_MENU,"IRON_CHESTPLATE","选择职业","先查看职业，再自行确认选择","浏览不会替你选职"),
            button(14,Action.SKILL_MENU,"ENCHANTED_BOOK","职业技能","查看、学习与装备职业技能","学习的点数和条件以详情为准"),
            button(16,Action.TALENT_MENU,"NETHER_STAR","天赋树","打开自己的天赋界面","先看条件，再确认分配"),
            button(20,Action.COMMON,"BLAZE_ROD","通用生存技能","归乡、治疗、饱食、闪现等13项","先看说明，再点击使用"),
            button(24,Action.LEGACY_SHORTCUTS,"COMPASS","常用快捷栏","熟悉技能后使用快捷罗盘","潜行右键罗盘也能直接打开"));
        case ADVENTURE->List.of(
            button(10,Action.TRAINING_MENU,"WOODEN_SWORD","村庄练习塔","练技能、协作与生存","每次新开从第一层开始"),
            button(12,Action.CONQUEST_MENU,"IRON_SWORD","艾恩葛朗特攻略","查看正式楼层、准备条件与入口","与村庄练习塔分别结算"),
            button(14,Action.DUNGEON_MENU,"MAP","主题遗迹","查看不同遗迹的难度和路线","到首室开始；遗迹内自动同队"),
            button(16,Action.QUEST_MENU,"WRITABLE_BOOK","RPG任务板","选择当前适合自己的任务","先看目标，再自行接取"),
            button(20,Action.CONTRACT_MENU,"LECTERN","公会委托","探索、讨伐、制作与工程委托","不要求先种田"),
            button(24,Action.GUILD_MENU,"GOLD_NUGGET","冒险者公会","查看声望、晋级与考试","职业等级与公会段位分别查看"));
        case STORAGE->List.of(
            button(10,Action.BACKPACK,"BARREL","随身大背包","打开本人54格大背包","与远程个人箱分别存放"),
            button(12,Action.STASH,"ENDER_CHEST","远程个人箱","打开页码选择，查看全部10页","任务奖励和购买商品也在这里"),
            button(14,Action.TIDY_BAG,"CHEST","合并背包堆叠","整理前会再次确认","只合并同组件物品，不丢弃、不出售"),
            button(16,Action.TIDY_STASH,"HOPPER","合并个人箱堆叠","覆盖全部10页，不只第一页","只合并，不销毁装备或杂物"),
            button(22,Action.RECYCLE_MENU,"GOLD_INGOT","回收多余装备","先查看报价和保留范围","不会因为打开页面就卖掉物品"));
        case TRADE->List.of(
            button(10,Action.SHOP_MENU,"GOLD_INGOT","金币商城","查看价格，购买装备和物资","商品送入个人箱"),
            button(13,Action.RECYCLE_MENU,"ANVIL","装备回收","多余装备可换金币","先预览报价，再确认"),
            button(16,Action.AUCTION_MENU,"CHEST","玩家交易行","查看其他玩家出售的商品","上架和购买使用现有交易确认"),
            button(22,Action.STASH,"ENDER_CHEST","领取购买商品","打开个人箱页码选择"));
        case SOCIAL->List.of(
            button(10,Action.PARTY,"CAMPFIRE","组队大厅","创建队伍、查看邀请或管理队伍","打开菜单不代表已经入队"),
            button(13,Action.PLAYERS_MENU,"PLAYER_HEAD","找队友与支援","查看世界与位置，追踪或传送","跨世界不能只比较XYZ"),
            button(16,Action.WAYPOINTS_MENU,"LODESTONE","我的传送点","保存、查看和管理个人地点","点击目的地前会显示传送消耗"),
            button(22,Action.HELP,"OAK_SIGN","聊天与入门说明","查看服务器当前聊天范围和用法","附近聊天与全服喊话分别发送"));
        case MEMORIES->List.of(
            button(10,Action.PHOTO_MENU,"SPYGLASS","女神相机","选择视角、描述和拍摄方式","照片按本人选择公开或保留私有"),
            button(13,Action.ARCHIVE_MENU,"BOOKSHELF","日记与档案","阅读大家公开的日记和旅行记录"),
            button(16,Action.SKIN_MENU,"PLAYER_HEAD","皮肤与模型","进入现有外观选择入口"),
            button(22,Action.PLACES_MENU,"COMPASS","旅行地点","公共地标、私人地点与探索入口"));
        default->List.of();
    };}
    /** Bound CJK tooltips by display columns, rather than cutting a surrogate pair. */
    static List<String> lines(String text,int columns,int maximum){
        if(columns<4||maximum<1)throw new IllegalArgumentException("invalid_text_budget");
        text=text.replaceAll("§[0-9a-fk-orA-FK-OR]","").replaceAll("[\\p{Cntrl}\\s]+"," ").strip();
        var out=new ArrayList<String>();var line=new StringBuilder();int width=0;
        for(int cp:text.codePoints().toArray()){
            int n=cp>=0x2e80?2:Character.getType(cp)==Character.NON_SPACING_MARK?0:1;
            if(width+n>columns){out.add(line.toString());line.setLength(0);width=0;if(out.size()==maximum){String last=out.removeLast();out.add(last+"…");return List.copyOf(out);}}
            line.appendCodePoint(cp);width+=n;
        }
        if(!line.isEmpty()||out.isEmpty())out.add(line.toString());return List.copyOf(out);
    }
    /** Actor-bound, single-use capability. Invalid or foreign responses cannot consume it. */
    static final class Ticket {
        final UUID owner,id=UUID.randomUUID();final long expires;private final AtomicBoolean consumed=new AtomicBoolean();
        Ticket(UUID owner,long now){this.owner=Objects.requireNonNull(owner);expires=Math.addExact(now,120_000);}
        boolean consume(UUID actor,int index,int size,long now){return owner.equals(actor)&&now<=expires&&index>=0&&index<size&&consumed.compareAndSet(false,true);}
        void close(){consumed.set(true);}
    }
}
