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
