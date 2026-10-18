import { afterEach, expect, it, vi } from 'vitest';
import type { SkillCall } from '../core/skills.ts';
import { readSkillHelp } from '../core/skills.ts';
import { methodHarness } from './method-harness.ts';

afterEach(() => vi.restoreAllMocks());

const steep: SkillCall = { skill: 'tunnel', at: [-495, 58, 112] };
const holdStill: SkillCall = { skill: 'control', keys: [], durationMs: 2000, mode: 'ground' };

it.each(['replace', 'append', 'now', 'afterCheckpoint'] as const)(
  'rejects the measured impossible first tunnel before dispatch when idle (%s)', mode => {
    const r = methodHarness('1.21.1');
    try {
      r.bot.entity.position.set(-494.5, 63, 115.5);
      const before = r.bot.entity.position.clone(), admit = vi.fn();
      const decision = r.exec.submitDetailed([steep], mode, undefined, admit);
      expect(decision).toMatchObject({ accepted: false, rejection: { kind: 'correction', rule: 'tunnel.slope' } });
      expect(decision.receipt).toContain('横 3 格要升降 5 格');
      expect(decision.receipt).toContain('未入队');
      expect(admit).not.toHaveBeenCalled();
      expect(r.exec.status()).toMatchObject({ running: null, waiting: [] });
      expect(r.bot.entity.position).toEqual(before);
      expect(r.host.events).toHaveLength(0);
    } finally { r.close(); }
  },
);

it('keeps the current task, queue and admission callback untouched for an impossible immediate replacement', async () => {
  const r = methodHarness('1.21.1');
  try {
    r.bot.entity.position.set(-494.5, 63, 115.5);
    r.exec.submitDetailed([holdStill], 'append');
    r.exec.submitDetailed([holdStill], 'append');
    const before = r.exec.status(), admit = vi.fn();
    const result = r.exec.submitDetailed([steep], 'now', undefined, admit);
    expect(result).toMatchObject({ accepted: false, rejection: { rule: 'tunnel.slope' } });
    expect(r.exec.status().running?.id).toBe(before.running?.id);
    expect(r.exec.status().running?.skill).toBe('control');
    expect(r.exec.status().waiting).toEqual(before.waiting);
    expect(r.exec.status().hold).toBe(before.hold);
    expect(admit).not.toHaveBeenCalled();
    expect(r.host.events.some(e => String(e.text).includes('已叫停'))).toBe(false);
  } finally { r.close(); }
});

it('returns native help and machine admission evidence for a misaligned spiral', async () => {
  const r = methodHarness('1.21.1');
  try {
    const result = await r.world.tools().find(t => t.name === 'mc_do')!.handler({
      queue: 'now', steps: [{ skill: 'tunnel', at: [1, 70, 0], spiral: true }],
    }, { role: 'test', log: r.host.log });
    expect(result).toMatchObject({ failed: true, meta: { admission: {
      accepted: false, rule: 'tunnel.spiralAlignment', kind: 'correction',
      recovery: [{ tool: 'mc_help', arguments: { skill: 'tunnel' }, text: (readSkillHelp({ skill: 'tunnel' }) as { text: string }).text }],
    } } });
    expect(r.exec.status()).toMatchObject({ running: null, waiting: [] });
  } finally { r.close(); }
});

it.each(['replace', 'append', 'afterCheckpoint'] as const)(
  'does not use the current location as a future queued tunnel start (%s)', mode => {
    const r = methodHarness('1.21.1');
    try {
      r.exec.submitDetailed([holdStill], 'append');
      expect(r.exec.submitDetailed([{ skill: 'tunnel', at: [1, 70, 0] }], mode).accepted).toBe(true);
    } finally { r.close(); }
  },
);

it.each([
  [{ skill: 'goto', at: [1, 64, 0], exact: true }, { skill: 'tunnel', at: [1, 70, 0], spiral: true }],
  [holdStill, { skill: 'tunnel', at: [1, 70, 0] }],
  [{ skill: 'tunnel', at: [1, 70, 0], dryRun: true }],
  [{ skill: 'tunnel', at: [0, 70, 0], spiral: true }],
].map(steps => ({ steps: steps as SkillCall[] })))('leaves prefix-dependent, preview and aligned plans to their execution contract: %j', ({ steps }) => {
  const r = methodHarness('1.21.1');
  try { expect(r.exec.submitDetailed(steps, 'append').accepted).toBe(true); }
  finally { r.close(); }
});

it.each(['environment', 'external', 'fall'] as const)('does not infer a stable tunnel start during a %s hold', slot => {
  const r = methodHarness('1.21.1');
  try {
    if (slot === 'environment') r.exec.pauseForEnvironment('test body owner');
    else if (slot === 'external') r.exec.pauseForExternal('test body owner');
    else r.exec.stopCurrent('test body owner');
    expect(r.exec.submitDetailed([{ skill: 'tunnel', at: [1, 70, 0] }], 'now').accepted).toBe(true);
  } finally { r.close(); }
});

it.each(['moving', 'airborne', 'precheck-disabled'] as const)('leaves %s geometry to the fresh execution check', state => {
  const r = methodHarness('1.21.1');
  try {
    if (state === 'moving') Object.assign(r.bot.pathfinder, { isMoving: () => true });
    else if (state === 'airborne') r.bot.entity.onGround = false;
    else (r.exec as unknown as { opts: { precheck: () => boolean } }).opts.precheck = () => false;
    expect(r.exec.submitDetailed([{ skill: 'tunnel', at: [1, 70, 0] }], 'now').accepted).toBe(true);
  } finally { r.close(); }
});

it('checks a relative first target from the frozen admission anchor without rewriting later steps', () => {
  const r = methodHarness('1.21.1');
  try {
    const steps: SkillCall[] = [{ skill: 'tunnel', at: ['~1', '~6', '~'] }, { skill: 'look', at: ['~', '~', '~1'] }];
    const before = structuredClone(steps);
    expect(r.exec.submitDetailed(steps).rejection?.rule).toBe('tunnel.slope');
    expect(steps).toEqual(before);
  } finally { r.close(); }
});
