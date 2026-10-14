# Game memory and learning

Read `mc_memory {"action":"help"}` to see the active retrieval mode and whether service learning is enabled. This is a game notebook; your host retains personality and general memory.

- Search a few `lesson` or `method` summaries, then `get` a selected ID. Recheck current geometry, inventory and permissions. No match proves neither a first encounter nor a lack of history.
- For an interpreted lesson, read `{"action":"help","topic":"remember"}`. Supply top-level `kind`, `summary`, `content`, `source`. Your conclusion uses `source.kind:"agent_note"`, with its real author and run/task/receipt reference. Another person's report retains their speaker. A reference is a pointer, not proof of truth.
- `capture` only samples live position/health/food/inventory. It cannot save an authored lesson. `input` and `operation` belong only to `action:"service"`.
- After `saved:true`, get the returned ID. If a counterexample changes the conclusion, read the latest revision and `revise` the full note with `expectedRevision`. Preserve the previous version and source of correction. Rejected local validation saves nothing; inspect the error/help. Remote indexing may fail after a successful local save, so check `saved` and `index` separately.
- At the next applicable task, retrieve and use the method, compare expanded terminal receipts and net change, and keep, revise or revert it. Read `mc_script {"api":"methods"}` to edit and validate executable methods separately. Notes do not install code.

Optional PowerContext or HTTP service learning uses `{"action":"service","operation":"help"}`. It requires an explicitly configured endpoint and dedicated game Scope. Evidence capture, experience/skill candidates, review and later adoption are separate stages. Without that configuration, use local notes and methods; do not invent an endpoint or invoke a hidden model. Maintenance guidance and service-generated proposals must retain their authors. Storage success, a finished script or one victory is not proof of learning or improved gameplay.
