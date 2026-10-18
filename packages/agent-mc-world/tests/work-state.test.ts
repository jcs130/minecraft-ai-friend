import { expect, it } from 'vitest';
import { resolveWorkReferences, type WorkReference, type WorkState } from '../src/contracts/index.ts';
const ref: WorkReference = { scope: { realm: 'fixture.test', account: 'player', agent: 'A' }, subject: 'quest', instance: 'accepted-1', revision: 1 };
const state: WorkState = { ...ref, revision: 2, status: 'completed', observedAt: '2026-01-01T12:00:00Z', evidence: { source: 'server', reference: 'event:123', text: 'Delivery confirmed' } };
it('retains exact closure evidence without mutating host references', () => {
  expect(resolveWorkReferences([ref], [state])).toEqual([{ reference: ref, state, disposition: 'retire' }]);
  expect(ref.revision).toBe(1);
});
it.each(['realm', 'account', 'agent'] as const)('does not close an intention in another %s', field => {
  expect(resolveWorkReferences([ref], [{ ...state, scope: { ...state.scope, [field]: 'other' } }])[0].disposition).toBe('unknown');
});
it('requires the same occurrence and ignores older revisions', () => {
  for (const other of [{ ...state, instance: 'accepted-2' }, { ...state, revision: 0 }, { ...state, subject: 'another' }])
    expect(resolveWorkReferences([ref], [other])[0].disposition).toBe('unknown');
});
it('does not turn active state, absent evidence or acceptance alone into completion', () => {
  expect(resolveWorkReferences([ref], [{ ...state, status: 'active' }])[0].disposition).toBe('active');
  expect(resolveWorkReferences([ref], [{ ...state, evidence: { ...state.evidence, text: '' } }])[0].disposition).toBe('unknown');
  expect(resolveWorkReferences([ref], [{ ...state, evidence: { ...state.evidence, source: 'agent' } as any }])[0].disposition).toBe('unknown');
});
it('leaves equal-revision contradictions unresolved independent of input order', () => {
  const active: WorkState = { ...state, status: 'active' };
  for (const rows of [[state, active], [active, state]]) {
    expect(resolveWorkReferences([ref], rows)[0].disposition).toBe('conflict');
    expect(resolveWorkReferences([ref], [...rows, { ...state, revision: 3 }])[0].disposition).toBe('retire');
  }
});
it('keeps malformed or unscoped legacy references unknown', () => {
  expect(resolveWorkReferences([{ ...ref, instance: '' }], [state])[0].disposition).toBe('unknown');
  expect(resolveWorkReferences([ref], [{ ...state, observedAt: 'yesterday' }])[0].disposition).toBe('unknown');
});
