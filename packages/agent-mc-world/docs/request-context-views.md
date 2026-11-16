# Request-only context views

`agent-mc-world/context` exports two host-independent helpers. Neither starts a model, selects an action, edits a journal, or changes a native receipt's status.

```ts
import {taskSceneQuery, receiptTextView} from 'agent-mc-world/context';
const query = taskSceneQuery({purpose: currentPurpose, directive: latestDirection});
const requestOutput = receiptTextView(originalToolOutput);
```

`taskSceneQuery` builds at most 200 characters for retrieval. The caller's current purpose gets its own budget; long directions retain their beginning and end with an explicit omission marker. An explicit query takes precedence. This is a bounded excerpt, not a semantic summary or permission to discard the complete task instructions.

`receiptTextView` replaces only a byte-identical copy of `text` in `execution.evidence.receipt` with a JSON pointer. All other native status, effects, failure details and full `text` remain. The added `requestTextReferences` declares the reversible mapping. Non-JSON, short, different or already referenced text is returned unchanged. Keep the original receipt in the durable store; the view is not another execution result.

Tests cover budgets, late direction changes, pointer reconstruction, distinct failures, opaque input and idempotence. Hosts must separately verify their native event envelopes and measure request sizes on real traces. These helpers do not demonstrate better model choices or game outcomes by themselves.
