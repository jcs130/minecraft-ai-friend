# Host-owned multimodal decisions

`DecisionPort.request` accepts optional top-level `images` alongside `state` and
`questions`. `DecisionRequest`, `DecisionResponse` and `DecisionInferenceStats`
are exported from `agent-mc-world/contracts`. Existing text-only hosts remain
compatible. Classification services may correctly report zero output tokens.

The host captures, sizes and selects images, supplies the provider and credentials,
validates answer choices, manages budgets and cancellation, and decides whether
to adopt a result. No endpoint, image acquisition, model, retry or additional loop
is installed by this contract. The core does not import a host or visualization.

`inference_stats` optionally carries request/session IDs, queue and execution time,
input tokens and provider vision measurements. These are correlation and usage
evidence, not action acceptance, execution completion or goal completion. Hosts
must redact provider-specific measurements before logging and keep images and
prompts out of telemetry when metadata-only logging is configured.

The separately maintained `mc-visual-console/systemone-decisions` entry provides
an explicitly configured SystemOne transport for visual hosts. A game host may
provide any structurally compatible DecisionPort. This additive contract does
not automatically enable a visual loop on SDK/MCP consumers or migrate live
Agent models, goals, memory or ledgers.
