# 0.5.3: action admission evidence

The native body already rejected impossible recipes before changing its queue. The MCP outcome now also retains `meta.admission` with `accepted: false`, the executor's actual `rule`/`kind`, and the relevant `mc_help` reference. Refused cooking/charcoal crafts include the canonical `smelt` documentation, with no extra inference or server operation.

This makes a semantic rejection distinguishable from a schema error, a queued task or an unknown action. Hosts can keep the original error, suppress unchanged repeats for a bounded interval and reconsider when inventory/world evidence changes. Documentation is a reference; it does not prove a furnace, fuel or output exists. No admission, cancellation, task completion or user authorization semantics changed.

Java 1.21.1 remains primary. This snapshot also includes the latest native Mineflayer-compatible Java-client method fixes from main. The optional shared viewer is still an explicit independent input.

Validation: 817 core tests passed, two conditional viewer tests skipped in the explicitly headless build; typecheck, canonical build verification and isolated packed consumer passed with network denied. Live survival acceptance is recorded separately and remains required for a playable release.
