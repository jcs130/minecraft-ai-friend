# experimental-26.2

Locally locked, unpublished Java 26.2 client stack used by agent-mc-world when the
negotiated protocol is 776 / version 26.2. This is **experimental support**, not
an official PrismarineJS or agent-mc-world release.

See `SOURCE-LOCK.json` for commits. Do not replace the package's default
`mineflayer` / `minecraft-data` / `minecraft-protocol` dependencies with this
tree. Old versions keep using the official npm packages.

## License and attribution

This tree is a locally locked copy of unpublished experimental forks, used only
when the core selects Java 26.2. It is not an official PrismarineJS or
agent-mc-world release.

| Component | Upstream | Locked commit | License (as shipped) |
| --- | --- | --- | --- |
| mineflayer | Cyverno/mineflayer@pc26_2-finish (PR #4192) | `dda625d98d4bab3857383bf8c662b76f847075fe` | MIT; see `mineflayer/LICENSE` |
| minecraft-protocol | Cyverno/node-minecraft-protocol@pc26_2-finish (PR #1550) | `5527f8aa8d94bf2e2fdd5f5ab7963917cb96df37` | BSD-3-Clause; see `minecraft-protocol/LICENSE` |
| minecraft-data wrapper + 26.2 overlay | PrismarineJS/node-minecraft-data `1cdd2d17` (3.119.0) with Cyverno/minecraft-data@pc26.2-data-fixes `6cff26d8` (PR #1344) | see `SOURCE-LOCK.json` | MIT per `minecraft-data/package.json` (`"license": "MIT"`). The local experimental copy did not include an upstream LICENSE file. |

Official packaged defaults remain `mineflayer@4.39.0`, `minecraft-protocol@1.68.0`,
and `minecraft-data@3.119.0`. prismarine-chunk 1.41.0 and prismarine-physics
1.11.1 stay official; 26.2 is aliased onto the 26.1/1.18 implementations in
`dependency-patches.ts` because map_chunk / update_light / block_change schemas
match 26.1. Those GitHub forks were not vendored.
