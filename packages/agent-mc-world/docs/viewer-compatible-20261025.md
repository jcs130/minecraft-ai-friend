# Compatible vanilla materials without a setup prerequisite

Core 0.5.7-rc.89 removes the exact prebuilt-material requirement from the normal vanilla web viewer. A missing version uses a prepared compatible pack automatically; the browser and mesh workers still decode the body's actual Minecraft registry. Matching semantic materials are reused and missing new models show a visible checker placeholder. Missing optional icons, paintings, fonts or audio do not block terrain or game admission.

An old configured cache can fall back to bundled materials. `mc_connection action:viewer-status` reports `resources.mode`, `requestedVersion` and `assetVersion`. An Agent may optionally prepare exact materials and call `viewer-retry` to refresh only the compatible/failed viewer, preserving the body, action queue, goals and memory. Normal users are not asked to install Python or build a pack. Native/modded rendering keeps its independent strict asset contract.

Validation on 2026-10-25: 2,091 core tests passed with one existing optional skip; public declarations built successfully. Shared source passed 1,467 tests, 39 existing conditional skips, type checks and seven console tests. Four frozen vanilla bundles were rebuilt. All 22,787 original binary assets matched the previous input. Real WebGL fixtures displayed exact 1.21.1 and 1.21.4 with 1.20.6 materials in first/third person, including a visible missing pale-oak material and no browser errors. These fixtures did not connect to a Minecraft server or call a model. Packed SDK/MCP and DSH validation are recorded separately with the release.

No production process was restarted or reloaded. Returning to core 0.5.7-rc.88 restores the prior viewer behavior; game identity, goals and persistent memory do not need to be cleared.
