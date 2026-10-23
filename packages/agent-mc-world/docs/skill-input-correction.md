# Skill input and correction

`mc_do`, `mc_scout` and the program SDK use the shared skill registry and parser.
Host adapters rename the tools; they do not implement another action language.

## Canonical input and compatibility

`steps` is a real JSON array of objects. Do not put a serialized array inside a
string. The compatibility parser can decode **one complete JSON array**, then
validates every step, dependency and skill restriction as usual. Admission
reports the decoding. It does not evaluate code, unwrap another object, decode
recursively, repair JSON, remove trailing characters, or execute a valid prefix.
Malformed input is rejected as a whole before queue replacement or dispatch.

Material placement uses `material` with either `anchors` (destination cells) or
`on` (reference cells/faces). A single `material` + `at` is accepted as the
unambiguous alias `anchors:[at]`, reported in the admission receipt. Combining
that alias with `anchors`, `on` or `shape` is rejected rather than choosing one
target. Blueprint placement retains its original `blueprint` + `at` semantics.

`probe.where` is a set of names filtering the same observed region. It no longer
inherits the unrelated twelve-entry `until` stop-list bound. Repeated names are
deduplicated, with a normalization note. Region volume, actual visibility,
unknown cells, cancellation and the per-material coordinate display bound are
unchanged. More filters do not cause another world scan for every name.

`probe.where` locates selected types; `probe.slice` returns a spatial section.
They remain separate modes. A mixed request is rejected with both alternatives
and the exact help selector, rather than silently discarding either intention.

## Error evidence

Input failure returns `failed:true`, `accepted:false`, `dispatched:false`, a field
path and the relevant `mc_help` selector. Readable text also contains the short
registry constraint, so clients which show only tool text still receive it.
The original task and queued work are preserved. The reply includes only a
bounded excerpt of bad input; the original tool call remains the evidence source.

`describeSkillInputCorrection`, `parseSteps`, `parseScoutSteps` and parse-note
types are available from the public `agent-mc-world/extension` export. Reading
or formatting a correction does not submit a new task, retry a failed action,
authorize execution, or establish game progress. Empty-target preflight refusals
are world-state conditions, not parameter syntax errors.

Hosts which mount tools under another namespace use `mapToolRecovery` (SDK and
extension exports) to map the callable recovery names and tool-help selectors.
This utility leaves ordinary game arguments, evidence and the original outcome
unchanged. Mapping a tool name is not a model decision or a dispatched action.
