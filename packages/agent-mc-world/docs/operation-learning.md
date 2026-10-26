# Shared operation learning contract

For continuous read-only archival and outcome-signal review beside an existing
host, see [continuous gameplay evidence](gameplay-learning.md). It reuses this
journal and the original IDs; it does not install another operation collector.

The core supplies a game evidence substrate for every Agent using its SDK/MCP. Pi is one consumer;
no Pi schema, model or persona is imported. Direct legacy World integrations may use the public
OperationExperienceBook/ClientOperationLearning ports explicitly; they must not claim automatic
collection until wired. `WorldOperationLearning` supplies the direct-host integration: wrap the
existing host with `start(host)`, wrap exposed tools with `tools(...)`, and wrap any internal
host-controlled body calls with the same collector. Call `stop()` after the body finishes stopping.
It adds no timer, model request, dispatch queue or personal-memory writes. Do not combine this
wrapper with an SDK collector for the same calls. Existing ordinary game memory and optional
service-learning APIs remain available.

Direct-host capture runs have their own `world-<UUID>` identity; original call and execution IDs
link back to host logs. A confirmed `requestFacts().experience.scope` is required; missing identity
never creates a guessed notebook. Inline script hashes identify the actual submitted version.
Choice recall is bounded to three historical lessons. Recall is not adoption: without explicit
SDK attribution, adopted memory references remain unknown. Automatic combat controllers which
do not submit tools retain their original reports; no synthetic terminal or success is fabricated.

`MinecraftAgentClient.learning` records host decisions and recalls at most three relevant local lessons.
`call` automatically captures physical tools and executable methods; `hostTactics` captures exact choice
admissions. `mc_choose` records its filtered advice, including stale/unavailable/uncertain cases.
The runtime status reports collection errors. No timer or model request is added by this collector.
Body calls keep their actual results if storage fails; unknown effects are never retried by logging.

Rows are isolated under `minecraft-memory/operations/<realm-account-agent-hash>`. IDs derive from
scope/run/request; retries with canonical equivalent input reuse the row. Execution IDs link terminal
events even when completion races ahead of admission. Restart leaves unresolved effects unresolved.
The SDK request ledger, not this analytics store, remains the dispatch deduplication authority.

Argument parsing rejects the entire batch before dispatch, including valid steps preceding an
invalid observation. `meta.admission` reports `accepted:false`, `dispatched:false`, the correction
rule and recovery guidance. Hosts must not turn these rejections into failed physical destinations
or require failed-task retry evidence for corrected read-only queries. A bare error without admission
or execution proof remains an unknown effect; absence of a receipt does not authorize replay.
The online index retains 1024 recent rows; evidence files are never automatically deleted. Use exact
IDs or the bundled offline summarizer for older records. Scope directories share the account's single
writer/connection lease. Preserve the whole private dataDir on migration or backup.

Stored data: time, IDs, controller, candidate IDs/readiness/probability, nullable model token/timing
metadata, safe action parameters, input hash, exact method and memory references, execution phase,
and bounded numeric world observations. No raw arguments, program source, prompts, reasoning, chat
or credentials enter these rows. Native Java inventory remains unknown here until an authoritative
structured inventory observation is provided; old bodies without numeric observations return null.
The original game event archive still holds original game receipts, governed by its existing policy.

Before/after are observations, not causal proof. A decision row's after is the observation at recording
time, not a reconstruction of the model input. Missing/stale/cross-realm samples stay null. Returned
RPCs without terminal evidence stay unverified. Probability is not accuracy; completion is not success.
The Mineflayer child samples facts with each tool reply and terminal event, and the proxy installs
that sample before notifying observers. It does not reuse the one-second console heartbeat as the
terminal observation. A failed read clears the sample to null without changing the actual outcome.
This samples current client state at delivery; it does not wait for later server effects, prove that
all inventory packets arrived, or repair historical rows collected by earlier versions.

A tunnel whose endpoint is already the current feet cell reports a `noop` step, including when a
queued predecessor reached that cell. It does not dig or move, and does not certify the earlier
route or the enclosing goal. Cancellation and invalid-slope checks still apply. Repeated no-ops
remain visible as no-progress evidence; they are not recorded as blocked digging failures.

Filtered probes report the number of observed and unknown cells. A zero count in the observed
portion cannot rule out targets in occluded or unloaded cells, outside the shape, or hidden by the
server. Entirely unknown regions have an unknown target count. Only a fully observed empty query
for recognized blocks enters the short duplicate-query hold; unknown coverage can be checked again
when visibility or loaded data changes. Historical lessons must retain these limits instead of
turning an unobserved region or a failed route into proof that no target or route exists.

