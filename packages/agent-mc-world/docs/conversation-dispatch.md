# Independent speech checks and body execution

`independentMinecraftSpeechPrefix(args)` is exported by the neutral SDK and
`agent-mc-world/extension`. It is a pure partition of a caller-selected batch;
it does not validate current inventory, execute a skill, choose a goal or call a
model. Native parsing, permissions, support/collision checks, task ownership,
cancellation and outcomes stay with the original World handler.

The partition supports leading social-text steps followed by an independent
body suffix with the default/replace queue policy. It retains relative body
order and remaps explicit body dependencies. Append/checkpoint/now ordering,
interleaved speech, unknown shapes, speech expectations and dependencies on
speech remain on the original ordered lane.

A host using the partition must submit the body exactly once and preserve its
native receipt. It may check the utterance asynchronously and return a separate
queryable speech reference. Native rejection of the body must remain a failure;
chat acceptance must not turn it into progress. Approved utterances use the
core's existing default single-plain-chat lane, which does not replace a body
task. Do not submit another multi-step or replace batch merely to deliver the
speech. Other backends must verify an equivalent non-replacing chat contract
before enabling this scheduling; the pure helper does not establish parity.

Speech checks need explicit scope, cancellation, a terminal outcome and a
bounded pending index. A restarted check with an unknown transport result must
not replay the speech or body. An already submitted mixed batch must not be
replayed because its speech is duplicated.

Action parameter errors include the existing error path, field contract and
registry-validated format example in both structured data and the text receipt.
The example is not an action proposal or a suggested destination. No parameter
is guessed, and no rejected batch is automatically corrected or retried.
