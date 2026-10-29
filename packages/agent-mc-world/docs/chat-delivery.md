# Chat transport receipts

Core rc.113 adds the public `ChatDeliveryReceipt` and `ChatDeliveryRejection`
types under `agent-mc-world/contracts`. The engine emits `minecraft.chat.sent`
as a non-waking, piggyback event only after its actual client transport call
returns. Mounted adapters map the event namespace without changing its receipt.
The event's `meta.chatDelivery` contains protocol `agent-mc/chat-delivery/v1`,
an execution-epoch-scoped send id, original send time, public/private address
and logical message text. Commands and authentication are excluded.

A single immediate chat call also returns this receipt in its outcome metadata,
including its `callId` when supplied. A queued chat step emits the receipt at
execution, with `taskExecutionId` matching the original task's execution id and
the zero-based `stepIndex`. Admission is not sending. A later failed step does
not undo a chat that already reached the client transport.

The boundary is `client-transport`; `recipientRead` remains `unknown`.
Mineflayer may split a long logical message into protocol-sized packets. This
receipt does not count those packets as separate replies, claim server acceptance,
or prove that a recipient saw or read the message. A transport exception after
dispatch begins leaves its effect unknown. Proven pre-dispatch rejection is
labelled separately and emits no successful-send event.

Hosts can persist a bounded outbox linked to their own source messages, keep
queued/unknown entries distinct from sent replies, and reconcile by call or
task/step identity. The core supplies execution evidence; it does not decide
which human message a Persona has answered or maintain another personal memory.
