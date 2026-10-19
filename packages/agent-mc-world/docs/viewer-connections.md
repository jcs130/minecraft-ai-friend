# Viewer connections

The modern viewer does not cap ordinary audience connections by default. Its
shared client profile option `viewerMaxSessions` is `0` for unlimited admission,
or a positive integer for an explicit deployment limit. A World configuration
uses its own namespace, for example `worlds.mymc.viewerMaxSessions`.

This setting takes effect when the viewer starts. It does not change the
Minecraft server's player limit, model request concurrency, or network binding.
The viewer still binds to loopback and checks the connection origin.

`GET /healthz` reports `viewers`, `maxSessions` and `audienceUnlimited`. When
unlimited, `maxSessions` is `Number.MAX_SAFE_INTEGER` for existing observers
that compare counts directly; `audienceUnlimited: true` describes the policy.
The profile value remains `0`. Passive gameplay recording currently uses the
same audience lane. Temporary visual
captures retain their independent single-session lane and capture lease.

Unlimited admission does not imply unlimited rendering or network capacity.
Each ordinary page maintains its own world stream. Close unused pages when
measuring resource use; changing source is not evidence that a running viewer
has loaded the new policy.
