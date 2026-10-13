/** Run with: node --import tsx minecraft-client.ts <private-config.json>
 * This example discovers the client without connecting. The host owns wakeups/model/memory.
 */
import { MinecraftAgentClient, loadMinecraftClientConfig, nullLogger } from 'agent-mc-world/client';

const config = process.argv[2];
if (!config) throw new Error('Pass a private Minecraft client configuration file.');
const client = new MinecraftAgentClient({ ...loadMinecraftClientConfig(config), log: nullLogger() });
console.log(JSON.stringify({ status: client.status(), tools: client.tools().map(({ name }) => name) }));
console.log(await client.environment());
// After the host chooses to connect:
// await client.connect();
// const accepted = await client.call('mc_do', { steps: [...] });
// Consume client.journal.read(after, limit, run), then evaluate actual terminal/world evidence.
// await client.disconnect();
