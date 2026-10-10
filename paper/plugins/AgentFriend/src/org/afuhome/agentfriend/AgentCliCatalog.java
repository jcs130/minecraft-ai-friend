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
        add(specs,"world","life","read","/mycli world list|menu|npcs|talk <ID> <话>|end|guide start|practice start|status|stop|events|photos","世界生活内容入口：新手实习、开门爬梯实练、村民聊天、世界事件、村民交易和照片展示","查询免费；聊天须在NPC八格内；当前照片仅导入/展示，没有自动快门","MC_WORLD JSON及NPC实际答复");
        add(specs,"world.list","life","read","/mycli world list","查看各内容插件实际启用状态和入口","查询免费，不执行技能","MC_WORLD type=catalog");
        add(specs,"world.board","life","read","/mycli world board [menu]","居民事务：农耕集市、照片展与遗迹调查；查看真实步骤及本人状态","与公会共享任务槽；guild accept接单，每阶段guild claim；最终入个人箱","MC_WORLD type=board；可选45格原版菜单");
        add(specs,"world.shops","life","read","/mycli world shops","查看真实集市商人的位置、农产收购与旅行补给","亲自到场交易，实际消耗原版物品；选中配方还不算成交","MC_WORLD type=shops");
        add(specs,"world.menu","life","gui","/mycli world menu","打开Java、基岩和Agent共用的原版生活菜单","在线玩家","27格原版菜单");
        add(specs,"world.npcs","life","read","/mycli world npcs","查看可聊天村民的ID、真实位置和是否在八格内","查询免费；先步行靠近，不自动传送","MC_WORLD type=npcs");
        add(specs,"world.talk","life","chat","/mycli world talk <NPC ID> <话>","与附近村民自然交谈，NPC有独立性格与对话记录","生存角色；NPC八格内；180字内；等待实际答复；对话不替代任务验收","MC_WORLD type=talk status=submitted或denied；NPC实际答复另到达");
        add(specs,"world.end","life","write","/mycli world end","结束村民对话，恢复普通公屏聊天","本人的当前对话","MC_WORLD type=talk status=ended");
        add(specs,"world.guide","life","write","/mycli world guide start|status","新手实习：查看技能目录、真正成功施法、完成生活委托；服务器记录证据","主动开始；失败施法/自称完成不计进度；不代学、不代花点","MC_WORLD type=guide/guide_progress");
        add(specs,"world.practice","life","write","/mycli world practice start|status|stop","通行实练：亲手打开木门并穿过、沿现有梯子连续爬升3格；不拆墙、不垫方块","自愿报名；生存或冒险模式；本人原生交互与移动；飞行、传送、自称完成不算；没有额外奖励或代操作","MC_WORLD type=practice/practice_progress；真实坐标、时间及原生操作证明；一次通过不表示长期掌握");
        add(specs,"world.events","life","read","/mycli world events","查看正在进行的世界生活事件","查询免费；活动公告另发；活动不自动完成任务","MC_WORLD type=events与WorldEvents当前列表");
        add(specs,"world.photos","life","read","/mycli world photos","查看个人照片地图及导入方法，可挂展示框","ImageFrame已启用；打印消耗空地图；自动拍摄尚未启用","MC_WORLD type=photos automaticCaptureReady=false与个人相册列表");
        add(specs,"profession","magic","read","/mycli profession status|list|menu|choose <ID>|leave <ID>","选择一个主战职业；list 查看当前开放路线；保留旧技能和成长","生存模式选择；UUID 学习账本；不改背包","MC_PROFESSION / MC_PROFESSION_RESULT");
        add(specs,"profession.status","magic","read","/mycli profession status","查看本人当前职业和准备槽","查询免费","MC_PROFESSION");
        add(specs,"profession.menu","magic","gui","/mycli profession menu","打开原版职业和技能菜单","Java、基岩手柄和 Mineflayer 共用","54 格原版菜单");
        add(specs,"profession.choose","magic","write","/mycli profession choose <ID>","选择职业方向，解锁入门技能的学习资格","生存模式；最多一个主战和两个生活职业；冷却不重置","MC_PROFESSION_RESULT");
        add(specs,"profession.leave","magic","write","/mycli profession leave <ID>","离开职业，取消其技能准备；学习历史保留","本人所选职业","MC_PROFESSION_RESULT");
        add(specs,"visuals","magic","read","/mycli visuals","查看原版技能粒子和播放预算；特效只在成功施法后出现","查询免费；不改变技能资格、耗魔、冷却和实际伤害范围","本人MC_VISUALS JSON；画面不作为命中或验收证据");
        add(specs,"say","life","chat","/mycli say <公开发言>","公开说话并在角色头顶显示短暂文字气泡；普通聊天同样有效","沿用普通聊天的接收者和取消规则；非观战/隐身角色才有气泡；附近24格且视线可达；私聊不显示","原版聊天及TextDisplay；连续发言更新同一个气泡；超长内容气泡省略，完整正文仍在聊天栏");
        add(specs,"bubbles","life","read","/mycli bubbles","查看玩家/NPC文字气泡状态和多人预算","查询免费；NPC私有对白仅本人及当前附身Eye可见；Java、基岩及Agent沿用原客户端","本人MC_BUBBLES JSON；基岩由Geyser转文字标签，外观可能不同；语音功能尚未启用");
        add(specs,"skills","magic","read","/mycli skills list [分类] [页码]|info <ID>|mine|points|learn <ID>|upgrade <ID>","基础和战法牧技能图鉴；list profession 直接查看职业技艺，默认列表有多页","查询免费；学习与升级耗点，施法需要本人资格","MC_SPELL_*、MC_SKILL、MC_SKILL_POINTS、MC_SKILL_ASSESSMENT");
        add(specs,"skills.list","magic","read","/mycli skills list [all|common|profession|warrior|mage|priest] [页码]","分页发现基础和职业技能；如 list priest 查看抚愈、净化、高阶圣愈","查询免费；旧 list <页码> 保留；按 pages 和 MC_SPELL_NEXT 读后续页","MC_SPELL_LIST 含分类/总量/版本，MC_SPELL_ITEM 含效果摘要/职业/详情命令");
        add(specs,"skills.explain","magic","read","/mycli skills explain <ID>","读取法术图鉴说明；逐级数值、技能点和本人条件用 skills info <ID>","查询免费，不执行技能","MC_SPELL_DETAIL");
        add(specs,"skills.mine","magic","read","/mycli skills mine","查看本人新技能、装备、资格、来源和实际能力统计","查询免费；未学技能也显示获取途径","MC_SKILL、MC_SKILL_POINTS 与 MC_SKILL_ASSESSMENT");
        add(specs,"skills.respec","magic","write","/mycli skills respec confirm","洗点退回已花点数；保留原资格、职业与事件解锁","默认10魔力、5分钟冷却；保留施法冷却；试炼/PvP外","MC_PROFESSION_RESULT 与 MC_SKILL_POINTS");
        add(specs,"skills.points","magic","read","/mycli skills points","本人技能点余额、已花、上限和成长进度","三个职业共用点数；切换不退点","MC_SKILL_POINTS");
        add(specs,"skills.learn","magic","write","/mycli skills learn <ID>","花技能点学习基础或职业技能","基础人人可学；职业需当前方向和任务/事件资格","MC_PROFESSION_RESULT 与 MC_SKILL_POINTS");
        add(specs,"skills.upgrade","magic","write","/mycli skills upgrade <ID>","花更多技能点提升职业技能等级","已学会、具备资格、余额足够；原冷却保留","MC_PROFESSION_RESULT 与 MC_SKILL_POINTS");
        add(specs,"skills.info","magic","read","/mycli skills info <ID>","查看各级效果、费用和本人解锁条件","查询免费","MC_SKILL 与 MC_SPELL_DETAIL");
        add(specs,"skills.learnmenu","magic","read","/mycli skills learnmenu","打开原版技能学习升级菜单","普通Java和基岩菜单协议","原版容器菜单");
        add(specs,"skills.prepare","magic","write","/mycli skills prepare <ID>","准备已学职业技能","当前职业；最多四项新主动和一项传承","MC_PROFESSION_RESULT");
        add(specs,"skills.unprepare","magic","write","/mycli skills unprepare <ID>","取消准备，保留学习记录和冷却","当前职业；已学会","MC_PROFESSION_RESULT");
        add(specs,"help","info","read","/mycli help [ID]","查看玩家帮助；有 ID 时查看该命令详情","在线玩家","帮助或 MC_CLI_DETAIL");
        add(specs,"list","info","read","/mycli list [分类|命令|all] [页码]","分页发现命令；默认只列顶层命令","在线玩家","MC_CLI_LIST、MC_CLI_ITEM");
        add(specs,"explain","info","read","/mycli explain <ID|命令 子命令>","查询用法、前提、效果和回执；绝不执行目标命令","在线玩家","MC_CLI_DETAIL");
        add(specs,"coach","info","read","/mycli coach status|next|guide|menu|later|on|off","按本人真实进度指引冒险者登记、新手实习与首张委托；低频私聊","自动迎新面向已登记的Agent；Java提醒默认开、基岩关；旁观者不参加","MC_COACH JSON；原status字段保留，增加onboarding");
        add(specs,"guide","info","read","/mycli guide [start|explore|magic|gear|guild|dungeon|team]","分主题游玩指引；menu 打开手柄菜单","在线玩家","聊天指引或原版菜单");
        add(specs,"status","info","read","/mycli status","查看本人生命、魔力、公会及试炼状态","在线玩家","个人状态与 MC_DUNGEON 坐标");
        add(specs,"spells","magic","read","/mycli spells list [分类] [页码]|explain <技能ID>","基础及职业技能图鉴；profession/warrior/mage/priest 可直接查战法牧技能","在线玩家；查询不会施法","本人 MC_SPELL_LIST/ITEM/DETAIL JSON");
        add(specs,"mastery","magic","read","/mycli mastery","查看本人法术熟练度与升级门槛","在线玩家","熟练度报告");
        add(specs,"skillbook","magic","item","/mycli skillbook list|use [槽位]","列出或使用实体技艺研习书；也可手持右键","背包有研习书且对应技能未满级","MC_SKILLBOOK 私有回执");
        add(specs,"cast","magic","cast","/mycli cast <技能ID> [参数]","施放生活、战斗或探索法术","本人非旁观者；魔力/学习/冷却由技能检查","技能结果；部分返回 MC_* 坐标");
        add(specs,"focus","magic","item","/mycli focus give|list|menu|bind <技能ID>","领取、查看、配置灵纹法杖","在线玩家；bind 需持有法杖","法杖菜单或绑定回执");
        add(specs,"imprint","magic","item","/mycli imprint [list|技能ID]","给手持工具刻印可用法术","附魔台 4 格内；非创造需 3 级经验和 1 青金石","菜单、可刻印列表或结果");
        add(specs,"compass","item","item","/mycli compass","补领技能罗盘","背包有空位；已有时不重复发放","领取结果");
        add(specs,"book","item","item","/mycli book","补领命格书","背包有空位；已有时不重复发放","领取结果");
        add(specs,"kit","item","item","/mycli kit","补领罗盘和命格书","背包有空位","领取结果");
        add(specs,"menu","item","gui","/mycli menu","打开技能罗盘原版箱子界面","在线玩家","原版菜单");
        add(specs,"protect","safety","read","/mycli protect break|place|container|use <x> <y> <z>","拆建/开箱/开门或机关前查询保护与物品归属；坐标必须是绝对整数","同维度已加载方块，距玩家不超过 16 格","mcagent:protection JSON；deny 不操作，unknown 暂缓；areas 含世界/含边界坐标与形状，nextAction/nextCommands 给正确做法，区外目标仍须重新查询");
        add(specs,"goto","travel","teleport","/mycli goto <公共地点ID|arena|guild|personal:名字|shared:分享码>","传送术前往公共、本人或分享地点","安全落点；6 魔力；个人名支持 1–24 位中文字母数字_-；不在活动中","命名地点先返回 MC_WAYPOINT_RESULT status=pending，最终 success/denied；成功 MC_TRAVEL；失败不扣费");
        add(specs,"waypoint","travel","read","/mycli waypoint","只读列出公共、本人命名地点和旧 home","在线玩家；不移动、不扣费","MC_WAYPOINT 绝对坐标和 MC_WAYPOINT_LIST JSON");
        add(specs,"locate","team","read","/mycli locate list|nearest|玩家名|off|tp <玩家名|nearest>","查在线队友绝对坐标、追踪或安全传送","目标在线且非旁观者","MC_PLAYER 绝对坐标或追踪/传送结果");
        add(specs,"arena","adventure","read","/mycli arena status|start|rest|next|shop|rewards|stash|leave","试炼塔挑战、商店与本人奖励箱","玩法动作受位置、队伍、冷却检查","MC_DUNGEON、MC_REWARD、MC_STASH 或菜单");
        add(specs,"pvp","adventure","read","/mycli pvp status|join|leave|lobby|board|menu","自愿参加同款装备一对一竞技场","非旁观者、未在试炼中；两人入队自动开赛","本人 MC_PVP JSON 与 MC_PVP_RESULT");
        add(specs,"guild","adventure","read","/mycli guild board|join|status|accept <ID>|claim|travel <遗迹ID>","公会任务、声望和遗迹远征","本人角色；接单需满足等级与每日限制","个人任务/声望或传送结果");
        add(specs,"life","life","read","/mycli life board|menu|status|locations|accept <ID>|claim|abandon|write <书名>|<正文>","生活公会：种田、烹饪、钓鱼、建筑、写书、红石机关和村民收购","本人非旁观者；每日每任务一次","个人提示和 mcagent:life JSON");
        add(specs,"village","safety","query_or_cast","/mycli village threat|support [事件ID]|villagers","查实时敌情、施放支援传送术、查村民收购报价","查询免费；支援8魔力、20秒冷却，须有已确认的活敌人","本人 mcagent:village JSON；支援返回 MC_VILLAGE_SUPPORT");
        add(specs,"goddess","goddess","read","/mycli goddess skills|learn feather|night|pray <话>","女神技艺和祈愿","学习需满足条件；祈愿需女神在线","技能列表、学习或送达结果");

        add(specs,"protect.break","safety","read","/mycli protect break <x> <y> <z>","预判能否挖掘该绝对坐标方块","整数坐标；同维度、16 格内、区块已加载","mcagent:protection status=deny|unknown|allow_likely");
        add(specs,"protect.container","safety","read","/mycli protect container <x> <y> <z>","开箱前查询领地与实体储物权限；公会门内归领地主人","整数坐标；同维度、16格内、已加载；门口公共箱可存取","MC_PROTECTION 与 mcagent:protection；拒绝则停止，按 publicCommand 找公共箱");
        add(specs,"protect.use","safety","read","/mycli protect use <x> <y> <z>","使用门、按钮、工作台前查询领地权限","整数坐标；同维度、16格内、已加载","MC_PROTECTION；deny 则停止，unknown 暂缓");
        add(specs,"land","safety","query_or_manage","/mycli land here|list|info <ID>|menu；members <ID> [页码]；trust|untrust <ID> <玩家名或UUID>；board <ID>","查看归属、协作者与实体公告牌；主人管理协作者","仅当前主人能授权/撤权；成员不能转授权；其他公共建筑保护仍适用","MC_LAND_INFO/LIST/MEMBERS/GUIDE/MEMBER_RESULT/BOARD");
        add(specs,"land.here","safety","read","/mycli land here","查看当前位置的领地归属和本人可做的操作","在线玩家","MC_LAND_INFO；unclaimed 仍须遵守公共建筑和活动保护");
        add(specs,"land.list","safety","read","/mycli land list [页码]","分页查看已登记领地","每页最多 9 项","MC_LAND_LIST");
        add(specs,"land.info","safety","read","/mycli land info <ID>","查看指定领地的主人、边界和本人权限","领地 ID 稳定；信任按 UUID","MC_LAND_INFO；not_found 表示 ID 不存在");
        add(specs,"land.menu","safety","menu","/mycli land menu","打开原版领地归属菜单，手柄可查看","技能罗盘左上角也可进入","原版 27 格菜单；点击详情不会传送");
        add(specs,"land.members","safety","read","/mycli land members <ID> [页码]","公开查看主人和完整协作者名单，每页9人","所有玩家免费查询；查询不授予权限","MC_LAND_MEMBERS 分页头、MC_LAND_MEMBER 逐人记录");
        add(specs,"land.trust","safety","write","/mycli land trust <ID> <玩家名或UUID>","主人或领地超管授权协作者在这块领地拆建并取放私有物品","当前非观战主人或显式超管；女神OP观战身份可跨领地管理；普通OP/成员不能转授权；已登录完整身份；最多64人","MC_LAND_MEMBER_RESULT；success才生效，unchanged无需重试；含actorUuid/authority，失败说明下一步");
        add(specs,"land.untrust","safety","write","/mycli land untrust <ID> <玩家名或UUID>","主人或领地超管撤销协作者权限并关闭失权的私有箱","可撤销离线成员；不改变主人和公共箱规则；普通成员不能转授权","MC_LAND_MEMBER_RESULT；撤权立即生效并持久保存");
        add(specs,"land.manage","safety","gui","/mycli land manage <ID>","主人或领地超管打开原版协作者管理页","选择玩家后显示权限范围，再确认；其他人可从公告牌查看名单","27格原版菜单，Java/基岩/Agent共用");
        add(specs,"admin.land.members","safety","read","mycli admin land members <ID>","女神运营工具读取指定领地完整主人和协作者名单","仅控制台/RCON适配；不读取箱内物品；玩家用land members分页","MC_LAND_MEMBERS；只读，不改变权限");
        add(specs,"admin.land.member","safety","write","mycli admin land member trust|untrust <ID> <玩家名或UUID>","女神运营工具以在线女神身份管理指定领地协作者","仅控制台/RCON；必须已核实女神OP观战身份在线；和玩家入口共用持久事务；不接受自由命令或任意操作者","MC_LAND_MEMBER_RESULT；含女神actorUuid和administrator；未知结果先读名单，不盲目重试");
        add(specs,"land.board","safety","read","/mycli land board <ID>","查看实体公告牌位置；走近右键查看主人和协作者","不自动传送；未加载或无安全空位显示待建，不覆盖已有建筑","MC_LAND_BOARD；原版双面上蜡牌，完整名单在原版27格页");
        add(specs,"coach.status","info","read","/mycli coach status","查看本人提醒开关、触发门槛、暂停截止时间、真实入门清单与下一步","在线玩家；查询不代办任务","MC_COACH type=status，含onboarding");
        add(specs,"coach.next","info","read","/mycli coach next","按服务器实际登记、实习与委托账本给出当前一步和可执行命令","在线非观战玩家；不自动接单、学习、施法或领奖","MC_COACH type=next reason=onboarding");
        add(specs,"coach.guide","info","read","/mycli coach guide","阅读玩法介绍、六项入门清单、本人进度与下一步","在线非观战玩家；只读","MC_COACH type=guide reason=onboarding");
        add(specs,"coach.menu","info","gui","/mycli coach menu","打开手柄友好的新手页，查看清单并自愿登记、报名或查询技能","点击相应动作才登记/报名；学习技能仍走原耗点确认","原版27格菜单");
        add(specs,"coach.later","info","write","/mycli coach later","暂停本人所有自动提醒，默认30分钟；跨重登保留","仍可主动查询；coach on 可提前恢复","MC_COACH type=status，onboarding.mutedUntil为Unix毫秒");
        add(specs,"coach.on","info","write","/mycli coach on","为本人启用提醒，跨重登保留","在线非旁观玩家","MC_COACH type=status enabled=true");
        add(specs,"coach.off","info","write","/mycli coach off","为本人关闭提醒，跨重登保留","在线玩家","MC_COACH type=status enabled=false");
        add(specs,"protect.place","safety","read","/mycli protect place <x> <y> <z>","预判能否在绝对坐标放置方块","整数坐标；同维度、16 格内、区块已加载","mcagent:protection status=deny|unknown|allow_likely");
        add(specs,"cast.selfheal","magic","cast","/mycli cast selfheal","治疗自己；圣愈术","非旁观者；MagicSpells 魔力与冷却检查","治疗结果与视觉提示");
        add(specs,"spells.list","magic","read","/mycli spells list [分类] [页码]","skills list 的兼容别名；profession/warrior/mage/priest 可直接查职业技能","查询免费；默认 all 多页，旧 list <页码> 保留","MC_SPELL_LIST/ITEM/NEXT");
        add(specs,"spells.explain","magic","read","/mycli spells explain <ID>","skills explain 的兼容别名；各级价格和条件用 skills info <ID>","查询免费，不执行技能","MC_SPELL_DETAIL");
        add(specs,"skillbook.list","magic","read","/mycli skillbook list","列出背包内真实研习书、槽位、技能与可得熟练度","本人在线","MC_SKILLBOOK action=list|summary");
        add(specs,"skillbook.use","magic","item","/mycli skillbook use [背包槽位0–35]","消耗一册研习书增加对应技能熟练度；满级不消耗","本人持有该书且未满 3 级","MC_SKILLBOOK action=use");
        add(specs,"cast.heal","magic","cast","/mycli cast heal","治疗 8 格内所有受伤玩家（含自己）","非旁观者；6 魔力；12 秒冷却；无需瞄准","治疗人数、视觉提示与私有技能事件");
        add(specs,"cast.food","magic","cast","/mycli cast food","恢复饥饿","非旁观者；MagicSpells 魔力与冷却检查","施法结果");
        add(specs,"cast.home","magic","teleport","/mycli cast home","归乡到出生村庄","非旁观者；村庄传送可用；6 魔力","成功后 MC_TRAVEL、技能特效和绝对坐标；失败不扣费");
        add(specs,"cast.blink","magic","cast","/mycli cast blink","短距闪现","非旁观者；MagicSpells 魔力与冷却检查","施法结果");
        add(specs,"cast.give","magic","cast","/mycli cast give <物品名>","造物：固定 8 种即时造出；其他物品申请女神审核","非旁观者；固定配方耗魔力；申请需女神在线","物品或申请送达/拒绝原因");
        add(specs,"cast.fireworks","magic","cast","/mycli cast fireworks","释放观赏烟花","非旁观者；冷却检查","粒子与声音");
        add(specs,"cast.starlight","magic","cast","/mycli cast starlight","释放观赏星尘","非旁观者；冷却检查","粒子与声音");
        add(specs,"cast.starbolt","magic","cast","/mycli cast starbolt","自动锁定怪物；基础 5 伤害，4 魔力、3 秒冷却","非旁观者；射程内有目标","私有命中提示含名称、中文实体类型和 minecraft 实体 ID；粒子");
        add(specs,"cast.frostnova","magic","cast","/mycli cast frostnova","范围冰霜减速；基础 2 伤害，7 魔力、14 秒冷却","非旁观者；魔力与冷却检查","施法结果与粒子");
        add(specs,"cast.flamewave","magic","cast","/mycli cast flamewave","范围火焰；基础 4 伤害，8 魔力、10 秒冷却","非旁观者；魔力与冷却检查","施法结果与粒子");
        add(specs,"cast.prospect","magic","cast","/mycli cast prospect [all|coal|iron|copper|gold|gems|diamond|redstone|ancient]","探查真实矿物；范围随挖矿等级增长","非旁观者；6 魔力、30 秒冷却，附近有矿才扣费","聊天 dimension/X/Y/Z 绝对矿块坐标、持续粒子指向线、轮廓或无矿结果");
        add(specs,"cast.leap","magic","cast","/mycli cast leap","跃空并缓降；4 魔力、8 秒冷却","非旁观者；站在地面","位移与视觉提示");
        add(specs,"cast.flight","magic","cast","/mycli cast flight","生存飞行 15 秒；10 魔力、90 秒冷却","非旁观者；技能可用","飞行状态与到期提示");
        add(specs,"cast.golem","magic","cast","/mycli cast golem","召唤守护铁傀儡 45 秒；12 魔力、75 秒冷却","非旁观者；附近有安全落点","召唤结果");
        add(specs,"cast.sense","magic","cast","/mycli cast sense","探敌术（心眼）；探测 24 格已加载怪物；3 魔力、15 秒冷却","非旁观者；无怪时不扣魔力","怪物方向、坐标、墙面粒子指引；Java 私有轮廓持续 8 秒");
        add(specs,"cast.support","magic","cast","/mycli cast support","支援传送术；与 village support、罗盘共享入口","8魔力、20秒冷却；已确认敌情和安全落点","MC_VILLAGE_SUPPORT 与 MC_TRAVEL id=support；敌人 UUID/坐标");
        add(specs,"cast.feather","magic","cast","/mycli cast feather","羽落 45 秒","已学习；非旁观者；冷却检查","效果与提示");
        add(specs,"cast.night","magic","cast","/mycli cast night","夜视 120 秒","已学习；非旁观者；冷却检查","效果与提示");
        add(specs,"focus.give","magic","item","/mycli focus give","领取灵纹法杖","在线玩家；背包有空位","领取结果");
        add(specs,"focus.list","magic","read","/mycli focus list","列出实际可绑定法术 ID","在线玩家","当前 FOCUS_SPELLS 列表");
        add(specs,"focus.bind","magic","item","/mycli focus bind <技能ID>","给背包中的法杖绑定技能","已有法杖；ID 来自 focus list","绑定结果");
        add(specs,"imprint.list","magic","read","/mycli imprint list","列出可刻印的法术 ID","在线玩家","当前 FOCUS_SPELLS 列表");
        add(specs,"waypoint.add","travel","write","/mycli waypoint add <名字>","记录亲自到达的当前位置，默认私有","安全平地；名字 1–24 位中文字母数字_-；默认最多 32 点；同名不覆盖；免费","MC_WAYPOINT_RESULT JSON 和 MC_WAYPOINT 绝对坐标");
        add(specs,"waypoint.remove","travel","write","/mycli waypoint remove <名字>","删除本人地点并撤销分享码","仅本人地点；免费；旧 home 走原删除权限","MC_WAYPOINT_RESULT；旧 home 返回 Essentials 回执");
        add(specs,"waypoint.update","travel","write","/mycli waypoint update <名字>","将已有本人地点明确更新为当前位置","本人已有命名地点；安全平地；免费","MC_WAYPOINT_RESULT；分享码保持有效并指向新落点");
        add(specs,"waypoint.rename","travel","write","/mycli waypoint rename <旧名> <新名>","修改本人地点名字","有效且未重名；免费；分享码保留","MC_WAYPOINT_RESULT JSON");
        add(specs,"waypoint.share","travel","write","/mycli waypoint share <名字>","公开本人地点供他人传送","本人地点；免费；主动授权公开名字、维度、坐标和发现者","MC_WAYPOINT_RESULT 含 shareCode 和 shared:目标；重复分享保持同码");
        add(specs,"waypoint.unshare","travel","write","/mycli waypoint unshare <名字>","撤回分享，旧码立即失效","本人地点；免费；再次分享会生成新码","MC_WAYPOINT_RESULT JSON");
        add(specs,"waypoint.list","travel","read","/mycli waypoint list [页码]","分页列出本人的命名地点","在线玩家；每页最多 36 点；不移动、不加载区块","MC_WAYPOINT_LIST JSON；scope=own");
        add(specs,"waypoint.shared","travel","read","/mycli waypoint shared [页码]","分页列出主动分享的地点","在线玩家；不会展示未分享地点；不移动、不加载区块","MC_WAYPOINT_LIST JSON；scope=shared");
        add(specs,"waypoint.menu","travel","gui","/mycli waypoint menu","打开命名地点菜单，支持命名、分享和传送","Java/基岩原版箱子菜单；命名输入不进公共聊天","地点菜单；实际传送成功才扣 6 魔力");
        add(specs,"waypoint.cancel","travel","write","/mycli waypoint cancel","取消菜单发起的命名输入","本人会话；免费","MC_WAYPOINT_RESULT JSON");
        add(specs,"landmark.list","travel","read","/mycli landmark list [页码]","列出当前公开的建筑地标","不加载区块；领地撤销或换主人后旧点停用","MC_LANDMARK_LIST 和逐条 MC_LANDMARK_ITEM；完整 mcagent:landmark JSON");
        add(specs,"landmark.mine","travel","read","/mycli landmark mine [页码]","查看自己可管理的地标建筑","只列当前本人拥有且允许登记地标的领地；免费","MC_LANDMARK_LIST scope=own");
        add(specs,"landmark.info","travel","read","/mycli landmark info <领地ID>","查看建筑管理者、建造履历和地标状态","免费；工程完成者由验收账本确定","MC_LANDMARK_INFO 和 MC_LANDMARK_RESULT；完整 mcagent:landmark JSON");
        add(specs,"landmark.publish","travel","write","/mycli landmark publish <领地ID> <名字>","把亲自到达的建筑安全落点登记为公共地标","仅当前领地主人生存角色；站在地块内；名字 1–24 位；不占个人点配额；免费","MC_LANDMARK_RESULT success/denied 和 MC_LANDMARK_ITEM；大家用 goto landmark:<领地ID>，成功 6 魔力");
        add(specs,"landmark.update","travel","write","/mycli landmark update <领地ID>","更新公共地标到本人当前安全位置","仅当前领地主人；站在建筑内；免费","MC_LANDMARK_RESULT；旧菜单传送在施放前重新检查");
        add(specs,"landmark.unpublish","travel","write","/mycli landmark unpublish <领地ID>","撤回地标传送，保留建筑管理权","仅当前领地主人；免费","MC_LANDMARK_RESULT；目录和旧目标立即失效");
        add(specs,"landmark.menu","travel","gui","/mycli landmark menu","打开公共地标和本人建筑管理菜单","Java/基岩原版箱子菜单；聊天命名仅发服务器","原版菜单；传送 pending 须等最终结果及 MC_TRAVEL；失败不扣魔力");
        add(specs,"landmark.cancel","travel","write","/mycli landmark cancel","取消地标菜单的命名输入","仅本人会话；免费","MC_LANDMARK_RESULT");
        add(specs,"locate.list","team","read","/mycli locate list","列出可见在线队友位置","在线玩家","每人一条 MC_PLAYER 绝对坐标");
        add(specs,"locate.nearest","team","write","/mycli locate nearest","追踪同世界最近队友","同世界有可见非旁观队友","BossBar 方向和距离");
        add(specs,"locate.off","team","write","/mycli locate off","停止追踪队友","在线玩家","停止结果");
        add(specs,"locate.tp","team","teleport","/mycli locate tp <玩家名|nearest>","安全传送到队友附近","队友在线可见；8 魔力、20 秒冷却；有安全落点","成功后 MC_TRAVEL 与绝对坐标；失败不扣费");
        add(specs,"arena.status","adventure","read","/mycli arena status","查看本人参赛身份、试炼进度、倒地队友坐标及救援进度","在线玩家；队友4格内停留10秒或本层清场可自动复活","MC_DUNGEON status 与 MC_TRIAL_RESCUE_STATE；downed 时等待救援，不自动退出");
        add(specs,"dungeon.list","adventure","read","/mycli dungeon list|info <ID>|status [ID]","发现不同地点的建筑地下城、真实房间坐标与本人进度","只读免费；info 指明首室深度和逐室路线","私有 MC_SITE_DUNGEON_LIST/ITEM/INFO/STATE JSON，schemaVersion=1");
        add(specs,"dungeon.travel","adventure","teleport","/mycli dungeon travel <ID>","前往已勘察的入口或外围；沿建筑道路深入首室","8魔力、基础传送资格；不能在试炼/PvP/另一地下城内使用","沿用 MC_TRAVEL 成功回执；抵达入口不计完成");
        add(specs,"dungeon.start","adventure","write","/mycli dungeon start <ID> [normal|adventure|apocalypse]","在真实建筑首室发起挑战，其他地点可同时开队","生存角色亲自到首室，未参加其他活动；10秒集结、每队最多8人","MC_SITE_DUNGEON_RESULT；逐室清怪、返回首室才登记奖励；无自动免费位移");
        add(specs,"dungeon.join","adventure","write","/mycli dungeon join <ID>","主动加入该处正在集结的队伍","亲自站在首室，发起后10秒内加入，未参加其他活动","MC_SITE_DUNGEON_RESULT；每室清场须在场，最后返回首室");
        add(specs,"dungeon.leave","adventure","write","/mycli dungeon leave","退出自己的遗迹挑战，留在原地","只影响本人；未登记的奖励不发放","MC_SITE_DUNGEON_RESULT；队伍空后清理该队标记怪");
        add(specs,"dungeon.resume","adventure","write","/mycli dungeon resume","在存储或房间出怪问题解决后重试暂停的挑战","须为该队成员；失败不清场、不发奖、不自动连续刷怪","MC_SITE_DUNGEON_RESULT；status 的 fault 说明暂停原因");
        add(specs,"dungeon.claim","adventure","item","/mycli dungeon claim [ID]","把完整探索凭据结算到个人奖励箱","每处上海日期每日奖励一次；队列满保留凭据，可重试","MC_SITE_DUNGEON_RESULT success/reason；结算与去重在同一原子配置写入");
        add(specs,"dungeon.menu","adventure","gui","/mycli dungeon menu","选择不同地点的地下城、路线、难度和组队","Java/基岩共用原版箱式菜单；地点罗盘有入口","普通箱式菜单；点击详情不会自动开始或传送");
        add(specs,"pvp.status","adventure","read","/mycli pvp status","本人积分、胜负、匹配及对手状态和大厅绝对坐标","在线玩家","本人 MC_PVP JSON");
        add(specs,"pvp.join","adventure","write","/mycli pvp join","传送入场并匹配；第二人加入后自动倒数","非旁观者、未在试炼中；6 魔力；原物品先安全暂存","本人 MC_PVP action=join 与成功后 MC_TRAVEL");
        add(specs,"pvp.leave","adventure","write","/mycli pvp leave","退出排队或认输；还原原物品与位置","已排队或正在比赛","本人 MC_PVP 与 MC_PVP_RESULT");
        add(specs,"pvp.lobby","adventure","teleport","/mycli pvp lobby","前往天空竞技场观众平台","竞技场已建；比赛中不可用；6 魔力","本人 MC_PVP、MC_TRAVEL 与大厅绝对坐标");
        add(specs,"pvp.board","adventure","read","/mycli pvp board","查看积分榜","在线玩家","私人 MC_PVP_RANK 列表");
        add(specs,"arena.start","adventure","write","/mycli arena start","与入口按钮附近队友一起开始试炼；组队全员倒地才失败撤离","在入口且符合组队/冷却条件；队友靠近4格停留10秒或清场可复活倒地者","挑战开始或拒绝原因；倒地回执 MC_TRIAL_RESCUE");
        add(specs,"arena.entrance","adventure","read","/mycli arena entrance","查看试炼塔普通、冒险、末日三个实体按钮的世界坐标及确认开场规则","在线玩家；查询免费，不传送、不选择或启动挑战","私有 MC_TRIAL_BUTTONS JSON，含三个按钮、ready与confirmationRequired");
        add(specs,"arena.difficulty","adventure","write","/mycli arena difficulty [auto|normal|adventure|apocalypse]","按冒险者公会等级自动匹配，或手动选择下次本人发起试炼的难度；高等级打低难度奖励减少","在线玩家；多人由按钮发起者决定，奖励按各自等级结算","私有 MC_DUNGEON_DIFFICULTY 回执，含推荐档位与选择模式");
        add(specs,"arena.rest","adventure","teleport","/mycli arena rest","从远处直达深层驿站并继续挑战","满足驿站解锁与挑战条件；每名入场者 8 魔力","成功后 MC_TRAVEL 或拒绝原因");
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
        add(specs,"arena.rewards","storage","gui","/mycli arena rewards","打开本人个人奖励箱","远程开启 2 魔力；站在实体箱旁免费","原版箱子菜单与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.rewards.list","storage","read","/mycli arena rewards list","列出箱满后尚未入箱的奖励","在线玩家","MC_REWARD、MC_REWARD_SUMMARY");
        add(specs,"arena.rewards.take","storage","item","/mycli arena rewards take <0–7|9–17|all>","领取尚未入箱的奖励；箱内物品用 stash take","背包有空位；远程成功领取 2 魔力，实体箱旁免费","领取结果与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.stash","storage","gui","/mycli arena stash","打开本人第一页54格双箱；10页共540格；支持原版箱子操作","远程开启 2 魔力；站在实体箱旁免费","原版箱子菜单与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.stash.pages","storage","gui","/mycli arena stash pages","原版菜单选择10页个人箱","每页54格；远程开页2魔力","原版分页选择菜单");
        add(specs,"arena.stash.page","storage","gui","/mycli arena stash page <1–10>","打开个人箱指定页","原槽位1–54保留，全局最大540","原版54格箱子");
        add(specs,"commission","adventure","read","/mycli commission list|mine|info <ID>|menu","查看玩家委托和本人履历","报酬使用现有绿宝石余额；每单一位接单者","MC_COMMISSION_LIST / MC_COMMISSION");
        add(specs,"commission.publish","adventure","write","/mycli commission publish delivery <物品ID> <数量> <报酬> <标题>；hunt <怪物ID> <数量> <报酬> <标题>；explore <维度> <报酬> <标题>；structure <结构ID> <报酬> <标题>","托管实际绿宝石余额并发布物资或同行委托","生存；余额足够；物资只收普通物品；结伴需发布者32格内同行","MC_COMMISSION_RESULT / MC_COMMISSION");
        add(specs,"commission.accept","adventure","write","/mycli commission accept <ID>","接取一张玩家委托","不能自己接自己的；同时最多承接一单，与公会槽位独立","MC_COMMISSION_RESULT");
        add(specs,"commission.claim","adventure","write","/mycli commission claim [ID]","真实交付物资或验收战斗/探索，领取已托管报酬","收购扣实际普通物品；探索须路线证据及返程；防重复结算","MC_COMMISSION_RESULT");
        add(specs,"commission.abandon","adventure","write","/mycli commission abandon [ID]","放弃接单，委托重新开放","不领取报酬；交付处理中禁止放弃","MC_COMMISSION_RESULT");
        add(specs,"commission.cancel","adventure","write","/mycli commission cancel <ID>","撤回本人未接委托并退回托管余额","有人接单后不能单方面撤回","MC_COMMISSION_RESULT");
        add(specs,"arena.stash.inventory","storage","read","/mycli arena stash inventory","列出本人背包槽位 0–35","在线玩家","MC_INVENTORY、MC_INVENTORY_SUMMARY");
        add(specs,"arena.stash.list","storage","read","/mycli arena stash list [1–10页码]","分页列出全局1–540槽位，默认第一页","在线玩家","MC_STASH、MC_STASH_SUMMARY");
        add(specs,"arena.stash.put","storage","item","/mycli arena stash put <英文物品ID> <1–64>","按物品类型从背包存入个人箱","背包有该物品；箱有空位；远程成功存入 2 魔力","MC_STASH_PUT moved 数量与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.stash.putslot","storage","item","/mycli arena stash putslot <背包槽位0–35> <1–64>","按精确背包槽存入；保留附魔与自定义物品","背包槽有物品；箱有空位；远程成功存入 2 魔力","MC_STASH_PUT moved 数量与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.stash.take","storage","item","/mycli arena stash take <箱槽位1–540> [1–64]","从个人箱取到本人背包","箱槽有物品；背包有空位；远程成功取出 2 魔力","MC_STASH_TAKE moved 数量与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.leave","adventure","teleport","/mycli arena leave","退出试炼返回入口","正在试炼区域内","传送或拒绝原因");
        add(specs,"guild.hall","adventure","teleport","/mycli guild hall","前往公会大厅","安全落点可用；6 魔力","成功后 MC_TRAVEL 或失败原因");
        add(specs,"guild.board","adventure","read","/mycli guild board","列出 05:00 更新的今日动态委托与常驻任务 ID","在线玩家","本人任务、声望及 mcagent:board 今日数据");
        add(specs,"guild.engineering","adventure","read","/mycli guild engineering [list|menu|任务ID]","查看可配置的远征、工程和生活任务；market 是同义入口","在线玩家；mcagent:market 单播","MC_MARKET_BOARD / MC_MARKET_DETAIL；repeat 区分每日/本人一次");
        add(specs,"guild.market","adventure","read","/mycli guild market [list|menu|任务ID]","查看千灯纪委托；探索要求真实路线，现有藏宝图/遗迹地图可接寻宝委托","探索见 exploration；寻宝见 mapHunt，不能只到坐标","MC_MARKET_BOARD / MC_MARKET_DETAIL；MC_MARKET_SURVEY 记录探索阶段达成");
        add(specs,"guild.map","adventure","read","/mycli guild map","读取主手目标地图或在途寻宝地图的真实标记与返程坐标","藏宝图/探险家/遗迹地图；普通地图无目标则明确拒绝；读取不消耗地图","MC_TREASURE_MAP / MC_TREASURE_TARGET / MC_TREASURE_RETURN；只提供原图X/Z，不揭示藏宝深度，不传送");
        add(specs,"guild.verify","adventure","read","/mycli guild verify","验收本人市场阶段的真实工程、动作、探索或地图寻宝证据","已接单；寻宝需真实探索/新开天然藏宝箱并返接单点；传送不增加路线","MC_MARKET_CHECK 的 ready/progress/reason/evidence；未通过不领奖");
        add(specs,"guild.assessment","adventure","read","/mycli guild assessment","读取本人各类任务的已验收步骤、失败检查和最近任务证据","只读本人记录；耗时含离线","MC_MARKET_ASSESSMENT；不把任务记录当作未测能力");
        add(specs,"guild.menu","adventure","gui","/mycli guild menu","打开原版公会任务面板","在线玩家","原版菜单");
        add(specs,"guild.join","adventure","write","/mycli guild join","注册冒险者公会","非旁观者；已入会时显示状态","入会回执");
        add(specs,"guild.status","adventure","read","/mycli guild status","查看本人公会等级、声望与活动任务","在线玩家","个人状态");
        add(specs,"guild.accept","adventure","write","/mycli guild accept <任务ID>","接取一张公会任务；接单可自动入会；tm_map_hunt绑定主手现有目标地图","满足等级/次数限制；同一时间一单；寻宝同一目的地每人一次，复制图不能重复领奖","任务进度或拒绝原因");
        add(specs,"guild.abandon","adventure","write","/mycli guild abandon","放弃当前公会任务","有活动任务","放弃结果");
        add(specs,"guild.claim","adventure","item","/mycli guild claim","交付已完成任务并结算声望/奖励","活动任务已达成","声望与奖励箱结果");
        add(specs,"guild.rewards","storage","gui","/mycli guild rewards","打开与试炼共用的本人奖励箱","远程开启 2 魔力；实体箱旁免费","原版箱子菜单与远程 MC_STORAGE_MAGIC");
        add(specs,"guild.stash","storage","gui","/mycli guild stash","打开与试炼共用的本人私人箱","远程开启 2 魔力；实体箱旁免费","原版箱子菜单与远程 MC_STORAGE_MAGIC");
        add(specs,"guild.shared","storage","read","/mycli guild shared","门内物品服从当前领地主人；门口四类公共箱及同类扩容箱所有玩家可存取","公会服务区已建成；实体开箱前可用 protect.container 查询；交付自动使用同类空箱","原 MC_GUILD_SHARED 坐标及54格容量；新增 MC_GUILD_SHARED_OVERFLOW 坐标；满仓 MC_GUILD_DELIVERY denied/itemsDebited=false；门内无权操作 MC_GUILD_ACCESS");
        add(specs,"guild.trader","adventure","gui","/mycli guild trader","查看公会接待员坐标；到门口打开购买、回收和任务菜单","公会服务区已建成","MC_GUILD_TRADER 与原版容器菜单");
        add(specs,"guild.travel","adventure","teleport","/mycli guild travel <遗迹ID>","前往已开放地下城遗迹的外围安全点","ID 从公会看板/文档获取；目标可用；8 魔力","成功后 MC_TRAVEL 或拒绝原因");
        add(specs,"life.board","life","read","/mycli life board","查看七类生活公会的每日委托和精确 ID","在线玩家","私人看板文字");
        add(specs,"life.menu","life","gui","/mycli life menu","打开手柄可用的原版生活公会菜单","在线玩家","原版 27 格菜单");
        add(specs,"life.locations","life","read","/mycli life locations","列出四座生活公会建筑、七位职业导师和绝对坐标","建筑已由服主建成","mcagent:life locations；buildingId/contractId/npc/profession/x/y/z");
        add(specs,"life.visit","life","teleport","/mycli life visit <harvest|harbor|workshop|library>","前往生活公会建筑入口，也可以从村庄步行","建筑已开放且入口无阻挡；6 魔力","成功后 MC_TRAVEL 与 MC_DESTINATION，或拒绝原因");
        add(specs,"life.status","life","read","/mycli life status","查看本人七类公会声望及当前任务","在线玩家","mcagent:life status");
        add(specs,"life.accept","life","write","/mycli life accept <任务ID>","领取一项生活委托","非旁观者；无其他进行中生活委托","mcagent:life accept");
        add(specs,"life.claim","life","item","/mycli life claim","交付达成的生活委托","任务进度已满；今日未领取","声望和个人箱奖励、mcagent:life claim");
        add(specs,"life.abandon","life","write","/mycli life abandon","放弃当前生活委托","本人有进行中任务","mcagent:life abandon");
        add(specs,"life.write","life","item","/mycli life write <书名>|<正文>","为 Agent 创建真实署名游记并参与故事公会任务","非旁观者；背包有空格；正文至少40字","背包实体成书、mcagent:life progress");
        add(specs,"village.threat","safety","read","/mycli village threat","查当前村庄外围掠夺者/原版袭击与绝对坐标；有威胁时优先评估支援","在线玩家；未加载区块不保证安全","mcagent:village status；active/source/count/position");
        add(specs,"village.support","travel","cast","/mycli village support [事件ID]","支援传送术：重查警报，直达活敌人附近安全落点","8魔力、20秒冷却；至少3颗心，不在试炼/PvP；旧警报/无敌人/无落点不扣费","MC_VILLAGE_SUPPORT 与 mcagent:village support；success/reason/eventId/position/enemy/spentMana");
        add(specs,"village.villagers","life","read","/mycli village villagers","查附近职业村民的绝对坐标、职业与绿宝石收购报价","同维度96格内已加载村民","mcagent:village villagers");
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

    private static Map<String, Spec> catalogSpecs() {
        Map<String, Spec> specs = new LinkedHashMap<>(SPECS);
        for (SpellGuide.Entry spell : SpellGuide.entries()) {
            String id = "cast." + spell.id();
            specs.putIfAbsent(id, new Spec(id, "magic", "cast", spell.command(), spell.effect(),
                    spell.requires(), "MC_PROFESSION_RESULT、mcagent:event"));
        }
        return specs;
    }

    static List<String> ids() { return catalogSpecs().keySet().stream().sorted().toList(); }

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
        for (Spec spec : catalogSpecs().values()) if (filter.equals("all")
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
        Spec spec = catalogSpecs().get(id);
        if (spec == null && id.startsWith("cast.")) {
            SpellGuide.Entry spell = SpellGuide.find(id);
            if (spell != null) spec = new Spec(id, "magic", "cast", spell.command(), spell.effect(), spell.requires(), "MC_PROFESSION_RESULT、mcagent:event");
        }
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
        if (id.startsWith("cast.")) {
            SpellGuide.Entry spell = SpellGuide.find(id);
            if (spell != null) detail.add("spell", spell.json());
        }
        player.sendMessage("MC_CLI_DETAIL " + detail);
    }

    private static void error(Player player, String code, String hint) {
        JsonObject error = new JsonObject();
        error.addProperty("schemaVersion", 1);
        error.addProperty("code", code);
        error.addProperty("hint", hint);
        error.addProperty("nextAction", hint + "；先 /mycli list 查看准确命令，再 /mycli explain <ID> 核对用法。");
        com.google.gson.JsonArray commands = new com.google.gson.JsonArray(); commands.add("/mycli list"); commands.add("/mycli explain <ID>");
        error.add("nextCommands", commands);
        player.sendMessage("MC_CLI_ERROR " + error);
        player.sendMessage("§e" + error.get("nextAction").getAsString());
    }
}
