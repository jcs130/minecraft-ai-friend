# Human-pace mining and movement limits

Honest throttles so the agent mines and walks at a normal player's pace. They only *slow the bot down*: rolling budgets, minimum gaps, rest breaks, and capped turn rates. They do not add input noise, spoof identity, or probe a server's detection threshold.

Both blocks live under `worlds.minecraft` (the same object as `host` / `version`). Partial values override the defaults; omitted keys keep the defaults below. Invalid values are rejected (`HumanPaceConfigError`). A typo in a hot-reloaded field keeps the last valid config rather than crashing a dig mid-tick.

The phrase list that counts as a server warning is **configuration data**, not a new core check. Put a server's own chat (for example a timed dig ban, or “自动化模组”) in `warningKeywords` / `warningPattern` / `warningBanPattern`. Do not hardcode a new server's strings into `core/`.

See also `core/mining-limiter.ts` and `core/movement-pace.ts`.

## `worlds.minecraft.miningLimits`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. `false` disables the throttle (and warning back-off). |
| `mineralPerMinute` | `12` | Stone, deepslate, ores and similar, per rolling minute. |
| `mineralPer10Min` | `80` | Same, per rolling 10 minutes. |
| `allPerMinute` | `24` | Every counted block (logs, dirt, sand, …) per minute. Zero-hardness blocks (grass, flowers) are not counted. |
| `allPer10Min` | `160` | Same, per 10 minutes. |
| `mineralGapMs` | `2500` | Minimum gap between two stone/ore dig starts. |
| `anyGapMs` | `1000` | Minimum gap between any two counted digs. |
| `restAfterMs` | `240000` | After this much continuous mining (no pause ≥ `restMs`), rest. |
| `restMs` | `60000` | Length of that rest. |
| `inlineWaitMs` | `8000` | Waits up to this long are waited in place; longer ones become a blocked skill result (`mining budget exhausted, wait Ns`) so the planner can do something else. |
| `hardStopOnWarning` | `true` | After a matched warning, no digging for the rest of the process. |
| `warningPauseMs` | `1200000` | When `hardStopOnWarning` is false, pause this long after a warning (20 min). |
| `warningBanMarginMs` | `300000` | Extra wait after a parsed “N minutes no digging” line. |
| `warningBudgetFactor` | `0.5` | Budget multiplier after the pause/ban, for `warningReducedMs`. |
| `warningReducedMs` | `3600000` | How long the reduced budgets last (1 hour). |
| `warningKeywords` | `反作弊`, `自动挖矿`, `挖矿外挂`, `禁止挖`, `自动化模组`, `外挂` | Substrings; any hit is a warning candidate. JSON may use a string array or a comma/pipe-separated string. The settings UI key is `warningKeywordsCsv` (same value as a string). |
| `warningPattern` | the same terms as a regex | Optional extra regex, *or*ed with the keywords. Empty = keywords only. Kept so older configs that only set a pattern still work. |
| `warningConfirmPattern` | `你\|检测\|禁止\|VL` | A keyword/pattern hit must also match this (case-insensitive) so advertisements that only quote the words are ignored. Empty = no extra filter. |
| `warningBanPattern` | `(\d+)\s*分钟内禁止挖` | First capture group = minutes of a mineral dig ban. Empty = do not parse a timed ban from chat. |

## `worlds.minecraft.movementPace`

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `maxYawDegPerTick` | `24` | Yaw cap per physics tick (~480°/s). A 180° turn takes about 8 ticks instead of a snap. |
| `maxPitchDegPerTick` | `16` | Pitch cap per tick. |
| `moveBeforeRestMs` | `75000` | After this much continuous pathfinding, stand still `restMs`. |
| `restMs` | `6000` | Length of that stand-still. |
| `legGapMs` | `1000` | Pause after reaching one goto before the next leg. |
| `maxLegBlocks` | `96` | Maximum straight-line length of one goto; longer targets must be split. |
| `hardStopOnWarning` | `true` | After a mining-limiter warning, pathfinding stops for the rest of the session. Warning phrases are those in `miningLimits`, not a second list. |

Walking and sprinting speed stay vanilla; there is no extra speed cap.

## DSH / host wiring

In this package's host schema the keys are `worlds.minecraft.miningLimits.*` and `worlds.minecraft.movementPace.*` (all `x-hot`).

A DSH agent profile passes the same objects under `minecraft` (merged into the World config). Example for the 永恒世界 (mcyyy) public server — values equal the defaults, plus one extra keyword from that server's wording. This is data for that server, not a core special case:

```json
{
  "minecraft": {
    "miningLimits": {
      "enabled": true,
      "mineralPerMinute": 12,
      "mineralPer10Min": 80,
      "allPerMinute": 24,
      "allPer10Min": 160,
      "mineralGapMs": 2500,
      "anyGapMs": 1000,
      "restAfterMs": 240000,
      "restMs": 60000,
      "inlineWaitMs": 8000,
      "hardStopOnWarning": true,
      "warningPauseMs": 1200000,
      "warningBanMarginMs": 300000,
      "warningBudgetFactor": 0.5,
      "warningReducedMs": 3600000,
      "warningKeywords": [
        "反作弊",
        "自动挖矿",
        "挖矿外挂",
        "禁止挖",
        "自动化模组",
        "外挂",
        "检测到你疑似"
      ],
      "warningConfirmPattern": "你|检测|禁止|VL",
      "warningBanPattern": "(\\d+)\\s*分钟内禁止挖"
    },
    "movementPace": {
      "enabled": true,
      "maxYawDegPerTick": 24,
      "maxPitchDegPerTick": 16,
      "moveBeforeRestMs": 75000,
      "restMs": 6000,
      "legGapMs": 1000,
      "maxLegBlocks": 96,
      "hardStopOnWarning": true
    }
  }
}
```

To turn either limiter off on a private/creative world, set `enabled` to `false`. To stop after a warning without a session-long hard stop, set `hardStopOnWarning` to `false` (the timed pause and reduced budgets still apply).
