# Upstream runtime update and vanilla validation

Goal: consume the current independent core and autonomy changes, then repeat natural vanilla 1.21.1 survival observation in the existing world.

Inputs checked: core main `41fbc28`, plugin main `08b3df8`. The incoming plugin is 0.5.3 and uses autonomy 0.1.17; its core pin `01e9991` precedes the latest editable method/build guidance change.

Constraints: preserve server/world, account, inventory, original receipts, explicit stop and unknown-outcome protection. Keep the plugin a thin adapter. Preserve configured model/voice/fast routes and local memory defaults; do not activate cloud memory, OAuth or new external services. Do not manually complete gameplay objectives.

- [x] Build exact core `41fbc28` from a Git archive using its declared pnpm 11.5.0 and official engine-only build. Run core tests/type checks and disconnected packed-consumer verification.
- [ ] Refresh canonical distribution hashes and pin; validate autonomy tests, wheel and isolated consumer. Commit and push normally after checking concurrent updates.
- [ ] Update plugin dependency, synchronize the official plugin package, and run adapter, viewer-data, Ruff and Market-structure checks. Preserve private configuration and build the installable archive.
- [ ] Establish old runtime exit and clean dispatch state, install the new backend in a separate directory, update only owned deployment paths, and reload the adapter. Restore the same world without touching the Minecraft server/model process.
- [ ] Observe real queue, inventory/food/position, tool errors, main-brain feedback and viewer data over multiple samples. Save the result as passed/failed with evidence; online state or narration alone is insufficient.

Initial runtime evidence: the old 0.1.14 process is no longer listening and status records failure at 05:16:16; host-state has no pending/inflight/uncertain dispatch. Java server PID 34136 remains listening on 25571. Existing unsupported server-specific stage text is retained as historical evidence, not proof that that activity exists in this vanilla world.

## Build evidence

- Core `41fbc284cb0e7157c520f28c21110782870472a5`: official engine build, typecheck and packed consumer passed with network denied for the consumer. The installed package verifies every pinned receipt, runtime/source file and public declaration.
- Full default-parallel core suite initially hit the 50 ms combat-program evaluation limit while other build work ran. Repeating the entire suite with two workers passed: 650 tests, one pre-existing skip. Production limits were not changed.
- Archive SHA256: `5dcf15957b50f1b207217d1b93fdce195e2c232f73f795be95783393ce67f78b`. Bin fingerprints apply the existing npm shebang-only CRLF normalization; the first raw-bin fingerprint attempt was rejected before launch and corrected without weakening verification.
- Autonomy 0.1.18: 231 tests, Ruff, wheel build and isolated wheel consumer passed. The isolated consumer denies host imports/network and verifies autonomous and queue-only cycles.
- Build logs are local under `reports/upstream-runtime-20261014-1404/`. These checks establish packaging/adapter contracts, not successful live survival.
