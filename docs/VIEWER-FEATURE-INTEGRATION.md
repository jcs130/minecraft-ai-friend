# Public Agent state in the native viewer

Autonomy 0.1.34 publishes `viewer-agent.json` separately from private runtime
status and injects it through the explicitly configured shared viewer adapter.
The projection contains the current public goal, bounded tool/skill names,
actual queued/rejected/terminal receipt status and last decision time. It never
copies planner requests, arguments, configuration, credentials or private memory.
The reader requires the current runtime session/player and a fresh timestamp.

The shared renderer owns native first/third/dungeon cameras, original item/skin
models, observed hand swings and the existing Agent intent/input/route/trail
widgets. These features use the same Mineflayer body. Neko contains no duplicate
renderer, navigation logic or parallel task queue. Source integration is in
`jcs130/mc-visual-console`; consumers must rebuild/verify their actual bundle.

The adapter also passes the shared stream's explicit `menuState()` into its
presentation projection. Actual windows, state IDs, cursor stacks and furnace
properties are decoded by the shared Mineflayer adapter. They are not inferred
from planner text or copied into the Neko plugin.

Display acceptance is not game completion. A `queued` receipt remains queued
until the matching native terminal arrives. A blocked/cancelled/failed task is
not displayed as success; effect verification stays false unless separately
observed. The full original receipts remain in the private journal.

The separately verified headless native core pin is preserved by this update.
Updating these source repositories does not deploy concurrent unrelated Java
body changes, restart the Minecraft server/model, or enable default auto-start.

## Local deployment evidence, 2026-10-15

The Neko consumer uses autonomy **0.1.34**, thin plugin **0.5.18**, shared
viewer source **58048b9a17d48f759519e0509885e690f6ce596e**, and the separately
verified native core **f6b07058479cab000ec2fb2a9cb302921b611e65** (0.4.0).
Concurrent newer core/Java-client/fishing source has been preserved on main;
it was not silently substituted into this deployment.

The served viewer source digest and console bundle were checked against an
offline preparation using the consumer's same working directory. That detail
matters because esbuild includes relative source-path comments in its bundle.
The actual Edge page showed first-person original skin arms, the same player's
third-person body, public goal/tool/receipt panels and a full inventory-0 layout
with 2×2 crafting/output/equipment slots. Earlier actual inventory clicks also
triggered the automatic read-only preview. The server, model, Neko main and
plugin service remained continuous during owned-runtime handovers.

Shared renderer regressions: **767 passed, 12 conditional skips, 0 failures**.
Framework source and isolated wheel consumer each passed **397 pytest** tests;
the plugin passed **56 pytest**, **4 Node** checks, Ruff and the official market
release check. Original exported 1.21.1 model/PNG bytes were separately checked
for dirt, cobblestone, oak logs, crafting tables and a stone pickaxe. Unsupported
held furnace registration remains explicit. These checks do not constitute
complete scene or original Java pixel parity.

A fresh naturally completed crafting-table/furnace sequence and complete
eat/drink/ranged-use/equip animations remain unverified. The live Agent also
continued issuing repeated observation calls and had a schema-rejected scout
request; restored display is not evidence of sustained autonomous survival.
The audit screenshots and raw private receipts are kept outside Git.

The generic 1.20.6 release-source artifact is a separate locked input and was
not relabelled as this explicit local 1.21.1 native renderer deployment.
