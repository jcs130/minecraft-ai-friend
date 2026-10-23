# Reuse an existing routine

Use the installed body's `mc_script` only if it is advertised. Read `routine:{op:"list"}`, select a relevant ID, then read `routine:{op:"read",id}` for its actual parameters, prerequisites and result fields. Explicit execution uses `routine:{op:"run",id},params`. These are operations on the same body, not separate bots.

- Work: harvest/replant, exact-cell logging, stow and restock. Confirm inventory, cursor and world changes; a completed program can still have remaining work.
- Travel: waypoints, swimming and flight routes. Flight requires actual server permission; a routine does not grant it. Swimming needs observed water, oxygen and a usable exit.
- Vehicles and portals: select a current-connection entity ID and verify movement or the actual dimension change. Native controls alone do not prove compatibility with a modded vehicle.

Keep `goalCompleted`, `outcome`, `remaining` and the original execution ID distinct. Do not replay an unknown transfer, interrupted harvest or failed route automatically. Read only the selected routine or native API topic (`mc_script api:"index"`) instead of the whole library.

The installed SDK includes `docs/work-routines.md`, `docs/movement-routines.md` and `docs/advanced-mobility.md` for deeper study. This standalone Skill has no runtime dependency on those external files; current routine schemas and help remain discoverable from the actual body.
