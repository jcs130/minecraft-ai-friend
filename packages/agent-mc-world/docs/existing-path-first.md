# Existing paths before terrain changes

Mineflayer `goto` now chooses each local travel leg in two stages. Explicit
`tunnel`, construction and their work-position navigation retain their own
contracts. No model, character, server rule or activity script is required.

1. Probe the actual leg with `walk` movements. Doors and gates can still be used;
   mining and scaffold placement are disabled. An existing route wins even when
   the current cost settings would prefer a shorter digging route.
2. A complete route, partial route, timeout or missing probe keeps the first
   execution constrained to existing paths. A bounded `noPath` result with a
   visited-node count permits the configured fallback. This means that search
   found no route, not that the destination is universally unreachable.
3. If the actual owned existing-path attempt returns `noPath`, including the
   upstream empty-path resolve case, allow at most one fallback. A newly observed
   existing route still wins during that comparison. Timeout, stalls,
   interruption, missing proof and cancellation do not authorize terrain changes.
4. `walkOnly:true` never escalates. Existing movement restrictions, protection,
   blueprint boundaries, collision, support and body ownership remain active.
   Capabilities are leased and restored in `finally`; a fallback does not enable
   any ability the original movements did not allow.
5. Long travel probes each current short leg with its actual goal and fresh
   starting position. It does not classify the distant unloaded destination as
   the local route. Arrival still requires the actual goal condition.

`Bridge.probeRoutes(target, goal, profiles?)` supports a bounded profile subset;
omitting it retains the full comparison menu. `preferExistingRoute` and its types
are exported through the SDK client and extension surfaces so other hosts can
use the same evidence rule. The runtime records `route-choice` with the selected
strategy and evidence. Configured abilities in a receipt do not prove that
mining or placement happened.

The Java-client backend keeps its separately documented navigation contract;
this does not claim feature parity for its path planner. Test evidence includes
Java 1.21.1 and 1.20.6 registries, a real physics detour around an intact wall,
callback/empty-path failures, cancellation, strict walking and long-leg scope.
Production loading and live travel improvement require separate verification.
