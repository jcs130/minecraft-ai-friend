# Bounded probe, RPG integration and nearby voice implementation plan

**Goal:** Keep real partial probe data, expose the installed server's RPG capabilities to Neko, and verify whether the existing Neko voice can reach nearby game players.

**Architecture:** General observation behavior stays in agent-mc-world. Server-specific queries and skills use the independently pinned neutral Qiandengji engine. Neko owns its TTS; any game-audio bridge must use public APIs and the core's existing authenticated voice lane.

**Tech stack:** TypeScript/Node, Python, official Neko SDK, existing Minecraft custom payloads.

**Spec:** User requests all confirmed fixes and asks whether Neko speech is integrated with server voice. Original receipts and offline reproduction: E:/ai-models/neko-scan-semantics-20261104T2216.

## Constraints and review focus

- Preserve explicit stop, identity, original receipts and the sole native body queue. No server restart, model-route change, invented RPG goal or replay.
- Work and large build artifacts go to E:. Preserve unrelated dirty extension files and viewer logs.
- Partial observation is usable evidence; unread and invisible cells stay unknown. Never relax build/excavate limits to fix read-only probes.
- Preserve custom/off extension choices; auto mode only selects server behavior for a verified Qiandengji connection configuration.
- Desktop audio completion, server frame delivery and human hearing are separate evidence. Do not read host voice credentials or change Neko/SDK.

## Tasks

- [ ] Add actual skillProbe regression for an oversized box: bounded reads, returned data, exact remaining regions, unknown cells, unchanged input and strict write-skill limits. Run red before implementation.
- [ ] Add bounded rectangular probe page selection and a partial coverage envelope. Keep small probe output compatible and preserve filters/slices. Run scoped and full core tests, types/build and packed consumer checks.
- [ ] Build the latest neutral Qiandengji package in an isolated E: checkout. Pin/hash its runtime files, wire both engine and presentation through existing verified ports, and test default/custom/off/integrity/upgrade behavior.
- [ ] Audit the running Neko public TTS response and public audio transport. If a supported same-utterance audio source exists, implement its adapter and core configuration without duplicate synthesis; otherwise expose the limitation honestly and retain desktop TTS.
- [ ] Run framework and plugin regressions, SDK checks and packed imports. Normally update the authorized development plugin through the app, preserving the original account and state; verify natural queries, actions and the actual UI. Public release is separate from this development integration.
