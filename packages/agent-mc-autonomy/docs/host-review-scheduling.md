# Host review and inference boundaries

An ordinary revision of the active host-authored stage used to pass the same
`ready()` interruption check as new human feedback. If it arrived during a long
request, the coordinator discarded that request and began another one, without
a provider error or a native action from the discarded result.

The interruption check now defers only a `host_review` feedback with
`mode:insert`, `review_decision:revise` and `revision_of` pointing to a currently
planning host-authored stage. Its durable request and revision are unchanged.
The normal coordinator claims it at the next decision boundary; the existing
checkpoint/append rules still govern real body work. Nothing is acknowledged,
reordered or silently dropped by the interruption check.

New host stages, human or unknown feedback, explicit replacement and manual
commands retain their interruption behavior. Stop, native danger, death,
unknown outcomes and failed ahead anchors keep their existing protections.
Older injected mailbox ports without `interrupt_ready()` retain conservative
`ready()` behavior.

`decisions.jsonl` records `controller_cancelled`, timing, pending IDs and
`scope:this_inference_only`. These are local cancellation reasons, not provider
errors or claims that running native work was cancelled. Logs with no response
in older versions cannot establish a precise cancellation time by themselves.
The live status/request timeline and the original queued command can support a
diagnosis; current run-loop tests independently reproduce the original loss.

Measure completed requests, controller cancellations and physical idle windows
separately. A faster provider, a successful callback or one accepted body task
does not by itself prove fluent long-running gameplay.

## Project evidence across reviews

The standing instruction is retained in full before immutable evidence storage.
Compact inspection preserves it up to 24 KiB of encoded JSON; larger instructions
are explicitly abridged and expose their exact original character length/path.
This prevents later method-authoring, reuse and evidence requirements disappearing
behind a short scene preview. No host persona or private memory is copied here.

The existing body publication also samples public native goal/method summaries
every five minutes or when either summary changes. The same strategic database
keeps at most eight samples from the last hour; inspection reads them without
creating history, waking a model, or dispatching a stage. Compact inspection keeps
the oldest and two latest samples and links to every retained original sample.
Changing owner session, world/run, lifecycle/restriction/unknown boundary,
standing instruction or explicit user lineage resets the comparison. Ordinary
host stage revisions do not manufacture a new user intent.

`sampled_summaries_unchanged_seconds` compares sampled summaries, not continuous
world observation or verified stagnation. A harvest can increase inventory while
the registered milestone stays unchanged; neither readout proves a project is
finished. Missing intervals and omitted samples are not action counts. A sampled
terminal reference is dated evidence and grants no replay authority. The host
still chooses whether to continue, close, defer or revise a useful project from
actual effects and current conditions; there is no activity quota or fixed
survival sequence. A short successful deployment cannot certify lasting behavior.

Maintenance must keep the standing instruction separate from resume evidence.
Do not append old project counts, method indexes, coordinates or a deployment
report to `run --goal`: that argument becomes standing intent in both body and
host review prompts. Preserve such records as dated scoped game memory or
original evidence instead, and resume from fresh native facts. In particular,
restarting a session must not reassert an old farm/project snapshot as a new
objective. Never silently parse or rewrite a human's natural-language goal;
correct a known maintainer-added appendix as an explicit recorded maintenance
operation, retaining the original and normal stop/drain/ownership checks.
