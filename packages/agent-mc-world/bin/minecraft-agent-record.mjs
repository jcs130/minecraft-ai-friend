#!/usr/bin/env node
import { runGameplayRecorder } from '../dist/runtime/src/learning/record-cli.js';
if (!process.argv[2]) { console.error('Usage: minecraft-agent-record <explicit-private-profile.json>'); process.exit(2); }
try { await runGameplayRecorder(process.argv[2]); }
catch { console.error('Gameplay recorder failed; inspect its private status and scope configuration. No game action was dispatched.'); process.exitCode=1; }
