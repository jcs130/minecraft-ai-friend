# Native body readiness

`installNativeBodyReadiness` observes an existing Mineflayer body. It creates no
body, sends no packet, changes no physics flag and starts no timer. A death,
native respawn, login, configuration transfer or mount invalidates the old
position and tick evidence. Positive health and `spawn` alone never validate a
landing. A fresh PLAY position followed by a real physics tick restores it.
Normal position corrections retain current tick evidence. A stationary player
with continuing physics remains ready; lack of coordinate movement is not a
failure. Five seconds without a tick makes physical readiness unknown again.

The public client entry exports this observer, its bounded reading and
`nativeBodyBlockedReason`. Installation is idempotent and disposal leaves the
old bot explicitly closed. Existing consumers without installation retain
their previous compatibility behavior.

The core Bridge installs the observer per connection. The executor reports a
physical step as blocked before dispatch when readiness is missing. Chat keeps
its independent transport/authentication rules. Combat refuses entry on stale
body state, and its existing wall-clock watcher releases an active hold if
physics stops. This reports `stuck`, never a successful retreat, kill or goal.
Resumed queued steps still pass the executor's fresh body gate.

Hosts retaining their own body install the same observer before login and call
the public gate at physical dispatch and automatic-combat entry. They must not
clone a second body or reset private Mineflayer flags to make the gate pass.
The narrow `agent-mc-world/body-readiness` entry loads only the observer.
[`examples/cortico-body-readiness-0.2.11.patch`](../examples/cortico-body-readiness-0.2.11.patch)
shows the tested original-host hooks; its dependency must resolve to the same
verified package archive as the host's other shared helpers.
An upstream host's timed “respawn confirmed” message must likewise be held while
the shared reading lacks a fresh landing. The observer does not guess a missing
server packet, authorize unknown-action replay, cancel model requests or force
a reconnect. Missing position packets still require protocol/server diagnosis.

Regression coverage includes the real pinned Java 1.21.1 health/physics plugins:
positive health with no new position produces no movement; a subsequent real
position restores simulation. Separate combat checks omit all physics callbacks
and verify wall-time termination with no successful-escape claim.
