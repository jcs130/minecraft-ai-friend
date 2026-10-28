# Already-satisfied navigation

An idle single-step `goto` may already satisfy the current native arrival
condition. Its first response completes immediately without allocating a task,
moving the body, emitting a task terminal or claiming the user's goal complete.

The same fast path now participates in the existing short stationary-request
guard. A repeated identical request from the same observed foot cell, dimension
and movement mode within that guard's window returns an unaccepted operation:
`meta.admission.kind = "repeat"` and
`meta.admission.rule = "navigation.already-satisfied"`. It preserves the original
queue and explains that another identical `goto` cannot add displacement.

This is a request rejection, not a failed or cancelled native task. There is no
new execution ID to poll. Correct the continuation, use a different required
operation, or wait for an actual condition. Neither result proves overall goal
success. The guard never chooses the next action for the caller.

Changed position and expiry allow a fresh check. Every immediate completion
still validates the actual arrival condition; expiry does not prove the world
changed. Busy tasks, multi-step plans, dry runs, expectations and different
dimensions retain their existing execution semantics.

Regression coverage verifies immediate completion, typed repeat rejection,
position changes, expiry, unchanged arguments, no phantom task IDs and no body
movement. SDK/MCP consumers use the existing admission contract; no host-specific
gameplay policy is required.
