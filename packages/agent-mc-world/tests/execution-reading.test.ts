import { expect, it } from 'vitest';
import { contextExecutionReading } from '../src/context.ts';

const terminal = () => ({ source: 'minecraft', ts: '2026-01-01T12:00:00Z', run: 'run-a', cursor: 19,
  text: 'Task blocked. ' + 'Large inventory body '.repeat(200), execution: { kind: 'task', id: 'epoch-a:12', phase: 'blocked', terminal: true,
    goalCompleted: false, evidence: { steps: [{ step: 1, outcome: 'fail', why: 'Different window…',
      detail: { text: 'Opened a custom dialogue window; trade indexes apply only to merchant windows. Read the menu contract before choosing again.',
        chars: 126, truncated: false }, observedEffect: { skill: 'use', changed: { position: false, inventory: false, window: false, target: null },
        before: { inventory: { diamonds: 999 } } } }] } } });

it('keeps the terminal identity and recovery condition without including snapshots or declaring the goal complete', () => {
  const event = terminal(), original = structuredClone(event), reading = contextExecutionReading(event)!;
  expect(reading).toMatchObject({ source: 'minecraft', run: 'run-a', cursor: 19, at: event.ts,
    id: 'epoch-a:12', phase: 'blocked', terminal: true, goalCompleted: false,
    steps: [{ reason: { text: event.execution.evidence.steps[0].detail.text, kind: 'detail', truncated: false },
      changed: { target: null, position: false, inventory: false, window: false } }] });
  expect(reading).not.toHaveProperty('receipt'); expect(JSON.stringify(reading)).not.toContain('diamonds');
  expect(event).toEqual(original);
});

it('uses an attributed excerpt for older receipts and never infers a terminal from prose or acceptance', () => {
  const event = terminal(); delete (event.execution.evidence.steps[0] as { detail?: unknown }).detail;
  const reading = contextExecutionReading(event, 80)!;
  expect(reading.steps[0].reason?.kind).toBe('preview');
  expect(reading.receipt).toEqual({ text: event.text.slice(0, 80), chars: event.text.length, truncated: true });
  expect(contextExecutionReading({ ...event, execution: undefined })).toBeNull();
  expect(contextExecutionReading({ ...event, execution: { ...event.execution, phase: 'accepted', terminal: false } })).toBeNull();
  expect(contextExecutionReading({ ...event, execution: { ...event.execution, phase: 'running' } })).toBeNull();
});

it('bounds unsuccessful steps and counts all omitted steps while preserving unknown changes and truncation', () => {
  const event = terminal(), detail = { text: 'Long recovery detail '.repeat(50), chars: 2000, truncated: true };
  event.execution.evidence.steps = Array.from({ length: 8 }, (_, index) => ({ ...event.execution.evidence.steps[0], step: index + 1, detail }));
  const reading = contextExecutionReading(event, 30)!;
  expect(reading.steps.map(step => step.step)).toEqual([5, 6, 7, 8]); expect(reading.omittedSteps).toBe(4);
  expect(reading.steps[0].reason).toEqual({ text: detail.text.slice(0, 30), chars: 2000, truncated: true, kind: 'detail' });
  expect(contextExecutionReading({ ...event, execution: { ...event.execution, goalCompleted: undefined } })?.goalCompleted).toBeNull();
  for (const limit of [-1, NaN, 1.5]) expect(() => contextExecutionReading(event, limit)).toThrow(TypeError);
});
