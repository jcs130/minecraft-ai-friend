# Optional native behavior settings

Ordinary installation needs only a server address, player identity and model binding. The default `native` table is empty; the core supplies its own defaults. These settings apply at the next explicit start, through the same native executor.

```toml
[native]
scaffold_blocks = ["dirt", "cobblestone"]

[native.combat]
enabled = true
engageRadius = 3
chaseMax = 6
maxSec = 30
space = 2.6
busyRatio = 60
cooldownSec = 60

[native.reflex]
fightBack = true
antiDrown = true
antiLava = true
fleeHealth = 10
reactCooldownSec = 8

[native.journey]
enabled = true
choiceMinBlocks = 10
choiceMaxBlocks = 20
dangerChoiceMaxBlocks = 5

[native.idle]
enabled = false
allowMovement = false
afterArrival = false
minIdleMs = 6000
minIntervalMs = 12000
maxIntervalMs = 28000

[native.show]
clickMs = 400
dwellOpenMs = 800
dwellResultMs = 1200
dwellCloseMs = 600
reopenGapMs = 900
budgetMs = 12000
```

Delete optional overrides to follow future core defaults. Remote textures (`native.remote_textures`) and background visual capture (`native.visual.background`) can also be explicitly selected. Unknown keys and invalid types/ranges are rejected. Server processes, cheats, permissions, collision, inventory confirmation, task deadlines and unknown-outcome acknowledgement cannot be configured through this table.

## Private existing-account login

The core already accepts an explicit `server.login_config_file` referencing a private scoped account document. `server_login.prepare_login(data, settings, password)` prepares this contract without connecting or sending chat. It never registers an account, changes a game password, or chooses a command from server text. On Windows it uses current-user DPAPI; another Windows account cannot decrypt this file. On other platforms the mounted secret has mode 0600.

An empty password preserves an existing matching managed credential, never another server/account's credential. Public status exposes only enabled/managed/configured booleans. Host applications should keep the input write-only, fence active workers and save the returned reference through their normal settings API.
