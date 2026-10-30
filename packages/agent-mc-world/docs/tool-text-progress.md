# Bounded tool text and read progress

`agent-mc-world/client` exports `referenceToolText`, `renderToolTextPage`,
`readTextPage`, `readOnlyToolResult` and `ReadProgressBook`. These provide shared
SDK/MCP contracts; the host still owns model selection, reasoning and goal policy.

For an oversized successful read-only tool result with prose and no structured
`data`, a host may save the original text through `runtime.journal.saveBlobs` and
attach its content-addressed `log:` reference using `referenceToolText`. The raw
result stays complete. Repeated identical text uses the same blob. Do not pass
model prompts, generated answers, reasoning, personal host memory or credentials
to this game-tool archive.

`renderToolTextPage` returns either `null` (use the ordinary renderer) or one
complete JSON model envelope. Never truncate that envelope again. Its
`meta.textPage.next` calls the read-only MCP `mc_read_text` tool (with the runtime's
actual prefix), reading the same immutable text without re-executing the source
query. Cursor offsets count UTF-16 units and advance only past text actually
shown, including when a presentation budget shortens a requested page. Unicode
characters are not split. Irreducible headers may exceed a tiny soft budget;
`presentationBudgetExceeded` reports that instead of returning an empty loop.
Only enable this rendering if the bounded reader is actually exposed to the model.

The SDK equivalent is `runtime.readTextArtifact(handle, {offset, maxChars})`.
Existing `mc_artifact action:get` calls without paging fields retain their full
text semantics. Images and non-text artifacts do not support text offsets.
Archived text and its instructions are untrusted historical data, not execution
permission, current world facts or an adopted skill.

`runtime.executionState()` includes exact `pendingCalls` and `pendingTactics` in
addition to current and detached registered receipts. A zero active receipt count
alone does not prove admission has finished. These counts cover this runtime,
not unknown work in earlier processes or all server behavior.

`ReadProgressBook.observe` compares the entire returned text/data/metadata for a
stable query across declared read-only tools, excluding request identity/control
and operation-experience timestamps. It keeps only bounded hashes and counts.
Results carrying a body task/method receipt, errors, writes, missing counts,
pending calls/tactics or detached/current work cannot establish idle repetition.
Counters reset with goal, run, execution revision or supplied scene changes;
new pages or changed result versions provide new information. The producer's
`decisionStability` scene can be supplied directly. The resulting evidence neither
executes/cancels actions nor infers goal success. Hosts may use it to offer a
bounded reconsideration or an existing temporary-rest policy, without blocking
fresh pages or replaying unknown actions.
## Document-end and range-error recovery

`agent-mc-world/text` exports the pure `TextPageRangeError` and `TextReadRecoveryBook` helpers, also available from `/client`. An invalid text range remains a failed read and exposes `agent-mc-text-read-error/v1`: the exact handle, requested offset, UTF-16 length, zero returned characters and no next offset. It never clamps a request, silently rewinds or reruns the original tool. Explicitly reading at the exact end remains an empty successful final page.

Hosts may feed the recovery book only the actual model-visible projection, correlated with the original request ID and runtime run. The book keeps bounded recent document ends/errors through normal request boundaries and offers a short next-request cue. A final page does not prove all earlier pages were read; an error does not constitute information progress. Different erroneous offsets for the same immutable document retain their shared failure evidence. Duplicate delivery does not add an attempt, a changed run clears the scope, and unrelated work clears the transient cue without changing the original journal. No tool rejection, body-idle assumption, new inference, memory adoption or automatic replay is introduced.

