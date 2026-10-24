# Server authorization after connection

## Password-server compatibility

With an explicitly configured, server/account-bound `command:"login"` credential,
a direct system message containing `/login` also counts as a request. This covers
AuthMe's comma and plugin-prefix variants without changing existing request markers.
Player chat and common forwarded player wrappers are excluded; `/loginx` and
`/register` never trigger this fallback. A configured registration action still
requires its own explicit markers. No password configuration means no automatic
login command.

The standard AuthMe success and session-reconnection receipts are recognized as
exact messages, optionally with its `[AuthMe]` prefix. They do not match quoted,
negated or player-chat text, and cannot override structured authorization state.
A standard wrong-password receipt blocks further submission. These compatibility
receipts come from the [official AuthMe message definitions](https://github.com/AuthMe/AuthMeReloaded/blob/master/authme-core/src/main/resources/messages/messages_en.yml).
Other server-specific confirmations can still use explicit `successMarkers`.

Initial timeout diagnostics preserve the actual phase through the disconnect,
connection state and World operator text:

| Reason | Meaning |
| --- | --- |
| `request-not-detected` | No login request was recognized; no password was submitted. |
| `credential-read-timeout` | A request was recognized but private credential loading did not finish; no password was submitted. |
| `confirmation-timeout` | The configured command was submitted but authorization was not confirmed; this is not proof of a bad password. |

Existing DSH first-run password files use the same contract and require no
credential rewrite. The adapter must consume the fixed core release. Passwords,
submitted commands and private file contents never enter diagnostic metadata.

An existing private JSON identity can supply a game password without copying it
into another credential file. Configure `credentialFile`, `credentialFormat:"json"`
and one explicit top-level string `credentialField` (for example `gamePassword`).
The server/account match and authoritative login gate remain unchanged. JSON files
must be private, at most 16 KiB; missing/non-string fields, invalid JSON and whitespace
in passwords fail without logging file contents. An API token is never chosen as a
fallback. Account registration and external API readiness remain the server pack's
responsibility, not a core default.

The scoped login observer remains active after initial confirmation. A fresh,
system-source `MC_AUTH_DENIED` or structured `MC_AUTH_STATE` with
`authorized:false` revokes the previous ready state. Public chat, malformed state
and an explicitly different account cannot revoke or grant authorization.

This transition reports `required`, preserves the network connection and emits a
World alarm. An explicitly configured `login` account can submit its existing scoped
credential once after a direct `MC_AUTH_DENIED` or a structured `login_required`
revocation of a previously confirmed session. Submission never opens the play gate;
only a fresh authoritative confirmation does. Repeated denial messages do not submit
again. After a successful recovery has remained authorized for 30 seconds, another
later revocation may renew the session. Immediate success/denial loops stop at
`required` for operator review. An account can opt out with
`reauthenticateOnRevoked:false`; registration commands are never repeated.

An expired recovery attempt remains `required` on the same connection. Delayed
credential reads cannot send after the timeout or a stop. Explicit password rejection,
two-factor requirements and unavailable credentials remain blocked. This recovery
does not register an account, change a password, disconnect the game, pause the host
loop or replay a body action. A later authoritative confirmation can restore readiness
on the same connection.

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
