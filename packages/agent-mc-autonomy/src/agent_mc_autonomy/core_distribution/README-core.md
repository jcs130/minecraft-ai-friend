# Agent MC World — N.E.K.O headless distribution

Minecraft execution plugin authored and maintained by jcs130.
Source: https://github.com/jcs130/minecraft-ai-friend, package `agent-mc-world`.

This artifact is built by `backend/build.py` in
https://github.com/jcs130/n.e.k.o_plugin_minecraft_autonomous from the base commit
and reviewed cleanup patch recorded in `dist/neko-headless.json`. The source and
compiled file hashes are included. It is a derived build, not an upstream release.

The public SDK/MCP expose the Mineflayer body, validated actions, facts, events,
execution receipts and cancellation. N.E.K.O owns models, goals, memory and the
decision loop. Defaults use Minecraft 1.21.1 and require explicit configuration
and connection. No server policies, framework imports or service discovery are
installed. No native client mods, bundled viewer or legacy host migration helpers
are shipped in this profile.

The optional permission extension uses `agent_mc:break_acl`; its server endpoint
must implement the same protocol. Existing server protection still applies.
Procedures accept only `agent-mc.procedure/v1`. Older procedure bytes and world
identities are never converted implicitly. Remote play does not open local saves.

The supplied MIT license notices remain in LICENSE. Third-party public declaration
licenses remain under dist/types/native. They do not identify another framework
as this Minecraft plugin's author or runtime dependency.
