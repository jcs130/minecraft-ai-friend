# Current core consumer sync

> Execution: continue the already authorized maintenance in this session. No new host policy or model loop.

**Goal:** Consume the current independently tested Minecraft core instead of the older environment-reflex backport.

**Architecture:** `agent-mc-world` remains the sole body and queue implementation. `agent-mc-autonomy/core_distribution` pins an exact engine archive, build receipts and npm dependency lock. The Neko adapter consumes a new exact framework revision; the separately pinned viewer stays unchanged in this increment.

**Tech Stack:** Node 22+, pnpm 11.5.0, TypeScript/Vitest, Python 3.11+, pytest, public Neko SDK.

**Spec:** `packages/agent-mc-world/docs/existing-path-first.md`, `packages/agent-mc-world/AGENTS.md`, `packages/agent-mc-autonomy/AGENTS.md`.

## Constraints and review focus

- Java 1.21.1 is primary; keep explicit older-version tests.
- A bounded no-path search can permit configured terrain changes; timeouts, cancellation and missing evidence cannot.
- Actual task terminal/effect receipts establish progress. Acceptance, model statements and successful imports do not.
- Preserve default-disabled startup, explicit stop, ownership and unknown-dispatch barriers. Never replace a body while work is uncertain.
- Keep private state/worlds and server-specific protocols outside generic changes. Do not modify/restart Neko main, models or the server.
- Preserve current full context/persona/messages and reasoning-history option.

## Task 1: Verify and pin the body

- [x] Extract `c1a16034ca5533bc095cc3062da9cd12f9ad1c32:packages/agent-mc-world` with LF bytes into an isolated diagnostic directory.
- [x] Verify the frozen dependency lock, run full `pnpm test`, `pnpm typecheck`, engine build and packed verification. The isolated Windows install encountered a directory rename failure; build the exact Git export against the already verified dependency tree with the same normalized lock, retaining failed preparation logs. Retain existing-path, inventory/offhand and feet-coordinate regression results.
- [x] Generate archive SHA-256, exact source revision, package/build/types/bin checksums and npm integrity from actual bytes. Update only `core_distribution/{source,package,package-lock}.json`, package version and current README. Preserve external viewer/resource checksums.
- [ ] Run autonomy pytest and a packed-wheel consumer/disconnected check. Commit and ordinary-push verified source after fetching main.

## Task 2: Consume and deploy

- [ ] Update adapter version, exact framework revision, current version docs and configuration pin expectations. Sync an isolated candidate with actual dependencies, run pytest/Node/Ruff/official release-structure checks and inspect the plugin archive.
- [ ] Install the new core into a new empty backend directory. Do not modify the running backend in place.
- [ ] Record fresh settings/session/ownership/process births and mailbox/native offsets. Request an ordinary maintenance drain and require no unknown/pending work before stopping the owned adapter worker.
- [ ] Update only the exact backend path and verified dependency package, then restart the owned worker/executor using PowerShell 7. Preserve the stop request identity and standing goal; reject an operator stop.
- [ ] Inspect actual movement/inventory/terminal receipts and natural narration over several snapshots. Keep long-term survival and publication unverified if not established.
- [ ] Record maintenance evidence and comparison baseline without changing `last_full_inspection_at` unless the entire full inspection was performed.
