# Repetitive plain model replies

A live provider returned an action phrase more than sixteen times without a
structured tool call. That reply could not move the body, but was previously
published as an ordinary, error-free decision and retained in planning history.

The independent controller now rejects a dominant consecutive run of at least
eight identical clauses of at least six characters, occupying at least 75% of
the response. Both plain content and the explicit speech envelope are checked.
Brief repetition, short vocalizations, distinct evidence and responses carrying
structured tools retain their existing admission rules. This is a conservative
output-quality check, not a required survival sequence or personality policy.

The original response remains in `decisions.jsonl`, with a content-free
`repetitive_model_reply` diagnostic and `dispatched:false`. Fresh event delivery
is retained for correction. Rejected text is not offered to the speech outbox,
published as a normal last message or appended to ordinary planning history.
The correction notice explains that no action was dispatched. A later valid
reply clears the diagnostic; it still requires normal tool admission and real
native receipts. Existing work, stop and unknown-dispatch fences are preserved.

Retries use the existing idle/minimum decision cadence with exponential backoff,
capped at 300 seconds. There is no extra model loop, automatic game action,
model switch, context-window change or inference-service restart. Offline
replays verify the boundary; deployment and sustained gameplay are separate
acceptance steps. The guard does not prove that a model will choose good food,
learn a server spell or survive.
