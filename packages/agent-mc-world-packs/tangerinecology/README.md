# 橘乡 server pack for agent-mc-world

Optional extension pack for **橘乡** (`mc.tangerinecology.top`, Velocity 26.2 →
Lophine/Purpur 26.2). It follows the core's server-pack contract
([component boundaries](../../agent-mc-world/docs/component-boundaries.md)): general
Minecraft behaviour stays in `agent-mc-world`; this pack only adds what is specific to
this server. The core never loads it implicitly, and the engine stays inert for any
other host.

| File | Purpose |
| --- | --- |
| `src/profile.mjs` | Host match, config overlay (26.2, fakeHost, pace limits, Vulcan warning words, SVC compat 20), MaxAuth account entry by credential reference |
| `src/route.mjs` | NanoLimbo/MaxAuth → lobby → `/main` → survival, classified from the server's command tree; bounded `/main` retries; SVC gate |
| `src/chat.mjs` | CraftEngine/CustomNameplates glyph stripping, TrChat `name >>> text`, HuskHomes teleport request + clickable accept/deny, warm-up |
| `src/pace.mjs` | Vulcan clamps on pathfinder movements: no sprint, no parkour, no dig/pillar while routing |
| `src/observer.mjs` | Per-connection bounded observations; accepts the forced resource pack (URL/token not retained) |
| `src/engine.mjs` | `createEngine` for the core engine child: `TacticalMinecraftWorld` + the above, `mc_tangerine` read tool |
| `src/entry.mjs` | MCP stdio entry (same composition as other server packs) |
| `docs/PLUGINS.md` | Plugin inventory and known issues from the 2026-11-23 playtest |

## Use

1. Build the core (`packages/agent-mc-world`: `npm run build`) or install a packed core.
2. Copy `login-config.example.json` to your private config directory, set `username`
   and the environment variable name. **Never write the password into any file or
   argument**; export it only in the process environment
   (`credentialEnv`). Point `worlds.minecraft.loginConfigFile` at that file.
3. In the client config set `host: mc.tangerinecology.top`, `version: "26.2"`,
   `auth: offline`. Optional native voice: `simpleVoiceChat.enabled: true` plus a
   local official SVC jar (`officialJar`) and `javaPath`. The pack keeps SVC closed
   until the body is on the survival backend.
4. Start through `src/entry.mjs`, or pass
   `extension: { module: <file URL of src/engine.mjs>, tools: [STATE_TOOL] }` to
   `MinecraftWorldProxy` in your own host.

Optional switches (data only) in `cfg.tangerinecology`:
`{ autoMain: true, acceptResourcePack: true, vulcanPace: true, keepVersion: false, force: false }`.

## What the pack does at runtime

- **Login route**: the core's server-login submits `/login` once from the runtime
  credential. When the command tree shows the lobby (`main` root, no `voicechat`) and
  login is confirmed, the pack sends `/main` once, retries at most 3 times 20 s apart,
  then reports `MAIN_ROUTE_ATTEMPTS_EXHAUSTED`. `phase=main` (backend exposes
  `voicechat` / `huskhomes:tpa`) is the only "joined" state.
- **SVC**: `simpleVoiceChatGate` returns true only in `phase=main`. The SecretPacket's
  `voiceHost` is a DNS name served by `voicechatproxy`; the core resolves it with the
  same public-DNS fallback as the game connection and rejects fake-IP answers. The
  client closes during the Velocity configuration hop and re-handshakes after it.
  `sent` never means somebody heard it.
- **Vulcan**: movement pace and mining limits switched on, warning words added, and
  the pathfinder never sprints, parkours, digs or pillars. Explicit dig/build tools
  still follow the core mining limits. A warning stops automatic movement.
- **Teleports (HuskHomes)**: incoming `tpa`/`tpahere` requests are listed in
  `mc_tangerine state` with the exact accept/deny command (from the click event when
  the server attached one). The Agent decides and sends it via `mc_do` chat. Do not
  move during the 3 s warm-up.
- **Text**: private-use glyphs from the server resource pack are stripped; TrChat
  player lines are recognised only for known online players.

## Tests

```sh
npm test                 # pure modules
# engine integration against a local core build:
mkdir -p node_modules && ln -sfn ../../../agent-mc-world node_modules/agent-mc-world && npm test
```

Version: `0.1.0`, private. Not published; publishing is the maintainer's decision.
