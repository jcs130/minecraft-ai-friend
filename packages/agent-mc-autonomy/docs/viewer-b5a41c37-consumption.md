# Viewer source synchronization in autonomy 0.2.4

The external viewer source is pinned to
`b5a41c37d8f503df5344762bd5df5e61c1734f4b`. Its raw Git source archive, renderer
source receipt and 327-file consumer inventory are updated together. The
Minecraft engine remains 0.5.7-rc.7 at `20d731ef`; its archive is unchanged.

This upstream change makes the compatibility viewer's held-map panel collapsed
by default, paints only when expanded and identifies server pixels, missing
pixels and unsupported marker layers. It does not establish that a map is a
photograph. The shared helper and map-pixel tests cover these boundaries.

The current native viewer has separate entry points. Both native browser bundles
build to the same bytes as the previous pin, with identical dependency inputs.
Do not claim this source synchronization adds a held-map panel to the native
console or changes its visible behavior. Textures, models, audio and appearance
inputs are preserved. Source synchronization, installed source selection and
actual live rendering remain separate evidence.
