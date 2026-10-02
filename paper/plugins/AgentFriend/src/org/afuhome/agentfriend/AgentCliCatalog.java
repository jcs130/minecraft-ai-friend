package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.bukkit.entity.Player;

/** Read-only, bounded command discovery for vanilla chat, Bedrock and Mineflayer. */
final class AgentCliCatalog {
    private static final int PAGE_SIZE = 7;
    private record Spec(String id, String category, String mode, String usage,
                        String summary, String requires, String returns) {
        boolean root() { return !id.contains("."); }
    }
    private static final Map<String, Spec> SPECS = createSpecs();

    private AgentCliCatalog() { }

    private static void add(Map<String, Spec> specs, String id, String category, String mode,
                            String usage, String summary, String requires, String returns) {
        if (specs.putIfAbsent(id, new Spec(id, category, mode, usage, summary, requires, returns)) != null)
            throw new IllegalStateException("Duplicate /mycli catalog id: " + id);
    }

    private static Map<String, Spec> createSpecs() {
        Map<String, Spec> specs = new LinkedHashMap<>();
        add(specs,"help","info","read","/mycli help [ID]","查看玩家帮助；有 ID 时查看该命令详情","在线玩家","帮助或 MC_CLI_DETAIL");
        add(specs,"list","info","read","/mycli list [分类|命令|all] [页码]","分页发现命令；默认只列顶层命令","在线玩家","MC_CLI_LIST、MC_CLI_ITEM");
        add(specs,"explain","info","read","/mycli explain <ID|命令 子命令>","查询用法、前提、效果和回执；绝不执行目标命令","在线玩家","MC_CLI_DETAIL");
        add(specs,"coach","info","read","/mycli coach status|on|off","查看或调整本人低频提醒；默认 Java 开、基岩关","在线玩家；旁观者不收到提醒","MC_COACH JSON");
        add(specs,"guide","info","read","/mycli guide [start|explore|magic|gear|guild|dungeon|team]","分主题游玩指引；menu 打开手柄菜单","在线玩家","聊天指引或原版菜单");
        add(specs,"status","info","read","/mycli status","查看本人生命、魔力、公会及试炼状态","在线玩家","个人状态与 MC_DUNGEON 坐标");
        add(specs,"spells","magic","read","/mycli spells","列出可用法术、消耗与学习条件","在线玩家","技能文字列表");
        add(specs,"mastery","magic","read","/mycli mastery","查看本人法术熟练度与升级门槛","在线玩家","熟练度报告");
        add(specs,"skillbook","magic","item","/mycli skillbook list|use [槽位]","列出或使用实体技艺研习书；也可手持右键","背包有研习书且对应技能未满级","MC_SKILLBOOK 私有回执");
        add(specs,"cast","magic","cast","/mycli cast <技能ID> [参数]","施放生活、战斗或探索法术","本人非旁观者；魔力/学习/冷却由技能检查","技能结果；部分返回 MC_* 坐标");
        add(specs,"focus","magic","item","/mycli focus give|list|menu|bind <技能ID>","领取、查看、配置灵纹法杖","在线玩家；bind 需持有法杖","法杖菜单或绑定回执");
        add(specs,"imprint","magic","item","/mycli imprint [list|技能ID]","给手持工具刻印可用法术","附魔台 4 格内；非创造需 3 级经验和 1 青金石","菜单、可刻印列表或结果");
        add(specs,"compass","item","item","/mycli compass","补领技能罗盘","背包有空位；已有时不重复发放","领取结果");
        add(specs,"book","item","item","/mycli book","补领命格书","背包有空位；已有时不重复发放","领取结果");
        add(specs,"kit","item","item","/mycli kit","补领罗盘和命格书","背包有空位","领取结果");
        add(specs,"menu","item","gui","/mycli menu","打开技能罗盘原版箱子界面","在线玩家","原版菜单");
        add(specs,"protect","safety","read","/mycli protect break|place <x> <y> <z>","操作方块前查询保护；坐标必须是绝对整数","同维度已加载方块，距玩家不超过 16 格","mcagent:protection JSON；deny 不操作，unknown 暂缓");
        add(specs,"goto","travel","teleport","/mycli goto <公共地点ID|arena|guild|personal:名字>","前往公共或私人传送点","目标已存在且安全；私人名 1–24 位英文数字_-","MC_DESTINATION 绝对坐标或失败原因");
        add(specs,"waypoint","travel","read","/mycli waypoint [add|remove <名字>]","列出公共/私人传送点或保存/删除私人点","在线玩家；add/remove 名称为 1–24 位英文数字_-","MC_WAYPOINT 绝对坐标或操作结果");
        add(specs,"locate","team","read","/mycli locate list|nearest|玩家名|off|tp <玩家名|nearest>","查在线队友绝对坐标、追踪或安全传送","目标在线且非旁观者","MC_PLAYER 绝对坐标或追踪/传送结果");
        add(specs,"arena","adventure","read","/mycli arena status|start|rest|next|shop|rewards|stash|leave","试炼塔挑战、商店与本人奖励箱","玩法动作受位置、队伍、冷却检查","MC_DUNGEON、MC_REWARD、MC_STASH 或菜单");
        add(specs,"pvp","adventure","read","/mycli pvp status|join|leave|lobby|board|menu","自愿参加同款装备一对一竞技场","非旁观者、未在试炼中；两人入队自动开赛","本人 MC_PVP JSON 与 MC_PVP_RESULT");
        add(specs,"guild","adventure","read","/mycli guild board|join|status|accept <ID>|claim|travel <遗迹ID>","公会任务、声望和遗迹远征","本人角色；接单需满足等级与每日限制","个人任务/声望或传送结果");
        add(specs,"life","life","read","/mycli life board|menu|status|accept <ID>|claim|abandon|write <书名>|<正文>","生活公会：种田、烹饪、钓鱼、建筑、写书和红石机关","本人非旁观者；每日每任务一次","个人提示和 mcagent:life JSON");
        add(specs,"goddess","goddess","read","/mycli goddess skills|learn feather|night|pray <话>","女神技艺和祈愿","学习需满足条件；祈愿需女神在线","技能列表、学习或送达结果");

        add(specs,"protect.break","safety","read","/mycli protect break <x> <y> <z>","预判能否挖掘该绝对坐标方块","整数坐标；同维度、16 格内、区块已加载","mcagent:protection status=deny|unknown|allow_likely");
        add(specs,"coach.status","info","read","/mycli coach status","查看本人提醒开关、触发门槛和冷却","在线玩家","MC_COACH type=status");
        add(specs,"coach.on","info","write","/mycli coach on","为本人启用提醒，跨重登保留","在线非旁观玩家","MC_COACH type=status enabled=true");
        add(specs,"coach.off","info","write","/mycli coach off","为本人关闭提醒，跨重登保留","在线玩家","MC_COACH type=status enabled=false");
        add(specs,"protect.place","safety","read","/mycli protect place <x> <y> <z>","预判能否在绝对坐标放置方块","整数坐标；同维度、16 格内、区块已加载","mcagent:protection status=deny|unknown|allow_likely");
        add(specs,"cast.selfheal","magic","cast","/mycli cast selfheal","治疗自己；圣愈术","非旁观者；MagicSpells 魔力与冷却检查","治疗结果与视觉提示");
        add(specs,"skillbook.list","magic","read","/mycli skillbook list","列出背包内真实研习书、槽位、技能与可得熟练度","本人在线","MC_SKILLBOOK action=list|summary");
        add(specs,"skillbook.use","magic","item","/mycli skillbook use [背包槽位0–35]","消耗一册研习书增加对应技能熟练度；满级不消耗","本人持有该书且未满 3 级","MC_SKILLBOOK action=use");
        add(specs,"cast.heal","magic","cast","/mycli cast heal","治疗 8 格内所有受伤玩家（含自己）","非旁观者；6 魔力；12 秒冷却；无需瞄准","治疗人数、视觉提示与私有技能事件");
        add(specs,"cast.food","magic","cast","/mycli cast food","恢复饥饿","非旁观者；MagicSpells 魔力与冷却检查","施法结果");
        add(specs,"cast.home","magic","teleport","/mycli cast home","归乡到出生村庄","非旁观者；村庄传送可用","传送结果与绝对坐标");
        add(specs,"cast.blink","magic","cast","/mycli cast blink","短距闪现","非旁观者；MagicSpells 魔力与冷却检查","施法结果");
        add(specs,"cast.give","magic","cast","/mycli cast give <物品名>","造物：固定 8 种即时造出；其他物品申请女神审核","非旁观者；固定配方耗魔力；申请需女神在线","物品或申请送达/拒绝原因");
        add(specs,"cast.fireworks","magic","cast","/mycli cast fireworks","释放观赏烟花","非旁观者；冷却检查","粒子与声音");
        add(specs,"cast.starlight","magic","cast","/mycli cast starlight","释放观赏星尘","非旁观者；冷却检查","粒子与声音");
        add(specs,"cast.starbolt","magic","cast","/mycli cast starbolt","自动锁定怪物；基础 5 伤害，4 魔力、3 秒冷却","非旁观者；射程内有目标","私有命中提示含名称、中文实体类型和 minecraft 实体 ID；粒子");
        add(specs,"cast.frostnova","magic","cast","/mycli cast frostnova","范围冰霜减速；基础 2 伤害，7 魔力、14 秒冷却","非旁观者；魔力与冷却检查","施法结果与粒子");
        add(specs,"cast.flamewave","magic","cast","/mycli cast flamewave","范围火焰；基础 4 伤害，8 魔力、10 秒冷却","非旁观者；魔力与冷却检查","施法结果与粒子");
        add(specs,"cast.prospect","magic","cast","/mycli cast prospect [all|coal|iron|copper|gold|gems|diamond|redstone|ancient]","探查真实矿物；范围随挖矿等级增长","非旁观者；6 魔力、30 秒冷却，附近有矿才扣费","聊天 dimension/X/Y/Z 绝对矿块坐标、轮廓或无矿结果");
        add(specs,"cast.leap","magic","cast","/mycli cast leap","跃空并缓降；4 魔力、8 秒冷却","非旁观者；站在地面","位移与视觉提示");
        add(specs,"cast.flight","magic","cast","/mycli cast flight","生存飞行 15 秒；10 魔力、90 秒冷却","非旁观者；技能可用","飞行状态与到期提示");
        add(specs,"cast.golem","magic","cast","/mycli cast golem","召唤守护铁傀儡 45 秒；12 魔力、75 秒冷却","非旁观者；附近有安全落点","召唤结果");
        add(specs,"cast.sense","magic","cast","/mycli cast sense","探测 24 格已加载怪物；3 魔力、15 秒冷却","非旁观者；无怪时不扣魔力","怪物方向、距离、高低差与数量");
        add(specs,"cast.feather","magic","cast","/mycli cast feather","羽落 45 秒","已学习；非旁观者；冷却检查","效果与提示");
        add(specs,"cast.night","magic","cast","/mycli cast night","夜视 120 秒","已学习；非旁观者；冷却检查","效果与提示");
        add(specs,"focus.give","magic","item","/mycli focus give","领取灵纹法杖","在线玩家；背包有空位","领取结果");
        add(specs,"focus.list","magic","read","/mycli focus list","列出实际可绑定法术 ID","在线玩家","当前 FOCUS_SPELLS 列表");
        add(specs,"focus.bind","magic","item","/mycli focus bind <技能ID>","给背包中的法杖绑定技能","已有法杖；ID 来自 focus list","绑定结果");
        add(specs,"imprint.list","magic","read","/mycli imprint list","列出可刻印的法术 ID","在线玩家","当前 FOCUS_SPELLS 列表");
        add(specs,"waypoint.add","travel","write","/mycli waypoint add <名字>","保存当前位置为私人传送点","名称 1–24 位英文数字_-；Essentials 权限检查","MC_WAYPOINT 绝对坐标或失败原因");
        add(specs,"waypoint.remove","travel","write","/mycli waypoint remove <名字>","删除本人私人传送点","名称 1–24 位英文数字_-","Essentials 删除回执");
        add(specs,"locate.list","team","read","/mycli locate list","列出可见在线队友位置","在线玩家","每人一条 MC_PLAYER 绝对坐标");
        add(specs,"locate.nearest","team","write","/mycli locate nearest","追踪同世界最近队友","同世界有可见非旁观队友","BossBar 方向和距离");
        add(specs,"locate.off","team","write","/mycli locate off","停止追踪队友","在线玩家","停止结果");
        add(specs,"locate.tp","team","teleport","/mycli locate tp <玩家名|nearest>","安全传送到队友附近","队友在线可见；20 秒冷却；有安全落点","传送结果与绝对坐标");
        add(specs,"arena.status","adventure","read","/mycli arena status","查看本人参赛身份、全服试炼进度和入口/楼层绝对坐标","在线玩家","MC_DUNGEON status 的 participant/selfState 与全服状态分开");
        add(specs,"pvp.status","adventure","read","/mycli pvp status","本人积分、胜负、匹配及对手状态和大厅绝对坐标","在线玩家","本人 MC_PVP JSON");
        add(specs,"pvp.join","adventure","write","/mycli pvp join","进入一对一匹配；第二人加入后自动倒数","非旁观者、未在试炼中；原物品先安全暂存","本人 MC_PVP action=join");
        add(specs,"pvp.leave","adventure","write","/mycli pvp leave","退出排队或认输；还原原物品与位置","已排队或正在比赛","本人 MC_PVP 与 MC_PVP_RESULT");
        add(specs,"pvp.lobby","adventure","teleport","/mycli pvp lobby","前往天空竞技场观众平台","竞技场已建；比赛中不可用","本人 MC_PVP 大厅绝对坐标");
        add(specs,"pvp.board","adventure","read","/mycli pvp board","查看积分榜","在线玩家","私人 MC_PVP_RANK 列表");
        add(specs,"arena.start","adventure","write","/mycli arena start","与入口按钮附近队友一起开始试炼","在入口且符合组队/冷却条件","挑战开始或拒绝原因");
        add(specs,"arena.difficulty","adventure","write","/mycli arena difficulty [auto|normal|adventure|apocalypse]","按冒险者公会等级自动匹配，或手动选择下次本人发起试炼的难度；高等级打低难度奖励减少","在线玩家；多人由按钮发起者决定，奖励按各自等级结算","私有 MC_DUNGEON_DIFFICULTY 回执，含推荐档位与选择模式");
        add(specs,"arena.rest","adventure","teleport","/mycli arena rest","从试炼驿站继续深层挑战","满足驿站解锁与挑战条件","传送或拒绝原因");
        add(specs,"arena.next","adventure","write","/mycli arena next","查询自动下楼状态；在驿站可触发 10 秒后出发","挑战进行中；驿站需已清场","倒计时/状态");
        add(specs,"arena.shop","adventure","gui","/mycli arena shop","打开入口或第七层余额商店；旧实体绿宝石交易可用 shop merchant","在试炼入口或第七层驿站","原版菜单或拒绝原因");
        add(specs,"arena.shop.list","storage","read","/mycli arena shop list","列出余额商店的护甲、武器与补给","在线玩家","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.shop.buy","storage","item","/mycli arena shop buy <商品ID> [1–16]","用个人绿宝石余额购买；商品进入个人箱待领取队列","余额足够且队列有容量","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.wallet","storage","read","/mycli arena wallet","查询本人的绿宝石余额","在线玩家","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.loot","adventure","read","/mycli arena loot","查看试炼装备、下一件法术刻印装备及本游戏日已领奖层数","在线玩家","私有 MC_DUNGEON_SET 进度回执");
        add(specs,"arena.layout","adventure","read","/mycli arena layout","读取本人当前战斗房间的绝对中心、范围、奖励箱和地形危险类型","本人正在当前层参赛","私有 MC_DUNGEON_LAYOUT 回执");
        add(specs,"arena.recycle.list","storage","read","/mycli arena recycle list","列出本人箱子与背包中可回收装备","在线玩家","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.recycle.quote","storage","read","/mycli arena recycle quote chest|bag <槽位> [数量]","对精确槽位装备获取30秒报价","装备未穿戴且不是专属或任务物品","私有 quoteId、组件与价格");
        add(specs,"arena.recycle.sell","storage","item","/mycli arena recycle sell <quoteId>","按报价回收装备并存入个人余额","报价未过期且完整物品组件未变","私有成交与余额回执");
        add(specs,"arena.rewards","storage","gui","/mycli arena rewards","打开本人个人奖励箱","在线玩家","原版箱子菜单");
        add(specs,"arena.rewards.list","storage","read","/mycli arena rewards list","列出箱满后尚未入箱的奖励","在线玩家","MC_REWARD、MC_REWARD_SUMMARY");
        add(specs,"arena.rewards.take","storage","item","/mycli arena rewards take <0–7|9–17|all>","领取尚未入箱的奖励；箱内物品用 stash take","背包有空位；先查看 rewards list","领取结果");
        add(specs,"arena.stash","storage","gui","/mycli arena stash","打开本人 54 格双箱；支持原版箱子操作","在线玩家","原版箱子菜单");
        add(specs,"arena.stash.inventory","storage","read","/mycli arena stash inventory","列出本人背包槽位 0–35","在线玩家","MC_INVENTORY、MC_INVENTORY_SUMMARY");
        add(specs,"arena.stash.list","storage","read","/mycli arena stash list","列出本人箱子槽位 1–54","在线玩家","MC_STASH、MC_STASH_SUMMARY");
        add(specs,"arena.stash.put","storage","item","/mycli arena stash put <英文物品ID> <1–64>","按物品类型从背包存入个人箱","背包有该物品；箱有空位","MC_STASH_PUT moved 数量");
        add(specs,"arena.stash.putslot","storage","item","/mycli arena stash putslot <背包槽位0–35> <1–64>","按精确背包槽存入；保留附魔与自定义物品","背包槽有物品；箱有空位","MC_STASH_PUT moved 数量");
        add(specs,"arena.stash.take","storage","item","/mycli arena stash take <箱槽位1–54> [1–64]","从个人箱取到本人背包","箱槽有物品；背包有空位","MC_STASH_TAKE moved 数量");
        add(specs,"arena.leave","adventure","teleport","/mycli arena leave","退出试炼返回入口","正在试炼区域内","传送或拒绝原因");
        add(specs,"guild.hall","adventure","teleport","/mycli guild hall","前往公会大厅","安全落点可用","传送结果");
        add(specs,"guild.board","adventure","read","/mycli guild board","列出今天可接任务和 ID","在线玩家","任务、声望及等级门槛");
        add(specs,"guild.menu","adventure","gui","/mycli guild menu","打开原版公会任务面板","在线玩家","原版菜单");
        add(specs,"guild.join","adventure","write","/mycli guild join","注册冒险者公会","非旁观者；已入会时显示状态","入会回执");
        add(specs,"guild.status","adventure","read","/mycli guild status","查看本人公会等级、声望与活动任务","在线玩家","个人状态");
        add(specs,"guild.accept","adventure","write","/mycli guild accept <任务ID>","接取一张公会任务；接单可自动入会","满足等级/每日限制；同一时间一单","任务进度或拒绝原因");
        add(specs,"guild.abandon","adventure","write","/mycli guild abandon","放弃当前公会任务","有活动任务","放弃结果");
        add(specs,"guild.claim","adventure","item","/mycli guild claim","交付已完成任务并结算声望/奖励","活动任务已达成","声望与奖励箱结果");
        add(specs,"guild.rewards","storage","gui","/mycli guild rewards","打开与试炼共用的本人奖励箱","在线玩家","原版箱子菜单");
        add(specs,"guild.stash","storage","gui","/mycli guild stash","打开与试炼共用的本人私人箱","在线玩家","原版箱子菜单");
        add(specs,"guild.shared","storage","read","/mycli guild shared","列出四组公会公共双箱的绝对坐标；所有玩家可用普通箱子方式存取","公会服务区已建成","MC_GUILD_SHARED 坐标及 54 格容量");
        add(specs,"guild.trader","adventure","gui","/mycli guild trader","查看公会接待员坐标；到门口打开购买、回收和任务菜单","公会服务区已建成","MC_GUILD_TRADER 与原版容器菜单");
        add(specs,"guild.travel","adventure","teleport","/mycli guild travel <遗迹ID>","前往已开放地下城遗迹的外围安全点","ID 从公会看板/文档获取；目标可用","传送或拒绝原因");
        add(specs,"life.board","life","read","/mycli life board","查看六类生活公会的每日委托和精确 ID","在线玩家","私人看板文字");
        add(specs,"life.menu","life","gui","/mycli life menu","打开手柄可用的原版生活公会菜单","在线玩家","原版 27 格菜单");
        add(specs,"life.status","life","read","/mycli life status","查看本人六类公会声望及当前任务","在线玩家","mcagent:life status");
        add(specs,"life.accept","life","write","/mycli life accept <任务ID>","领取一项生活委托","非旁观者；无其他进行中生活委托","mcagent:life accept");
        add(specs,"life.claim","life","item","/mycli life claim","交付达成的生活委托","任务进度已满；今日未领取","声望和个人箱奖励、mcagent:life claim");
        add(specs,"life.abandon","life","write","/mycli life abandon","放弃当前生活委托","本人有进行中任务","mcagent:life abandon");
        add(specs,"life.write","life","item","/mycli life write <书名>|<正文>","为 Agent 创建真实署名游记并参与故事公会任务","非旁观者；背包有空格；正文至少40字","背包实体成书、mcagent:life progress");
        add(specs,"goddess.skills","goddess","read","/mycli goddess skills","查看女神技能和学习条件","在线玩家","技能文字列表");
        add(specs,"goddess.learn","goddess","write","/mycli goddess learn feather|night","学习羽落或夜视","非旁观者；5 级经验或炼金等级满足免费条件","学习结果");
        add(specs,"goddess.pray","goddess","message","/mycli goddess pray <1–100字>","把祈愿私聊给女神 Agent","女神在线；本人 30 秒冷却","明确送达或未送达");
        return Map.copyOf(specs);
    }