`mc_memory action:experience` exposes help/list/get/stats/reflect through existing SDK and MCP tools.
`list` returns compact historical summaries by default. Pass pagination and optional filters in
`input` (for example `{action:"experience",operation:"list",input:{limit:4,offset:0}}`).
Top-level `limit`/`offset` are also accepted when they do not conflict with `input`; other misplaced
or unknown fields fail explicitly. Follow the returned `nextOffset`, because the character budget
may make a summary page smaller than the requested limit. Expand one exact ID with
`{action:"experience",operation:"get",input:{id:"<returned ID>"}}`; `input.detail:"full"` explicitly
requests full list records. Original observations, decisions and policy evidence are never rewritten.
Unfiltered pagination reads only the selected evidence files. The direct `OperationExperienceBook.list`
API retains full records for existing SDK consumers. List summaries and successful reads do not establish
current facts, completed goals or a learned improvement.
Reflection checks scope-bound evidence IDs and preserves an attributed notebook lesson, with explicit
conditions and counterexamples. Stable review IDs support local crash recovery without duplicate notes.
Helpful interpretations need at least one completed operation with measured before/after, and still
return masteryVerified:false. Reflect is local; optional replication or service candidate generation
remains explicit. Different Agents never share private worlds or authorize actions through memory.

Shared lessons feed core `mc_choose`; Pi also recalls them in System1 routine decisions and System2's
bounded request tail. Personal Pi memory and existing tactic history remain intact. A host can report
raw decisions via learning.recordDecision; it should supply exact decision IDs on subsequent call
attribution. Recalled references and adopted memoryRefs are separate. Historical retrieval alone
must not increment a verified-success count or silently alter live methods.

Method versions use the existing `mc_script` library and explicit validation/selection. Runtime tactic
versions remain experimental until real outcomes support them. Skills are progressive guidance around
these interfaces, not a second runtime. Package both minecraft-agent and minecraft-learning with MIT
license and per-file hashes; marketplace publication is a separate reviewed action.

The [authored action lifecycle](method-learning.md) adds fixed-version composition,
persisted actual execution lookup, explicit reviews, and an optimistic preferred-version
selection to that same core library. Candidate, selected version and Agent interpretation
remain distinct; no other host's personal method library is assumed to have been searched.

`mc_combat_tactic.routines` registers a bounded fast menu of exact saved method references. Each entry
has `id`, `intent`, `procedure` and optional `params`/`durationMs`. Registration resolves the immutable
version in the current realm/account library; it neither runs the method nor follows a newer same-name
version. `routines:[]` clears the menu. Registration adds no inference loop; an explicitly enabled host
combat driver uses its existing independent clock and model connection. The model receives option
labels, necessary battlefield facts and execution availability, without method source or history.
The compact request omits the absolute sample timestamp and repeated built-in action prose. The host
retains the original sample and deadline checks; entity health ages and unknown readings still reach
the model. Ability blockers use a boolean veto beside availability, mana cost and cooldown. Their
original text remains in the full frame. Authored method intents and tactic instructions are retained.

An authored `program` can filter and order the registered method options in `frame.actionPool` before
the fast model chooses. Its order is retained. Methods are offered only with a free body and no active
combat controller; casts, withdrawal, target changes and short steps reuse that controller during an
encounter. A selected hostile target remains selected while the same visible entity is available.
Fresh connection, task, tactic version, identity and physical eligibility checks still precede dispatch.
An explicit decision config `minConfidence` applies to the chosen option's probability; the default
uses a 0.1 lead over the runner-up rather than an implicit 0.75 probability floor for every choice count.
A service's above-chance confidence is retained separately and does not create a second threshold.
Application metadata separates keeping the existing controller, attempted dispatch and accepted dispatch.
See [combat decision adoption](combat-decision-adoption.md) for freshness checks and evaluation boundaries.
The native reflex port does not yet resolve this saved-method catalog; its explicit `mc_script` remains
separate, and unsupported registration returns an error.

Fast method admission returns the original method execution ID and exact revision/source hash. Its
terminal event and SDK calls use the existing method channel. Operation evidence retains the fast
decision ID and method reference, so reflection can cite actual outcomes, revise a method through the
ordinary library parent check, register the revised reference, and restore the previous one. Completed
methods, registration and test fixtures remain insufficient evidence of improved gameplay or mastery.
