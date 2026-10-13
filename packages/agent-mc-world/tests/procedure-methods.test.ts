import { afterEach, describe, expect, it } from 'vitest';
import { MethodRunner, type MethodRun } from '../core/method-runner.ts';
import { PROCEDURE_RECEIPT_MIME, resolveProcedure } from '../core/support/procedure.ts';
import { fixtureBlobs, procedureFixture, procedureRef } from './procedure-fixture.ts';
import { methodHarness, methodEnded } from './method-harness.ts';
import type { WorldHost } from '../core/support/host-contract.ts';

const runners: MethodRunner[] = [];
afterEach(() => runners.splice(0).forEach(r => r.stop('test cleanup')));
function validate(versions: ReturnType<typeof procedureFixture>[]) {
  const root = versions[0], reference = procedureRef(root);
  let ended!: (r: MethodRun) => void;
  const result = new Promise<MethodRun>(resolve => {ended=resolve;});
  const runner = new MethodRunner({call: () => {throw new Error('validation invoked World');}, onFinish: ended});
  runners.push(runner);
  runner.start({name: root.id, code: root.code, validate: true,
    procedure: {reference, graph: resolveProcedure(reference, root.adapter, fixtureBlobs(versions))}});
  return result;
}

describe('composed executable Minecraft methods', () => {
  it('validates every pinned dependency without executing action code', async () => {
    const child = procedureFixture('child', 'await mc.do([{skill:"chat",text:"test"}]);');
    const root = procedureFixture('root', 'return await methods.run("child");', {dependencies: {child: procedureRef(child)}});
    expect(await validate([root, child])).toMatchObject({status: 'validated', trace: [], result: {valid: true, versions: 2}});
    const invalid = procedureFixture('invalid', 'const = ;');
    const wrong = procedureFixture('wrong', root.code, {dependencies: {child: procedureRef(invalid)}});
    expect(await validate([wrong, invalid])).toMatchObject({status: 'failed', trace: []});
  });

  it('executes composed action groups with real physics and preserves child identities and actual receipts', async () => {
    const r = methodHarness();
    try {
      const child = procedureFixture('walk', `const action=await mc.do([{skill:'control',keys:['forward'],
        durationMs:300,yawDeg:params.yaw}]);return {done:action.done,taskId:action.taskId,after:action.state.snapshot.position};`);
      const root = procedureFixture('corner', `const before=await mc.state();const a=await methods.run('walk',{yaw:180});
        const b=await methods.run('walk',{yaw:-90});const after=await mc.state();return {before:before.snapshot.position,a,b,after:after.snapshot.position};`,
      {dependencies: {walk: procedureRef(child)}});
      r.host.blob = fixtureBlobs([root, child]);
      const tool = r.world.tools().find(t => t.name === 'mc_script')!;
      const reply = await tool.handler({procedure: procedureRef(root)}, {role: 'main', log: r.host.log});
      expect(reply).toMatchObject({text:expect.stringContaining('已启动'),execution:{kind:'method',phase:'accepted',goalCompleted:false}});
      const run = await methodEnded(r, r.runner.read().at(-1)!.id);
      expect(run.status).toBe('completed');
      expect(r.bot.entity.position.x).toBeLessThan(0);
      expect(r.bot.entity.position.z).toBeGreaterThan(1);
      expect(run.procedure?.invocations.map(v => [v.revision, v.status])).toEqual([
        [root.revision, 'completed'], [child.revision, 'completed'], [child.revision, 'completed']]);
      expect(run.trace.filter(t => t.method === 'do').map(t => t.procedure?.invocation)).toEqual([2, 3]);
      const event = r.host.events.find(e => e.type === 'minecraft.method')!;
      const bytes = (event as unknown as Parameters<WorldHost['pushEvent']>[0]).blobs?.[0];
      expect(bytes && 'bytes' in bytes && bytes.mime).toBe(PROCEDURE_RECEIPT_MIME);
      const receipt = JSON.parse(Buffer.from((bytes as {bytes: Uint8Array}).bytes).toString('utf8'));
      expect(receipt.executionId).toBe(run.procedure?.executionId);
      expect(receipt.trace.filter((t: {method: string}) => t.method === 'do')).toMatchObject([
        {result: {done: true, taskId: 1}}, {result: {done: true, taskId: 2}}]);
      expect(receipt.versions).toContainEqual(expect.objectContaining({revision: child.revision, author: child.author}));
    } finally {r.close();}
  });

  it('shares native body ownership and cancellation cleanup across child methods', async () => {
    const r = methodHarness();
    try {
      const child = procedureFixture('hold', `await bot.setControlState('forward',true);return 1;`);
      const root = procedureFixture('mixed', `await methods.run('hold');await mc.do([{skill:'control',keys:['back'],durationMs:300}]);`,
        {dependencies: {hold: procedureRef(child)}});
      const ref = procedureRef(root);
      const run = r.runner.start({name: root.id, code: root.code,
        procedure: {reference: ref, graph: resolveProcedure(ref, root.adapter, fixtureBlobs([root, child]))}});
      const terminal = await methodEnded(r, run.id);
      expect(terminal.status).toBe('failed');
      expect(terminal.error).toMatch(/mc.do|身体/);
      expect(Object.values(r.keys).some(Boolean)).toBe(false);
      expect(terminal.trace[0].procedure?.revision).toBe(child.revision);
    } finally {r.close();}
  });

  it('revokes unawaited child work and bounds repeated method invocations', async () => {
    const child = procedureFixture('read', 'return await mc.state();');
    for (const code of [`methods.run('read');return 1;`, `for(let i=0;i<33;i++) await methods.run('read');`]) {
      const root = procedureFixture('root', code, {dependencies: {read: procedureRef(child)}});
      let ended!: (r: MethodRun) => void;
      const result = new Promise<MethodRun>(resolve => {ended=resolve;});
      const runner = new MethodRunner({call: async () => new Promise(resolve => setTimeout(()=>resolve({observed:true}),10)), onFinish: ended});
      runners.push(runner);
      runner.start({name: root.id, code: root.code, procedure: {reference: procedureRef(root),
        graph: resolveProcedure(procedureRef(root), root.adapter, fixtureBlobs([root, child]))}});
      expect((await result).status).toBe('failed');
      expect(runner.current).toBeNull();
    }
  });
});
