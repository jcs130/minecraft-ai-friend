# Candidate 0.5.3

Long navigation now offers a safe checkpoint after each completed local leg. A queued short task such as eating can run, then the original fixed destination resumes with the same execution identity. The existing dry-footing, inventory, body-owner, combat and active-effect guards remain in force; no checkpoint is forced in water or during combat.

Server-command travel no longer treats a supplied coordinate that already contains the current position as a verified server destination. It refuses without dispatch and asks the caller to verify the actual destination. Dependent steps remain blocked. Ordinary remote travel still waits for observed arrival before releasing successors; a dispatched command alone is not success.

The candidate consumes core main 0.5.2 and shared viewer main 4b59ce79. Viewer inputs are rebuilt under a distinct immutable artifact name with their own SHA, preserving the upstream input record separately. Java 1.21.1 remains primary, with explicit 1.20.6 assets.
