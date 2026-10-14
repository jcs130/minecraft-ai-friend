# Keep deduplicated reads usable after history pruning

Live 0.1.23 request35 contains a full mc_bag answer. In the same native turn,
request36 retains only a scout exchange and request37 retains only the native
"这轮已经答过了,答案不会变,先看上一条。" receipt. The answer it points to has
been omitted. Fresh gear still contains major inventory facts, so this is a
verified reference defect, not proof of the sole cause of survival failure.

The pinned core implements this exact once-per-turn contract for mc_bag,
mc_queue and mc_blocked. It has no typed prior-request/stamp reference. Preserve
raw receipts and add a bounded planner projection referring to the real previous
answer from the same native turn. Keep its actual request/turn identity and
already compacted content/handles. No cross-turn cache, new read or game action;
missing previous evidence must be explicitly unresolved.

- [x] Reproduce dangling reference after full-answer history eviction (11 red regressions).
- [x] Add the narrow shared compatibility projection and 16 boundary regressions.
- [x] Run complete suite, Ruff, wheel and isolated consumer (combined 0.1.24: 342 passed); commit/push follows.
- [ ] Consume in the thin adapter, package/deploy, observe natural gameplay separately.

Longer-term core improvement: typed priorRequestId/stamp metadata can replace the
exact legacy receipt contract. Do not fabricate such fields in native journals.

The compatibility patch passes the full 311-test suite and Ruff before the
separate counter-port work. Independent review found no blocking issue. Exact
queue burst notices, failures and execution receipts do not overwrite substantive
answers. Existing >6,000-byte compaction remains a preview plus original chunks;
this patch does not claim to restore unabridged long answers or change execution.
