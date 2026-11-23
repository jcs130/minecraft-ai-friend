# agent-mc-world server packs

Optional, explicitly selected extensions of the `agent-mc-world` core for one specific
server. Each pack follows the same shape as the existing Qiandengji runtime pack
(`paper/integrations/agent-portal/skill/assets/runtime/qiandengji/`):

- `engine.mjs` exports `createEngine(options)` for the core engine child
  (`MinecraftWorldProxy({ extension: { module, tools } })`), subclassing
  `TacticalMinecraftWorld` and using only public ports (`agent-mc-world/extension`,
  `/tactics`, `/client`).
- `contract.mjs` holds the tool declaration and server guide; `entry.mjs` is an MCP stdio entry.
- Pure parsers live in separate modules with their own tests.

Rules: general Minecraft behaviour belongs in the core; no credentials, accounts or
personas in a pack; a pack is inert for every host it does not match.

| Pack | Server |
| --- | --- |
| [tangerinecology](tangerinecology/) | 橘乡 `mc.tangerinecology.top` (Velocity 26.2) |
