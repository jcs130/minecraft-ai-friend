# Shared operation learning contract

The core supplies a game evidence substrate for every Agent using its SDK/MCP. Pi is one consumer;
no Pi schema, model or persona is imported. Direct legacy World integrations may use the public
OperationExperienceBook/ClientOperationLearning ports explicitly; they must not claim automatic
collection until wired. Existing ordinary game memory and optional service-learning APIs remain available.

`MinecraftAgentClient.learning` records host decisions and recalls at most three relevant local lessons.
`call` automatically captures physical tools and executable methods; `hostTactics` captures exact choice
admissions. `mc_choose` records its filtered advice, including stale/unavailable/uncertain cases.
The runtime status reports collection errors. No timer or model request is added by this collector.
Body calls keep their actual results if storage fails; unknown effects are never retried by logging.

Rows are isolated under `minecraft-memory/operations/<realm-account-agent-hash>`. IDs derive from
scope/run/request; retries with canonical equivalent input reuse the row. Execution IDs link terminal
events even when completion races ahead of admission. Restart leaves unresolved effects unresolved.
The SDK request ledger, not this analytics store, remains the dispatch deduplication authority.
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

`mc_memory action:experience` exposes help/list/get/stats/reflect through existing SDK and MCP tools.
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
