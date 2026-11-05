import { parentPort, workerData } from 'node:worker_threads';
import { Store, digest } from '../../src/store.mjs';
import { AgentAccess } from '../../src/agent-access.mjs';
import { GameAccounts } from '../../src/game-accounts.mjs';

const { config, action, values } = workerData;
const store = new Store(config.dataDir), game = { roster: async () => [] };
const accounts = new GameAccounts(config, store, game, {
  capabilities: async () => ({ ready: true }), writeRequest: async () => {},
  readResult: async () => { throw Object.assign(Error('not received'), { code: 'ENOENT' }); },
});
const access = new AgentAccess(config, store, game, accounts);
parentPort.postMessage({ ready: true });
parentPort.once('message', async () => {
  const results = [];
  try {
    for (const value of values) {
      try {
        if (action === 'register') await access.publicRegister(value, digest('isolated-network:' + value.requestId));
        else if (action === 'activate') {
          const login = access.login({ clientId: value.clientId, clientSecret: value.clientSecret });
          const context = access.authorize({ headers: { authorization: 'Bearer ' + login.token } });
          await access.activate(context, value.request);
        } else if (action === 'issue') access.pool.issue(store.ownerByName('fixture-admin'), value);
        else throw Error('UNKNOWN_FIXTURE_ACTION');
        results.push({ ok: true });
      } catch (error) { results.push({ ok: false, reason: error.reason || error.code || error.message }); }
    }
    parentPort.postMessage({ results });
  } finally { store.close(); parentPort.close(); }
});
