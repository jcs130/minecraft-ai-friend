# Independent Agent runtime

- This package owns autonomy/controller/context/mailbox, event-to-review policy, fresh evidence, review lifecycle and deduplication. Host adapters only deliver neutral envelopes and return decisions; no parallel body queue.
- Never import Neko, Cortico or the server project. Model/personality providers are explicit injected ports. No hard-coded endpoint, persona, credentials, world directory or service discovery.
- `agent-mc-world` owns the actual Minecraft body, native tasks, barriers and facts. This runtime is its sole turn coordinator. High-level hosts cannot acknowledge native barriers through review tools.
- Preserve explicit start/stop, unknown-dispatch blocking, intent UUIDs and user-feedback priority. Model reports and accepted messages are not verified goal completion.
- Tests use temporary state and fake model/body ports with network/processes prohibited. Run package pytest and isolated packed consumer checks before commit. Viewer adapters and built core are explicit inputs, not copied dependencies.
- The plugin consumes a pinned hash-checked source snapshot of this package. Change canonical source here first; do not maintain a second policy implementation in adapters.
