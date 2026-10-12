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
        for (String ordinary : new String[]{"普通保护提示", "<玩家> MC_PROTECTION {\"allowed\":false}",
                "引用 MC_PROTECTION {}", "MC_PROTECTION {broken", "MC_PROTECTION 普通说明",
                "MC_STATUS []", "MC_STATUS {} trailing", "MC_status {}", "MC_STATUS{\"x\":1}",
                "MC_DUNGEON 这只是说明", "MC_DUNGEON floor=", "引用 MC_PLAYER name=玩家"}) {
            assert !MachineChatReceipts.matches(ordinary) : ordinary;
        }
        assert !MachineChatReceipts.matches(null);
        System.out.println("MachineChatReceipts: 25 assertions passed");
    }
}
