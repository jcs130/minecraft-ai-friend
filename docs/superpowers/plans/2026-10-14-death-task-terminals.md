# Death must settle every accepted native task

Live evidence: at 18:24:15 Beijing, native task #16 was accepted into the queue during combat. At 18:24:16 death cancelled one queued task, and the body respawned with an empty queue. At 18:41 the independent controller still retained exact task `c21647d2-bc40-4e5e-8ef2-ce7a84cf5ce7:16` as accepted, so decisions remained at 15. This is not resolved by deleting controller state or replaying the task.

`Executor.cancelForDeath()` clears current/frozen/queued work but only emits a task report when a hold exists, and only for the first task. The existing `onConnectionLost()` path correctly emits one `reportCancelled()` per exact task ID. Apply that established terminal-report contract to death, retaining epoch fencing, step landings and held-reason evidence.

- [x] Reproduce queued-during-combat/held-queue/current/frozen cancellation with a fake native bot. Require one cancelled report per accepted ID, no replay, no late completion and normal new-body work afterward. Red: 4 failures / 1 pass; green: 5 passes.
- [x] Use the existing cancellation report helper for every unique cancelled task; no inference, extra host policy or shared queue.
- [x] Run full independent core tests, declarations, build verification and isolated packed consumer checks before committing/pushing main. Full engine package: 86 files / 690 tests passed, one optional packaged-viewer test skipped without its locked assets. Clean source build, public source typecheck, actual packed runtime with network/framework imports denied, and strict NodeNext/Bundler declarations passed. The deployment uses an explicitly configured external viewer.
- [ ] Produce and pin an actual new body archive/build receipt in the framework, update the thin plugin dependency, run its required checks and package inspection.
- [ ] Use normal stop/disconnect only on this owned framework to retire its stale accepted entry, preserve original ledger/receipts, deploy and restart the checked body with the same world/account/model. Observe actual browser/native progress; do not intentionally kill the live player to test this branch.
