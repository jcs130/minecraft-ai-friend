// Validates mc_maids arguments with the REAL touhou-maids maid-port (maidCommand) and prints MAID_TOOL.
// Protocol: first line out = MAID_TOOL JSON; then for each JSON line in -> {"ok":true,"command":...} | {"ok":false,"error":...}.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
const port = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(JSON.stringify(port.MAID_TOOL) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  try { const entry = port.maidCommand(JSON.parse(line)); process.stdout.write(JSON.stringify({ ok: true, command: entry.command, action: entry.action }) + '\n'); }
  catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: String(error.message) }) + '\n'); }
}
