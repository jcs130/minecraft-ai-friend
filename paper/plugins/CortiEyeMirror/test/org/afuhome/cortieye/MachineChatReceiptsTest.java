package org.afuhome.cortieye;

/** Run with assertions enabled; no Minecraft server or player data required. */
public final class MachineChatReceiptsTest {
    public static void main(String[] args) {
        for (String prefix : new String[]{"MC_PROTECTION", "MC_GUILD_ACCESS", "MC_LAND_ACCESS", "MC_PHOTO", "MC_STATUS"}) {
            assert MachineChatReceipts.matches(prefix + " {\"schemaVersion\":1,\"allowed\":false}") : prefix;
        }
        assert MachineChatReceipts.matches("MC_STATUS {\"text\":\"" + "x".repeat(40000) + "\"}") : "large JSON";
        for (String legacy : new String[]{"MC_DUNGEON floor=2 active=true", "MC_PLAYER name=ag_CorMy x=-504",
                "MC_WAYPOINT id=arena x=-560", "MC_TRAVEL id=arena status=success",
                "MC_DUNGEON_AUDIT_END floor=0 count=0", "MC_WORLD type=catalog"}) {
            assert MachineChatReceipts.matches(legacy) : legacy;
        }
        for (String receipt : new String[]{"MC_CLI_NEXT /mycli list all 2", "MC_COACH_ERROR command_unavailable",
                "MC_PROTECTION {broken", "MC_PROTECTION 普通说明", "MC_STATUS []", "MC_STATUS {} trailing",
                "MC_DUNGEON 这只是说明", "MC_DUNGEON floor=", "MC_STATUS", "MC_STATUS\n{\"scope\":\"self\"}",
                "  MC_STATUS {}", "\nMC_CLI_NEXT /mycli list all 2", "§bMC_STATUS§r {}",
                "§x§f§f§0§0§0§0MC_STATUS {}", "[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。"}) {
            assert MachineChatReceipts.matches(receipt) : receipt;
        }
        for (String feedback : new String[]{"§c【操作未执行】拆除方块被保护规则拒绝",
                "§e【保护范围】冒险者公会 X=-513..-500", "【保护查询】可尝试0，拒绝1",
                "【正确做法】私产须主人授权；领公共物资请用 /mycli guild shared。",
                "【操作未完成】技能尚在冷却",
                "【委托未计数】需要使用弓", "【委托进度】2/3", "[生活挑战] 暂无记录", "[公共档案馆] 写入成功",
                "「冒险者公会」保护区 minecraft:overworld X=-513..-500（含边界）；请停止未授权操作。申请授权。"}) {
            assert MachineChatReceipts.matches(feedback) : feedback;
        }
        assert MachineChatReceipts.matches("{\"schemaVersion\":1,\"type\":\"MC_MARKET_CHECK\",\"ready\":false}");
        assert MachineChatReceipts.matches("  {\"type\":\"MC_MARKET_ACTION\",\"schemaVersion\":1,\"nextAction\":\"需主人授权\"}");
        for (String json : new String[]{"{\"type\":\"MC_MARKET_CHECK\"}", "{\"schemaVersion\":1,\"type\":\"npc_speech\"}",
                "{\"schemaVersion\":1,\"type\":\"MC_MARKET_CHECK\"} trailing", "{\"schemaVersion\":1,\"type\":{}}"}) {
            assert !MachineChatReceipts.matches(json) : json;
        }
        for (String ordinary : new String[]{"普通保护提示", "<玩家> MC_PROTECTION {\"allowed\":false}",
                "引用 MC_PROTECTION {}", "MC_status {}", "MC_STATUS{\"x\":1}",
                "引用 MC_PLAYER name=玩家", "[私聊] One → 你: MC_STATUS {}", "[MC_STATUS]说明",
                "§b<玩家>§r MC_STATUS {}", "MC_ 不是有效类型", "[MC_STATUS {}", "MC_STATUS_EXTRA_suffix {}",
                "<ag_One> 【保护范围】你刚才说什么？", "One whispers to you: 【正确做法】先来这里",
                "[提示] 玩家正在求助，申请领地授权", "[危险] 怪物正在攻击", "ag_One 加入了千灯纪"}) {
            assert !MachineChatReceipts.matches(ordinary) : ordinary;
        }
        assert !MachineChatReceipts.matches(null);
        System.out.println("MachineChatReceipts: 61 assertions passed");
    }
}
