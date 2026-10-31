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
        if((id.startsWith("challenge.")||id.startsWith("tasks")||id.startsWith("archive"))&&!usage.contains("--json"))usage+=" [--json]";
        if (specs.putIfAbsent(id, new Spec(id, category, mode, usage, summary, requires, returns)) != null)
            throw new IllegalStateException("Duplicate /mycli catalog id: " + id);
    }

    private static Map<String, Spec> createSpecs() {
        Map<String, Spec> specs = new LinkedHashMap<>();
        add(specs,"archive","life","read","/mycli archive <动作>","公开日记、公告、照片和真实公会履历；按需查目录","已登录本人；查询不写书、不消耗资源；现有奖励委托仍用commission","私有MC_ARCHIVE；实体书可放箱子/讲台公开阅读");
        add(specs,"archive.status","life","read","/mycli archive status","查档案库是否就绪和下一步","免费只读；不产生写作或摄影证明","MC_ARCHIVE ready/state/nextCommand");
        add(specs,"archive.list","life","read","/mycli archive list [book|photo|notice|event] [--page 页码]","分页查公开作品及本人未公开照片","免费只读；每页最多7项，不输出正文","MC_ARCHIVE items/page/hasNext；info/read看选中作品");
        add(specs,"archive.info","life","read","/mycli archive info <作品UUID> [--version 版本]","查作者、标题、版本与保存状态","免费只读；旧私有照片只对作者开放","MC_ARCHIVE entry；read用原版分页书阅读正文");
        add(specs,"archive.read","life","gui","/mycli archive read <作品UUID> [--version 版本]","打开原版书籍阅读公开正文，不生成物品","免费；Java、基岩和Mineflayer用原版书组件；只改变当前界面","MC_ARCHIVE与原版open_book；不发任务证明");
        add(specs,"archive.create","life","write","/mycli archive create <书名>|<正文> [--request-id 标识]","写公开日记并持久归档，同步官网档案馆","无需书与笔也可数字归档；若有空白书与笔则写成实体书；书名1–32字、正文1–10000字；旁观者只读","先落盘；无书不扣物、不发写作奖励；MC_ARCHIVE durable/printed/id/requestId；同标识重试不重复打印");
        add(specs,"archive.notice","life","write","/mycli archive notice <标题>|<正文> [--request-id 标识]","在公共档案目录发布署名公告并写成书","耗1本空白书与笔；公开正文是作者内容；有奖励的委托仍用commission托管","MC_ARCHIVE与真实书；不会向公屏广播正文或机器回执");
        add(specs,"archive.restore","life","write","/mycli archive restore <作品UUID> [--version 版本] [--request-id 标识]","从数据库恢复遗失书籍的普通副本","耗1本本人空白书与笔；只支持book/notice；保留原作者/版本，不增加写作/照片/任务奖励","MC_ARCHIVE copyId/printed；结果未知先查背包与info，不能盲目重放");
        add(specs,"archive.menu","life","gui","/mycli archive menu [book|photo|notice|event] [--page 页码]","打开公共档案目录，点击作品阅读","免费；浏览不打印、不报名；照片实物仍在原个人奖励箱","原版箱式菜单与MC_ARCHIVE");
        add(specs,"tasks","adventure","read","/mycli tasks <list|info|status|menu|pause|resume>","先探索、再冒险；纯探索远征和已撤下的农耕旧单可暂存","已登录玩家；查看不报名、不选职业、不换任务；查询免费","私有MC_TASKS；接单和交付沿用guild accept/claim，任务进度查tasks status");
        add(specs,"tasks.list","adventure","read","/mycli tasks list [combat|crafting|exploration|supply|engineering|life|all] [--page 页码]","裸list列六条路线；指定路线分页查任务，入门任务优先","免费只读；每页最多7张；beginner只推荐，不限制选其他任务","MC_TASKS type=routes/list；items/page/pages/total/nextCommand");
        add(specs,"tasks.info","adventure","read","/mycli tasks info <任务ID>","查指定委托阶段、怪物/武器条件、奖励与本人可接状态","ID从tasks list取得；在途使用接单快照；超长详情按nextCommand无损续读","MC_TASKS type=info或MC_PAGE完整分片；acceptCommand接单、submitCommand交阶段、statusCommand复查");
        add(specs,"tasks.status","adventure","read","/mycli tasks status","读取本人冒险与生活委托的阶段和下一步","免费只读；不自动刷新验收、释放过期任务或报名","MC_TASKS type=status；全部阶段实际交付后才发最终奖");
        add(specs,"tasks.menu","adventure","gui","/mycli tasks menu [路线|all] [--page 页码]","罗盘同款路线菜单：先选路线、查看详情，再明确接单","原版Java/基岩/Mineflayer可用；浏览不接单，不选职业；公共补给另有按钮","原版菜单与MC_TASKS type=menu；只有接单按钮调用guild accept");
        add(specs,"tasks.pause","adventure","write","/mycli tasks pause","暂存一次性纯探索远征或已撤下的农耕旧单，空出任务槽","免费；只保留一张；先结束本人考试或副本；其他日常、工程和原图不可暂存；完整保留冻结规则、阶段、证据","私有MC_TASKS；durable=true才确认成功；tasks status查看暂存，不能覆盖旧记录");
        add(specs,"tasks.resume","adventure","write","/mycli tasks resume","恢复暂存远征的原阶段","免费；任务槽必须为空且没有进行中的考试；不重接、不发奖、不改变原规则","私有MC_TASKS；tasks status核对原阶段与走查证据；重复调用不重置进度");
        add(specs,"challenge","life","read","/mycli challenge <子命令> [--json]","自愿生活挑战；create报名、start开始、status查进度","查询免费且不报名；生活实测不代表标准化模型排名","私有MC_CHALLENGE；success且durable才算已保存通过");
        add(specs,"challenge.create","life","write","/mycli challenge create <项目ID> [--json]","创建等待场次，冻结规则；尚未开始计时","生存或冒险角色，无在办挑战；免费，使用自己物资","MC_CHALLENGE state=forming；准备后 challenge start；重复创建同项目返回原场次");
        add(specs,"challenge.start","life","write","/mycli challenge start [--json]","队长开始当前场次计时；重复调用不会重置计时","成员齐备、在线存活、窗口关闭、光标为空；物资条件见info","MC_CHALLENGE state=running；旧 start <项目ID> 仍等价create，begin仍等价start");
        add(specs,"challenge.join","life","write","/mycli challenge join <场次UUID> <分工>","本人加入等候队伍；supply用maker或receiver，rescue用partner","本人空闲且角色可参测；不允许替别人报名；菜单可直接选分工","MC_CHALLENGE members；人员齐备后由队长开始");
        add(specs,"challenge.begin","life","write","/mycli challenge begin [--json]","兼容旧入口；等价 challenge start","成员在线存活、窗口关闭、光标为空；物资条件见info","MC_CHALLENGE state=running");
        add(specs,"challenge.cancel","life","write","/mycli challenge cancel","退出本轮团队记录，保留结束原因与已确认步骤","任一参测成员可取消；不会回滚物品、取消公会委托或退出地下城","MC_CHALLENGE state=cancelled；再次报名创建新场次，旧记录保留");
        add(specs,"challenge.status","life","read","/mycli challenge status [场次UUID] [--verbose] [--json]","本人当前或最近场次的简短进度；--verbose展开队伍和缺项","免费只读，不报名；Agent默认只给结构化回执","MC_CHALLENGE；success=true且durable=true才是已保存的完成结果");
        add(specs,"challenge.result","life","read","/mycli challenge result [场次UUID] [--page 页码] [--verbose] [--json]","按需读取本场证据和结束原因","免费只读；其他队伍记录拒绝访问；事件来源为服务器，自动化或LLM身份未经评估","MC_CHALLENGE含items/page/pages/nextCommand；重复读取不消费事件");
        add(specs,"challenge.list","life","read","/mycli challenge list [--page 页码] [--json]","分页列出项目摘要；info查看选中项目的规则","免费只读，不报名；角色、时限和说明用info查看","一条MC_CHALLENGE type=catalog含items，不逐项刷屏");
        add(specs,"challenge.info","life","read","/mycli challenge info <项目ID> [--json]","读取挑战规则、分工、时限与物资条件","免费只读；新场次冻结当前规则，在办场次不随热配置改变","MC_CHALLENGE type=detail；ruleVersion标识规则版本");
        add(specs,"challenge.history","life","read","/mycli challenge history [--page 页码] [--json]","分页读取本人历史摘要，包括取消与中断","免费只读；按场次UUID可继续查旧记录","MC_CHALLENGE type=history含items；result查看选中场次");
        add(specs,"challenge.menu","life","gui","/mycli challenge menu","打开生活挑战的原版菜单，查看说明或自愿加入分工","普通Java和基岩玩家可用；点击报名/开始/取消才改变挑战状态","原版箱式菜单；/mycli challenge status复核");
        add(specs,"intro","info","read","/mycli intro","一屏入门：规则、本人状态、能力目录、我的进度和安全下一步","已登录普通玩家可用；只读，不报名、不接单","MC_INTRO；可用 /mycli 或 /mycli help 进入");
        add(specs,"rules","info","read","/mycli rules [页码]","普通玩家可读的中文服务器规则","已登录玩家，无OP要求，查询免费","MC_RULES page/pages/rules/nextCommand");
        add(specs,"progress","info","read","/mycli progress [all|main|training|guild|challenge|story] [页码]","统一分项查看主线、专项实练、公会委托、认证和生活挑战；缺少条件及下一步","只读；加页码按需返回一页，用nextCommand续读；不加页码保留旧协议","MC_PAGE或兼容MC_PROGRESS；主线graduated、专项done和本轮挑战独立");
        add(specs,"page","info","read","/mycli page <快照ID> [页码]","续读本次连接的完整查询快照，大记录分片可无损拼回","只读；五分钟有效；每人保留最近两个快照；断线后重新查询","MC_PAGE含page/pages/total/snapshotObservedAt/nextCommand；不可把分片当完整任务");
        add(specs,"capabilities","info","read","/mycli capabilities [list [分类|命令|all] [页码]|info <ID>]","零副作用的能力发现；保留旧list/explain兼容入口","目录查询本身不会执行目标命令，也不记学习证明","MC_CLI_LIST、MC_CLI_ITEM、MC_CLI_DETAIL；discoveryReadOnly=true");
        add(specs,"inventory","info","read","/mycli inventory [status|refresh|item <0–35|hand>]","读取服务器本人随身背包与快捷栏，按准确物品名称识别特色道具，refresh同步原版物品栏","仅本人；不含54格大背包、任务物品袋或个人奖励箱；读取全部分页。player_head可能是大背包，须看name/customId/usage","私有 MC_INVENTORY分页，id/baseId是基础材质，name为展示名；MC_ITEM含单件物品名称、服务器标识、用法与说明");
        add(specs,"world","life","read","/mycli world list|menu|npcs|talk <ID> <话>|end|guide start|practice start|status|stop|events|photos","世界生活内容入口：新手实习、开门爬梯实练、村民聊天、世界事件、村民交易和照片展示","查询免费；聊天须在NPC八格内；女神相机无需空地图，开始拍摄默认2魔力，成片自动入个人奖励箱","MC_WORLD JSON及NPC实际答复");
        add(specs,"world.story","life","read","/mycli world story <动作> [--json]","灯火归途：人物、章节与居民支线","自愿开始；查询不报名、不换委托、不选职业；menu为原版界面","私有MC_STORY或MC_PAGE；原任务仍用tasks status");
        add(specs,"world.story.status","life","read","/mycli world story status [--json]","查本人剧情章节、缺项和下一步","免费只读；不推进采样、不保存剧情、不代接单","MC_STORY readOnly=true；旧主线毕业独立");
        add(specs,"world.story.list","life","read","/mycli world story list [chapter|npc|side] [--page 页码] [--json]","按需分页查章节、人物或支线","免费只读；NPC登记位置与实时实体位置明确区分；查询不生成NPC或加载远处区块","私有MC_PAGE；info查看选中ID");
        add(specs,"world.story.info","life","read","/mycli world story info <ID> [--json]","查章节步骤、人物话题或支线关联委托","免费只读；在办章节使用已接受的冻结定义；人物查询不算交谈","MC_STORY或MC_PAGE；返回明确后续命令");
        add(specs,"world.story.start","life","write","/mycli world story start [章节ID] [--json]","自愿开始符合前置的章节","免费；冻结阶段要求；重复开始同章保留原场次；不接公会单、不发物","MC_STORY；保存后确认，status核对");
        add(specs,"world.story.choose","life","write","/mycli world story choose <combat|crafting|exploration|supply|engineering|life> [--json]","选择可随时改选的旅途偏好","免费；不改变战法牧职业，不代接任务，不覆盖在办单","MC_STORY route；tasks list查对应任务");
        add(specs,"world.story.talk","life","write","/mycli world story talk <人物ID> [话题ID] [--json]","与八格内的真实剧情NPC私下交谈","免费；话题由info给出；对话可能记录当前剧情步骤或选择旅途偏好，不能授予战利品或战斗证明","MC_STORY与私有短对话；查询人物请用info");
        add(specs,"world.story.track","life","write","/mycli world story track [on|off] [--json]","开启或关闭本人剧情追踪","免费；只有本人和实际附身Eye看到；有公会任务或副本时避让原进度条","MC_STORY tracking；不取消章节或任务");
        add(specs,"world.story.cancel","life","write","/mycli world story cancel [--json]","主动取消当前剧情章节","免费；当前剧情步骤停止，已完成章节保留；不放弃公会委托或清物品","MC_STORY；再次start会重新接受当前章节定义");
        add(specs,"world.story.menu","life","gui","/mycli world story menu [人物ID]","打开旅途手记或人物原版菜单","查看免费；开始、选择、接单都需明确点击；人物对话需八格内","原版箱式GUI；不要求客户端模组");
        add(specs,"world.list","life","read","/mycli world list [--page 页码] [--json]","分页查看RPG、试炼、遗迹、组队、交易、NPC、摄影、日记、外观与语音入口","每页6项；免费只读，未就绪能力明确标注；不预加载全部玩法规则","MC_WORLD type=catalog；gameplay/page/nextCommand");
        add(specs,"world.board","life","read","/mycli world board [menu]","居民事务：农耕集市、照片展与遗迹调查；查看真实步骤及本人状态","与公会共享任务槽；guild accept接单，每阶段guild claim；最终入个人箱","MC_WORLD type=board；可选45格原版菜单");
        add(specs,"world.shops","life","read","/mycli world shops","查看真实集市商人的位置、农产收购与旅行补给","亲自到场交易，实际消耗原版物品；选中配方还不算成交","MC_WORLD type=shops");
        add(specs,"trade","life","read","/mycli trade menu|list [页]|find <物品> [页]|buy|sell [物品] [页]|info|locate <商人ID>|stop|hall","商旅公会交易板：聚合真实村民/集市商店报价与位置；可查询谁出售或收购物品","只读，查询免费；只含已加载商人，不强制加载区块；报价最多缓存3秒，实际成交窗口为准","私有 MC_TRADE schema=1；原版45格分页菜单；点击报价定位，不远程交易");
        add(specs,"trade.find","life","read","/mycli trade find <中文物品名或ID或附魔名> [页]","搜索交易两侧，包含真实附魔书的附魔等级与物物交换","按消息长度分页，每页最多4条，返回商人ID、成本、结果、位置、售罄状态；缺结果不等于全世界无人出售","MC_TRADE type=offers；buy仅买入物品，sell仅卖出物品，均从玩家视角");
        add(specs,"trade.info","life","read","/mycli trade info <商人ID> [页]","查看指定已加载商人的全部可见交易，最多32项，按消息长度分页","ID来自trade查询；村民显示当前配方参考价，个人折扣以现场窗口为准；Shopkeepers按本人权限读取","MC_TRADE type=offers mode=merchant；costs可能包含两种物品");
        add(specs,"trade.locate","life","read","/mycli trade locate <商人ID>；trade stop；trade hall","定位商人：罗盘和顶部方向每秒跟随位置，步行到场右键成交；hall显示溪畔商栈门牌","不传送、不代购；离开加载范围或死亡会结束定位；会替换本人队友追踪，可重新locate队友","MC_TRADE type=locate|hall；失效给出中文原因与下一步");
        add(specs,"world.menu","life","gui","/mycli world menu","打开Java、基岩和Agent共用的原版生活菜单","在线玩家","27格原版菜单");
        add(specs,"world.npcs","life","read","/mycli world npcs","查看可聊天村民的ID、真实位置和是否在八格内","查询免费；先步行靠近，不自动传送","MC_WORLD type=npcs");
        add(specs,"world.talk","life","chat","/mycli world talk <NPC ID> <话>","与附近村民自然交谈，NPC有独立性格与对话记录","生存角色；NPC八格内；180字内；等待实际答复；对话不替代任务验收","MC_WORLD type=talk status=submitted或denied；NPC实际答复另到达");
        add(specs,"world.end","life","write","/mycli world end","结束村民对话，恢复普通公屏聊天","本人的当前对话","MC_WORLD type=talk status=ended");
        add(specs,"world.guide","life","write","/mycli world guide start|status","新手实习：读技能目录、成功施法、完整交付任选路线委托；旧生活证明保留","主动开始；tasks list看路线，不必种田；失败施法/自称完成不计进度；不代学不花点","MC_WORLD type=guide/guide_progress");
        add(specs,"world.practice","life","write","/mycli world practice start|status|stop","通行实练：亲手打开木门并穿过、沿现有梯子连续爬升3格；不拆墙、不垫方块","自愿报名；生存或冒险模式；本人原生交互与移动；飞行、传送、自称完成不算；没有额外奖励或代操作","MC_WORLD type=practice/practice_progress；真实坐标、时间及原生操作证明；一次通过不表示长期掌握");
        add(specs,"world.events","life","read","/mycli world events","查看WorldEvents当前的试炼集结、遗迹远征与探索活动","查询免费；自愿参加，不自动开场、传送或发奖","MC_WORLD type=events与WorldEvents当前列表");
        add(specs,"photo","life","write","/mycli photo take <名字> [third|first|top] [1|2] [--story <经历>]；status|cancel","拍照可直接附上本人描述，成片与描述保存到同一纪念册并同步官网；个人奖励箱取原片","描述1–400字作者自述，不作为考试证明；默认私有，由主人或管理员公开；无需空地图，开始默认2魔力、每人60秒","MC_PHOTO success表示原片已持久入箱；photo info <名字>查描述；以后可用photo story补写或修改");
        add(specs,"photo.album","life","read","/mycli photo album [页]；photo info <本人照片名|公开作品ID>","旅行纪念册：查询实地照片是否合格、重拍建议、署名与故事","只读，不自动报名或投稿；旧相册仍用 /imageframe list","私有 MC_PHOTO_ALBUM、MC_PHOTO_RECORD；照片质量不能代替走查与返程");
        add(specs,"photo.gallery","life","read","/mycli photo gallery [页]","艺术厅摄影展：查看公开作品、摄影者、地点和作者故事","原版地图菜单及成书，Java/基岩/Agent可读；故事为作者自述","MC_PHOTO_ALBUM、MC_PHOTO_RECORD；slot为空表示等待适合的实体展位");
        add(specs,"photo.title","life","write","/mycli photo title <本人照片名> <题目>","为自己的旅行照片起标题","1至64字普通文字；作者UUID、实际地点和原片不能更改；已投稿作品同步展签","photo info <照片名> 核对结果");
        add(specs,"photo.story","life","write","/mycli photo story <本人照片名> <当地经历>","为自己的照片写下旅行故事","1至400字普通文字；作者自述，不作为考试证明；已投稿作品的故事公开","photo info <照片名> 核对结果");
        add(specs,"photo.exhibit","life","write","/mycli photo exhibit <本人照片名>；photo withdraw <本人照片名>","主动投稿或撤下艺术厅展览，有合适空位自动挂墙","需要本人的合格原片与故事；投稿公开署名、地点和故事，不消耗原地图；展位满进入目录等待","photo info 查询published与slot；withdraw仅撤展，不删除原片和考试证据");
        add(specs,"world.photos","life","read","/mycli world photos","打开女神相机、旅行纪念册与艺术厅摄影展","ImageFrame已启用；automaticCaptureReady表示相机当次是否就绪，false时用photo status查询","MC_WORLD type=photos；相机菜单及当前就绪状态");
        add(specs,"profession","magic","read","/mycli profession status|list|menu|choose <ID>|leave <ID>","选择一个主战职业；list 查看当前开放路线；保留旧技能和成长","生存模式选择；UUID 学习账本；不改背包","MC_PROFESSION / MC_PROFESSION_RESULT");
        add(specs,"profession.status","magic","read","/mycli profession status","查看本人当前职业和准备槽","查询免费","MC_PROFESSION");
        add(specs,"profession.menu","magic","gui","/mycli profession menu","打开原版职业和技能菜单","Java、基岩手柄和 Mineflayer 共用","54 格原版菜单");
        add(specs,"profession.choose","magic","write","/mycli profession choose <ID>","选择职业方向，解锁入门技能的学习资格","生存模式；最多一个主战和两个生活职业；冷却不重置","MC_PROFESSION_RESULT");
        add(specs,"profession.leave","magic","write","/mycli profession leave <ID>","离开职业，取消其技能准备；学习历史保留","本人所选职业","MC_PROFESSION_RESULT");
        add(specs,"visuals","magic","read","/mycli visuals","查看原版技能粒子和播放预算；特效只在成功施法后出现","查询免费；不改变技能资格、耗魔、冷却和实际伤害范围","本人MC_VISUALS JSON；画面不作为命中或验收证据");
        add(specs,"say","life","chat","/mycli say <公开发言>","公开说话并在角色头顶显示短暂文字气泡；普通聊天同样有效","沿用普通聊天的接收者和取消规则；非观战/隐身角色才有气泡；附近24格且视线可达；私聊不显示","原版聊天及TextDisplay；连续发言更新同一个气泡；超长内容气泡省略，完整正文仍在聊天栏");
        add(specs,"bubbles","life","read","/mycli bubbles","查看玩家/NPC文字气泡状态和多人预算","查询免费；NPC私有对白仅本人及当前附身Eye可见；Java、基岩及Agent沿用原客户端","本人MC_BUBBLES JSON；基岩由Geyser转文字标签，外观可能不同；语音功能尚未启用");
        add(specs,"skills","magic","read","/mycli skills list [分类] [页码]|info <ID>|mine|points|learn <ID>|upgrade <ID>","基础与四种战斗职业技能图鉴；list profession 直接查看职业技艺，默认列表有多页","查询免费；学习与升级耗点，施法需要本人资格","MC_SPELL_*、MC_SKILL、MC_SKILL_POINTS、MC_SKILL_ASSESSMENT");
        add(specs,"skills.list","magic","read","/mycli skills list [all|common|profession|warrior|tank|mage|priest] [页码]","分页发现基础和职业技能；如 list priest 查看抚愈、净化、高阶圣愈","查询免费；旧 list <页码> 保留；按 pages 和 MC_SPELL_NEXT 读后续页","MC_SPELL_LIST 含分类/总量/版本，MC_SPELL_ITEM 含效果摘要/职业/详情命令");
        add(specs,"skills.explain","magic","read","/mycli skills explain <ID>","读取法术图鉴说明；逐级数值、技能点和本人条件用 skills info <ID>","查询免费，不执行技能","MC_SPELL_DETAIL");
        add(specs,"skills.mine","magic","read","/mycli skills mine","查看本人新技能、装备、资格、来源和实际能力统计","查询免费；未学技能也显示获取途径","MC_SKILL、MC_SKILL_POINTS 与 MC_SKILL_ASSESSMENT");
        add(specs,"skills.status","magic","read","/mycli skills status [mine|all|技能ID] [页码]","读取本人当前技能资格、实际魔力成本、剩余冷却和已知阻碍","只读，不刷新点数；supported/unlocked/learned/canUseNow分开；未知为null，目标/落点仍由实际施法检查","MC_PAGE；mine默认只列已学及资格未知项；详情用skills info <ID>");
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
        add(specs,"coach","info","read","/mycli coach status|next|guide|lessons|enroll|cancel|menu|later|on|off","本人新手进度；lessons只读，enroll报名特色实练，cancel停止新证明","自动迎新和低频提醒按本人设置；旁观者不参加；暂停提醒不等于取消实练","MC_COACH JSON；原status字段保留，增加onboarding");
        add(specs,"guide","info","read","/mycli guide [start|explore|magic|gear|guild|dungeon|team]","分主题游玩指引；menu 打开手柄菜单","在线玩家","聊天指引或原版菜单");
        add(specs,"status","info","read","/mycli status","本人即时状态：连接标识、观测时间、认证、生命魔力、活动和主线下一步","已登录普通玩家；只读，不刷新任务、不记实练；旧公告不覆盖当前状态，缺认证桥接为unknown","MC_STATUS；更多任务用progress all 1、技能用skills status、物品用inventory status");
        add(specs,"status.full","info","read","/mycli status full","兼容旧版详细状态，附带公会与试炼输出","旧入口可刷新任务和记录已报名实练证明；只读状态用status","旧版个人状态、MC_GUILD、MC_DUNGEON等");
        add(specs,"coach.practice","info","write","/mycli coach practice status","主动读取并记录状态实练证明，普通status查询不会完成实练","先coach enroll；不会报名、施法或花费资源；已有证明不会重复发放","MC_STATUS及MC_COACH type=feature_proof；失败查coach lessons");
        add(specs,"spells","magic","read","/mycli spells list [分类] [页码]|explain <技能ID>","基础及职业技能图鉴；profession/warrior/tank/mage/priest 可直接查战法牧技能","在线玩家；查询不会施法","本人 MC_SPELL_LIST/ITEM/DETAIL JSON");
        add(specs,"mastery","magic","read","/mycli mastery","查看本人法术熟练度与升级门槛","在线玩家","熟练度报告");
        add(specs,"skillbook","magic","item","/mycli skillbook list|use [槽位]","列出或使用实体技艺研习书；也可手持右键","背包有研习书且对应技能未满级","MC_SKILLBOOK 私有回执");
        add(specs,"cast","magic","cast","/mycli cast <技能ID> [参数]","施放生活、战斗或探索法术","本人非旁观者；魔力/学习/冷却由技能检查","技能结果；部分返回 MC_* 坐标");
        add(specs,"focus","magic","item","/mycli focus give|list|menu|bind <技能ID>","领取、查看、配置灵纹法杖","在线玩家；bind 需持有法杖","法杖菜单或绑定回执");
        add(specs,"imprint","magic","item","/mycli imprint [list|技能ID]","给手持工具刻印可用法术","附魔台 4 格内；非创造需 3 级经验和 1 青金石","菜单、可刻印列表或结果");
        add(specs,"compass","item","item","/mycli compass","补领技能罗盘","背包有空位；已有时不重复发放","领取结果");
        add(specs,"book","item","item","/mycli book","补领命格书","背包有空位；已有时不重复发放","领取结果");
        add(specs,"kit","item","item","/mycli kit","补领罗盘和命格书","背包有空位","领取结果");
        add(specs,"menu","item","gui","/mycli menu","打开技能罗盘原版箱子界面","在线玩家","原版菜单");
        add(specs,"protect","safety","read","/mycli protect <break|place|container|use|batch> [参数] [--verbose] [--json]","查询保护权限；多个目标用batch聚合，详情按需展开","同维度、眼睛16格内、已加载；不执行操作、不加载新区块","本人私有结果；deny停止，unknown暂缓，allow_likely仍以真实操作为准");
        add(specs,"protect.batch","safety","read","/mycli protect batch <break|place|container|use> <x,y,z> [x,y,z ...] [--verbose] [--json]","批量聚合保护结果；也可用 --box x1 y1 z1 x2 y2 z2 查询含边界范围","最多64个目标；绝对整数；同维度、眼睛16格内、已加载；重复坐标只查一次","一份MC_PROTECTION_BATCH：counts、groups按精确判定合并，indices为从0开始的闭区间；targets编码box时x最快、再z、再y；不把外包范围当整块禁区；完整规则--verbose，超大详情nextCommand分页");
        add(specs,"goto","travel","teleport","/mycli goto <公共地点ID|arena|guild|personal:名字|shared:分享码>","传送术前往公共、本人或分享地点","安全落点；6 魔力；个人名支持 1–24 位中文字母数字_-；不在活动中","命名地点先返回 MC_WAYPOINT_RESULT status=pending，最终 success/denied；成功 MC_TRAVEL；失败不扣费");
        add(specs,"waypoint","travel","read","/mycli waypoint","只读列出公共、本人命名地点和旧 home","在线玩家；不移动、不扣费","MC_WAYPOINT 绝对坐标和 MC_WAYPOINT_LIST JSON");
        add(specs,"locate","team","read","/mycli locate list|nearest|玩家名|off|tp <玩家名|nearest>","查在线队友绝对坐标、追踪或安全传送","目标在线且非旁观者","MC_PLAYER 绝对坐标或追踪/传送结果");
        add(specs,"arena","adventure","read","/mycli arena status|start|rest|next|shop|rewards|stash|leave","试炼塔按层挑战、商店与本人奖励箱；逐室探索的遗迹地下城另用 /mycli dungeon","玩法动作受位置、队伍、冷却检查","MC_DUNGEON、MC_REWARD、MC_STASH 或菜单");
        add(specs,"dungeon","adventure","read","/mycli dungeon <动作>","遗迹地下城：逐室探索、组队挑战与奖励；试炼塔另用arena","查询免费；传送、参战和领取条件见子命令","私有MC_SITE_DUNGEON回执；status核对真实场次与凭据");
        add(specs,"landmark","travel","read","/mycli landmark <动作>","公共地标：查询建筑安全落点，主人可登记和撤回","查询免费；管理需主人权限；实际传送另耗魔力","MC_LANDMARK回执；不会因查询自动登记或传送");
        add(specs,"pvp","adventure","read","/mycli pvp status|join|leave|lobby|board|menu","自愿参加同款装备一对一竞技场","非旁观者、未在试炼中；两人入队自动开赛","本人 MC_PVP JSON 与 MC_PVP_RESULT");
        add(specs,"guild","adventure","read","/mycli guild board|join|status|accept <ID>|claim|travel <遗迹ID>","公会任务、声望和遗迹远征","本人角色；接单需满足等级与每日限制","个人任务/声望或传送结果");
        add(specs,"life","life","read","/mycli life board|menu|status|locations|accept <ID>|claim|abandon|write <书名>|<正文>","生活公会：种田、烹饪、钓鱼、建筑、写书、红石机关和村民收购","本人非旁观者；每日每任务一次","个人提示和 mcagent:life JSON");
        add(specs,"village","safety","query_or_cast","/mycli village threat|support [事件ID]|villagers","查实时敌情、施放支援传送术、查村民收购报价","查询免费；支援8魔力、20秒冷却，须有已确认的活敌人","本人 mcagent:village JSON；支援返回 MC_VILLAGE_SUPPORT");
        add(specs,"goddess","goddess","read","/mycli goddess skills|learn feather|night|pray <话>","女神技艺和祈愿","学习需满足条件；祈愿需女神在线","技能列表、学习或送达结果");

        add(specs,"protect.break","safety","read","/mycli protect break <x> <y> <z> [--verbose] [--json]","预判能否挖掘；多个目标用protect batch","整数坐标；同维度、16 格内、区块已加载","一份MC_PROTECTION摘要；deny停止，unknown暂缓；原频道完整数据，--verbose展开规则");
        add(specs,"protect.container","safety","read","/mycli protect container <x> <y> <z> [--verbose] [--json]","开箱前查询领地与实体储物权限；公共设施补给可取放","整数坐标；同维度、16格内、已加载；门口公共箱可存取","一份MC_PROTECTION摘要；拒绝按publicCommand找公共箱；--verbose展开规则");
        add(specs,"protect.use","safety","read","/mycli protect use <x> <y> <z> [--verbose] [--json]","使用门、按钮、工作台前查询领地权限","整数坐标；同维度、16格内、已加载","一份MC_PROTECTION摘要；deny停止，unknown暂缓；--verbose展开规则");
        add(specs,"land","safety","query_or_manage","/mycli land here|list|info <ID>|menu；members <ID> [页码]；trust|untrust <ID> <玩家名或UUID>；board <ID>","查看归属、协作者与实体公告牌；主人管理协作者","仅当前主人能授权/撤权；成员不能转授权；其他公共建筑保护仍适用","MC_LAND_INFO/LIST/MEMBERS/GUIDE/MEMBER_RESULT/BOARD");
        add(specs,"land.here","safety","read","/mycli land here","查看当前位置的领地归属和本人可做的操作","在线玩家","MC_LAND_INFO；unclaimed 仍须遵守公共建筑和活动保护");
        add(specs,"land.list","safety","read","/mycli land list [页码]","分页查看已登记领地","每页最多 9 项","MC_LAND_LIST");
        add(specs,"land.info","safety","read","/mycli land info <ID>","查看指定领地的主人、边界和本人权限","领地 ID 稳定；信任按 UUID","MC_LAND_INFO；not_found 表示 ID 不存在");
        add(specs,"land.menu","safety","menu","/mycli land menu","打开原版领地归属菜单，手柄可查看","技能罗盘左上角也可进入","原版 27 格菜单；点击详情不会传送");
        add(specs,"land.members","safety","read","/mycli land members <ID> [页码]","公开查看主人和完整协作者名单，每页9人","所有玩家免费查询；查询不授予权限","MC_LAND_MEMBERS 分页头、MC_LAND_MEMBER 逐人记录");
        add(specs,"land.trust","safety","write","/mycli land trust <ID> <玩家名或UUID>","主人或领地超管授权协作者在这块领地拆建并取放私有物品","当前非观战主人或显式超管；女神OP观战身份可跨领地管理；普通OP/成员不能转授权；已登录完整身份；最多64人","MC_LAND_MEMBER_RESULT；success才生效，unchanged无需重试；含actorUuid/authority，失败说明下一步");
        add(specs,"land.untrust","safety","write","/mycli land untrust <ID> <玩家名或UUID>","主人或领地超管撤销协作者权限并关闭失权的私有箱","可撤销离线成员；不改变主人和公共箱规则；普通成员不能转授权","MC_LAND_MEMBER_RESULT；撤权立即生效并持久保存");
        add(specs,"land.manage","safety","gui","/mycli land manage <ID>","主人或领地超管打开原版协作者管理页","选择玩家后显示权限范围，再确认；其他人可从公告牌查看名单","27格原版菜单，Java/基岩/Agent共用");
        add(specs,"admin.blockaccess.status","safety","read","mycli admin blockaccess status [--json]","查看当前拆建范围策略和精确建设者人数","仅控制台/RCON；不加载区块、不编辑方块；玩家用protect查询本人目标","MC_BLOCK_ACCESS；只读，零游戏内消耗");
        add(specs,"admin.blockaccess.reload","safety","write","mycli admin blockaccess reload [--json]","加载block-access.yml的建设者UUID和保留村庄范围","仅控制台/RCON；完整验证所有世界后保存WorldGuard方块规则；错误保留上一有效配置；不授予OP或库存权限","MC_BLOCK_ACCESS；success才生效；超时先用status查询，零游戏内消耗");
        add(specs,"admin.land.members","safety","read","mycli admin land members <ID>","女神运营工具读取指定领地完整主人和协作者名单","仅控制台/RCON适配；不读取箱内物品；玩家用land members分页","MC_LAND_MEMBERS；只读，不改变权限");
        add(specs,"admin.land.member","safety","write","mycli admin land member trust|untrust <ID> <玩家名或UUID>","女神运营工具以在线女神身份管理指定领地协作者","仅控制台/RCON；必须已核实女神OP观战身份在线；和玩家入口共用持久事务；不接受自由命令或任意操作者","MC_LAND_MEMBER_RESULT；含女神actorUuid和administrator；未知结果先读名单，不盲目重试");
        add(specs,"land.board","safety","read","/mycli land board <ID>","查看实体公告牌位置；走近右键查看主人和协作者","不自动传送；未加载或无安全空位显示待建，不覆盖已有建筑","MC_LAND_BOARD；原版双面上蜡牌，完整名单在原版27格页");
        add(specs,"coach.status","info","read","/mycli coach status","查看本人提醒开关、触发门槛、暂停截止时间、真实入门清单与下一步","在线玩家；查询不代办任务","MC_COACH type=status，含onboarding");
        add(specs,"coach.next","info","read","/mycli coach next","按服务器实际登记、实习与委托账本给出当前一步和可执行命令","在线非观战玩家；不自动接单、学习、施法或领奖","MC_COACH type=next reason=onboarding");
        add(specs,"coach.guide","info","read","/mycli coach guide","阅读玩法介绍、六项入门清单、本人进度与下一步","在线非观战玩家；只读","MC_COACH type=guide reason=onboarding");
        add(specs,"coach.lessons","life","read","/mycli coach lessons","只读查看六项特色实练；查看不再顺便报名","旧报名和证明保留；新报名用coach enroll，停止记录用coach cancel；与主线毕业独立","MC_COACH type=lessons；统一进度用 /mycli progress training");
        add(specs,"coach.enroll","life","write","/mycli coach enroll","主动报名六项特色实练，随后实际操作才记证明","非观战角色；免费；不代学、不自动存取、不重置旧证明","报名文字回执及MC_COACH enrolled=true；/mycli progress training 复查");
        add(specs,"coach.cancel","life","write","/mycli coach cancel","主动停止新的特色实练记录，保留旧证明","本人免费；与暂停提醒coach later和关闭提醒coach off不同","MC_COACH enrolled=false；/mycli progress training 复查");
        add(specs,"coach.menu","info","gui","/mycli coach menu","打开手柄友好的新手页，查看清单并自愿登记、报名或查询技能","点击相应动作才登记/报名；学习技能仍走原耗点确认","原版27格菜单");
        add(specs,"coach.later","info","write","/mycli coach later","暂停本人所有自动提醒，默认30分钟；跨重登保留","仍可主动查询；coach on 可提前恢复","MC_COACH type=status，onboarding.mutedUntil为Unix毫秒");
        add(specs,"coach.on","info","write","/mycli coach on","为本人启用提醒，跨重登保留","在线非旁观玩家","MC_COACH type=status enabled=true");
        add(specs,"coach.off","info","write","/mycli coach off","为本人关闭提醒，跨重登保留","在线玩家","MC_COACH type=status enabled=false");
        add(specs,"protect.place","safety","read","/mycli protect place <x> <y> <z> [--verbose] [--json]","预判能否放置；多个目标用protect batch","整数坐标；同维度、16 格内、区块已加载","一份MC_PROTECTION摘要；deny停止，unknown暂缓；--verbose展开规则");
        add(specs,"cast.selfheal","magic","cast","/mycli cast selfheal","治疗自己；圣愈术","非旁观者；MagicSpells 魔力与冷却检查","治疗结果与视觉提示");
        add(specs,"spells.list","magic","read","/mycli spells list [分类] [页码]","skills list 的兼容别名；profession/warrior/tank/mage/priest 可直接查职业技能","查询免费；默认 all 多页，旧 list <页码> 保留","MC_SPELL_LIST/ITEM/NEXT");
        add(specs,"spells.explain","magic","read","/mycli spells explain <ID>","skills explain 的兼容别名；各级价格和条件用 skills info <ID>","查询免费，不执行技能","MC_SPELL_DETAIL");
        add(specs,"skillbook.list","magic","read","/mycli skillbook list","列出背包内真实研习书、槽位、技能与可得熟练度","本人在线","MC_SKILLBOOK action=list|summary");
        add(specs,"skillbook.use","magic","item","/mycli skillbook use [背包槽位0–35]","消耗一册研习书增加对应技能熟练度；满级不消耗","本人持有该书且未满 3 级","MC_SKILLBOOK action=use");
        add(specs,"cast.heal","magic","cast","/mycli cast heal","治疗 8 格内所有受伤玩家（含自己）","非旁观者；6 魔力；12 秒冷却；无需瞄准","治疗人数、视觉提示与私有技能事件");
        add(specs,"cast.food","magic","cast","/mycli cast food","恢复饥饿","非旁观者；MagicSpells 魔力与冷却检查","施法结果");
        add(specs,"cast.home","magic","teleport","/mycli cast home","归乡到出生村庄","非旁观者；村庄传送可用；6 魔力","成功后 MC_TRAVEL、技能特效和绝对坐标；失败不扣费");
        add(specs,"cast.blink","magic","cast","/mycli cast blink","瞄准安全落点；未瞄准时向前选最远安全地面","非旁观者；25格内安全落点；统一魔力与原冷却","施法结果");
        add(specs,"cast.give","magic","cast","/mycli cast give <物品名>","造物：固定 8 种即时造出；其他物品申请女神审核","非旁观者；固定配方耗魔力；申请需女神在线","物品或申请送达/拒绝原因");
        add(specs,"cast.fireworks","magic","cast","/mycli cast fireworks","释放观赏烟花","非旁观者；冷却检查","粒子与声音");
        add(specs,"cast.starlight","magic","cast","/mycli cast starlight","释放观赏星尘","非旁观者；冷却检查","粒子与声音");
        add(specs,"cast.starbolt","magic","cast","/mycli cast starbolt","自动锁定怪物；基础 5 伤害，4 魔力、3 秒冷却","非旁观者；射程内有目标","私有命中提示含名称、中文实体类型和 minecraft 实体 ID；粒子");
        add(specs,"cast.frostnova","magic","cast","/mycli cast frostnova","范围冰霜减速；基础 2 伤害，7 魔力、14 秒冷却","非旁观者；魔力与冷却检查","施法结果与粒子");
        add(specs,"cast.flamewave","magic","cast","/mycli cast flamewave","范围火焰；基础 4 伤害，8 魔力、10 秒冷却","非旁观者；魔力与冷却检查","施法结果与粒子");
        add(specs,"cast.prospect","magic","cast","/mycli cast prospect [all|coal|iron|copper|gold|gems|diamond|redstone|ancient]","探查真实矿物；范围随挖矿等级增长","非旁观者；6 魔力、30 秒冷却，附近有矿才扣费","聊天 dimension/X/Y/Z 绝对矿块坐标、从当前位置完整连向矿块且随移动更新的粒子方位线、轮廓或无矿结果；直线不是安全路径");
        add(specs,"cast.leap","magic","cast","/mycli cast leap","跃空并缓降；4 魔力、8 秒冷却","非旁观者；站在地面","位移与视觉提示");
        add(specs,"cast.flight","magic","cast","/mycli cast flight","生存飞行 15 秒；10 魔力、90 秒冷却","非旁观者；技能可用","飞行状态与到期提示");
        add(specs,"cast.golem","magic","cast","/mycli cast golem","召唤守护铁傀儡 45 秒；12 魔力、75 秒冷却","非旁观者；附近有安全落点","召唤结果");
        add(specs,"cast.sense","magic","cast","/mycli cast sense","探敌术（心眼）；探测 24 格已加载怪物；3 魔力、15 秒冷却","非旁观者；无怪时不扣魔力","怪物方向、坐标、从当前位置连向最近活敌人的动态粒子方位线；Java私有轮廓持续8秒；直线不是安全路径");
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
        add(specs,"locate.tp","team","teleport","/mycli locate tp <玩家名|nearest>","队友传送术：安全到伙伴附近，复用罗盘找队友","目标在线可见；8魔力、20秒冷却；有安全落点；双方非副本/PvP参战","成功后 MC_TRAVEL 与绝对坐标；失败不扣费或开始冷却；不代建队/参战");
        add(specs,"arena.status","adventure","read","/mycli arena status [--json|--verbose]","查询当前入场缺项或战斗下一步；默认短文本","每次start从第1层开始，历史通关不自动跳层；清层自动下楼。传送6魔力、开场免费，已解锁驿站rest需8魔力","MC_TRIAL_STATE；显式JSON/verbose兼容MC_DUNGEON status及救援字段");
        add(specs,"dungeon.list","adventure","read","/mycli dungeon list","发现不同地点的建筑地下城与可用挑战入口","只读免费，不加载新区块、不传送或开场","私有MC_SITE_DUNGEON_LIST/ITEM；info查选中地点，status查本人场次");
        add(specs,"dungeon.info","adventure","read","/mycli dungeon info <ID>","查难度、建议等级、装备搭配和当前一步","只读免费；详细路线用--verbose；地点ID从dungeon list读取","默认精炼中文；--json保留原字段并附实时指引，抵达入口不等于进入首室");
        add(specs,"dungeon.status","adventure","read","/mycli dungeon status [ID]","查当前房间、存档点、剩余机会、占用或待领奖","只读免费；active=false只表示尚无活动场次；查询不领奖或开场","默认当前一步及剩余机会；--json含真实状态和凭据；完整旧结果用--verbose");
        add(specs,"dungeon.travel","adventure","teleport","/mycli dungeon travel <ID>","前往已勘察的入口或外围；沿建筑道路深入首室","8魔力、基础传送资格；不能在试炼/PvP/另一地下城内使用","沿用 MC_TRAVEL 成功回执；抵达入口不计完成");
        add(specs,"dungeon.start","adventure","write","/mycli dungeon start <ID> [normal|adventure|apocalypse]","一人在首室开场，遗迹内达标者自动同队；可中途加入和离开","生存模式、穿齐护甲并携带可用武器或职业法器，未参加其他活动；不要求日常组队","MC_SITE_DUNGEON_RESULT；战败回存档点，第三次战败结束；真实参战者通关后均生成个人奖励凭据，无须返程");
        add(specs,"dungeon.join","adventure","write","/mycli dungeon join <ID>","兼容入口：确认加入当前挑战；正常进入遗迹即自动加入","同地点、装备与职业等级达标；不限开场十秒","MC_SITE_DUNGEON_RESULT；只影响本场，不修改日常队伍；已参战记录离场后保留");
        add(specs,"dungeon.leave","adventure","write","/mycli dungeon leave","退出当前在场参战，留在原地并保留贡献","倒地先等待救援；退出期间不自动加入，离开遗迹再回来即可续接","MC_SITE_DUNGEON_RESULT；同伴通关后，真实参与者仍有待领奖凭据");
        add(specs,"dungeon.resume","adventure","write","/mycli dungeon resume","在存储或房间出怪问题解决后重试暂停的挑战","须为该队成员；失败不清场、不发奖、不自动连续刷怪","MC_SITE_DUNGEON_RESULT；status 的 fault 说明暂停原因");
        add(specs,"dungeon.claim","adventure","item","/mycli dungeon claim [ID]","把通关参战奖励结算到个人奖励箱","每处上海日期每日奖励一次；队列满保留凭据，可重试；无需回首室","MC_SITE_DUNGEON_RESULT success/reason；结算与去重在同一原子配置写入");
        add(specs,"dungeon.menu","adventure","gui","/mycli dungeon menu","选择不同地点的地下城、路线、难度和组队","Java/基岩共用原版箱式菜单；地点罗盘有入口","普通箱式菜单；点击详情不会自动开始或传送");
        add(specs,"pvp.status","adventure","read","/mycli pvp status","本人积分、胜负、匹配及对手状态和大厅绝对坐标","在线玩家","本人 MC_PVP JSON");
        add(specs,"pvp.join","adventure","write","/mycli pvp join","传送入场并匹配；第二人加入后自动倒数","非旁观者、未在试炼中；6 魔力；原物品先安全暂存","本人 MC_PVP action=join 与成功后 MC_TRAVEL");
        add(specs,"pvp.leave","adventure","write","/mycli pvp leave","退出排队或认输；还原原物品与位置","已排队或正在比赛","本人 MC_PVP 与 MC_PVP_RESULT");
        add(specs,"pvp.lobby","adventure","teleport","/mycli pvp lobby","前往天空竞技场观众平台","竞技场已建；比赛中不可用；6 魔力","本人 MC_PVP、MC_TRAVEL 与大厅绝对坐标");
        add(specs,"pvp.board","adventure","read","/mycli pvp board","查看积分榜","在线玩家","私人 MC_PVP_RANK 列表");
        add(specs,"arena.start","adventure","write","/mycli arena start","与入口按钮附近队友一起开始试炼；组队全员倒地才失败撤离","在入口且符合组队/冷却条件；队友靠近4格停留10秒或清场可复活倒地者","挑战开始或拒绝原因；倒地回执 MC_TRIAL_RESCUE");
        add(specs,"arena.entrance","adventure","read","/mycli arena entrance [--json]","查询主世界三个按钮、坐标与准确开场步骤；命令可代替按钮","查询免费；先goto arena（6魔力），伙伴到按钮12格内，一人arena start（免费）","显式JSON返回MC_TRIAL_BUTTONS；未加载区块为未知，不猜入口被拆");
        add(specs,"arena.difficulty","adventure","write","/mycli arena difficulty [auto|normal|adventure|apocalypse]","按冒险者公会等级自动匹配，或手动选择下次本人发起试炼的难度；高等级打低难度奖励减少","在线玩家；多人由按钮发起者决定，奖励按各自等级结算","私有 MC_DUNGEON_DIFFICULTY 回执，含推荐档位与选择模式");
        add(specs,"arena.rest","adventure","teleport","/mycli arena rest","从远处直达深层驿站并继续挑战","满足驿站解锁与挑战条件；每名入场者 8 魔力","成功后 MC_TRAVEL 或拒绝原因");
        add(specs,"arena.next","adventure","write","/mycli arena next","查询自动下楼状态；在驿站可触发 10 秒后出发","挑战进行中；驿站需已清场","倒计时/状态");
        add(specs,"arena.shop","adventure","gui","/mycli arena shop","打开入口或第七层余额商店；旧实体绿宝石交易可用 shop merchant","在试炼入口或第七层驿站","原版菜单或拒绝原因");
        add(specs,"arena.shop.list","storage","read","/mycli arena shop list","列出余额商店的护甲、武器与补给","在线玩家","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.shop.buy","storage","item","/mycli arena shop buy <商品ID> [1–16]","用统一RPG金币购买；商品进入个人箱待领取队列","余额足够且队列有容量","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.wallet","storage","read","/mycli arena wallet","查询本人的统一RPG金币余额","在线玩家","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.loot","adventure","read","/mycli arena loot","查看试炼装备、下一件法术刻印装备及本游戏日已领奖层数","在线玩家","私有 MC_DUNGEON_SET 进度回执");
        add(specs,"arena.layout","adventure","read","/mycli arena layout","读取本人当前战斗房间的绝对中心、范围、奖励箱和地形危险类型","本人正在当前层参赛","私有 MC_DUNGEON_LAYOUT 回执");
        add(specs,"arena.recycle","storage","read","/mycli arena recycle <动作>","查询可回收装备、获取报价，再明确出售","list查询免费；quote生成报价；sell才转移实际物品","MC_ARENA_ECONOMY；按quoteId与实际余额核对");
        add(specs,"arena.recycle.list","storage","read","/mycli arena recycle list","列出本人箱子与背包中可回收装备","在线玩家","私有 MC_ARENA_ECONOMY JSON");
        add(specs,"arena.recycle.quote","storage","read","/mycli arena recycle quote chest|bag <槽位> [数量]","对精确槽位装备获取30秒报价","装备未穿戴且不是专属或任务物品","私有 quoteId、组件与价格");
        add(specs,"arena.recycle.sell","storage","item","/mycli arena recycle sell <quoteId>","按报价回收装备并存入个人余额","报价未过期且完整物品组件未变","私有成交与余额回执");
        add(specs,"arena.rewards","storage","gui","/mycli arena rewards","打开本人个人奖励箱","基础远程存箱已可用；成功远程开页2魔力，实体箱旁免费，无需学习或先传送","原版箱子菜单与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.rewards.list","storage","read","/mycli arena rewards list","只读查看待入箱奖励；首次开箱前及箱满时都可能有","在线玩家","MC_REWARD、MC_REWARD_SUMMARY");
        add(specs,"arena.rewards.take","storage","item","/mycli arena rewards take <0–7|9–17|all>","领取尚未入箱的奖励；箱内物品用 stash take","背包有空位；远程成功领取 2 魔力，实体箱旁免费","领取结果与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.stash","storage","gui","/mycli arena stash","本人540格个人箱；Agent可直接putslot存、list查、take取，无需开界面","基础远程存箱已可用；成功远程开页2魔力，实体箱旁免费，无需学习或先传送","原版箱子菜单与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.stash.pages","storage","gui","/mycli arena stash pages","原版菜单选择10页个人箱","每页54格；无需学习，成功远程开页2魔力","原版分页选择菜单");
        add(specs,"arena.stash.page","storage","gui","/mycli arena stash page <1–10>","打开个人箱指定页","原槽位1–54保留，全局最大540","原版54格箱子");
        add(specs,"commission","adventure","read","/mycli commission list|mine|info <ID>|menu","查看玩家委托和本人履历","报酬使用统一RPG金币；每单一位接单者","MC_COMMISSION_LIST / MC_COMMISSION");
        add(specs,"commission.publish","adventure","write","/mycli commission publish delivery <物品ID> <数量> <报酬> <标题>；hunt <怪物ID> <数量> <报酬> <标题>；explore <维度> <报酬> <标题>；structure <结构ID> <报酬> <标题>","托管实际RPG金币并发布物资或同行委托","生存；余额足够；物资只收普通物品；结伴需发布者32格内同行","MC_COMMISSION_RESULT / MC_COMMISSION");
        add(specs,"commission.accept","adventure","write","/mycli commission accept <ID>","接取一张玩家委托","不能自己接自己的；同时最多承接一单，与公会槽位独立","MC_COMMISSION_RESULT");
        add(specs,"commission.claim","adventure","write","/mycli commission claim [ID]","真实交付物资或验收战斗/探索，领取已托管报酬","收购扣实际普通物品；探索须路线证据及返程；防重复结算","MC_COMMISSION_RESULT");
        add(specs,"commission.abandon","adventure","write","/mycli commission abandon [ID]","放弃接单，委托重新开放","不领取报酬；交付处理中禁止放弃","MC_COMMISSION_RESULT");
        add(specs,"commission.cancel","adventure","write","/mycli commission cancel <ID>","撤回本人未接委托并退回托管余额","有人接单后不能单方面撤回","MC_COMMISSION_RESULT");
        add(specs,"arena.stash.inventory","storage","read","/mycli arena stash inventory","列出本人背包槽位 0–35","在线玩家","MC_INVENTORY、MC_INVENTORY_SUMMARY");
        add(specs,"arena.stash.list","storage","read","/mycli arena stash list [1–10页码]","只查已装入箱格，默认第一页；待入箱奖励另用arena rewards list，开箱后装入","在线玩家","MC_STASH、MC_STASH_SUMMARY");
        add(specs,"arena.stash.put","storage","item","/mycli arena stash put <英文物品ID> <1–64>","按物品类型从背包存入个人箱","背包有该物品；箱有空位；远程成功存入 2 魔力","MC_STASH_PUT moved>0才完成；不先开界面、不传送，空槽或箱满不移动物品");
        add(specs,"arena.stash.putslot","storage","item","/mycli arena stash putslot <背包槽位0–35> <1–64>","按背包0–35槽直接远程存入；非绑定装备保留附魔和外观","背包槽有物品；箱有空位；远程成功存入 2 魔力","MC_STASH_PUT moved>0才完成；不先开界面、不传送，空槽或箱满不移动物品");
        add(specs,"arena.stash.take","storage","item","/mycli arena stash take <箱槽位1–540> [1–64]","从个人箱取到本人背包","箱槽有物品；背包有空位；远程成功取出 2 魔力","MC_STASH_TAKE moved 数量与远程 MC_STORAGE_MAGIC");
        add(specs,"arena.leave","adventure","teleport","/mycli arena leave","退出试炼返回入口","正在试炼区域内","传送或拒绝原因");
        add(specs,"guild.hall","adventure","teleport","/mycli guild hall","前往公会大厅","安全落点可用；6 魔力","成功后 MC_TRAVEL 或失败原因");
        add(specs,"guild.board","adventure","read","/mycli guild board","列出 05:00 更新的今日动态委托与常驻任务 ID","在线玩家","本人任务、声望及 mcagent:board 今日数据");
        add(specs,"guild.engineering","adventure","read","/mycli guild engineering [list|menu|任务ID]","查看可配置的远征、工程和生活任务；market 是同义入口","在线玩家；mcagent:market 单播","MC_MARKET_BOARD / MC_MARKET_DETAIL；repeat 区分每日/本人一次");
        add(specs,"guild.market","adventure","read","/mycli guild market [list|menu|任务ID]","查看千灯纪委托；探索要求真实路线，现有藏宝图/遗迹地图可接寻宝委托","探索见 exploration；寻宝见 mapHunt，不能只到坐标","MC_MARKET_BOARD / MC_MARKET_DETAIL；MC_MARKET_SURVEY 记录探索阶段达成");
        add(specs,"guild.map","adventure","read","/mycli guild map","读取主手目标地图或在途寻宝地图的真实标记与返程坐标","藏宝图/探险家/遗迹地图；普通地图无目标则明确拒绝；读取不消耗地图","MC_TREASURE_MAP / MC_TREASURE_TARGET / MC_TREASURE_RETURN；只提供原图X/Z，不揭示藏宝深度，不传送");
        add(specs,"guild.verify","adventure","read","/mycli guild verify","验收本人市场阶段的真实工程、动作、探索或地图寻宝证据","已接单；寻宝需真实探索/新开天然藏宝箱并返接单点；传送不增加路线","MC_MARKET_CHECK 的 ready/progress/reason/evidence；未通过不领奖");
        add(specs,"guild.assessment","adventure","read","/mycli guild assessment","读取本人各类任务的已验收步骤、失败检查和最近任务证据","只读本人记录；耗时含离线","MC_MARKET_ASSESSMENT；不把任务记录当作未测能力");
        add(specs,"guild.exam","adventure","read","/mycli guild exam <动作>","能力认证与晋级考试；查询、报名和交付分开","先查题目与本人状态；start才报名，submit才交付","MC_GUILD_EXAM；专项证书与新手毕业独立");
        add(specs,"guild.exam.supplies","adventure","read","/mycli guild exam supplies <动作>","考试材料：先查询，再明确领取或取回","只读查询免费；claim/take会转移本人的真实材料","MC_GUILD_EXAM；地图和奖励不重复发放");
        add(specs,"guild.exam.list","adventure","read","/mycli guild exam list","查看实操题库、场地开放情况与下一阶晋级缺项","生存角色；先guild join登记","MC_GUILD_EXAM；声望不自动跳段");
        add(specs,"guild.exam.info","adventure","read","/mycli guild exam info <ID>","查看题目、技能与资源准备、航点和验收要求","查询免费；自然前往已勘察起点","MC_GUILD_EXAM，含冻结版本与绝对目标");
        add(specs,"guild.exam.start","adventure","write","/mycli guild exam start <ID>","主动开始一项能力考试；start promotion <ID>参加下一阶晋级","一人一场；学习准备施法由本人操作；只收技能本身魔力","MC_GUILD_EXAM；市场SKILL_ASSESSMENT使用guild claim交付");
        add(specs,"guild.exam.status","adventure","read","/mycli guild exam status [--json]","查本人考试、匹配且可接的委托与准确下一步；区分考证和晋级","只接收本人或实际附身对象；推荐不自动接单","MC_GUILD_EXAM；contractOptions含真实拒绝原因和nextCommand");
        add(specs,"guild.exam.guide","adventure","gui","/mycli guild exam guide [--json]","考试分步指引：准备、接单、实地调查、拍照、返程和交付","普通玩家打开原版菜单；Agent或--json读取步骤，不接单不发奖","MC_GUILD_EXAM；guide.steps/currentContract/supplies，实际冻结要求");
        add(specs,"guild.exam.supplies.list","adventure","read","/mycli guild exam supplies list [--json]","查摄影直接成片规则和可选遗迹探险图","只读；摄影无需空地图；遗迹图每人每目的地一次","MC_GUILD_EXAM type=supplies；本人材料清单");
        add(specs,"guild.exam.supplies.status","adventure","read","/mycli guild exam supplies status [--json]","查询材料发放和目标核验状态","只读不生成地图、不加载目的地区块","MC_GUILD_EXAM；allocation给出个人箱页码/全局槽位/待入箱状态");
        add(specs,"guild.exam.supplies.info","adventure","read","/mycli guild exam supplies info <photo|map> [--json]","查看材料用途与领取条件","photo说明无需空地图、成片自动入个人奖励箱；map是带真实天然遗迹目标的filled_map","MC_GUILD_EXAM；缺项、领取命令及箱子入口");
        add(specs,"guild.exam.supplies.claim","adventure","write","/mycli guild exam supplies claim <photo|map> [--json]","领取考试材料到本人个人箱","在办生存考试；免费；map异步核验已勘察天然结构，绝不新生成地形；箱满入原待领队列","MC_GUILD_EXAM；pending不等于已发，最终allocated及saved=true后再取物");
        add(specs,"guild.exam.supplies.take","adventure","write","/mycli guild exam supplies take <photo|map|all> [--json]","免费将已发考试材料取到本人主背包","仅转移原发放记录中的完整物品；不授予其他个人箱访问、不要求传送术；背包满则保留原处","MC_GUILD_EXAM；taken_into_inventory与saved=true表示实物已取，重复调用不重发");
        add(specs,"guild.exam.submit","adventure","write","/mycli guild exam submit","复核并交付本场实操，授予证书或下一阶","实际条件齐全；固定场次结算去重；失败不降级","MC_GUILD_EXAM；不额外赠声望、技能点或物品");
        add(specs,"guild.exam.cancel","adventure","write","/mycli guild exam cancel","主动取消独立考试；市场阶段中断后用exam retry从本阶段重试","已花技能魔力/冷却保留；市场放弃用guild abandon","MC_GUILD_EXAM；旧证书保持");
        add(specs,"guild.certificates","adventure","read","/mycli guild certificates","列出本人已通过的能力证书与18阶冒险者认证","只显示服务器实际验收；未认证不表示不会","MC_GUILD_CERTIFICATES；职业高跃/御空/祝福二三级需要对应基础/进阶证书");
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
        add(specs,"world.guide.start","life","write","/mycli world guide start","主动报名新手三证实习","非观战角色；免费；不代学、不施法、不接单","MC_WORLD type=guide；/mycli progress main 复查");
        add(specs,"world.guide.status","life","read","/mycli world guide status","只读查看新手三证实习","查询不报名；三证实习与整条主线毕业独立","MC_WORLD type=guide；/mycli progress main 可统一查询");
        add(specs,"world.practice.start","life","write","/mycli world practice start","主动报名开门和爬梯的实际通行练习","落地、生存或冒险模式；免费；已有证明保留","MC_WORLD type=practice，实际完成另有practice_progress");
        add(specs,"world.practice.status","life","read","/mycli world practice status","只读查看门、梯子的实际操作证明","查询免费，不报名、不清除证明","MC_WORLD type=practice；/mycli progress training 统一查询");
        add(specs,"world.practice.stop","life","write","/mycli world practice stop","主动停止通行实练，保留已有证明","本人免费","MC_WORLD type=practice active=false");
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
        return catalogSpecs(SpellGuide.entries(),nativeBackend());
    }
    private static boolean nativeBackend(){return org.bukkit.plugin.java.JavaPlugin.getPlugin(AgentFriendPlugin.class).nativeRpg().selected();}
    private static Map<String, Spec> catalogSpecs(List<SpellGuide.Entry> spells) {
        return catalogSpecs(spells,false);
    }
    private static Map<String, Spec> catalogSpecs(List<SpellGuide.Entry> spells,boolean nativeRpg) {
        Map<String, Spec> specs = new LinkedHashMap<>(SPECS);
        if(nativeRpg){
            nativeSpec(specs,"intro","read","/mycli intro","按真实饥饿、职业、装备和任务给一个当前目标","免费只读，不代选职、接取、学习或领奖；物理目标须实际行动，verifyCommand仅核对");
            nativeSpec(specs,"trade.wallet","read","/mycli trade wallet","查Vortex任务金币余额","任务、回收、试炼奖励和商店共用金币；实体绿宝石仍是物品；服务不可用不伪造0余额");
            nativeSpec(specs,"trade.auction","read","/mycli trade auction","查玩家拍卖维护状态：交付故障，暂不能使用","免费只读，未上架、未扣款；不把扣钱或成功台词当作收到物品");
            var trade=specs.get("trade");specs.put(trade.id(),new Spec(trade.id(),trade.category(),trade.mode(),trade.usage()+"；wallet；auction","村民交易报价和位置；wallet查任务金币，auction查维护状态",trade.requires()+"；金币入口只读取本人经济账户",trade.returns()));
            // One discovery tree. Hide retired class/skill actions, not unrelated gameplay.
            specs.keySet().removeIf(id->Set.of("profession","skills","spells","cast").contains(id.split("\\.")[0]));
            nativeSpec(specs,"profession","group","/mycli profession <动作>","职业：list/info 查询，choose 主动选择，status 核对","choose 只选一次，授予本职业初始装备；查询免费");
            nativeSpec(specs,"profession.status","read","/mycli profession status","查本人当前职业","免费只读；不会重选或发装备");
            nativeSpec(specs,"profession.list","read","/mycli profession list","列六职业 ID 与定位","免费只读；先 info 了解，再主动 choose");
            nativeSpec(specs,"profession.info","read","/mycli profession info <ID>","查职业定位与初始技能","免费只读；ID 来自 profession list");
            nativeSpec(specs,"profession.choose","write","/mycli profession choose <ID>","选择职业并保存，领取原生初始装备","需未选职且处于可行动状态；免费；只能选一次");
            nativeSpec(specs,"profession.menu","gui","/mycli profession menu","打开职业菜单，点击选择才变更职业","打开免费；选择后以 profession status 核对");
            nativeSpec(specs,"skills","group","/mycli skills <动作>","技能：list/info 查询，learn 学习，prepare 设置点击技","Vortex管理职业成长和魔力；AuraSkills保留基础熟练度与被动；不再使用旧准备槽和upgrade");
            for(String action:List.of("list","status","points","mine"))nativeSpec(specs,"skills."+action,"read","/mycli skills "+action+(action.equals("list")?" [common|passive]":action.equals("status")?" [ID]":""),action.equals("list")?"查职业技能；common通用生存技，passive基础被动":"查本职可用技能、待学节点与点数","免费只读；list common查通用生存技，list passive查基础熟练度和自动被动；无需为基础成长改职业");
            nativeSpec(specs,"skills.info","read","/mycli skills info <ID>","查目标、效果、等级、费用与冷却","免费只读；主动技能、学习节点和被动天赋分别说明");
            nativeSpec(specs,"skills.tree","read","/mycli skills tree","查本职天赋点、节点与前置条件","免费只读；需要已选职业");
            nativeSpec(specs,"skills.learn","write","/mycli skills learn <节点ID>","学习职业节点或被动天赋并保存","按 skills info 明示的等级、前置与学习点/天赋点扣费；通用技无需学习");
            nativeSpec(specs,"skills.prepare","write","/mycli skills prepare <技能ID>","设置已解锁的武器点击技能","仅已解锁的主动技能；不扣学习点、不施法；被动不能准备");
            nativeSpec(specs,"skills.menu","gui","/mycli skills menu","打开原生技能菜单","打开免费，点击学习按对应节点费用结算");
            nativeSpec(specs,"cast","cast","/mycli cast <技能ID> [参数]","施放技能；先 info 查目标、耗魔和冷却","职业技支持 --json；通用技沿用原回执，prospect 需要矿种等参数；不支持的格式会在执行前拒绝");
            for(String basic:NativeRpg.COMMON_IDS){
                var guide=SpellGuide.find(basic);boolean cast=AgentCommunicationContract.castable(basic,guide.command());
                String requirements=Set.of("night","feather").contains(basic)?"非旁观或倒地；通用技能已可用，无需旧经验等级或炼金门槛。":guide.requires();
                specs.put("cast."+basic,new Spec("cast."+basic,"magic",cast?"cast":basic.equals("team")?"teleport":"read",guide.command(),
                    "基础通用，无需选职或学习；"+(cast?"": "使用所列实际入口，不执行cast；")+guide.effect(),
                    requirements+"；"+guide.costLine()+"；详情skills info "+basic,"核对原效果回执和实际状态；未确认不重放"));
            }
            nativeSpec(specs,"tasks","group","/mycli tasks <动作>","冒险任务：list/info/status 查询，accept 接取，claim 交付","不自动接单；旧路线分类、menu/pause/resume 保持兼容");
            nativeSpec(specs,"tasks.list","read","/mycli tasks list [--page 页码]","分页查原生讨伐、探索与制作任务","每页最多7项，免费只读；旧路线分类另沿原公会任务");
            nativeSpec(specs,"tasks.info","read","/mycli tasks info <ID>","查条件、前置、奖励和接取命令","免费只读；ID 从 list 复制，不猜测任务名");
            nativeSpec(specs,"tasks.status","read","/mycli tasks status [ID] [--page 页码]","查进行中任务的实际缺项及下一步；可聚焦一项","免费只读；指定 ID 时不使用 --page；旧委托查 progress guild");
            nativeSpec(specs,"tasks.accept","write","/mycli tasks accept <ID>","主动接取指定原生任务并保存","按 info 核对等级与前置；不代做目标；超时先查 status，勿重接");
            nativeSpec(specs,"tasks.claim","write","/mycli tasks claim <ID>","满足真实目标后交付并结算奖励","以最终保存与奖励回执为准；待核对时不重复领取");
            nativeSpec(specs,"tasks.abandon","write","/mycli tasks abandon <ID>","主动放弃指定进行中的RPG任务","再次接取重新计数；未领取奖励不发放，已获物品和奖励保留；不退出副本、不回城；超时先查tasks status <ID>，不重复提交");
            nativeSpec(specs,"status","read","/mycli status","查生命、饱食、职业等级、魔力与下一步","免费只读；不代选职业、接任务或领奖");
            nativeSpec(specs,"progress","read","/mycli progress [all|main|training|guild|challenge|story] [页码]","总览RPG任务与冒险；指定分区查原有独立进度","裸 progress 汇总，显式分区保留原分页；专项完成不等于主线毕业");
            for(String id:List.of("arena.stash","arena.stash.pages","arena.stash.page")){
                Spec old=specs.get(id);specs.put(id,new Spec(id,old.category(),old.mode(),old.usage(),old.summary(),"成功远程开页2魔力，实体箱旁免费；通用travel已可用，无需学习；未开箱时不扣费",old.returns()));
            }
            Spec inventory=specs.get("inventory");specs.put("inventory",new Spec("inventory",inventory.category(),inventory.mode(),inventory.usage(),"查随身物品；个人箱、共享补给也从这里找","仅本人；大背包：/minepacks:backpack open；个人箱：/mycli arena stash；共享补给：/mycli guild shared",inventory.returns()));
            nativeSpec(specs,"arena.recycle","group","/mycli arena recycle list|quote bag|chest <槽> [数量]|sell <报价ID>|status","多余武器护甲回收为RPG金币；先报价再确认；不会自动出售","手持、穿戴、绑定/任务/职业法器不回收；石头木头存个人箱；旧试炼余额按1:1迁入同一金币账户");
            nativeSpec(specs,"arena.recycle.sell","item","/mycli arena recycle sell <报价ID>","按30秒有效的原物品报价出售，等待真实金币到账","只执行一次；未知或pending不重发，查arena recycle status并联系服主；金币余额trade wallet");
            nativeSpec(specs,"arena.recycle.status","read","/mycli arena recycle status","查RPG金币服务、余额与待对账回收","只读，不补发金币或物品；arena wallet是同一金币余额的兼容入口");
            nativeSpec(specs,"mastery","read","/mycli mastery","旧熟练度已归档，转查Vortex当前技能状态","基础技能固定可用；职业成长用学习点和天赋：skills status/tree");
            nativeSpec(specs,"skillbook","group","/mycli skillbook list","只读列出保留的旧研习书；use已停用","书不消耗、不再写旧熟练度；升级查询skills status，学习skills learn <ID>");
            nativeSpec(specs,"skillbook.use","read","/mycli skillbook use <槽位>","兼容旧调用并解释迁移；不会消耗书或升级旧技能","基础技能无需研习；职业升级统一Vortex学习点和天赋");
            Spec stashPut=specs.get("arena.stash.putslot");specs.put(stashPut.id(),new Spec(stashPut.id(),stashPut.category(),stashPut.mode(),stashPut.usage(),"按背包精确槽位直接远程存箱，无需先传送或打开GUI","通用travel已可用；成功2魔力；绑定保护保持；按moved和stash list核对",stashPut.returns()));
            Spec shared=specs.get("guild.shared");specs.put(shared.id(),new Spec(shared.id(),shared.category(),shared.mode(),shared.usage(),"查公会共享装备、食物与材料箱坐标，需亲自前往领取",shared.requires(),shared.returns()));
            nativeSpec(specs,"guild.party","group","/mycli guild party [动作]","先status查邀请/成员/集合；create→invite→对方accept才组队，聊天约定不算","复用原Vortex权限；集合可locate tp；会话队伍不代表副本参战，原生重启后须重组");
            nativeSpec(specs,"guild.party.plan","read","/mycli guild party plan <发起者> <伙伴...>","多人组队的本人下一步；四人列四个准确名字，复用同一原生队伍","只读，不代建队/邀请/接受；已在不同队伍时先协商，不自动退队。人数上限由原生管理器执行，名单不是入队证明");
            for(String action:List.of("status","create","invite","accept","decline","leave","disband","kick","menu"))nativeSpec(specs,"guild.party."+action,action.equals("status")?"read":action.equals("menu")?"gui":"write","/mycli guild party "+action+(Set.of("invite","kick").contains(action)?" <在线玩家名>":""),switch(action){case "status"->"查本人队长和成员；无队伍是正常状态";case "create"->"创建原生队伍，不自动邀请或开副本";case "invite"->"邀请在线队友，需对方主动accept";case "accept"->"接受本人有效邀请，不会自动进入副本";case "decline"->"拒绝本人待接受邀请";case "leave"->"退出原生队伍；原副本场次另查status";case "disband"->"队长解散原生队伍";case "kick"->"依原生队伍职权移出在线成员";default->"打开原生组队菜单";},"仅本人；原生组队权限；操作免费，邀请和队伍为会话状态；成功后用guild party status核对");
            return specs;
        }
        for (SpellGuide.Entry spell : spells) {
            String id = "cast." + spell.id();
            specs.putIfAbsent(id, new Spec(id, "magic", "cast", spell.command(), spell.effect(),
                    spell.requires(), "MC_PROFESSION_RESULT、mcagent:event"));
        }
        return specs;
    }
    private static void nativeSpec(Map<String,Spec> specs,String id,String mode,String usage,String summary,String requires){
        specs.put(id,new Spec(id,"adventure",mode,usage+" [--json]",summary,requires,"私有回执；查询确认真实状态，未知结果不自动重放"));
    }

    static List<String> ids() { return catalogSpecs().keySet().stream().sorted().toList(); }
    /** Standard --help/-h discovery never runs the requested gameplay command. */
    static void commandHelp(Player player,String[] args) {
        boolean json=java.util.Arrays.asList(args).contains("--json");
        JsonObject out=helpData(args,SpellGuide.entries(),nativeBackend());
        if(json){stamp(player,out);player.sendMessage("MC_CLI_HELP "+out);return;}
        AgentCliText.help(out).forEach(player::sendMessage);
    }

    /** Pure help generation shares the actual catalog; never emits tutorial or gameplay evidence. */
    static JsonObject helpData(String[] raw) {
        return helpData(raw,SpellGuide.entries());
    }
    static JsonObject helpData(String[] raw,List<SpellGuide.Entry> spells) {
        return helpData(raw,spells,false);
    }
    static JsonObject helpData(String[] raw,List<SpellGuide.Entry> spells,boolean nativeRpg) {
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("readOnly",true);
        try{
            var words=new ArrayList<String>();int page=1;boolean seenPage=false,json=false;
            for(int i=0;i<raw.length;i++){
                String word=raw[i];if(word.equals("--help")||word.equals("-h"))continue;
                if(word.equals("--json")){json=true;continue;}
                if(word.equals("--verbose"))continue;
                if(word.equals("--page")){
                    if(seenPage||++i==raw.length)throw new IllegalArgumentException("--page需要正整数");
                    try{page=Integer.parseInt(raw[i]);}catch(NumberFormatException invalid){throw new IllegalArgumentException("--page需要正整数");}
                    if(page<1)throw new IllegalArgumentException("--page需要正整数");seenPage=true;continue;
                }
                if(word.startsWith("-"))throw new IllegalArgumentException("未知帮助选项 "+word);
                words.add(word.toLowerCase(Locale.ROOT));
            }
            if(nativeRpg&&!words.isEmpty()){
                if(words.getFirst().equals("rpg"))words.removeFirst();
                if(!words.isEmpty())words.set(0,switch(words.getFirst()){case "class","职业"->"profession";case "quests","任务路线"->"tasks";case "spells","技能"->"skills";default->words.getFirst();});
                if(words.size()>1&&words.getFirst().equals("skills"))words.set(1,switch(words.get(1)){case "equip"->"prepare";case "explain"->"info";default->words.get(1);});
                if(words.size()>2&&words.getFirst().equals("guild")&&words.get(1).equals("party"))words.set(2,switch(words.get(2)){case "list","info"->"status";case "join"->"accept";case "gui","open"->"menu";default->words.get(2);});
            }
            Map<String,Spec> specs=catalogSpecs(spells,nativeRpg);String id="";int matched=0;
            for(int count=words.size();count>0;count--){String candidate=String.join(".",words.subList(0,count));if(specs.containsKey(candidate)){id=candidate;matched=count;break;}}
            if(!words.isEmpty()&&id.isEmpty())throw new IllegalArgumentException("未知命令");
            String path=id.isEmpty()?"/mycli":"/mycli "+id.replace('.',' ');
            String prefix=id.isEmpty()?"":id+".";
            Set<String> compatibility=Set.of("help","list","explain","spells","status.full","challenge.begin");
            var children=new LinkedHashMap<String,Spec>();
            for(Spec spec:specs.values()){
                if(!spec.id().startsWith(prefix)||spec.id().equals(id)||compatibility.contains(spec.id()))continue;
                String tail=spec.id().substring(prefix.length());String child=prefix+tail.split("\\.")[0];
                if(!compatibility.contains(child)&&specs.containsKey(child))children.putIfAbsent(child,specs.get(child));
            }
            out.addProperty("path",path);
            if(!children.isEmpty()&&!(id.equals("cast")&&words.size()>matched)){
                // Parameterised leaf commands (e.g. cast heal) are matched above. Unknown
                // subcommands must not silently fall back to a parent help page.
                if(words.size()>matched)throw new IllegalArgumentException("未知子命令；用 "+path+" --help 查看");
                var order=switch(prefix){case ""->nativeRpg?List.of("intro","status","profession","skills","tasks","dungeon","inventory"):List.of("status","tasks","skills","dungeon","profession","inventory","rules");case "dungeon."->List.of("list","info","status","start","join","claim","leave");case "guild."->List.of("status","shared","party","board","exam","stash");case "guild.party."->List.of("status","create","invite","accept","leave","disband","menu");case "arena."->List.of("status","stash","rewards","list","start","join","leave");default->List.of("status","list","info");};
                var list=new ArrayList<>(children.values());
                list.sort(java.util.Comparator.comparingInt((Spec s)->idEmptyPriority(prefix,s.id(),order)).thenComparing(Spec::id));
                int pages=Math.max(1,(list.size()+PAGE_SIZE-1)/PAGE_SIZE);if(page>pages)throw new IllegalArgumentException("页码范围1–"+pages);
                out.addProperty("usage",path+" <命令> [参数]");out.addProperty("page",page);out.addProperty("pages",pages);out.addProperty("total",list.size());
                Spec parent=specs.get(id);if(parent!=null&&parent.mode().equals("gui"))out.addProperty("defaultAction","无子命令时："+parent.summary()+"；"+parent.requires());
                var rows=new com.google.gson.JsonArray();
                list.stream().skip((long)(page-1)*PAGE_SIZE).limit(PAGE_SIZE).forEach(spec->{JsonObject row=new JsonObject();row.addProperty("name",spec.id().substring(prefix.length()));row.addProperty("summary",spec.summary());rows.add(row);});out.add("commands",rows);
                if(page<pages)out.addProperty("nextCommand",path+" --help --page "+(page+1)+(json?" --json":""));
            }else{
                if(page!=1)throw new IllegalArgumentException("具体命令帮助只有1页");Spec spec=specs.get(id);if(spec==null)throw new IllegalArgumentException("未知命令");
                out.addProperty("usage",spec.usage());out.addProperty("summary",spec.summary());JsonObject semantic=semantics(spec);
                if(nativeRpg&&nativeEntry(id))nativeSemantics(spec,semantic);
                for(String key:List.of("operation","parameters","permission","requirements","consumption","resultQuery"))out.add(key,semantic.get(key));
                out.add("actionReadOnly",semantic.get("readOnly"));out.addProperty("jsonSupported",nativeRpg&&nativeEntry(id)||jsonSupported(id));
            }
        }catch(IllegalArgumentException invalid){out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("readOnly",true);out.addProperty("errorCode","INVALID_ARGUMENT");out.addProperty("message",invalid.getMessage());out.addProperty("nextCommand","/mycli --help");}
        return out;
    }
    private static boolean nativeEntry(String id){return Set.of("status","progress","profession","skills","cast","tasks","tasks.list","tasks.info","tasks.status","tasks.accept","tasks.claim","guild.party").contains(id)||id.startsWith("profession.")||id.startsWith("skills.")||id.startsWith("guild.party.");}
    private static void nativeSemantics(Spec spec,JsonObject out){
        boolean read=spec.mode().equals("read");out.addProperty("operation",read?"query":spec.mode().equals("group")?"group":"execute");out.addProperty("readOnly",read);
        var effects=new com.google.gson.JsonArray();effects.add(read?"只读取并发送本人信息，不选职、不接任务、不学习、不消耗资源":spec.mode().equals("group")?"由具体子动作决定，先查子命令帮助":spec.mode().equals("gui")?"只请求打开界面；不代表已选择或学习，点击动作另行结算":"明确执行所请求动作；以最终回执和真实状态核对，未知结果不重放");out.add("sideEffects",effects);
        out.addProperty("consumption",read?"无游戏内资源消耗":spec.requires());
        out.addProperty("resultQuery",spec.id().startsWith("guild.party")?"/mycli guild party status":spec.id().startsWith("tasks")?"/mycli tasks status <ID>":spec.id().startsWith("profession")?"/mycli profession status":spec.id().startsWith("skills")||spec.id().equals("cast")?"/mycli skills status；/mycli skills info <ID>":"/mycli status");
    }
    private static int idEmptyPriority(String prefix,String id,List<String> order){
        String key=prefix.isEmpty()?id:id.substring(prefix.length());
        return order.contains(key)?order.indexOf(key):order.size();
    }
    private static boolean jsonSupported(String id){return (id.startsWith("dungeon")&&!id.equals("dungeon.menu"))||(id.startsWith("world.story")&&!id.endsWith(".menu"))||id.startsWith("admin.blockaccess.")||id.startsWith("archive")||id.startsWith("challenge")||id.startsWith("tasks")||id.equals("status")||id.equals("progress")||id.equals("skills.status")||Set.of("page","capabilities","rules","intro","trade.wallet","trade.auction","world.board","world.list","world.status","arena.status","arena.entrance","coach.next","coach.guide","guild.exam.status","guild.exam.info","guild.exam.guide").contains(id)||id.startsWith("protect")||id.startsWith("guild.exam.supplies.");}

    static void list(Player player, String[] args) {
        list(player,args,true);
    }
    static void list(Player player, String[] args,boolean recordEvidence) {
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
        head.addProperty("discoveryReadOnly",!recordEvidence);
        stamp(player,head);
        player.sendMessage("MC_CLI_LIST " + head);
        for (int index = (page - 1) * PAGE_SIZE; index < Math.min(page * PAGE_SIZE, matches.size()); index++) {
            Spec spec = matches.get(index);
            JsonObject item = new JsonObject();
            item.addProperty("id", spec.id());
            item.addProperty("category", spec.category());
            item.addProperty("mode", spec.mode());
            item.addProperty("summary", spec.summary());
            item.addProperty("operation",currentSemantics(spec).get("operation").getAsString());
            stamp(player,item);
            player.sendMessage("MC_CLI_ITEM " + item);
        }
        if(recordEvidence)org.bukkit.plugin.java.JavaPlugin.getPlugin(AgentFriendPlugin.class).featureTutorials().note(player,"cli_list");
        if (page < pages) player.sendMessage("MC_CLI_NEXT /mycli "+(recordEvidence?"list":"capabilities list")+" " + filter + " " + (page + 1));
    }

    static void explain(Player player, String[] args, int from) {
        explain(player,args,from,true);
    }
    static void explain(Player player, String[] args, int from,boolean recordEvidence) {
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
        detail.addProperty("discoveryReadOnly",!recordEvidence);
        detail.add("semantics",currentSemantics(spec));
        if (id.startsWith("cast.")) {
            SpellGuide.Entry spell = SpellGuide.find(id);
            if (spell != null) detail.add("spell", spell.json());
        }
        stamp(player,detail);player.sendMessage("MC_CLI_DETAIL " + detail);
        if(recordEvidence)org.bukkit.plugin.java.JavaPlugin.getPlugin(AgentFriendPlugin.class).featureTutorials().note(player,"cli_detail");
    }

    private static JsonObject currentSemantics(Spec spec){JsonObject out=semantics(spec);if(nativeBackend()&&nativeEntry(spec.id()))nativeSemantics(spec,out);return out;}
    private static JsonObject semantics(Spec spec) {
        String id=spec.id();boolean mixed=(spec.root()&&Set.of("archive","tasks","challenge","world","photo","profession","skills","spells","coach","arena","dungeon","guild","life","land","landmark","waypoint","locate","commission","goddess","focus","imprint","trade","village","pvp","skillbook").contains(id))
                ||Set.of("world.story","world.guide","world.practice","guild.exam","guild.exam.supplies","guild.stash","guild.rewards","arena.rewards","arena.shop","arena.recycle").contains(id);
        boolean evidence=Set.of("help","list","explain","status.full","skills.list","spells.list","skills.explain","spells.explain").contains(id);
        boolean legacyRefresh=Set.of("guild.board","guild.status","life.status","guild.exam.list","guild.exam.status","skills.mine","skills.info","skills.points","profession.status").contains(id);
        boolean enroll=Set.of("world.story.start","challenge.create","coach.enroll","world.guide.start","world.practice.start","guild.exam.start").contains(id)||id.endsWith(".accept")||id.endsWith(".join");
        boolean cancel=id.endsWith(".cancel")||id.endsWith(".abandon")||id.endsWith(".stop")||id.endsWith(".leave");
        boolean action=Set.of("guild.verify","trade.locate","arena.recycle.quote","world.photos","skills.learnmenu").contains(id);
        String operation=mixed?"group":enroll?"enroll":cancel?"cancel":action?"execute":spec.mode().equals("read")?"query":"execute";
        boolean readOnly=operation.equals("query")&&!evidence&&!legacyRefresh&&!spec.usage().contains("menu");
        JsonObject out=new JsonObject();out.addProperty("operation",operation);out.addProperty("readOnly",readOnly);
        var effects=new com.google.gson.JsonArray();
        effects.add(mixed?"命令组含查询和动作；先查具体子命令，不能把mode=read理解成所有子动作只读":evidence?"旧阅读入口：已报名时可记录阅读/状态实练证明；不自动报名、学习或施法；纯发现用capabilities":legacyRefresh?"旧入口可能刷新验收进度、迁移认证或释放过期任务；纯查询请用 /mycli progress":readOnly?"只读取与发送本人信息，不改变报名、任务、物品或资源":id.equals("guild.verify")?"主动验收并更新本人任务的阶段证据；不直接领奖":id.equals("trade.locate")?"启动/停止本人商人导航或查询大厅；导航会替换当前队友追踪":id.equals("arena.recycle.quote")?"生成短期报价ID并替换本人旧报价；不消耗物品，sell才成交":spec.mode().equals("gui")||spec.mode().equals("menu")||spec.usage().contains("menu")||Set.of("world.photos","skills.learnmenu").contains(id)?"打开或切换原版界面；点击动作按对应权限和资源结算":"主动改变本人状态、物品、技能、位置或消息；按requires和实际结果回执判断");
        out.add("sideEffects",effects);
        out.addProperty("permission",id.startsWith("admin.")?"仅控制台/RCON；普通玩家不可调用；其他身份条件见requirements":id.startsWith("land.trust")||id.startsWith("land.untrust")||id.equals("land.manage")?"当前领地主人或显式领地超管；普通协作者不能转授权":"已登录玩家本人；无通用OP要求，具体角色/模式/资格/区域条件见requirements");
        out.addProperty("requirements",spec.requires());
        out.addProperty("consumption",operation.equals("query")?"无游戏内资源消耗":mixed?"按子动作分别结算；先查对应ID":id.equals("skills.learn")||id.equals("skills.upgrade")?"花对应技能等级的技能点；/mycli skills info <ID> 返回本人当前价格，余额用skills points":Set.of("coach.enroll","coach.cancel","world.guide.start","world.practice.start","world.practice.stop","guild.join","guild.verify","trade.locate","arena.recycle.quote").contains(id)?"无物品、魔力或技能点消耗":spec.requires());
        var parameters=new com.google.gson.JsonArray();var matcher=java.util.regex.Pattern.compile("<([^<>]+)>|\\[([^\\[\\]]+)\\]").matcher(spec.usage());
        while(matcher.find()){JsonObject parameter=new JsonObject();parameter.addProperty("syntax",matcher.group());parameter.addProperty("name",matcher.group(1)!=null?matcher.group(1):matcher.group(2));parameter.addProperty("required",matcher.group(1)!=null);parameters.add(parameter);}
        out.add("parameters",parameters);
        String query=id.startsWith("skills.")||id.startsWith("cast.")||id.startsWith("profession")?"/mycli status；/mycli skills info <ID>；/mycli skills points":id.startsWith("photo")?"/mycli photo status":id.startsWith("inventory")?"/mycli inventory；重新打开对应容器核对":id.startsWith("arena.stash")||id.startsWith("guild.stash")||id.endsWith(".rewards")?"/mycli arena stash list；/mycli arena rewards list；关闭重开容器核对":id.startsWith("arena.recycle")||id.startsWith("arena.shop")||id.equals("arena.wallet")?"/mycli arena wallet；/mycli arena stash list；/mycli inventory":id.startsWith("arena")?"/mycli arena status；/mycli arena loot":id.startsWith("dungeon")?"/mycli dungeon status <ID>":id.startsWith("landmark")?"/mycli landmark info <领地ID>":id.startsWith("land.")||id.startsWith("admin.land")?"/mycli land info <ID>；/mycli land members <ID>":id.startsWith("waypoint")||id.equals("goto")?"/mycli waypoint list；本人最终 MC_TRAVEL/MC_WAYPOINT_RESULT":id.startsWith("trade")?"/mycli trade info <商人ID>":id.startsWith("commission")?"/mycli commission mine":id.startsWith("pvp")?"/mycli pvp status":id.startsWith("village")?"/mycli village threat":"/mycli progress";
        if(id.startsWith("challenge"))query="/mycli challenge status；/mycli challenge result [场次UUID]";
        if(id.startsWith("admin.blockaccess."))query="mycli admin blockaccess status --json";
        if(id.startsWith("protect"))query="原命令重新查询当前权限；详情在原命令后加 --verbose；查询不代表操作完成";
        if(id.startsWith("archive"))query="/mycli archive info <作品UUID>；/mycli archive list；物品操作核对本人背包，结果未知不重放";
        if(id.startsWith("tasks"))query="/mycli tasks status；/mycli progress guild 1";
        if(id.equals("trade.wallet")||id.startsWith("trade.auction"))query="/mycli trade wallet；/mycli inventory；实际拍卖窗口";
        out.addProperty("resultQuery",query);out.addProperty("completionPolicy","命令发出或pending不等于完成；以本人最终回执和实际状态为准。超时/断线结果未知，先查询，不自动重放。");
        return out;
    }

    private static void error(Player player, String code, String hint) {
        JsonObject error = new JsonObject();
        error.addProperty("schemaVersion", 1);
        error.addProperty("code", code);
        error.addProperty("errorCode",code);error.addProperty("retryable",false);
        error.addProperty("hint", hint);
        error.addProperty("nextAction", hint + "；先 /mycli list 查看准确命令，再 /mycli explain <ID> 核对用法。");
        com.google.gson.JsonArray commands = new com.google.gson.JsonArray(); commands.add("/mycli list"); commands.add("/mycli explain <ID>");
        error.add("nextCommands", commands);
        stamp(player,error);player.sendMessage("MC_CLI_ERROR " + error);
        player.sendMessage("§e" + error.get("nextAction").getAsString());
    }
    private static void stamp(Player player,JsonObject data) {
        org.bukkit.plugin.java.JavaPlugin.getPlugin(AgentFriendPlugin.class).communication().stamp(player,data);
    }
}
