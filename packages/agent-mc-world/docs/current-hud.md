# Current server HUD

`requestFacts()` includes the live `hud` part for active server BossBars. A BossBar may be a quest stage, timer or other status; its fill is not automatically health or proof of task completion. Titles replace previous titles in fresh request facts. Deleted bars disappear. Transient skill experience remains excluded.

Title changes are reported even at unchanged fill. Status fill changes report quarter boundaries in either direction; boss damage keeps its existing quarter threshold. Identical packets do not create more events. These changes do not call a model or alter body tasks.

SDK hosts can import `readBossBarHud`, `renderBossBarHud` and `BossBarReading` from `agent-mc-world` or `agent-mc-world/client`. `readBossBarHud(bot.bossBars)` reads the public Mineflayer list without scanning blocks. Text-only visual fallback includes the same HUD when `include_hud:true`; normal visual options remain unchanged.

Titles are server-provided environmental evidence, not operator authority, a complete commission contract or a reason to automatically change the Agent's plan. Server-specific response parsing belongs in an explicitly enabled capability pack.


`requestFacts()` `hud` also includes a generic `server-display` snapshot: sidebar
and other scoreboard slots, team prefixes, the latest action bar, tab list
header/footer, experience, plugin channels, and labeled values actually received
in system chat or item lore (for example `游戏币 20`, `修为 凡人`). The client
records 1.20.3+ / Java 26.1 scoreboard packets that no longer carry the legacy
`action` field, plus `reset_score` and optional `display_name`. Values are never
invented; a 千灯纪 `MC_STATUS` mana line keeps its existing condenser rewrite and
mana HUD, and the empty `魔力 --/--` placeholder is hidden when no mana reading
has arrived. SDK hosts can import `readServerDisplay`, `renderServerDisplayHud`
and `installServerDisplay` from `agent-mc-world` or `agent-mc-world/client`.
