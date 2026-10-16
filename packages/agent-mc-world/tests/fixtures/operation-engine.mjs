// Offline IPC fixture: no game client, network, model or production state.
export function createEngine() {
  let host, x = 0, unavailable = false, broken = false, pending;
  const scope = { realm: 'fixture-realm', account: 'offline:fixture', agent: 'fixture' };
  const receipt = (id, terminal) => ({ kind: 'task', id, phase: terminal ? 'completed' : 'accepted', terminal, goalCompleted: false });
  const finish = async id => host.pushEvent({ source: 'minecraft', type: 'minecraft.task',
    ts: new Date().toISOString(), text: 'original terminal', execution: receipt(id, true) });
  return {
    start: async h => { host = h; }, stop: async () => {},
    console: () => ({ lamps: [], storage: [] }), envPromptRuntimeVars: () => ({}),
    requestFacts: () => {
      if (broken) throw new Error('sample unavailable');
      return unavailable ? null : { text: 'fixture sample', snapshotTypes: [], experience: { scope,
        observation: { at: new Date().toISOString(), dimension: 'overworld', position: { x, y: 64, z: 0 },
          health: 20, food: 18, inventory: { stone: x } } } };
    },
    tools: () => [
      { name: 'mc_do', handler: async args => {
        unavailable = false; broken = false;
        if (args.mode === 'early') { x = 3; await finish(args.id); x = 9; }
        if (args.mode === 'early-broken') { broken = true; await finish(args.id); }
        if (args.mode === 'later') { x = 11; pending = args.id; }
        if (args.mode === 'sync') x = 17;
        if (args.mode === 'missing') unavailable = true;
        if (args.mode === 'broken') broken = true;
        if (args.mode === 'throws') { unavailable = true; throw new Error('original dispatch failure'); }
        return { text: 'original outcome', execution: receipt(args.id, !['early', 'early-broken', 'later'].includes(args.mode)) };
      } },
      { name: 'mc_fixture_finish', handler: async args => {
        if (args.reset) { unavailable = false; broken = false; x = 17; return { text: 'known scene' }; }
        x = 13; await finish(pending); x = 15;
        return { text: 'follow-up delivery' };
      } },
    ],
  };
}
