# Optional host activity port

`MinecraftWorld`, `MinecraftWorldProxy` and the generic `MinecraftClientWorld` expose `publishAgentActivity(value)`. `normalizeAgentActivity` and `AgentActivityRecord` are available from `agent-mc-world/extension`. A host may forward actual returned model reasoning, replies, tool calls/results, classifier evidence and independently observed game execution receipts. Nothing invokes a model or acquires the game body.

The public schema is `agent-activity/v1`; required fields are `id`, ISO `at`, `kind`, `source`, `status`, `title`. Preserve run/session/round, call/task IDs and timestamps when available. Unknown attribution and missing reasoning remain unknown. A returned function-call item means the model proposed a call; tool admission and actual body completion must be separate records. Do not report a goal complete because a tool was accepted.

The proxy validates/redacts before IPC, the engine validates again, and the shared viewer bounds retained history and sends incremental records outside its high-frequency geometry stream. Secret fields and authentication commands are redacted. Prompts, raw provider requests, images, encrypted reasoning and personal memory are not part of this port. A host must not expose them as activity.

The optional Cortico consumer observes the existing local console debug stream only when configured with an explicit loopback origin. The core has no dependency on Cortico, no console address, no credentials and no provider selection. Native Java consumers without this port must report it unavailable.

Renderer source/protocol: `jcs130/mc-visual-console` commit `5f2576b3`. Bundles and source hashes are recorded in `provenance/viewer-activity-20261018.json`. Source, packaging and live loading are separate acceptance stages.
