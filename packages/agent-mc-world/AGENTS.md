# Independent Minecraft core

- This directory is the single source for `agent-mc-world`; build and test it independently of the server project at `world/`.
- Host adapters depend on this package. Core source, default entry, declarations and build must not import Cortico, DSH, N.E.K.O or Qiandengji adapters.
- Preserve `agent-mc/v1` event delivery, tool barriers, explicit turns, task identity/terminal states, facts/archive, deduplication and cancellation. Acceptance is not goal completion.
- Host owns personality, model calls, learning decisions and personal memory. The core may persist explicitly requested game-only notes and historical observations, isolated by realm/account/agent, without claiming current facts or verified learning. No hidden model loop, server discovery or performance endpoint scanning.
- Viewer source stays in `jcs130/mc-visual-console`; prepare locked release inputs explicitly. Do not commit derived game/viewer assets, runtime state or credentials here.
- Full package tests, public declaration checks and build verification precede commit. Test consumers against a packed package in isolation.
- Source migration does not authorize production restarts. Report source, package, deployment and live gameplay evidence separately.