    static List<String> roots() {
        return SPECS.values().stream().filter(Spec::root).map(Spec::id).sorted().toList();
    }

    static List<String> filters() {
        Set<String> filters = new LinkedHashSet<>();
        filters.add("all");
        SPECS.values().stream().map(Spec::category).sorted().forEach(filters::add);
        roots().forEach(filters::add);
        return List.copyOf(filters);
    }

    static List<String> ids() { return SPECS.keySet().stream().sorted().toList(); }

    static void list(Player player, String[] args) {
        if (args.length > 3) { error(player, "INVALID_ARGUMENT", "用法：/mycli list [分类|命令|all] [页码]"); return; }
        String filter = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "roots";
        if (!filter.equals("roots") && !filters().contains(filter)) {
            error(player, "UNKNOWN_FILTER", "可选过滤器：" + String.join(",", filters())); return;
        }
        int page = 1;
        if (args.length == 3) {
            try { page = Integer.parseInt(args[2]); }
            catch (NumberFormatException invalid) { error(player, "INVALID_PAGE", "页码必须是正整数"); return; }
        }
        List<Spec> matches = new ArrayList<>();
        for (Spec spec : SPECS.values()) if (filter.equals("all")
                || filter.equals("roots") && spec.root()
                || filter.equals(spec.category())
                || filter.equals(spec.id().split("\\.")[0]) && !spec.root()) matches.add(spec);
        matches.sort(java.util.Comparator.comparing(Spec::id));
        int pages = Math.max(1, (matches.size() + PAGE_SIZE - 1) / PAGE_SIZE);
        if (page < 1 || page > pages) { error(player, "INVALID_PAGE", "页码范围 1–" + pages); return; }
        JsonObject head = new JsonObject();
        head.addProperty("schemaVersion", 1);
        head.addProperty("filter", filter);
        head.addProperty("page", page);
        head.addProperty("pages", pages);
        head.addProperty("total", matches.size());
        head.addProperty("pageSize", PAGE_SIZE);
        player.sendMessage("MC_CLI_LIST " + head);
        for (int index = (page - 1) * PAGE_SIZE; index < Math.min(page * PAGE_SIZE, matches.size()); index++) {
            Spec spec = matches.get(index);
            JsonObject item = new JsonObject();
            item.addProperty("id", spec.id());
            item.addProperty("category", spec.category());
            item.addProperty("mode", spec.mode());
            item.addProperty("summary", spec.summary());
            player.sendMessage("MC_CLI_ITEM " + item);
        }
        if (page < pages) player.sendMessage("MC_CLI_NEXT /mycli list " + filter + " " + (page + 1));
    }

    static void explain(Player player, String[] args, int from) {
        if (args.length <= from) { error(player, "MISSING_ID", "用法：/mycli explain <ID>；先用 /mycli list"); return; }
        String id = String.join(".", java.util.Arrays.copyOfRange(args, from, args.length))
                .toLowerCase(Locale.ROOT);
        Spec spec = SPECS.get(id);
        if (spec == null) { error(player, "UNKNOWN_ID", "未知 ID " + id + "；先用 /mycli list <分类|命令>"); return; }
        JsonObject detail = new JsonObject();
        detail.addProperty("schemaVersion", 1);
        detail.addProperty("id", spec.id());
        detail.addProperty("category", spec.category());
        detail.addProperty("mode", spec.mode());
        detail.addProperty("usage", spec.usage());
        detail.addProperty("summary", spec.summary());
        detail.addProperty("requires", spec.requires());
        detail.addProperty("returns", spec.returns());
        player.sendMessage("MC_CLI_DETAIL " + detail);
    }

    private static void error(Player player, String code, String hint) {
        JsonObject error = new JsonObject();
        error.addProperty("schemaVersion", 1);
        error.addProperty("code", code);
        error.addProperty("hint", hint);
        player.sendMessage("MC_CLI_ERROR " + error);
    }
}
