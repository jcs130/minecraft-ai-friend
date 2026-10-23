# Prepared offline runtime (0.1.78)

The complete distribution targets **Windows x64 with a CPython 3.11 host**.
Unpack the full external ZIP, run its `prepare.cmd`, import the adjacent real
official SDK `.neko-plugin`, configure your own account/model, then explicitly
start. Neko itself, account credentials, model providers/weights and private
worlds are not part of the neutral runtime. Preparation neither starts an
application nor contacts the network. Git, npm, globally installed Node,
PowerShell policy changes and a Python builder are unnecessary for recipients.

The SDK plugin remains a normally importable archive. Large resources and
runtime dependencies are adjacent to it in the external delivery ZIP. The
composer enforces the SDK's 500 MiB import, 10,000 entry, 1 GiB expanded and
256 MiB member limits. The full external ZIP is not a Market upload (whose
download limit is 200 MiB), nor an SDK import limit bypass.

## Immutable payload and preparation

`runtime-manifest.json` is a descriptor limited to 64 KiB. It declares schema
`agent-mc-runtime-bundle/v1`, platform/architecture, exact core/viewer source
pins, Node version/hash, component/resource paths and licensing notices.
It binds `runtime-files.json` by SHA-256 and count. The separate inventory is
limited to 32 MiB / 100,000 files / 8 GiB total / 512 MiB per file.

All payload paths are relative to the bundle. Full verification rejects
traversal, absolute paths, Windows device names/alternate streams/trailing
dots/spaces, case collisions, missing/unlisted files, links/reparse points,
wrong source/platform/version and damaged bytes. SHA-256 detects corruption
relative to the trusted distribution; this format is not a digital signature.
Canonical core build/source/type receipts remain independently enforced.

`source.json` also pins the SHA-256 of packaged `viewer-source.json`: an exact
323-member public raw Git source inventory. Distributor preflight verifies it
before creating a destination or copying dependencies. Full Python/Node checks
require the complete viewer source projection to match, including parent
package metadata, renderer files and sibling adapters. Only `node_modules`
directories are excluded from this projection; resources live separately.
Missing, modified or extra source files fail even if the bundle's own inventory
is regenerated. Metadata-only resolution never reads this source map.

`prepare.cmd` invokes only `node/node.exe` and `prepare.mjs`. It checks every
payload byte and all core receipts, copies the payload once into its own
versioned local cache, and verifies the copied bytes before publishing a
registration. The portable catalog remains immutable. The installed runtime,
absolute machine-local catalog and registration are written under:

```
%LOCALAPPDATA%/AgentMCWorld/installations/<id>-<manifest-sha256>/
%LOCALAPPDATA%/AgentMCWorld/current.json
```

The current pointer is replaced atomically after complete preparation. Each
installation retains its own registration; another version does not overwrite
it. Identical preparation verifies and reuses the installed copy without
recopying it. An interrupted copy leaves its uniquely named staging directory
and preserves the previous pointer; retry creates a fresh stage. Conflicting
installed bytes fail without overwriting them. After successful preparation
and plugin import, the extracted download folder may be deleted. The runtime
continues from the local cache. Local registrations are never included in
source archives or the delivery ZIP.

## Host boundary

`Settings.parse` remains filesystem-pure. A thin host explicitly calls:

```python
from agent_mc_autonomy.runtime_bundle import apply_runtime_defaults
from agent_mc_autonomy import Settings

effective = apply_runtime_defaults(raw_config)  # prepared current registration
settings = Settings.parse(effective)
```

`apply_runtime_defaults(raw, *, bundle_root=None, registration_file=None) -> dict`
returns a deep copy. An explicit bundle root chooses its own prepared versioned
registration by descriptor identity, whether the selected root is the extracted
source or the cached copy; an explicit registration file selects that
installation directly.
No service/disk scanning occurs. The helper fills `backend.node`,
`backend.directory`, `viewer.renderer_directory`, `viewer.catalog_file`,
`viewer.bundled_appearance_catalog_file`, and `runtime.bundle_root` /
`runtime.bundle_manifest_sha256`. Autonomy/auto-start are not enabled.

Any nonempty custom Node/backend/viewer/catalog/appearance/observer URL bypasses
implicit default application as a whole, avoiding mixed runtime components.
External observer mode and Java framebuffer configurations also pass through.
Hosts must pass actual user selections, not insert a default `node` string or
old developer paths before this helper. Do not persist resolved machine paths
back over the user's portable configuration. A missing/damaged selected
registration raises `BundleError` with a `runtime_bundle_*` reason and an
actionable instruction to unpack/prepare again; it never falls back to another
binary or downloads dependencies.

If a UI does round-trip the displayed resolved values, it **must also retain**
the returned `runtime.bundle_root` and `runtime.bundle_manifest_sha256` binding
as installation metadata. Applying defaults again preserves that binding, and
explicit start still checks all bytes and supplies the bundled browser child
environment. Saving only displayed Node/backend/viewer paths drops provenance
and is not a supported host integration. A deliberate switch to a custom
runtime clears both binding fields together; changing a component while keeping
the binding fails at start instead of silently mixing binaries.

`resolve_prepared_bundle(..., verify_integrity=False) -> PreparedBundle` reads
only bounded metadata and returns root, Node, backend, renderer, catalog,
appearance catalog and manifest SHA-256. It does not load the large inventory
or claim current payload integrity/live readiness. `verify_bundle(root,
expected_manifest_sha256=None, full=True)` performs the complete check;
`full=False` explicitly returns `integrityVerified=False`.

The normal `run_session` boundary calls `verify_settings_runtime(settings)`
before creating a body process, verifies the exact selected component paths
and requires the expected core MCP entry. This checks every byte again at
explicit start, including resources/dependencies. Other standalone starters
must call that guard themselves. Metadata availability is never live scene or
body proof. All existing unknown-dispatch, pending acknowledgement, lease and
explicit start/stop guards remain in place.

The standalone CLI selects this same contract with `--bundle-root <root>` or
`--bundle-registration <registration.json>`, alongside its normal `--config`.
Absent these explicit options, its existing behavior is preserved.

## Distributor inputs

`python -m agent_mc_autonomy.runtime_bundle.build` accepts a **new** destination,
bundle ID and seven explicit prepared directories: official Node, installed
backend, exact viewer root (renderer-src plus sibling src), complete original
assets, original appearances, licenses and portable browser. Inputs must be physical regular
files; author workspace junctions are rejected. It retains all npm dependency
licenses and includes Node's original LICENSE. The renderer needs the actual
esbuild 0.28.2 Windows x64 executable even though upstream labels it a dev
dependency: normal viewer preparation builds its browser modules. The six
sibling viewer src adapters are required as well.

The full original Java 1.21.1 sound pack resides under
`resources/vanilla-1.21.1/public/sounds`, alongside original visual resources.
The vanilla registry hash begins `55893d26`; the separately tracked modpack
registry beginning `039bd785` must not replace it. YUI source/catalog bytes
retain their original hashes. Assets and original metadata are not rewritten.

The installer source `.tgz` and one optional upstream research note containing
an author-machine path are omitted from the runtime copy; neither is a
build/source/types receipt member or runtime dependency. Exact source/archive
inputs remain separately recorded by the distributor. No runtime receipt is
weakened and no third-party executable is patched.

`compose_delivery(runtime, plugin, output, instructions)` verifies the complete
runtime and supplied real SDK plugin bounds, then writes a new external ZIP.
It does not build an SDK plugin, manufacture placeholders, publish a release,
modify SDK limits or start a host. The host adapter owns its official SDK build
and final public entry acceptance before composition.
