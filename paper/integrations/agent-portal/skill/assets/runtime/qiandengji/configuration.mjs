// Mineflayer 4.37.1 can keep its PLAY physics timer running while a modern
// proxy switches back to CONFIGURATION. Never serialize those transient PLAY
// packets with the configuration codec, and never replay them afterwards.
const installs = new WeakMap();
const MOVEMENT = new Set(['position', 'position_look', 'look', 'flying', 'entity_action', 'player_input']);

export function pauseDuringConfiguration(bot) {
  const client = bot._client;
  if (installs.has(client)) return installs.get(client);
  const originalWrite = client.write;
  let suspended = false, restorePhysics = false, closed = false, discarded = 0;
  function pause() {
    if (suspended) return;
    suspended = true;
    restorePhysics = bot.physicsEnabled !== false;
    bot.physicsEnabled = false;
  }
  function state(next) { if (next === 'configuration') pause(); }
  function position() {
    if (client.state !== 'play' || !suspended) return;
    suspended = false;
    bot.physicsEnabled = restorePhysics;
  }
  function write(name, params) {
    if (client.state === 'configuration' && MOVEMENT.has(name)) { discarded++; return; }
    return originalWrite.call(this, name, params);
  }
  function close() {
    if (closed) return;
    closed = true;
    client.off('state', state);
    client.off('position', position);
    bot.off('end', close);
    if (client.write === write) client.write = originalWrite;
    installs.delete(client);
  }
  client.write = write;
  client.on('state', state);
  // Wait for the new server's position correction, rather than simulating the
  // old limbo position as soon as finish_configuration changes the state.
  client.on('position', position);
  bot.once('end', close);
  if (client.state === 'configuration') pause();
  const handle = { close, get discarded() { return discarded; } };
  installs.set(client, handle);
  return handle;
}
