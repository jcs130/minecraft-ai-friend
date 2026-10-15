import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { accountScript } from '../src/client/account-page.ts';

function page(reply: Record<string, unknown>) {
  const nodes = new Map<string, any>();
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: false, disabled: true, removeAttribute: vi.fn() }); return nodes.get(id); };
  const fetch = vi.fn(async () => ({ ok: true, json: async () => reply }));
  runInNewContext(accountScript, { location: { pathname: '/account/' + 'a'.repeat(64) }, URL, Date,
    document: { hidden: false, getElementById: node, addEventListener: vi.fn() }, fetch, setInterval: vi.fn() });
  return { fetch, node };
}
const state = () => ({ instanceId: 'a'.repeat(64), schema: 'minecraft-client-console/v1', runtime: { phase: 'started' },
  controlToken: 'fixture-control', configuredAccounts: {agent:'fixture-account'}, configuredAuthentication: {agent:'microsoft'},
  connection: { server: {requestedVersion:'1.21.1',actualVersion:null}, accounts: { agent: {phase:'awaiting-user',
    challenge: {userCode:'FIXTURE-1234',verificationUri:'https://www.microsoft.com/link',expiresAt:new Date(Date.now()+60000).toISOString()} } } } });

it('renders a human challenge and cancels only the bound native connection', async () => {
  const app = page(state());
  await vi.waitFor(() => expect(app.node('code').textContent).toBe('FIXTURE-1234'));
  expect(app.node('verification').href).toBe('https://www.microsoft.com/link');
  expect(app.node('server').textContent).toContain('实际版本 未连接');
  await app.node('disconnect').onclick();
  expect(app.fetch.mock.calls[1]).toEqual(['/api/client/action', expect.objectContaining({body:'{"action":"disconnect"}',
    headers: {'content-type':'application/json','x-mc-control':'fixture-control','x-mc-instance':'a'.repeat(64)}})]);
});
it.each(['expired', 'hostile', 'replaced'])('hides unusable or mismatched human challenges: %s', async reason => {
  const reply = state();
  if (reason === 'expired') reply.connection.accounts.agent.challenge.expiresAt = '2000-01-01T00:00:00Z';
  if (reason === 'hostile') reply.connection.accounts.agent.challenge.verificationUri = 'https://attacker.test/';
  if (reason === 'replaced') reply.instanceId = 'b'.repeat(64);
  const app = page(reply);
  await vi.waitFor(() => expect(app.fetch).toHaveBeenCalledOnce());
  await new Promise(resolve => setImmediate(resolve));
  expect(app.node('code').textContent).toBe('');
  expect(app.node('challenge').hidden).toBe(true);
  if (reason === 'replaced') {
    await app.node('disconnect').onclick();
    expect(app.fetch).toHaveBeenCalledOnce();
    expect(app.node('disconnect').disabled).toBe(true);
  }
});
