package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.List;
import org.bukkit.entity.Player;

/** Player-facing recovery advice; adds fields without changing old result codes or executing commands. */
final class ActionFeedback {
    record Advice(String message, String next, List<String> commands) {
        void add(JsonObject data) {
            data.addProperty("errorMessage", message); data.addProperty("nextAction", next);
            JsonArray values = new JsonArray(); commands.forEach(values::add); data.add("nextCommands", values);
        }
        void send(Player p) { p.sendMessage("§e【操作未完成】" + message); p.sendMessage("§a【正确做法】" + next); }
    }
    private static Advice a(String message, String next, String... commands) { return new Advice(message, next, List.of(commands)); }
    static Advice advice(String scope, String reason, String rawId) {
        String id = rawId != null && rawId.matches("[a-zA-Z0-9_:-]{1,80}") ? rawId : "";
        String skill = id.isEmpty() ? "/mycli skills list" : "/mycli skills info " + id;
        String contract = id.isEmpty() ? "/mycli commission mine" : "/mycli commission info " + id;
        String dungeon = id.isEmpty() ? "/mycli dungeon list" : "/mycli dungeon info " + id;
        String market = id.isEmpty() ? "/mycli guild status" : "/mycli guild market " + id;
        Advice common = switch (reason) {
            case "survival_required", "survival_only", "spectator", "spectator_or_dead", "already_in_activity_or_not_survival" ->
                a("当前角色状态不允许此操作。", "先用 /mycli status 检查角色和活动；倒地请等队友在4格内停留10秒或清完本层，活动请正常退出；观战者请使用对应的生存角色。", "/mycli status");
            case "data_unavailable", "configuration_unavailable", "save_failed", "invalid_configuration", "invalid_ledger", "invalid_delivery_journal", "invalid_wallet", "guide_storage_failed", "escrow_failed", "delivery_inventory_conflict", "state_capacity", "checkpoint_conflict_requires_operator", "definition_changed_checkpoint_preserved", "pending_receipt_capacity", "history_capacity" ->
                a("服务或保存记录暂不可用（" + reason + "）。", "停止重复提交，保留当前物品和记录；将原因码、刚执行的命令和时间告知服主，修复后先查询状态再操作。", "/mycli status");
            case "not_enough_mana", "insufficient_mana", "insufficient_balance", "insufficient_wallet" -> null;
            case "activity_active", "in_activity", "activity_area", "pvp_active", "match_active" ->
                a("正在活动中，当前操作被限制。", "先 /mycli status 确认活动；决定结束时用 /mycli arena leave、/mycli dungeon leave 或 /mycli pvp leave 正常退出，再执行原操作。退出可能结束本场资格。", "/mycli status");
            case "downed" -> a("你已倒地，不能施法或行动。", "请队友到你4格内连续停留10秒，或清完当前层/室；复活后再行动。", "/mycli status");
            default -> null;
        };
        if (common != null) return common;
        return switch (scope) {
            case "skills" -> switch (reason) {
                case "insufficient_points" -> a("可用技能点不足。", "用 /mycli skills points 查看余额、成长门槛和上限；继续成长获得点数，或阅读 /mycli skills respec 的费用后自行决定洗点。", "/mycli skills points", "/mycli skills respec");
                case "nothing_to_refund" -> a("没有实际花费的点数可退。", "用 /mycli skills points 查看支出；旧资格免费保留，选择其他学习或升级目标。", "/mycli skills points", "/mycli skills list");
                case "prerequisite", "locked" -> a("尚未满足该技能的学习条件。", "用 " + skill + " 查本人缺少的等级、任务或事件资格，完成后再学习。", skill);
                case "already_learned" -> a("已经学会此技能。", "用 " + skill + " 查看等级；想升级可自行确认 /mycli skills upgrade " + id + "，会消耗技能点。", skill);
                case "max_level" -> a("该技能已到最高等级。", "用 /mycli skills list 选择其他技能；保留点数也可以，研习书可留给其他未满级技能。", "/mycli skills list");
                case "profession_required" -> a("当前职业与技能不符。", "先用 " + skill + " 查看职业要求，再 /mycli profession list 选择对应方向。", skill, "/mycli profession list");
                case "not_learned" -> a("尚未学会此技能。", "先用 " + skill + " 核对资格与点数；决定学习后执行 /mycli skills learn " + id + "。", skill);
                case "not_prepared" -> a("该职业技能尚未放入准备槽。", "用 /mycli skills prepare " + id + " 准备；若槽满，先在 /mycli skills mine 查明旧技能后自行 unprepare。", "/mycli skills prepare " + id, "/mycli skills mine");
                case "equipment_required" -> a("手持装备不符合技能要求。", "用 " + skill + " 查看武器/工具要求，换好装备后再施法。", skill);
                case "cooldown" -> a("技能仍在冷却。", "按回执 cooldownRemainingMs 等待剩余秒数，再施放一次；反复执行不会缩短冷却。", skill);
                case "insufficient_mana" -> mana();
                case "no_target" -> a("没有有效目标。", "按 " + skill + " 的范围靠近可见目标；治疗需有受伤友军，攻击需有效敌人，再施法。", skill);
                case "protected_target" -> a("目标受保护。", "停止攻击该目标；根据 " + skill + " 选择可攻击的敌对生物，不攻击村民、队友或私产。", skill);
                case "unsafe_path" -> a("路径或落点不安全。", "移到无遮挡的平地，确认脚下有支撑、头顶两格净空后再试，不要拆开受保护建筑。", skill);
                case "prepared_limit" -> a("技能准备槽已满。", "用 /mycli skills mine 查看当前准备项，选一项执行 /mycli skills unprepare <ID>，再准备所需技能。", "/mycli skills mine");
                case "life_limit" -> a("生活职业已达到两个。", "先 /mycli profession status 查看已有职业，决定取舍后 /mycli profession leave <ID>，再选择新职业。", "/mycli profession status");
                case "already_effective" -> a("当前效果已足够。", "继续当前行动，等效果结束或出现实际需要再施法；用 /mycli status 查看状态。", "/mycli status");
                case "unknown_profession" -> a("没有这个职业ID。", "从 /mycli profession list 复制准确ID，再执行 profession choose。", "/mycli profession list");
                case "unknown_skill", "invalid_arguments" -> a("技能ID或参数无效。", "从 /mycli skills list 复制准确ID；用 /mycli help skills 查看学习、升级和准备语法。", "/mycli skills list", "/mycli help skills");
                default -> fallback(reason, skill);
            };
            case "commission" -> switch (reason) {
                case "insufficient_wallet" -> a("绿宝石余额不足以托管报酬。", "用 /mycli arena wallet 查余额；通过试炼或 /mycli arena recycle 回收装备赚取，再按可用余额发布。", "/mycli arena wallet", "/mycli arena recycle list");
                case "plain_items_missing" -> a("交付所需普通物资不足；附魔、命名、绑定物品不计。", "用 " + contract + " 核对物品与数量，把足量普通物品放进本人背包后 claim。", contract);
                case "objective_incomplete" -> a("尚未完成委托条件。", "用 " + contract + " 查看进度和返程位置；讨伐需与发布者同行，探索须实际走查并返回，再 claim。", contract);
                case "self_contract" -> a("不能接自己发布的委托。", "用 /mycli commission list 选择其他玩家的开放委托；自己的单等待别人接。", "/mycli commission list");
                case "not_open", "not_accepted", "unknown_contract" -> a("委托不存在、已结束或当前状态不允许此操作。", "先用 /mycli commission mine 查看自己的单，再从 /mycli commission list 选择仍开放的准确ID。", "/mycli commission mine", "/mycli commission list");
                case "owner_only", "runner_only" -> a("你不是本操作所需的发布者或接单者。", "用 " + contract + " 核对双方身份；撤回由发布者执行，交付/放弃由接单者执行。", contract);
                case "accepted_contract_requires_abandon" -> a("该委托已被接取，发布者不能直接撤回。", "先用 " + contract + " 核对接单者，与其沟通；须由接单者自行 abandon 后，发布者才能 cancel。", contract);
                case "already_accepting_contract" -> a("已有一张在途玩家委托。", "用 /mycli commission mine 查看当前单；完成后 claim，或自行决定 abandon，再接新单。", "/mycli commission mine");
                case "owner_pending_full" -> a("发布者个人奖励待入箱队列已满。", "联系发布者清理 /mycli arena stash 的全部页面，并重新开箱装入队列；腾位后你再交付。", contract);
                case "open_contract_limit" -> a("开放委托已达到全服200张或本人5张上限。", "用 /mycli commission mine 检查，完成或自行撤回不需要的未接单委托，再发布。", "/mycli commission mine");
                case "reward_1_to_100000" -> a("报酬不在允许范围。", "将报酬改为1至100000的整数绿宝石余额，先查钱包，再按发布语法提交。", "/mycli arena wallet", "/mycli help commission");
                case "quantity_1_to_1024" -> a("物资数量无效。", "将物资数量改为1至1024的整数；完整发布示例见 /mycli help commission。", "/mycli help commission");
                case "hostile_type_or_quantity" -> a("讨伐怪物ID或数量不受支持。", "例如选 zombie、skeleton、spider、creeper、witch、pillager、blaze 或 husk；数量1至128，再发布。", "/mycli help commission");
                case "invalid_material" -> a("物品ID无效或不是可交付物品。", "使用原版物品ID（如 minecraft:redstone），不要用中文名或空气；按 /mycli help commission 重新发布。", "/mycli help commission");
                case "invalid_dimension" -> a("探索维度ID无效。", "维度只能填 overworld、nether 或 end，再按完整发布语法提交。", "/mycli help commission");
                case "unknown_structure", "structure_not_supported" -> a("结构ID无效或尚未支持走查。", "选 minecraft:mansion、minecraft:fortress 或 minecraft:end_city 等受支持的大型遗迹；先 /mycli help commission 查用法。", "/mycli help commission");
                case "title_1_to_40_characters" -> a("委托标题无效。", "标题改为1至40个可见字符，不含换行或控制字符，再提交。", "/mycli help commission");
                case "invalid_number", "invalid_page", "invalid_type", "usage_publish" -> a("委托参数格式不正确。", "用 /mycli help commission 核对 delivery/hunt/explore/structure 的参数顺序；数量、报酬和页码使用整数，页码从1开始。", "/mycli help commission");
                case "wallet_capacity" -> a("钱包将超出余额上限。", "用 /mycli arena wallet 查余额，可自行购买需要的装备消耗余额后再操作；不要反复交付。", "/mycli arena wallet", "/mycli arena shop list");
                default -> fallback(reason, "/mycli commission mine");
            };
            case "dungeon" -> switch (reason) {
                case "walk_to_first_room", "party_full_or_not_at_first_room" -> a("未到首室，或队伍已满8人。", "用 " + dungeon + " 核对入口和首室坐标；沿原通道进入首室。加入需在10秒集结期且有空位，否则等下一场。", dungeon);
                case "muster_closed" -> a("本场10秒集结期已关闭。", "用 /mycli dungeon status 查看场次；等本场结束后到首室与队友重新开场，不要强行加入。", "/mycli dungeon status", dungeon);
                case "site_busy" -> a("该地点已有挑战队伍。", "用 /mycli dungeon status 查看，等待结束或从 /mycli dungeon list 选另一处。", "/mycli dungeon status", "/mycli dungeon list");
                case "site_cooldown" -> a("场地处于开场冷却（最长120秒）。", "等待冷却结束，到首室再 start 一次；可先用 " + dungeon + " 查看规则。", dungeon);
                case "claim_previous_reward_first", "no_pending_reward", "specify_dungeon_id" -> a("须先核对本人待领奖的地下城及ID。", "用 /mycli dungeon status 查待领奖记录；有奖励时 /mycli dungeon claim <ID>，没有则先完成挑战并返回首室。", "/mycli dungeon status");
                case "personal_reward_queue_full" -> a("个人奖励队列已满，尚不能装入。", "清出 /mycli arena stash 的页面空位并重新开箱，把待入箱奖励取走，再 dungeon claim；不要丢弃贵重物品腾位。", "/mycli arena stash", "/mycli arena rewards");
                case "not_participating" -> a("你没有参加当前地下城。", "用 /mycli dungeon status 核对；想挑战请先到入口首室并主动 start，或在集结期 join。", "/mycli dungeon status", dungeon);
                case "not_fault_paused" -> a("没有可由你恢复的故障暂停场次。", "先 /mycli dungeon status 查看；正常挑战继续前进，若有保存故障请联系服主，不要重复 resume。", "/mycli dungeon status");
                case "entry_blocked", "room_blocked_clear_floor_and_retry" -> a("入口或房间没有足够安全落脚空间。", "沿原通道步行查看；不要拆受保护建筑。把 " + dungeon + " 的位置与报错告知服主清理落点，再重试。", dungeon);
                case "entry_unavailable", "entry_not_generated", "travel_denied" -> a("入口不可用，或传送的魔力/技能/保护条件不满足。", "先 /mycli status 查魔力，再用 " + dungeon + " 核对入口；可沿原道路前往。入口持续不可用请联系服主。", "/mycli status", dungeon);
                case "player_state_changed" -> a("准备传送时角色移动或活动状态改变。", "先确认已结束其他活动；站稳后只提交一次 travel，并等最终结果。", "/mycli dungeon status");
                case "unknown_dungeon", "unknown_difficulty" -> a("地下城ID或难度无效。", "从 /mycli dungeon list 复制ID；难度填 normal、adventure 或 apocalypse，再 start。", "/mycli dungeon list");
                default -> fallback(reason, dungeon);
            };
            case "economy" -> switch (reason) {
                case "insufficient_balance" -> a("绿宝石余额不足。", "用 /mycli arena wallet 核对余额；完成试炼或回收可回收装备赚取，再购买。", "/mycli arena wallet", "/mycli arena recycle list");
                case "pending_queue_full" -> a("个人箱的待入箱队列已满。", "清理 /mycli arena stash 的全部页面并重新开箱装入待领奖队列，再购买。", "/mycli arena stash", "/mycli arena rewards");
                case "not_recyclable_or_protected" -> a("物品不能回收，或属于绑定/受保护物品。", "用 /mycli arena recycle list 选择服务器列出的可回收装备；保留原物品。", "/mycli arena recycle list");
                case "quote_expired", "quote_unknown_or_consumed", "item_changed" -> a("回收报价已过期、已用过，或物品发生变化。", "先 /mycli arena wallet 核对结算；重新 recycle list 并取得新 quote，确认数量后仅 sell 一次。", "/mycli arena wallet", "/mycli arena recycle list");
                case "wallet_limit" -> a("回收后余额会超过上限。", "先查 /mycli arena wallet，可购买需要的装备消耗余额后再取得新的回收报价。", "/mycli arena wallet", "/mycli arena shop list");
                case "invalid_offer_or_quantity", "usage_shop_list_buy_wallet" -> a("商品ID、购买数量或语法无效。", "先 /mycli arena shop list 复制商品ID；用 /mycli arena shop buy <ID> [数量] 购买。", "/mycli arena shop list");
                default -> a("回收或商店参数不正确（" + reason + "）。", "用 /mycli arena recycle list 查物品槽位；/mycli arena recycle quote bag|chest <槽位> [数量] 获取报价，再 /mycli arena recycle sell <报价ID>；不要凭空猜槽位。", "/mycli arena recycle list", "/mycli help arena.recycle.quote");
            };
            case "pvp" -> switch (reason) {
                case "arena_not_built", "server_pvp_disabled" -> a("竞技场或PvP服务未开放。", "联系服主检查竞技场与PvP配置；现在可选择 /mycli dungeon list 的挑战。", "/mycli pvp status", "/mycli dungeon list");
                case "not_eligible" -> a("当前状态不能排队。", "先 /mycli status 查是否存活、生存模式、处于试炼或物品恢复；结束活动或等待恢复后再 pvp join。", "/mycli status");
                case "already_joined_or_recovery_pending" -> a("已经排队，或原物品仍在恢复。", "用 /mycli pvp status 查状态；已排队请等对手，恢复中请勿改动背包，持续异常联系服主。", "/mycli pvp status");
                case "cursor_item_not_stored" -> a("鼠标光标上还有物品。", "先把光标物品放回本人背包并关闭界面，再 /mycli pvp join。", "/mycli pvp join");
                case "not_participating" -> a("当前没有参加PvP。", "用 /mycli pvp status 查看；要参赛可 pvp lobby 前往后主动 join。", "/mycli pvp status");
                case "insufficient_mana" -> mana();
                case "teleport_failed" -> a("竞技场传送没有完成。", "先 /mycli status 核对魔力与角色状态；站在安全位置再试 pvp lobby，持续失败联系服主。", "/mycli status");
                default -> fallback(reason, "/mycli pvp status");
            };
            case "world" -> switch (reason) {
                case "npc_not_found", "npc_too_far" -> a("居民不存在、未加载或距离超过8格。", "用 /mycli world npcs 查看真实居民ID和坐标，沿路到其8格内，再 /mycli world talk <ID> <内容>。", "/mycli world npcs");
                case "message_too_long", "usage_talk_id_message" -> a("居民对话参数无效。", "用 /mycli world npcs 复制ID；输入 /mycli world talk <ID> <1至180字符内容>，不含换行或控制字符。", "/mycli world npcs");
                case "usage_guide_start_or_status" -> a("新手实习操作无效。", "先 /mycli world guide status 查看进度；决定开始时执行 /mycli world guide start。", "/mycli world guide status");
                case "npcs_unavailable", "photos_unavailable", "events_unavailable", "content_adapter_unavailable" -> a("此项生活服务暂不可用。", "先 /mycli world list 查看仍开放的内容；将报错服务和时间告知服主，恢复后再进入。", "/mycli world list");
                default -> fallback(reason, "/mycli world list");
            };
            case "market" -> switch (reason.split(":", 2)[0]) {
                case "profession_required" -> a("此委托需要指定职业。", "用 " + market + " 核对要求的职业，再 /mycli profession list 查看方向，自己决定是否切换职业。", market, "/mycli profession list");
                case "skill_required" -> a("此委托需要尚未学会的技能。", "用 " + market + " 查所需技能ID，再 skills info <ID> 核对学习条件和费用，学习后接单。", market, "/mycli skills list");
                case "project_completed", "project_reserved", "site_unavailable" -> a("工程已完工、被占用或场地尚未开放。", "用 /mycli guild engineering 查看场地；从 /mycli guild board 另选开放委托，不覆盖他人的工程。", "/mycli guild engineering", "/mycli guild board");
                case "scan_busy", "area_unloaded", "site_changed_during_scan" -> a("验收正在忙、场地未加载或扫描中仍有改动。", "到场加载场地，暂停施工，等本次扫描完成后 /mycli guild verify 再验一次。", "/mycli guild engineering", "/mycli guild verify");
                case "insufficient_road_coverage", "insufficient_new_blocks", "bridge_not_connected", "missing_components", "signal_not_observed" -> a("工程尚未达到验收条件。", "用 " + market + " 核对结构、材料、端点和机关条件；按 MC_MARKET_CHECK.evidence 补齐缺项，红石需实际切换输入，暂停施工后 guild verify。", market, "/mycli guild verify");
                case "action_progress_incomplete", "different_structure_or_world" -> a("实际行动或同一遗迹走查记录尚未满足。", "用 " + market + " 查看条件，再 /mycli guild status 查进度；继续本阶段指定地点的真实探索，完成后返回验收。", market, "/mycli guild status");
                case "protected_site" -> a("工程范围与受保护建筑或私产冲突。", "停止施工，用 /mycli guild engineering 核对批准的场地；请服主另选无冲突场地，不拆现有建筑。", "/mycli guild engineering");
                default -> fallback(reason, market);
            };
            case "support" -> switch (reason) {
                case "stale_event", "no_live_enemy", "confirming" -> a("警报已过期、敌人已消失，或仍在确认。", "用 /mycli village threat 读取当前活敌人与事件ID；有已确认敌人再 village support，不要反复追旧坐标。", "/mycli village threat");
                case "low_health" -> a("生命低于3颗心。", "先用食物自然回血，或有魔力时 /mycli cast heal 治疗；/mycli status 确认生命后再支援。", "/mycli status");
                case "cooldown" -> a("支援传送仍在冷却。", "按 cooldownRemainingMs 等待；结束后先 /mycli village threat 重查活敌人，再发起一次支援。", "/mycli village threat");
                case "no_safe_landing" -> a("敌人附近没有安全落点。", "用 /mycli village threat 查敌人实时位置，可沿正常道路靠近；不要拆受保护建筑或连续强行传送。", "/mycli village threat");
                case "insufficient_mana" -> mana();
                default -> fallback(reason, "/mycli village threat");
            };
            case "waypoint", "landmark" -> switch (reason) {
                case "not_enough_mana" -> mana();
                case "not_found", "share_unavailable", "point_changed", "landmark_unavailable", "land_unavailable" -> a("地点不存在、未公开或已改变。", "重新 /mycli waypoint list 或 /mycli landmark list，复制当前有效的目标；分享已撤回时请联系发现者。", "/mycli waypoint list", "/mycli landmark list");
                case "protected_entry", "protected_exit", "protection_unavailable", "teleport_rejected" -> a("出发点或目的地的权限/安全条件不允许传送。", "先 /mycli land here 核对出发点；用地点列表核对目的地，请主人确认通行权或选择其他公开地点，不拆保护方块。", "/mycli land here", "/mycli waypoint list", "/mycli landmark list");
                case "world_border" -> a("地点位于当前世界边界之外。", "请地点主人在世界边界内的安全平地更新地点，或从列表选择另一个有效目标。", "/mycli waypoint list");
                case "moved", "busy" -> a("等待期间已移动，或已有传送在准备。", "停在原地等当前最终回执；已取消时只重新发起一次 goto，不要同时提交多个传送。", "/mycli status");
                case "not_land_owner" -> a("只有当前领地主人能管理地标。", "用 /mycli land info " + id + " 核对主人；请主人本人到场登记，你可使用已公开地标。", "/mycli land info " + id);
                case "outside_land" -> a("登记地点不在该领地的完整站立空间内。", "用 /mycli land info " + id + " 查边界；主人站入范围，脚下地板和头顶也须在内，再登记。", "/mycli land info " + id);
                case "invalid_name", "name_exists", "limit_reached" -> a("地点名称或数量不符合要求。", "先查本人地点；使用1至24个中文字母数字或_-的不重复名字；更新用 update，数量满时自行删除不用的点。", "/mycli waypoint list", "/mycli help waypoint");
                case "not_standing", "unsafe_landing", "unsafe_height" -> a("落点不安全或角色没有站稳。", "离开载具，停止飞行/滑翔，在有完整支撑和两格净空的平地记录；原点受阻请主人更新，不拆私产。", "/mycli waypoint list");
                case "landmark_not_enabled" -> a("此领地尚未获准成为公共地标。", "用 /mycli land info " + id + " 查来源，将领地ID告知服主核对委托交接及地标配置。", "/mycli land info " + id);
                case "world_unavailable", "chunk_unavailable", "timeout" -> a("目的地世界或区块暂不可用。", "先从列表核对目的地，稍后只重试一次；持续失败联系服主，不反复加载区块。", "/mycli waypoint list");
                default -> fallback(reason, scope.equals("landmark") ? "/mycli landmark list" : "/mycli waypoint list");
            };
            default -> fallback(reason, "/mycli help");
        };
    }
    private static Advice mana() { return a("魔力不足。", "用 /mycli status 查当前魔力和所需费用；先停止耗魔并等待自然恢复，足够后再施放一次。", "/mycli status"); }
    private static Advice fallback(String reason, String query) {
        return a("条件尚未满足（" + reason + "）。", "先用 " + query + " 核对当前状态、准确ID和前置条件；不确定时把原因码与原命令告知服主，不重复提交。", query);
    }
    private ActionFeedback() { }
}
