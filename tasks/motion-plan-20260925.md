# Motion plan and Jev step correction

## Observed gap

The tested `base_navigate` program already walks through multiple local survey and goto segments while Qwen is busy. The sixth live 600-second window confirmed four long goto segments across two programs, but a finished or replanning program leaves the body idle until another slow decision. Jev currently chooses a skill or interrupts a native task; it does not choose among the freshly surveyed next navigation segments.

## Implementation

1. Add a bounded, typed 2–6 waypoint `navigate_plan` tool. It resolves an explicitly tested `base_motion_plan` skill and submits one durable skill job, leaving the existing action quota and body lease unchanged.
2. The new program validates each waypoint inside the work area, advances only after an exact goto receipt and observed arrival, and uses the existing 16/8/4 survey fallback for each leg.
3. At each fresh survey with supported candidates, ask Jev to choose a specific next goto or escalate. The controller binds the selected exact coordinates into program memory before dispatch. A stale body, low confidence, unavailable policy, unsafe native preflight, unknown outcome or failed leg stops the plan and returns to slow planning.
4. Verify isolated skill fixtures, tool admission, Jev alternatives, negative and crash cases. Do a full isolated suite before any live install/deployment, then observe a natural live window.

This first plan keeps movement going across several LLM specified waypoints. Other queued game actions remain available through the existing six request mailbox; the native receipts still decide whether they succeeded.
