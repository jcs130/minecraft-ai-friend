# Reviewed renderer input

This candidate consumes mc-visual-console source `5d5ab6df6d12d28dcb1f2b3dae8af56b1223ad39`,
rebuilt from its locked original Java 1.21.1 and 1.20.6 asset packs with no server preset.
The release input and SHA-256 live in `release-sources.json`; generated Java data host provenance
stays beside `core/java-data-viewer.mjs`. The independent client console and metadata monitor
come from the same viewer checkout. No gameplay capture, credential, account or persona is included.

The browser renderer includes upstream terrain scheduling, map and appearance updates. Native
aquatic actors and other native-only integrations retain their separate protocol/capability scope;
this input does not turn Mineflayer into a modded Java client or establish pixel parity.

Explicit `world.viewerAssetsDir` overrides the packaged default. Consumers must rebuild and
replace that directory deliberately, preserve private appearance state and verify the actual
HTTP bundle hash. Updating the package alone is insufficient for such deployments.

Core source is based on `ec3b13c6`, including unknown filtered probe coverage, dry-run effect
exclusion and explicit support repair admission. Planned placement does not erase real failure
evidence or establish successful footing; normal dependency and execution checks remain active.
