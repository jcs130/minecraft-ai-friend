/** Identical source for the shared Mineflayer and real Java-client method workers.
 * Read-only by default. Explicit params.look={yaw,pitch} sets a view in radians.
 * A completed program certifies neither movement nor task completion.
 */
export const portableMethod = `
const capabilities = await mc.capabilities();
const required = ["read", ...(params.look ? ["look"] : [])];
const missing = required.filter(name => !capabilities.botMethods.includes(name));
if (missing.length) return { ready: false, missing, goalCompleted: false };
const position = await bot.read("entity.position");
if (!position) return { ready: false, reason: "position unknown", goalCompleted: false };
if (params.look) await bot.look(params.look.yaw, params.look.pitch, true);
return { ready: true, position, health: await bot.read("health"), goalCompleted: false };
`;
