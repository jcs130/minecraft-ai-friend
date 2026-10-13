import { parentPort, workerData } from 'node:worker_threads';
import 'ses';
import { Vec3 } from 'vec3';
import { procedureProgram } from './support/procedure-program.mjs';

lockdown({ errorTaming: 'unsafe', consoleTaming: 'safe' });

let serial = 0;
const pending = new Map();
const rpc = harden((method, args = {}, scope) => {
  const result = new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject, method });
    parentPort.postMessage({ kind: 'call', id, method, args: JSON.parse(JSON.stringify(args)), scope });
  });
  const name = method === 'mineflayer' ? `bot.${args.name}` : `mc.${method}`;
  return new Proxy(result, {
    get(target, key) {
      if (key === 'then' || key === 'catch' || key === 'finally') return target[key].bind(target);
      if (key === Symbol.toStringTag) return Reflect.get(target, key);
      throw new TypeError(`${name}() returns a Promise; await it before reading ${String(key)}. No observation was read from this Promise.`);
    },
  });
});
parentPort.on('message', (message) => {
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(harden(request.method === 'mineflayer' ? revive(message.value.value) : message.value));
});

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 3 && ['x', 'y', 'z'].every(key => typeof value[key] === 'number')) {
    return new Vec3(value.x, value.y, value.z);
  }
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)]));
  if (value.properties && value.stateId !== undefined && value.position) result.getProperties = () => result.properties;
  return result;
}

function capabilities(scope) {
  const bot = workerData.nativeMethods ? Object.fromEntries(workerData.nativeMethods
    .filter(name => name !== 'inventory.items').map(name => [name, (...args) => rpc('mineflayer', { name, args }, scope)])) : undefined;
  if (bot) bot.inventory = { items: () => rpc('mineflayer', { name: 'inventory.items', args: [] }, scope) };
  return { mc: harden({ state: () => rpc('state', {}, scope), do: steps => rpc('do', { steps }, scope),
    flightPlan: args => rpc('flightPlan', args, scope) }), ...(bot ? { bot: harden(bot), Vec3: harden(Vec3) } : {}) };
}

try {
  let result;
  if (workerData.graph) {
    const program = procedureProgram(workerData.graph, { capabilities, maxInvocations: workerData.maxInvocations,
      onInvocation: event => parentPort.postMessage({ kind: 'procedure', ...event }) });
    result = workerData.validate ? program.validate() : await program.run(workerData.params);
  } else {
    const compartment = new Compartment({ ...capabilities(), params: harden(workerData.params) });
    const program = compartment.evaluate(`(async () => {\n${workerData.code}\n})`);
    if (typeof program !== 'function') throw new Error('code必须是异步函数体');
    result = workerData.validate ? { valid: true } : await program();
  }
  parentPort.postMessage({ kind: 'done', value: result === undefined ? null : result });
} catch (error) {
  parentPort.postMessage({ kind: 'error', error: String(error).slice(0, 1600) });
}
