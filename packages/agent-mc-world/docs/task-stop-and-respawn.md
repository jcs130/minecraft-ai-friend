# `core/world.ts` / `core/death-lifecycle.ts`: task stop and respawn

`mc_stop` cancels methods, combat and queued body tasks. Death recovery belongs
to the connection lifecycle and keeps its scheduled respawn. A stop after death
does not cancel that timer or send a second respawn request.

Stopping the World, ending the connection or replacing its generation cancels
pending recovery. A native respawn also cancels the pending request. Positive
health and a fresh full inventory packet establish the recovered state; a sent
respawn request alone does not.

`tests/respawn-movement.test.ts` exercises task stops before and after the delay
with the pinned Mineflayer health/inventory/physics plugins and the real
Executor. `tests/login-readiness.test.ts` covers connection stop;
`tests/death-lifecycle.test.ts` covers disconnect, generation replacement and
early server respawn. Tests do not connect to a game server.
