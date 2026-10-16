# Immutable experience aggregate, 2026-10-16

Autonomy 0.1.73 pins engine-only core 0.5.7-dev.20261016.32 from exact source
`c9ac67e2de2b0429b49fe25fe21721852bb6ec5e`, archive SHA256 `ec513eeb71b7da90f06a2a86e61cbfa15cff00de16da9630f10bdb8aa0708ceb`.
The core contains the public native GUI presentation binding used by this runtime.
Normal integration retains both reviewed GUI abort/stow contracts and incoming
host-selected retry/inventory policy. A bounded real-physics readiness fixture
replaces a timing assumption; production movement checks are unchanged.

The packaged default context limit is 65536, with optional 131072 for a supporting
service. Explicit values remain unchanged. The disconnected check uses the actual
Settings default and conservative byte counter with unchanged output/framing
reserves, retaining essential body/place/queue/failure evidence and original-query
handles. The same catalogue is explicitly rejected at 32768 with that fallback.
This does not measure model tokens or prove a deployed server supports 64K. Direct
model configuration does not discover server capacity; the operator must configure
the actual supported limit. Existing 32K configurations are not upgraded implicitly.
The earlier immutable 0.1.72 wheel passed its full suite but failed this required
disconnected budget check. Its artifacts and failure remain recorded separately.

Shared viewer source is `c799ae1a71fd7a03f3404f67e33f2985eed8a7aa`. It is separately supplied,
never embedded in this engine-only core. Source archive `modern-viewer-c799ae1a-source.tar.gz` has
SHA256 `8acc9a51e1bf0a5115f381c4a18552752ac03866f53f1e5fed7230243ec3fb98`; its renderer/host digest is
`08ae93cb4510f201234b8c0111e517c7f10577e031e0cbae6ddb748285c1884a` (315 files).
The source-only archive is produced from tracked source:

```sh
git archive --format=tar.gz --output=modern-viewer-c799ae1a-source.tar.gz c799ae1a71fd7a03f3404f67e33f2985eed8a7aa:packages modern-viewer/renderer-src modern-viewer/src
```

Original resource bytes use a separate **root-scoped** archive, preserving the
repository `.gitattributes` rule `packages/modern-viewer/asset-packs/** -text -whitespace`:

```sh
git archive --format=tar.gz --output=viewer-original-packs-c799ae1a-exact.tar.gz c799ae1a71fd7a03f3404f67e33f2985eed8a7aa packages/modern-viewer/asset-packs/vanilla-1.21.1 packages/modern-viewer/asset-packs/native-1.21.1
```

Its SHA256 is `cba6f1c01685a7d2bbd832a1bea5e0043c6677d07f71ba3caeac69253428a6c2`. Each of 8,456 vanilla and
39,700 native files is checked against its pack.json original byte length and
SHA256, without newline normalization. The `:packages` subtree form must not be
used for asset packs: the root attribute path no longer matches and Git can
convert original JSON bytes, which correctly fails native hash checks. A failed
intermediate archive is retained privately and is not a deployable input.
Use a Unicode-safe tar reader and strip only the leading `packages/` directory
when materializing original resources beside `modern-viewer/renderer-src`.

Build the **extracted source**, with explicit unchanged dependency inputs:

```sh
node tools/build-native-ysm-review.mjs <original-YUI-catalog> <new-output-directory>
```

The original catalog canonical digest is `e014078c1e0498fd70616cb951fb87b8091cea934cc3d26959b8b94394c5f353`;
its eight files are verified by the existing loader. Actual bundle hashes are
recorded under `external_viewer.bundle_sha256` in source.json. This build context
has native-console SHA256 `e9c1b86f4ae1fe4ec41c387204c1c0707dc507c9b50642fbdcdf4db390d52d45`; the prior
scoped source build has a distinct hash and is not relabelled as these bytes.
No private account, world, provider or host installation path is a package default.

Core release-sources.json retains the incoming upstream bundled-viewer provenance;
`build:engine` explicitly disables it. The separately verified external viewer
receipt above identifies the intended optional integration. Saved server-follow
choices and original YUI assets are preserved. Defaults remain disconnected.

These are source/package inputs and offline checks. Live GUI pacing, animation,
voice, travel explanations and survival remain separate acceptance. Additional
performance diagnostics, remaining item/equipment families and actors remain
required before public release. No tag, release or live deployment is asserted.
