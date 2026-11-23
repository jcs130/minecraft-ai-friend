# 橘乡 plugin inventory and known issues

Source: one playtest on 2026-11-23 21:13–21:55 (Asia/Shanghai, UTC+8) as an offline
account, plus a read-only content audit the same evening. `/pl` is denied to players,
so the list comes from `/version`, `/help`, the command tree (27 roots in NanoLimbo,
152 in the lobby, 517–521 on the survival backend) and registered plugin channels.
Versions are those the server printed; anything not listed was not observed.

| Plugin / component | What it does here | Agent impact |
| --- | --- | --- |
| Velocity 1.7.2-26.2 + NanoLimbo | Proxy; auth limbo → lobby → `/main` survival | Explicit 26.2 client (core experimental stack); route in this pack |
| Lophine (Purpur/Paper fork) 26.2 | Backend server | Core |
| MaxAuth | Offline-account `/login` (titles 需要账号验证 / 登录成功) | Core server-login; credential only from the runtime environment |
| Vulcan 2.9.7 | Anti-cheat | Pack clamps pathfinder (no sprint/parkour/dig/pillar); pace + mining limits on; stop on warning |
| Simple Voice Chat 2.6.20 + voicechatproxy | Proximity voice; `voiceHost` is a domain | Core `mc_svc` (native SVC, compat 20); pack opens it only after `/main` |
| CraftEngine 26.9.2 | Custom items/blocks/fonts; forced resource pack | Core MUTF-8 NBT + component evidence; pack accepts the pack and strips glyphs |
| CustomNameplates | Nameplates and chat bubbles (glyph fonts) | Pack strips private-use glyphs |
| TrChat 2.4.9 | Chat format `name >>> message`, deeply nested components | Core depth limits raised; pack parses sender |
| HuskHomes | `tpa`/`tpahere`/`tpaccept`/`tpdeny`, home, warp, `spawn`, `rtp`, `back`; 3 s warm-up | Pack lists requests with accept/deny commands and warm-up |
| CMI / CMILib | Misc. commands (`cmi:rtp`, `hat`, `ctext`, …) | Commands only |
| TrMenu / KaMenu | GUI menus | Core `mc_window`; no per-menu adaptation |
| Residence | Land claims | Not adapted: break/place is refused inside claims |
| AuraSkills-style skills (`skills`, `mana`, …) | RPG skills | Not adapted |
| XConomy, PlayerPoints, QuickShop, ChestShop, GlobalMarket, UltimateShop | Economy and shops | Never auto-spend |
| TAB, SkinsRestorer, LuckPerms, PlaceholderAPI, PlayerTitle, PlayerGuild, LiteSignIn, CookieClickerZ, BreweryX, fishing, lottery, music (MineKuMusic), MagicKiss, GSit, EasyBot, BiliBiliVideo, WorldEdit/FAWE, Terra … | Gameplay/cosmetic (40+ more) | Not adapted |

## Known issues (not fixed by this pack)

- 26.2 experimental stack: multi-slot crafting (e.g. sticks) can desync the window;
  verify by actual inventory change.
- After respawn the body was once stuck on a high glass platform at spawn.
- SVC: UDP auth/validate and sending worked (a player replied "听见了" in chat), but
  only keepalives arrived — no inbound audio frames. Cause not established (peers not
  talking, or listen permission).
- No dedicated adaptation yet for text-display holograms, TrMenu/KaMenu menus or
  Residence boundaries.
- The forced resource pack is accepted but not downloaded or rendered by the body.
