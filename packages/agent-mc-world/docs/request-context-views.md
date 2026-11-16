# Request-only context views

`agent-mc-world/context` exports two host-independent helpers. Neither starts a model, selects an action, edits a journal, or changes a native receipt's status.

```ts
import {taskSceneQuery, receiptTextView} from 'agent-mc-world/context';
const query = taskSceneQuery({purpose: currentPurpose, directive: latestDirection});
const requestOutput = receiptTextView(originalToolOutput);
```

`taskSceneQuery` builds at most 200 characters for retrieval. The caller's current purpose gets its own budget; long directions retain their beginning and end with an explicit omission marker. An explicit query takes precedence. This is a bounded excerpt, not a semantic summary or permission to discard the complete task instructions.

`receiptTextView` replaces only a byte-identical copy of `text` in `execution.evidence.receipt` with a JSON pointer. Compact per-step detail text may reference a complete verbatim span of the visible receipt using `pointer`, `start`, `length` and the explicit `utf16` unit. Partial matches never qualify. All other native status, effects, failure details and full `text` remain. The added `requestTextReferences` declares the reversible mapping. Non-JSON, short, different or already referenced text is returned unchanged. Keep the original receipt in the durable store; the view is not another execution result.

Tests cover budgets, late direction changes, pointer reconstruction, distinct failures, opaque input and idempotence. Hosts must separately verify their native event envelopes and measure request sizes on real traces. These helpers do not demonstrate better model choices or game outcomes by themselves.

Native query envelopes may also repeat `data` as an exactly canonical JSON suffix in `text`, including `data.reply.text` repeating `data.reply.data`. The v2 reference form replaces only that redundant text with a null placeholder and records `{pointer, encoding:"json", prefix}`. The placeholder preserves key order. Restore child references first, then reconstruct the text as `prefix + JSON.stringify(data)`. Notices, uncertain correlation, timestamps, original nulls, failures and distinct prose remain. Pretty-printed JSON, different values and additional trailing text do not match. Never apply the request projection to the durable receipt or treat a query as successful execution.

A six-receipt native replay on 2026-11-16 (three skill queries, storage, dungeon info and one accepted action) measured 37,642 → 18,908 UTF-16 characters, with exact reconstruction of every changed receipt. A separate earlier 31-record window contained no qualifying duplicate; reduction is workload-dependent. Neither sample establishes provider-token savings or lower runtime latency. Synthetic tests preserve failed replies, unknown/null values, uncertainty notices and chained references, including JSON key order. Native traces remain private.
