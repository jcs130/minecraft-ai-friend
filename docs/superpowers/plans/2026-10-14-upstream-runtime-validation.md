# Upstream runtime update and vanilla validation

Goal: consume the current independent core and autonomy changes, then repeat natural vanilla 1.21.1 survival observation in the existing world.

Inputs checked: core main `41fbc28`, plugin main `08b3df8`. The incoming plugin is 0.5.3 and uses autonomy 0.1.17; its core pin `01e9991` precedes the latest editable method/build guidance change.

Constraints: preserve server/world, account, inventory, original receipts, explicit stop and unknown-outcome protection. Keep the plugin a thin adapter. Preserve configured model/voice/fast routes and local memory defaults; do not activate cloud memory, OAuth or new external services. Do not manually complete gameplay objectives.

- [x] Build exact core `41fbc28` from a Git archive using its declared pnpm 11.5.0 and official engine-only build. Run core tests/type checks and disconnected packed-consumer verification.
- [x] Refresh canonical distribution hashes and pin; validate autonomy tests, wheel and isolated consumer. Commit and push normally after checking concurrent updates.
- [x] Update plugin dependency, synchronize the official plugin package, and run adapter, viewer-data, Ruff and Market-structure checks. Preserve private configuration and build the installable archive.
- [x] Establish old runtime exit and clean dispatch state, install the new backend in a separate directory, update only owned deployment paths, and reload the adapter. Restore the same world without touching the Minecraft server/model process.
- [x] Observe real queue, inventory/food/position, tool errors, main-brain feedback and viewer data over multiple samples. Save the result as passed/failed with evidence; online state or narration alone is insufficient.

Initial runtime evidence: the old 0.1.14 process is no longer listening and status records failure at 05:16:16; host-state has no pending/inflight/uncertain dispatch. Java server PID 34136 remains listening on 25571. Existing unsupported server-specific stage text is retained as historical evidence, not proof that that activity exists in this vanilla world.

## Build evidence

- Core `41fbc284cb0e7157c520f28c21110782870472a5`: official engine build, typecheck and packed consumer passed with network denied for the consumer. The installed package verifies every pinned receipt, runtime/source file and public declaration.
- Full default-parallel core suite initially hit the 50 ms combat-program evaluation limit while other build work ran. Repeating the entire suite with two workers passed: 650 tests, one pre-existing skip. Production limits were not changed.
- Archive SHA256: `5dcf15957b50f1b207217d1b93fdce195e2c232f73f795be95783393ce67f78b`. Bin fingerprints apply the existing npm shebang-only CRLF normalization; the first raw-bin fingerprint attempt was rejected before launch and corrected without weakening verification.
- Autonomy 0.1.18: 231 tests, Ruff, wheel build and isolated wheel consumer passed. The isolated consumer denies host imports/network and verifies autonomous and queue-only cycles.
- Build logs are local under `reports/upstream-runtime-20261014-1404/`. These checks establish packaging/adapter contracts, not successful live survival.

## Live result: survival not passed

Deployed autonomy 0.1.18 through plugin 0.5.4, with the canonical core installed separately and verified. The same server, local model, world and account remained in use. Runtime PID 44676 entered at 14:18:58 Beijing time; the Java server and model processes retained their previous start times. Plugin control panel and the external viewer both showed current game data and the viewer rendered the forest/player. The viewer's generic Agent HUD still reported `AGENT_STATUS_NOT_PROVIDED`.

The unmodified natural window ran 14:19:23–14:27:23, with 17 read-only samples and decision counter 1→16. Position, inventory, health 20/20 and hunger 17/20 did not change; the inventory contained no food. The planner repeatedly queried help/inventory and produced invalid `mc_help.skills` or `mc_scout` arguments. The old unsupported exam stage was still being revised by the host. This window is `not_passed`, despite working connections and cached model input tokens.

At 14:29:24, one ordinary plugin `feedback(mode=replace)` call restored the user's vanilla survival goal. Its UUID was retained, the original empty queue was explicitly acknowledged, and the command reached `planning`; this was not a manually supplied game action plan. A second read-only window, 14:30:03–14:34:03, captured nine samples and decision counter 23→32. A native voxel observation completed at 14:31:12, but position, inventory, health and hunger still did not change. Help reads increased from 69 to 108, and the feedback's body queue policy was not consumed. This window is also `not_passed`.

Single-skill help receipts inspected in this run fit the existing full-response bound; the model saw real documentation. Sampled model receipts include 3,608 cached tokens and no observed context-overflow rejection. These observations do not establish a unique root cause, a server fault or equivalence to the user's successful Cormy configuration. No model/provider/sampling change, manual collecting/crafting/teleporting, item grant or fabricated success was used.

Raw samples, the high-level feedback receipt, process/listener evidence and hash-indexed `result.json` are retained locally in the plugin checkout's ignored `local/live-runtime/upstream-20261014-1404/`. The test runtime and viewer remain running. Packaging/deployment is verified; autonomous survival remains an open acceptance failure.
