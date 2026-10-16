# Server authorization after connection

The scoped login observer remains active after initial confirmation. A fresh,
system-source `MC_AUTH_DENIED` or structured `MC_AUTH_STATE` with
`authorized:false` revokes the previous ready state. Public chat, malformed state
and an explicitly different account cannot revoke or grant authorization.

This transition reports `required`, preserves the network connection and emits a
World alarm. The Agent receives an explicit description of the missing current
authorization. It does not resubmit a credential, register an account, change a
password, disconnect the game or pause the host loop. A later authoritative
confirmation can restore readiness on the same connection. Initial login
failures retain their existing operator recovery boundary.

This fixes stale client readiness; it does not identify why a particular server
lost its authentication state. The live 2026-10-16 observation showed repeated
denials after successful initial login, alongside repeated submitted commands.
Server-side root cause and successful reauthorization need separate evidence.
