# `src/client/tool-help.ts`: tool contracts and on-demand parameter notes

`withToolHelp(tools, name, { parameterDescriptions: 'on-demand' })` keeps tool names,
execution handlers and every JSON Schema constraint. Parameter `description` annotations
remain in the help catalogue instead of the repeatedly advertised parameters. Top-level
tool descriptions stay inline. The default is `inline`.

The mounted help tool reads the original effective schema after host renaming. Read its
index, select a tool, and follow returned JSON pointers; `full: true` returns the exact
selected node. Constants, enums, defaults and examples retain literal application data,
including fields named `description`. Help never executes a game action or calls a model.

Hosts can select this projection through the public `agent-mc-world/client` or
`agent-mc-world/extension` export. Large or unfamiliar action parameters still need
their exact help; compact advertisement does not add aliases or accept malformed inputs.


### Checkpoint evidence and task readback

The public `agent-mc-world/contracts` exports `compactWorkExecutionEvidence` and
`workContinuationEvidence`. The first retains bounded native step decisions,
observed-effect flags and spatial coverage beside truncated prose, without
copying bulk inventories or voxel arrays. Explicit `mc_queue {taskId}` / full
reads carry this structure in `data` and before the original text; default queue
prose stays compact. Task history remains dated history, not a current snapshot.

The continuation key compares matched query content and spatial revisions,
excluding transport request clocks and correlation IDs for recognized envelopes.
Pending acceptance and entirely unobserved spatial scans have a null key. Hosts
must scope key sets by assignment/realm, retain original receipts, and separately
judge task progress: a distinct key never proves a goal completed. Opaque formats
retain their content instead of guessing which domain fields to remove.
