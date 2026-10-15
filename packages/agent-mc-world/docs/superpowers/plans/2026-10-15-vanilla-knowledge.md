# Vanilla 1.21.1 Knowledge Implementation Plan

> **For agentic workers:** Execute the following checked increments in the current session; research is delegated separately under the research skill. Preserve the shared working tree and normal main-branch pushes.

**Goal:** Make Java 1.21.1 the primary optimization target and supply bounded, source-attributed vanilla knowledge on demand, including correct food and cooking decisions.

**Architecture:** `agent-mc-world` owns a read-only versioned reference catalogue. Local search returns summaries; get returns one bounded entry. Historical `mc_memory` and its optional embedding/remote services remain separate from immutable vanilla references and fresh world facts. The autonomous controller only advertises and routes the core tool.

**Tech Stack:** TypeScript, pinned minecraft-data 3.112.0, Vitest, Python controller/pytest, public MCP/SDK.

**Spec:** User instructions on 2026-10-15: primary version 1.21.1; commit optimizations/fixes; explain raw/cooked nutrition and put standard Minecraft knowledge in the independent core for on-demand retrieval. Sources and findings: `docs/research/vanilla-1.21.1-food-knowledge.md`.

## Global Constraints

- No implicit model, embedding, network, game action or service restart during reference retrieval.
- Exact version selection; unavailable versions stay unknown. Reference data does not establish current inventory, recipes, permissions or goal success.
- Main target Java 1.21.1; preserve compatible SDK automatic negotiation and other server adapters.
- Preserve explicit eat requests; prefer cooked food in routine selection when available without eliminating emergency safe raw food.
- Existing memory, queue, evidence archives, unknown-action guards and unrelated concurrent changes remain intact.
- Commit canonical core before pinning an adapter. No marketplace publication or credentials in source.

## Review Focus

- `ominous_bottle` is incorrectly present in the upstream food table: exclude it from routine food and hunger reserves.
- Missing cooked stock or urgent hunger: do not require unavailable cooking infrastructure before eating.
- Unknown or auto version without a connection: do not silently load 1.21.1 as current truth.
- Chinese queries, paginated search and exact item IDs: return bounded reproducible entries with sources.
- Craft-only registry gaps: charcoal and cooked meat are furnace products; missing crafting recipes do not mean impossible production.

### Task 1: Versioned reference catalogue

**Files:** Create `core/vanilla-food.ts`, `core/knowledge.ts`, `tests/knowledge.test.ts`, `docs/vanilla-knowledge.md`. Modify `core/world.ts`, `src/client/runtime.ts`, `src/client/index.ts`, `src/client/java-client.ts`, `src/client/ENV_PROMPT.md`, `README.md`, `core/config.ts`.

**Interface:** `readMinecraftKnowledge(args: Record<string, unknown>, version: string): Record<string, unknown>`; `KNOWLEDGE_TOOL` is a read-only tool declaration. Search returns at most 10 summaries; get returns one entry with version, sources and explicit baseline status.

- [x] Add assertions for `food/beef` (3 hunger/1.8 saturation), `food/cooked_beef` (8/12.8), all 41 upstream food entries including an explicit non-nutritive bottle correction, cooking versus craft and Chinese lookup.
- [x] Assert invalid limits, unknown IDs/versions and unsupported semantics are explicit, and search never returns full entry contents.
- [x] Implement exact-version registry references for items, blocks, crafting recipes and foods, plus source-verified Java 1.21.1 food/cooking/regeneration guides.
- [x] Wire the read-only tool through engine, public SDK exports and disconnected SDK calls without starting a game or using a model.
- [x] Document on-demand use and the boundary with historical/optional vector memory; set core development default to 1.21.1 while retaining SDK `auto`.

```ts
expect(readMinecraftKnowledge({action:'get',id:'food/beef'},'1.21.1'))
  .toMatchObject({version:'1.21.1',currentWorldVerified:false,
    entry:{nutrition:{foodPoints:3,saturation:1.8}}});
expect(() => readMinecraftKnowledge({action:'search'},'auto')).toThrow(/version/i);
```

### Task 2: Food-selection evidence and controller discovery

**Files:** Modify `core/nutrition.ts`, `core/precheck.ts`, `tests/knowledge.test.ts`; create `tests/nutrition.test.ts`. Modify sibling `agent-mc-autonomy/src/agent_mc_autonomy/controller.py`, `context.py` and controller tests.

**Interface:** Existing `chooseRoutineFood` and `renderFoodReserveReadout` retain their signatures. `mc_knowledge` is an immediate read when the backend advertises it.

- [x] Reproduce undesired raw selection when cooked food is carried, and upstream `ominous_bottle` being treated as routine food.
- [x] Prefer its available cooked counterpart for routine meals; keep safe raw food usable when no counterpart exists and risky emergency foods bounded to existing starvation conditions.
- [x] Add concise per-stock nutrition/cooking/risk information to the current food reserve, and a soft advisory when an explicit raw meal has a carried cooked counterpart. Do not silently substitute an explicit request.
- [x] Advertise core knowledge directly and classify it as a read. Put only the stable discovery instruction in the prefix; retrieved contents enter ordinary bounded tool history.

```ts
expect(chooseRoutineFood(16,[{name:'beef',count:2},{name:'cooked_beef',count:1}],foods))
  .toBe('cooked_beef');
expect(chooseRoutineFood(6,[{name:'beef',count:1}],foods)).toBe('beef');
expect(chooseRoutineFood(6,[{name:'ominous_bottle',count:1}],foods)).toBeNull();
```

### Task 3: Validate, commit and integrate

- [ ] Run focused regressions, then the full core suite, public declarations and official engine build; preserve logs privately.
- [ ] Pack the core and inspect an isolated SDK/MCP consumer with network denied, including offline reference retrieval.
- [ ] Run the full controller tests with fake ports and an isolated wheel consumer; commit scoped validated changes and push normally after a fresh upstream check.
- [ ] If a deployment is made, follow the existing checked source/archive pin and exact-owned executor handover; record deployed versus source-only status honestly and preserve the game, Neko, viewer and model processes.
- [ ] Report submitted commits, exact food causes, sourced knowledge coverage and remaining live acceptance limits.
