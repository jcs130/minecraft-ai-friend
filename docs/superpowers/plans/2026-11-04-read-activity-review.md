# Read activity review repair

**Goal:** Preserve actual observation activity across the body-to-review boundary so a long inspection loop is visible to the planner and host.

**Architecture:** Share the existing bounded counter names between the controller and review projection. Count immediate native observation/check/visual calls without adding them to the admission or lookahead allowlists. Keep queued reads distinct from physical changes. Offer stage completion as an option in the existing evidence guidance, never mark a project complete automatically.

**Spec:** The reported live shelter inspection loop on 2026-11-04; `agent-mc-autonomy/AGENTS.md` owns evidence and review policy. Original incident receipts remain in private maintenance evidence, outside Git.

**Constraints:** Preserve original calls, safety barriers, exact arguments, unknown cells, stop authority, model route and deadline. No forced gameplay, new queue, extra inference loop or public release.

## Task 1: Reproduce and repair evidence loss

Files: `packages/agent-mc-autonomy/src/agent_mc_autonomy/{read_activity,controller,review,context}.py`, `packages/agent-mc-autonomy/tests/test_read_activity_review.py`.

- [x] Add fake-port tests for queued observe batches, immediate observe/check/visual reads and empty catalogue queries reaching `ReviewPort` inspection with exact counters.
- [x] Verify failures with `python -m pytest tests/test_read_activity_review.py -q` before changing production code.
- [x] Share bounded names; retain the existing independent admission allowlist. Preserve failed reads, mixed action plans and malformed counter handling.
- [x] Make existing read guidance include checking stage completion and an honest blocked report, without choosing actions or modifying goals.
- [x] Run targeted tests, full framework pytest, Ruff, and the same suite against an isolated wheel before committing version 0.2.147.

## Task 2: Integrate and verify the consumer

Files: plugin pinned framework manifest/vendor, plugin version/config metadata; no native core/viewer changes unless new evidence requires them.

- [x] Fetch both source remotes before edits/pushes; preserve unrelated files.
- [x] Pin the verified framework commit in plugin 0.6.151, run plugin/Node/official package checks, then ordinary push.
- [x] Install the genuine official CI package using the existing App UI after a normal game stop and verified native drain.
- [x] Reuse the same account/settings and existing execution resources; start via UI, record screenshots and original scoped receipts.
- [x] Observe self-selected activity beyond initial startup. Report partial evidence honestly if a loop persists; do not claim autonomous survival from one movement.

Consumer verification: plugin `d216939b7832cda44c01f23c61b42a5389b59a6b` pins framework `0040f62c621765c61a8256afb50096b4f2a263dd`. Source and isolated-wheel suites each passed 1,892 tests; plugin passed 583 with one platform skip, Node UI passed 25, and official Verify run 41828036057 succeeded. The same official artifact was imported through the App; all 30,184 prior data files remained byte-identical before starting, and only the configured plugin version changed.

The bounded live observation ended at UTC 2026-11-04 12:38:58. It contains 91 successful model responses, 24 scoped admissions with 23 unique original terminal events and one task still legitimately in flight, plus two additional native eating terminals. Physical evidence supports 15 working terminals and 23 successful change steps, including tools, mining, eating and retrieving two cooked beef. Failed and partially changed tasks remain distinct. Ten review deliveries received actual host acknowledgements. A saved review packet contains the previously omitted immediate observation and queued-read counters. These facts establish the projection repair and continuing self-selected work; they do not establish a controlled improvement, permanent loop prevention or long-term survival. No public release was created.

## Review focus

Queued read-only tasks must not be counted as construction; mixed read/action plans retain native effects; invalid/unknown counter names remain excluded; all old admission/ordering gates remain unchanged; no goal completion is inferred from counters. Each is exercised by the targeted tests plus existing controller/review suite.

Execution: native implementation in the already authorized repair task. No separate approval gate or delegation.
