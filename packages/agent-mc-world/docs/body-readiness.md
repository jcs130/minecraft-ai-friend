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

Current request facts and deferred snapshots also consult this observer. While the body is unready they report explicit unknown physical readings with the native phase and boundary, retain goal intent and attributed terminal history, and omit action candidates. Proximity/gesture sampling pauses rather than interpreting the old death position as current. A real landing and physics tick restores ordinary readings; no reconnect or respawn packet is fabricated.

During respawn, facts retain the same death episode and its recorded daily count.
A health packet received after this boundary is exposed separately with its
original observation time, even if the landing is still unknown. It never grants
physical readiness. Transport/authentication readiness remains a distinct field:
`body-not-ready` does not mean disconnected. A later boundary invalidates the
earlier health packet's currentness.

An optional observer callback reports boundary, first position and first physics
tick transitions. Bridge logs these with the connection generation and protocol
state to distinguish missing input from unfinished physics. Ordinary 20 Hz ticks
and position corrections do not generate additional log records.
