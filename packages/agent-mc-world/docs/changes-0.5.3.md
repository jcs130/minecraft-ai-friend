# 0.5.3: action admission evidence

The native body already rejected impossible recipes before changing its queue. The MCP outcome now also retains `meta.admission` with `accepted: false`, the executor's actual `rule`/`kind`, and the relevant `mc_help` reference. Refused cooking/charcoal crafts include the canonical `smelt` documentation, with no extra inference or server operation.

This makes a semantic rejection distinguishable from a schema error, a queued task or an unknown action. Hosts can keep the original error, suppress unchanged repeats for a bounded interval and reconsider when inventory/world evidence changes. Documentation is a reference; it does not prove a furnace, fuel or output exists. No admission, cancellation, task completion or user authorization semantics changed.

Java 1.21.1 remains primary. This snapshot also includes the latest native Mineflayer-compatible Java-client method fixes from main. The optional shared viewer is still an explicit independent input.

Validation: 817 core tests passed, two conditional viewer tests skipped in the explicitly headless build; typecheck, canonical build verification and isolated packed consumer passed with network denied. Live survival acceptance is recorded separately and remains required for a playable release.

## Independent behavior repair candidate

The following changes were validated and deployed in the immutable private candidate 0.5.3-dev.20261015.2 at 55f3a4c. The source branch also follows newer main changes; that does not silently replace an installed candidate.

Long navigation now offers a safe checkpoint after each completed local leg. A queued short task such as eating can run, then the original fixed destination resumes with the same execution identity. The existing dry-footing, inventory, body-owner, combat and active-effect guards remain in force; no checkpoint is forced in water or during combat.

Server-command travel no longer treats a supplied coordinate that already contains the current position as a verified server destination. It refuses without dispatch and asks the caller to verify the actual destination. Dependent steps remain blocked. Ordinary remote travel still waits for observed arrival before releasing successors; a dispatched command alone is not success.

Integration note (rc.119): the paragraph above describes that historical private
candidate, not the current `server_travel` contract. Current main deliberately
allows an already-satisfied position check, explicitly reports that the command
was not sent, and refers callers to `chat.text` for an intended non-travel command.
The old rejection is not reintroduced. The completed-leg checkpoint and regression
coverage were reconciled with current task ownership and navigation cleanup.

The candidate consumes core main 0.5.2 and shared viewer main 4b59ce79. Viewer inputs are rebuilt under a distinct immutable artifact name with their own SHA, preserving the upstream input record separately. Java 1.21.1 remains primary, with explicit 1.20.6 assets.
