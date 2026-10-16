# Agent MC Java Client Bridge

A small client-only Fabric bridge for **Minecraft 1.20.6 or 1.21.1 / Java 21**. It supplies an alternative body for `agent-mc-world`; it has no personality, model, memory policy, launcher or reconnect loop. The server does not need this mod. Keep normal server authentication and permissions.

This is our own `agent-mc-java/v1` implementation. It is **not wire compatible with `maw-client-bridge-0.3.0`**. Do not copy a different bridge's connection token into it. The native source and MIT license are maintained here independently of any Agent host.

## Build

Install the matching Minecraft/Fabric client and Fabric API normally first. The explicit installed input must contain `libraries/`, `mods/fabric-api-*+1.20.6.jar` and Fabric's `.fabric/remappedJars/.../client-intermediary.jar`.

```sh
node build.mjs /path/to/installed-fabric-1.20.6 /path/to/jdk-21
node build.mjs /path/to/installed-fabric-1.21.1 /path/to/jdk-21 1.21.1
```

The build compiles local Java source and runs the lease/ledger, inventory, method and navigation contract checks. Test classes are compiled separately and excluded from the runtime jar. It never downloads dependencies, extracts host framework source, connects to a server or starts a client. Output: `build/agent-mc-bridge-0.1.0-fabric-1.20.6.jar`. Put it and the matching Fabric API in a separate instance's `mods/` directory. Do not use it with NeoForge or another Minecraft version.

For the explicit 1.21.1 target, both installed Minecraft and Fabric API inputs must be 1.21.1; the output suffix and packaged manifest declare exactly that version. Build dependencies/classes are isolated by target. Runtime observations report Fabric Loader's actual Minecraft version. Use the matching Minescript 4.0 artifact and preserve its configured Python interpreter, both action ledgers and private login configuration across migration. A compiled bridge still requires a real client launch, protocol and rendering acceptance.

## Body protocol

The actual game writes owner-only `agent-mc-bridge/connection.json` containing a fresh loopback endpoint and Bearer token on each launch. Do not publish this file. `agent-mc-world` reads it through `provider: "java-client"`; see the core's `docs/java-client.md`.

POST `/v1/rpc`, `Authorization: Bearer <local token>`:

```json
{"protocol":"agent-mc-java/v1","method":"state","params":{}}
```

- Discover: `capabilities`, `operations`; observe: `state`, `screenshot`, `result`.
- Shared JavaScript methods: `method_read` and a queued `method.run` reservation with ordered `method_call` / `method_result` / `method_finish`. The core reuses its Mineflayer-facing SES worker and `bot`/`Vec3` contract. See [script execution](docs/script-execution.md) and the core's compatibility matrix; this is not arbitrary Mineflayer plugin compatibility.
- Optional WebGL data observation: `visual_frame`, `visual_registry`, `visual_chunk`, `visual_skin`. `visual_skin {resource}` exports only the current action player's actual 64x32/64x64 skin texture as bounded PNG, checks the requested current resource and account/server, and restores the GL binding. It never reads arbitrary files/URLs or substitutes another skin; no control lease is needed for observations.
- Control: `claim`, `renew`, `release`. All input and captures verify `expectedUuid` and `expectedServer`. Input also requires the controller ID and private lease nonce.
- Execute: `do` with stable `action_id`, `operation`, `input`, and `queue` (`append`, `now`, `afterCheckpoint`). One body queue; at most 16 waiting actions. `afterCheckpoint` currently means after the current primitive's terminal boundary.
- Reconcile/cancel: `result`, `cancel`, `stop`. A timeout is unknown until reconciled; never retry under a new ID.
- Phases: accepted/running/completed/partial/blocked/cancelled/unknown. Chat, use and clicks are dispatch receipts, **partial**, until fresh server/menu evidence proves their effect. Completion of a primitive does not complete a host goal.

Actual operations: bounded movement and held-item use, yaw/pitch, chat/commands, hotbar, inventory open, token-checked menu clicks/close and displayed native buttons. Snapshots include server UUID/address, real position/vitals, complete ItemStack encoding/components, cursor, menu slots/revision/token and raw game notices. Screenshots come from the rendered framebuffer, including current textures, animation and GUI.

When the actual vanilla disconnected screen is open, `state.disconnectReason` exposes its narrated title/reason, bounded to2048 characters. This remains a read-only observation even without a world; it does not relax identity checks for screenshots or body input, inspect arbitrary GUI text fields, or infer that a reachable socket is a successful game login.

Actions persist under `agent-mc-bridge/actions/` by hashed ID. Input text is transient rather than stored in this native ledger. Accepted/running records recovered after a client crash become unknown and are not replayed. Retain both the native ledger and the SDK/host ledger across upgrades. Host tool arguments may be logged: keep password login in a private operator path, not model prompts or normal chat history.

## Background behavior and limits

Input uses Minecraft APIs and key bindings. The bridge cancels cursor capture, creates its window without asking for focus and keeps game input ticking while a valid controller owns the lease. Lease expiry, stop and disconnect release its held inputs. There are no OS input injection or foreground activation calls. A real render window and working GPU/display session remain necessary; a minimized, locked or disconnected desktop needs separate rendering verification.

Minescript 4.0 Python is an explicitly enabled optional executor; see [script execution](docs/script-execution.md). Start the Java process in its actual game directory, where Minescript resolves its configuration and scripts. A directory mismatch makes that capability unavailable. Python is trusted local code, not a sandbox. Optional Baritone public API integration supplies walking `navigate` and shared `bot.pathfinder.goto(GoalBlock/GoalNear)`. It is auto-detected without dispatch and uses the existing lease/queue/action IDs; measured grounded arrival and confirmed owned cancellation are required. Another active navigator is not replaced. See the core's [native navigation contract](../agent-mc-world/docs/java-client.md#optional-walking-navigator) for pinned API inputs, disabled breaking/placing, cleanup and remaining limits. Automatic login, general mining/combat and arbitrary mod APIs remain unavailable. A mod's installation alone does not prove its actions or GUI work. Fabric/Yarn mappings are version specific; a 1.21.1 NeoForge bridge needs a separate implementation and acceptance.

The owned Python wrapper sets its stdin/stdout/stderr to UTF-8 before importing Minescript. On Windows, a locale such as GBK can misread UTF-8 inventory/component JSON, consume escapes next to non-ASCII text and leave the script waiting until timeout. Existing bridge installations can explicitly configure Minescript's `.py` command to use Python `-X utf8 -u` plus `PYTHONIOENCODING=utf-8`, retaining their existing `PYTHONPATH`. Minescript 4.0 reloads its command configuration when admitting the next job; changing these settings does not replay a job or restart a client. Do not overwrite an existing custom command configuration without merging it. Test the wrapper offline with `python -B -m unittest discover -s tests -v`.

The [Numen Lua API review](docs/numen-lua-api-review.md) maps the upstream API and execution protocol to this client's capabilities and records what remains unimplemented.

Primary references: [Fabric client entrypoints](https://docs.fabricmc.net/develop/getting-started/project-structure), [Yarn 1.20.6 client APIs](https://maven.fabricmc.net/docs/yarn-1.20.6%2Bbuild.3/net/minecraft/client/MinecraftClient.html), [Minescript 4.0](https://github.com/maxuser0/minescript/blob/main/docs/v4.0/README.md), [Baritone 1.11.3 version requirements](https://github.com/cabaletta/baritone/releases/tag/v1.11.3), [HeadlessMC rendering options](https://github.com/headlesshq/headlessmc).
