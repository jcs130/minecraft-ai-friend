# Conversation during unfinished native work

Native `follow` can continue until cancelled explicitly. Waiting for every
pending execution to publish a terminal also prevented received private/public
chat from entering the next decision. A fresh `minecraft.chat` conversation
wakeup (`flush`, `debounce`, `interrupt` or `preempt`) now permits a decision
while the native task remains owned. Archive-only/stale events and piggyback
telemetry do not grant this opportunity. Ordinary long actions remain quiet in
the absence of a conversation or another existing meaningful wakeup.

If the model first reads messages/help, the bounded tool round can finish its
conversation across read-only continuations. A nonempty plain reply or an
admitted real body plan ends that continuation. A message arriving during the
reply stays pending for the next decision. Existing tool-round limits, minimum
decision cadence, validation and provider backoff remain effective; conversation
does not clear backoff or gain danger/urgent status.

Receipt alone never cancels or completes the native task, changes a relationship
or promotes another player's words to a user goal. Only an explicitly selected
model action uses the existing native queue policy. Unknown dispatch, native
event-drain barriers, death recovery and explicit stop remain authoritative.
No host SDK, second body queue, additional model or speech caller is introduced.

Offline run-loop tests reproduce an unfinished task receiving chat, preserve
pending ownership through a read and reply, and cover cadence/backoff, stops,
telemetry suppression and messages arriving during inference. Deployment and
natural conversation acceptance require separate live evidence.
