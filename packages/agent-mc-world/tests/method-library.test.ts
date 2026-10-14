import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MethodLibrary } from '../core/method-library.ts';
import type { MethodRun } from '../core/method-runner.ts';
import { methodHarness, methodEnded } from './method-harness.ts';

const args = (code: string, parent: string | null = null) => ({ id: 'step-check', code, parent,
  description: 'Observe a short move and return its real displacement.', conditions: ['Only use after checking loaded collision and support.'] });
const validated = (code: string): MethodRun => ({ id: 1, name: 'step-check', sourceHash: createHash('sha256').update(code).digest('hex'),
  startedAt: new Date().toISOString(), status: 'validated', trace: [] });

describe('portable editable methods', () => {
  it('requires exact syntax validation, optimistic parent, and preserves old sources across reload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-methods-'));
    try {
      const lib = new MethodLibrary(dir), code = 'return await mc.state();';
      expect(() => lib.save(args(code), undefined, 'main')).toThrow(/语法校验/);
      expect(() => lib.save(args(code), validated('return 1;'), 'main')).toThrow(/语法校验/);
      const first = lib.save(args(code), validated(code), 'main') as any;
      const next = 'const s=await mc.state();return s.snapshot?.position;';
      expect(() => lib.save(args(next), validated(next), 'main')).toThrow(/parent/);
      const second = lib.save(args(next, first.reference.revision), validated(next), 'main') as any;
      const restored = new MethodLibrary(dir);
      expect(restored.read('step-check').code).toBe(next);
      expect(restored.read('step-check', first.reference.revision).code).toBe(code);
      expect(restored.read('step-check').parent).toBe(first.reference.revision);
      expect(second).toMatchObject({ persistent: true, verifiedImprovement: false, author: { kind: 'agent', role: 'main' } });
      expect(() => restored.read('../engine')).toThrow();
      expect(new MethodLibrary(null).blob(first.reference.handle)).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('validates, saves, runs and revises through the actual tool and executor, with terminal receipts and physics', async () => {
    const r = methodHarness();
    try {
      const tool = r.world.tools().find(t => t.name === 'mc_script')!;
      const call = (a: Record<string, unknown>) => tool.handler(a, { role: 'main', log: r.host.log });
      const code = 'const before=await mc.state();const action=await mc.do([{skill:"control",keys:["forward"],durationMs:200}]);return {done:action.done,before:before.snapshot.position,after:action.state.snapshot.position};';
      await call({ name: 'step-check', code, validate: true });
      const syntax = await methodEnded(r, r.runner.read().at(-1)!.id);
      expect(syntax.status).toBe('validated');
      expect(r.bot.entity.position.z).toBe(.5);
      const saved = await call({ library: { op: 'save', ...args(code), validationRunId: syntax.id } });
      const text = typeof saved === 'string' ? saved : saved.text;
      const reference = JSON.parse(text).reference;
      expect(reference.handle).toMatch(/^mem:mc-method\//);
      await call({ procedure: reference });
      const run = await methodEnded(r, r.runner.read().at(-1)!.id);
      expect(run.status).toBe('completed');
      expect(run.trace.some(t => t.method === 'do' && (t.result as any).done === true)).toBe(true);
      expect((run.result as any).after.z).not.toBe((run.result as any).before.z);
      expect(run.procedure?.versions[0]).toMatchObject({ revision: reference.revision, parent: null, author: { kind: 'agent' } });
      const revised = code.replace('forward', 'left');
      await call({ name: 'step-check', code: revised, validate: true });
      const syntax2 = await methodEnded(r, r.runner.read().at(-1)!.id);
      const save2 = await call({ library: { op: 'save', ...args(revised, reference.revision), validationRunId: syntax2.id } });
      const reference2 = JSON.parse(typeof save2 === 'string' ? save2 : save2.text).reference;
      await call({ procedure: reference2 });
      const run2 = await methodEnded(r, r.runner.read().at(-1)!.id);
      expect(run2.status).toBe('completed');
      expect((run2.result as any).after.x).not.toBe((run2.result as any).before.x);
      expect(run2.procedure?.versions[0]?.parent).toBe(reference.revision);
      await call({ procedure: reference });
      const rollback = await methodEnded(r, r.runner.read().at(-1)!.id);
      expect(rollback.status).toBe('completed');
      expect(rollback.procedure?.versions[0]?.revision).toBe(reference.revision);
      expect((rollback.result as any).after.z).not.toBe((rollback.result as any).before.z);
      const bad = await call({ library: { op: 'save', ...args('return 2;', reference.revision), validationRunId: syntax.id } });
      expect(bad).toMatchObject({ failed: true });
      expect((await call({ library: { op: 'list' }, stop: true }))).toMatchObject({ failed: true });
    } finally { r.close(); }
  });
});
