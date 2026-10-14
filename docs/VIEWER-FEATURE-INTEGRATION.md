# Public Agent state in the native viewer

Autonomy 0.1.33 publishes `viewer-agent.json` separately from private runtime
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

Display acceptance is not game completion. A `queued` receipt remains queued
until the matching native terminal arrives. A blocked/cancelled/failed task is
not displayed as success; effect verification stays false unless separately
observed. The full original receipts remain in the private journal.

The separately verified headless native core pin is preserved by this update.
Updating these source repositories does not deploy concurrent unrelated Java
body changes, restart the Minecraft server/model, or enable default auto-start.
