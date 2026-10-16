# Server authorization after connection

The scoped login observer remains active after initial confirmation. A fresh,
system-source `MC_AUTH_DENIED` or structured `MC_AUTH_STATE` with
`authorized:false` revokes the previous ready state. Public chat, malformed state
and an explicitly different account cannot revoke or grant authorization.

This transition reports `required`, preserves the network connection and emits a
World alarm. The Agent receives an explicit description of the missing current
authorization. It does not resubmit a credential, register an account, change a
password, disconnect the game or pause the host loop. A later authoritative
confirmation can restore readiness on the same connection.

An initial confirmation timeout reports `retrying`, not a rejected credential.
The connection owner closes only that attempt, disposes its observers and uses
the existing 3/10/30/60 second reconnect backoff. Password acceptance without a
final authorization receipt never enables play. The retry counter resets only
after both authorization and a usable spawn. Each new connection may submit
the configured credential once in response to its own system login request;
old messages and delayed credential reads cannot authorize the new body.
Explicit rejection, two-factor requirements and invalid local credentials or
configuration remain blocked. Manual stop and host shutdown cancel retries.

This reconnects the body inside the existing World. Goals, memory and host
session stay in place, while old body work is interrupted and current world
facts must be sampled again. It never replays old movement or declares a goal
complete merely because the connection returned.

This fixes stale client readiness; it does not identify why a particular server
lost its authentication state. The live 2026-10-16 observation showed repeated
denials after successful initial login, alongside repeated submitted commands.
Server-side root cause and successful reauthorization need separate evidence.
