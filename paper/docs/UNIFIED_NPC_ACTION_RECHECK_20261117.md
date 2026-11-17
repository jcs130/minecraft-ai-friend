# Unified NPC action recheck, 2026-11-17

PR #291's production activation preserved the original bodies, but subsequent
autonomy readback exposed three release gaps. Activation is not autonomy acceptance.

- The maid catalogue dropped the server's per-action `oneOf` field constraints.
  Models consequently sent `guard(enabled=true)`, which the executor correctly
  refused. The adapter now publishes each action's actual argument schema.
- The original Feiyu was a boat passenger. Physical actions returned `maid_busy`,
  with no native dismount available. The body now reports passenger/vehicle facts,
  offers an explicit journalled dismount, and explains `dismount_required` for
  incompatible movement. Speech and acknowledgement do not require leaving a seat.
- Kirito's operator configuration contained `body:use`, which matches the broad
  tool-name syntax but is not a body verb. Constructing its action during planning
  raised ValidationError before the model request. Role validation now checks the
  actual action vocabulary at startup. The release configuration removes this
  unsupported entry; no new capability is claimed.

The graph HTTP child also lacked FastAPI in the provisioned environment. Its full
HTTP dependencies were installed, `pip check` passed, and the service started.
Future release checks must import the HTTP entrypoint and check authenticated
health, rather than treating the supervisor PID as proof of a running graph.

Validation before merge:

- Two new Python regressions failed on the previous implementation, then passed.
- Harness suite: 129 passed, 3 existing environment-dependent skips (UTF-8 host).
- Java controller contract: 49 checks passed.
- Actual isolated Youer/TLM body with Token Plan DeepSeek V4.1 Flash: 12 checks
  passed, including observable passenger state, explained refusal, speech while
  seated, model-selected dismount then guard, original receipt reconciliation,
  duplicate ID, already-dismounted no-op, preserved inventory/vehicle and guard.
  Inventory comparisons exclude only sampling time; all item data is compared.
- Candidate maid bridge: `0.1.46-unified-actions`, SHA256
  `abb2350c3d813bcf4535b3145892ae15a78af2b081ef336d4c85446300c99f23`.
  The hosted bridge rebuild is byte-identical to PR #291's artifact.

Evidence is retained under `artifacts/npc-joint-release-20261117`:
`runtime-fix-before.txt`, `runtime-fix-after.txt`, `seated-body-stage.json`,
`postflight-fix-build/build.json`. The earlier 72 real-provider conversation
attention cases remain synthetic acceptance, not natural multiplayer acceptance.

At this record's creation the game is online and unified NPC decisions are paused
for investigation. The patch is a candidate. A new maintenance must preserve the
latest post-migration world, accounts, inventories, identities, memory and action
receipts; it must not repeat the prior body migration or create another Yui.
Back up to F only, stop normally, replace the exact patch, validate loaded hashes,
then resume existing identities and verify actual routes and original receipts.
On uncertainty pause the controller and reconcile its original request; do not
restore an old whole world or replay an unknown action.
