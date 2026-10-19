# NInfer live trial implementation plan

**Goal:** Run the existing Minecraft session with the explicitly selected local NInfer model, preserving full context and native task ownership.

**Architecture:** The autonomy package owns optional provider wire adaptation. The thin Neko adapter consumes a pinned package. Local service/configuration changes remain private; Neko code, SDK, official voice and game server stay untouched.

**Baseline:** Framework main `3b23db8808feeabaa63a704c672b108edde502b2`; adapter main `e2649cf78fe1c8b8ea75b0ab08c0aad0bc39c5d6`. NInfer source `931bd49ba332f48fad4b5230eec5a95ec5701290` has been built and separately benchmarked. Benchmarks do not prove gameplay.

- [ ] Add an explicitly selected NInfer cache strategy to `model_config.py` and `model_protocols.py`. Keep defaults unchanged. Checkpoint stable history before fresh facts without modifying stored messages, tool IDs or reasoning. Accept a Chat cache key.
- [ ] Add offline provider tests for changing facts, tool history, images and unsupported configuration; run autonomy tests and an isolated wheel consumer.
- [ ] Commit/push the framework normally, pin it in the adapter, and verify adapter tests, Ruff and official package structure. Preserve concurrent changes.
- [ ] Record fresh ownership and drained game state, back up private settings, unload/stop only the identified old model service and launch the checked NInfer binary on the 3090. Provide rollback without suspending a frontend indefinitely.
- [ ] Select 128K, bounded low reasoning and the new local endpoint, then explicitly start the normal standalone runtime. Reuse current server/account, identity and durable ledgers.
- [ ] Observe multiple real model decisions and native terminal receipts, actual position/inventory changes, viewer state and natural speech delivery. Record latency/cache metrics and outstanding limitations in private maintenance evidence. Do not claim long-term survival from a brief trial.

No release/tag/Market action or scheduled automation change belongs to this trial.
