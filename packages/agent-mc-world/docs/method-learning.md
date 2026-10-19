# Authored actions and reusable method versions

`mc_script` accepts a new JavaScript function body. It is not limited to named
scripts. The host/model decides when a program is useful: persistent inputs,
calculations, feedback branches or repeated composition can avoid a model request
per small step. Ordinary skills remain directly usable. No quota or timer forces
the Agent to author a program.

`mc_script {api:"authoring"}` provides the progressive guide. Native key states
remain held across awaited reads/waits inside one program's body lease. Completion,
cancellation and timeout release its inputs. A new tool call does not inherit that
lease. Current backend capability help determines the available primitives.

## One core game-method path

1. `library:{op:"list",query:"purpose"}` retrieves small purpose/condition summaries;
   `read` opens one immutable candidate or exact older revision.
2. Write code and validate its syntax. `save` requires the same source hash and
   original `validationRunId`, description, conditions, and `parent:null` for a new
   id or the current candidate revision for an edit. It never executes the code.
3. Optional `dependencies:{alias:{handle,revision}}` refers to exact versions already
   present in this scoped library. `await methods.run("alias",params)` composes them
   using the existing graph/worker, shared body ownership and execution budgets.
   Parent versions do not follow a child's later edits. External host artifacts can
   still be passed explicitly to the existing `procedure` runner; saving a core
   library graph does not copy unknown external libraries into this scope.
4. Execute `{procedure:reference,params}` in a naturally applicable task. The actual
   adapter terminal persists the original `ProcedureReceipt` for this library.
   `library:{op:"evidence",id,executionId}` reads a bounded summary; `call` expands
   one original SDK result. Without a UUID it lists the recent eight references.
   Older immutable receipts remain readable by exact UUID across restart.
5. `review` requires this exact method revision and an actual execution UUID.
   It stores the Agent's `outcome` (achieved/not-achieved/unknown), `assessment`,
   `context`, optional numeric `measurements` (unknown is null), and `counterexamples`.
   It rejects syntax-only receipts. Interpretations remain separate from observed
   execution, including a completed program that made no useful world change.
6. `adopt` requires a completed execution and explicit achieved-goal review for that
   revision, plus `expectedAdopted` (null initially, otherwise the selected hash)
   and `reason`. This selects a future retrieval reference; it changes no running
   program. `list` retains the candidate head **and** `selected.reference` separately.
   A failed new candidate does not silently replace a selected method. Older code,
   negative reviews and selection records remain available for revision/rollback
   (`evidence` with `reviewId` or `selectionId` reads the exact interpretation/choice).
7. In a later comparable scene, retrieve and explicitly run the selected reference,
   recheck current premises, and evaluate the new outcome. Storage, selection,
   completion, and an Agent's achieved interpretation never automatically establish
   causal improvement, general mastery, or model weight training.

The replaceable `methods` request-fact part contains the scoped count, at most three
short summaries and an unresolved latest execution reference. It carries no source
or full history and starts no scan, model, dispatch or personal-memory write. A
failed read is labelled unverified. Per-file stamps avoid re-reading an unchanged
index on every fact sample. A host's `procedure_find` may address a different
personal/cross-World library; a miss there does not search the core game library.

## Persistence and evidence boundaries

Versions, receipts, reviews and selection records stay under the existing
realm/account/agent `minecraft-methods` directory. Receipts have exact root and
source identities and content hashes; reviews recheck the original before adoption.
The adapter is the trusted recording port. `MethodLibrary.recordExecution` is not
an Agent tool accepting user-provided success claims. Writes are locked and index
replacement is atomic. A recording failure does not fail or replay a physical
action; the original terminal/event remains authoritative and the error is visible.
The directory belongs in the host's private backup/migration, alongside its existing
game ledgers. No code is promoted into the engine or shared core automatically.

The same tool/schema is used by SDK, MCP and thin host adapters. `MethodLibrary`,
`METHOD_LIBRARY_SCHEMA`, and `MethodReview` are also exported by `/client` and
`/extension` for explicit host use. Hosts without a persistent data directory get
in-memory storage and must not claim restart persistence. These interfaces add no
inference loop or cloud dependency.
