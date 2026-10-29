# Agent MC World — canonical engine-only distribution

Minecraft execution plugin authored and maintained by jcs130.
Source: https://github.com/jcs130/minecraft-ai-friend, package `agent-mc-world`.

`build.py` archives the exact source commit in `source.json` and calls the core's
official `pnpm build:engine`. No source patch, replacement compiler, rewritten
manifest or copied game implementation is used. Build/type receipts, entry shims
and archive hashes are pinned for installation. This local build is not an npm
release. N.E.K.O's backend scripts only re-export these shared tools.

The public SDK/MCP expose the Mineflayer body, validated actions, facts, events,
execution receipts, tactics, game memory and cancellation. The caller owns
personality, general memory, planning models and the decision loop. The Python
integration defaults to Minecraft 1.21.1 and requires configuration and
connection. The separate 1.20.1 Forge consumer requires an explicitly selected,
hash-paired local engine port. The canonical SDK retains its version-auto default. No framework is
imported and no service is discovered. Viewer assets are a separate optional input.

The optional permission extension uses `agent_mc:break_acl`; its server endpoint
must implement the same protocol. Existing server protection still applies.
The legacy permission channel and realm-marker filenames remain readable; the
old independent marker is reused unchanged. Optional migration helpers are normal
canonical exports, never invoked during installation. Remote play does not open
local saves. Keep prior private data directories when explicitly upgrading.

The supplied MIT license notices remain in LICENSE. Third-party public declaration
licenses remain under dist/types/native. They do not identify another framework
as this Minecraft plugin's author or runtime dependency.
