# Java 26.1 client adaptation

Client-only support for official Mineflayer 4.39.0 talking to Java `26.1` (protocol 775). This does not change any Minecraft server, plugin, or `server.properties`.

## Host setup

- Set `worlds.minecraft.version` to `26.1` (not a brand string such as `Tardis 26.1.2`).
- Keep `auth: 'offline'` unless the server actually uses Microsoft authentication.
- Configure the existing scoped login file (`loginConfigFile`) with `command:"login"` and a credential from `credentialEnv`, a private file, or DPAPI. Passwords never belong in source, logs, or markers.
- Some packed environments resolve public game hosts to `198.18.0.0/15`. Leave `publicDnsFallback` on (the default): the client retries public DNS and connects to the resolved IP while sending the original domain as `fakeHost` for the handshake. You may also set `fakeHost` explicitly when `host` is already an IP. Account matching still uses the configured `host:port`, not the resolved IP.
- Do not auto-walk the instant you join a claimed spawn. Idle wander waits until the first play position has been stable for about 1.5 seconds. Host-started movement is allowed; anti-cheat on some servers will silently resync position and may ban after 30 minutes if the client fights that resync.

## AuthMe pre-join dialog

On 26.1 AuthMe servers the password is submitted during the configuration-phase `show_dialog`, not first as chat `/login`.

- Dialog type `minecraft:multi_action`, input key `password`, submit action `authme:prejoin-login/submit`.
- The payload is vanilla 1.21.6+ `custom_click_action`: VarInt length prefix + anonymous NBT `{ password }`. The minecraft-data 26.1 field is still typed as optional `anonymousNbt` (a presence bit); that default writer is ignored.
- The client never sends `accept_code_of_conduct` for this dialog, and never clicks cancel.
- After submit it waits for the server to `clear_dialog` and `finish_configuration`. Chat `/login` remains a one-shot fallback only after a system `/login` prompt.
- A brief `登录数据异常，请等待登录结束` notice is ignored; authorization still waits for `已成功登录！` or the English AuthMe receipts.

## Windows, books, and hidden GUIs

- `open_window` titles that arrive as anonymous NBT are unwrapped before Mineflayer stores them, so titles such as `||主菜单||` are readable instead of `[object Object]`.
- `/教程` may be silent in chat and instead emit `open_book`; the held written book’s `written_book_content` is surfaced as a world event.
- If a plugin sends `window_items` with no following `open_window` (observed with `/rtp` and `/ss log`), the client closes that window id after a short grace period so later commands are not rejected as “already in a GUI”. Normal DeluxeMenus chests still send `open_window` and are closed with `bot.closeWindow`.


## Web viewer materials

The modern web viewer has no protocol whitelist. An exact packaged 26.1 material
pack is used when present under `versions/26.1`. Otherwise the viewer automatically
selects the closest prepared pack by chronological Java order — year-based `26.x`
follows the `1.21` line — and hydrates the live connection's 26.1 registry. Raw
major/minor distance is not used, because it would prefer `1.20.6` over `1.21.11`
for `26.1`. New 26.1 models may still appear as missing-texture placeholders until
an exact pack is prepared with mc-visual-console
`tools/prepare-vanilla-viewer.mjs --version 26.1`.

