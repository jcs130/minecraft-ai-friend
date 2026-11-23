# Windows continuity for a hosted Cortico player

The existing launcher starts Cortico and coordinates its body handoff with the resident service.
Run the watchdog once a minute under the same Windows account. Losing the PowerShell
launcher alone does not justify stopping a running Cortico instance. The watchdog can
adopt its recorded Node CLI process with a verified child World listener and an
active loopback World probe. It renews only the coordination file for that body and
owner. Numen's native controller lease remains authoritative.

Keep the script and its configuration in a private operator directory. Set:

- root: the managed deployment directory containing the existing controller lock, launch report and seat configuration.
- residentRoot: the unified resident deployment with the matching role, health file and handoff path.
- repo, node: the pinned Cortico checkout and Node executable, as in the original launch configuration.
- deployment, role, world, port: the original Cortico profile, resident role, World ID and loopback UI port.
- launchTask: the existing task that acquires the body and starts Cortico.

Register it with Register-HostedCorticoWatchdog.ps1 -Config <absolute JSON path> -TaskName <new task>.
The separate task works while the operator's Windows account is logged in, including
while the desktop is locked. It does not replace or alter the existing launch task.

The watchdog reports to watchdog.json. A foreign listener, an unresolved original
action or a conflicting coordination file prevents a new launch. A live but unhealthy
World does not trigger a second controller. When the original process and listener
are both absent, the existing launcher handles reacquisition from the resident
controller. No action is replayed.

The resident service rechecks server vacancy after a timed-out handoff probe.
It only retries the read and still requires the old Numen fence to be vacant
before handing off or reacquiring a body.

An operator stop file or resident maintenance pause disables recovery. For an adopted
process, use Cortico's normal local shutdown to stop it, with the stop file in place
to prevent an automatic restart. To remove the watchdog, disable its task; its
coordination lease expires on its own. Do not remove an active native lease.

Run test-hosted-cortico-watchdog.ps1 with Windows PowerShell to check adoption,
World failure, process and lease identity, unknown receipts, exit and stop behavior.

## Optional nearby commentary for Kirito

Append [the Cortico profile](kirito-nearby-narration.md) to this role's orientation
and use Cortico's Apply Now button to reload the prompt in the current session.
Append [the resident fallback profile](kirito-nearby-narration-resident.txt) to the
same role's persona in roles.json; the resident service reads it on its next start.

Use one Numen voice call for a useful decision or confirmed milestone. QiandengVoice
delivers its existing nearby captions and SVC audio from that same utterance.
A voice queue acknowledgement is not a listener receipt. Verify the role's voice
ledger and, during a spectator check, an attached viewer's voice connection and
proximity. Keep normal player captions and voice preferences in effect.