A hash-verified exact pack can be copied into the viewer root as `versions/26.1`
and selected with `viewer-retry` (same body, no reconnect). Official source
receipts are in `viewer-26.1-overlay.json`. The preparation pipeline now supports
`--extras true --sounds true --python <Pillow-python> --javap <JDK25-javap>`.
It verifies the official asset index and every downloaded object's SHA-1/size,
exports the default font, and for unobfuscated 26.1 disassembles the **matching
client's named MapColor class** instead of requiring nonexistent obfuscation mappings.
The current overlay contains 62 map base colors, native shades `[180,220,255,135]`,
2 map-frame models, 12 supported particle definitions and their sprite atlas,
1902 sound events and 4544 referenced OGG files. Sound files retain hash/size
metadata and original index/sounds.json. The sound loader prefers the hash-pinned native registry, with the explicitly
normalized 26.1 data table as fallback. All 1902 currently running fallback names
were independently compared with that native export and match. Protocol holder
decoding has already subtracted one.
The verified native exporter now emits 1168 block SoundType entries and all
1902 zero-based native sound IDs. It bootstraps the matching named client with
55 hash/size-verified official Java libraries, without starting a game connection. Browser audio still needs the user's ordinary activation.
Optional custom BGM is declared absent in `sounds/manifest.json` when not
installed; the client neither invents a catalogue nor repeatedly requests it.
Renderer llama-spit/trident legacy URLs resolve to the genuine named 26.1 PNGs.
Head/skull profile URLs are normalized to the existing same-origin, observed-hash
allowlisted proxy (64 KiB/image, eight pending requests, timeout and negative cache);
CSP is unchanged. Unknown or unavailable profiles retain honest fallback behavior.
Map-decoration icons, full native particle physics and frame pixel parity remain
explicitly unverified, not silently claimed as implemented.
Animated clock item frames are exported as `clock_00.png`–`clock_63.png`; the
viewer also serves `icons/clock.png` as a byte-identical alias of official
`clock_00.png`. Java 26.1 renamed projectile entity textures
(`spectral_arrow` → `arrow_spectral`) and may describe some model textures as
`{sprite, force_translucent}`; those official forms are unwrapped during prepare
and at runtime.

Java 26.1 scoreboard score packets no longer include the legacy `action` field
(removal moved to `reset_score`) and may carry an optional NBT `display_name`.
The client records those packets for both the Agent `hud` snapshot and the
modern viewer sidebar, without assuming a particular server's field names.

The locked release vendor archive still does not contain this local generated
26.1 overlay; its verified supplemental resources are separate from the old
prebuilt sound packs. Paper player-appearance catalogues are separate from a
vanilla pack and are not fabricated.

## Server-provided custom values

`installServerDisplay` is registered on the actual connected action bot. It captures
26.1 `scoreboard_score`/`reset_score`, optional NBT `display_name`, teams, bars,
and narrowly recognized self-balance system responses. No sidebar is required.
Current open-menu/inventory lore is another source: the observed 26.1 text flattener
can produce `▪ 修为»凡人` with no delimiter spaces. Empty values remain explicitly
unknown, and `/home`-style help lines are not promoted into numeric HUD fields.
The item's title/owner header and original lore line are retained as provenance.
Sampling unchanged item objects does not manufacture new receipt timestamps.
After five minutes retained readings are marked historical pending another query.

The same `readServerDisplay(bot)` snapshot feeds Agent `requestFacts().hud`,
viewer `/server-display` and its stats panel, plus the existing scoreboard socket.
The local operator console accepts fixed `play.menu`, `play.close`, `play.look`
and `play.walk` actions through its existing Origin/nonce checks. Only `/menu`
can be sent by that interface. Look is bounded; walks are normal ground controls,
50–500 ms, no jump/sprint/flight, routed through `mc_do` and the normal executor
with key release and stop-on-server-correction. There is no arbitrary eval/chat API.
Agent facts and the bounded local surface collision context are available in
operator state. This is protocol block data, not a browser screenshot or visual proof.

## Still out of scope here

- Cortico engine hooks, npm publish, and downstream `dsh-minecraft-agent` version bumps.
- 26.2 protocol work.
- Rendering the hidden `/rtp` GUI title when the server never sends `open_window`.

## Human-pace limits (not 26.1-specific)

Mining and auto-walk throttles are generic core options under `worlds.minecraft.miningLimits` and
`worlds.minecraft.movementPace`. Warning phrases for a particular server are configuration, not
protocol code. See [human-pace limits](human-pace-limits.md).

